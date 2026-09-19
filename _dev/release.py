#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按版本号打 tag 并建 GitHub Release，自动把产物挂成 Release 附件。

为什么需要它：安卓 APK 是二进制，每重新打包一次就会在 git 历史里永久留一个副本（删不掉）。
正确做法是「源码进仓库、产物进 Release」，但手动做这件事很容易漏步骤（忘了推 tag、
忘了传附件、Release 正文和 CHANGELOG 不一致）。这个脚本把这几步固定下来。

用法：
    python _dev/release.py 1.2              # 打 tag v1.2 + 建 Release + 上传附件
    python _dev/release.py 1.2 --dry-run    # 只打印将要做什么，不动远端
    python _dev/release.py --list           # 列出已有 Release
    python _dev/release.py 1.2 --notes-only # 只打印从 CHANGELOG 摘出来的正文

约定：
  · Release 正文自动从 CHANGELOG.md 里 `## [1.2]` 那一段摘取（单一事实来源，不会两边不一致）
  · 附件默认传 dist/词匠-离线背单词.html 与词匠.apk，存在什么传什么
  · 凭据走 `git credential fill`（即 Git Credential Manager 已存的那份），**脚本里不存任何密钥**
  · 需要 token 具备 `repo` 权限（建/改 Release 属于写操作）
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

API = 'https://api.github.com'
UPLOADS = 'https://uploads.github.com'
UA = 'wordforge-release-helper'

# 要挂到 Release 上的产物（按这个顺序）。不存在就跳过，不报错。
ASSETS = [
    ('dist/词匠-离线背单词.html', 'text/html'),
    ('词匠.apk', 'application/vnd.android.package-archive'),
]


# ---------------------------------------------------------------- 基础工具
def git(*args, timeout=180):
    env = dict(os.environ)
    env['GIT_TERMINAL_PROMPT'] = '0'
    env['GCM_INTERACTIVE'] = 'never'
    r = subprocess.run(['git', '-c', 'core.quotepath=false', *args],
                       capture_output=True, env=env, timeout=timeout)
    return (r.returncode,
            (r.stdout or b'').decode('utf-8', 'replace').strip(),
            (r.stderr or b'').decode('utf-8', 'replace').strip())


_TOKEN = None


def token():
    """从 credential helper 取 token。取不到就明确报错，不回显任何密钥内容。

    惰性求值：只在真的要访问 API 时才去取，所以 --notes-only 这种纯本地操作
    在没有凭据的机器上也能跑（方便离线校对 Release 正文）。
    """
    global _TOKEN
    if _TOKEN:
        return _TOKEN
    req = b'protocol=https\nhost=github.com\n\n'
    env = dict(os.environ)
    env['GIT_TERMINAL_PROMPT'] = '0'
    env['GCM_INTERACTIVE'] = 'never'
    r = subprocess.run(['git', 'credential', 'fill'], input=req,
                       capture_output=True, env=env, timeout=90)
    out = (r.stdout or b'').decode('utf-8', 'replace')
    for line in out.splitlines():
        if line.startswith('password='):
            _TOKEN = line.split('=', 1)[1].strip()
            return _TOKEN
    sys.exit('!! 取不到 GitHub 凭据。先随便 push 一次让 Git Credential Manager 登录，或改用 PAT。')


def api(path, method='GET', body=None, raw=None, ctype=None, timeout=300):
    url = path if path.startswith('http') else API + path
    headers = {
        'Authorization': 'Bearer ' + token(),
        'Accept': 'application/vnd.github+json',
        'User-Agent': UA,
        'X-GitHub-Api-Version': '2022-11-28',
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if raw is not None:
        data = raw
        headers['Content-Type'] = ctype or 'application/octet-stream'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read()
            return resp.status, (json.loads(payload.decode('utf-8')) if payload.strip().startswith(b'{')
                                 or payload.strip().startswith(b'[') else payload)
    except urllib.error.HTTPError as ex:
        txt = ex.read().decode('utf-8', 'replace')
        return ex.code, {'_raw': txt[:600]}


def md5(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def parse_remote():
    rc, o, _ = git('remote', 'get-url', 'origin')
    if rc:
        sys.exit('!! 没有 origin 远端')
    m = re.search(r'github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?$', o)
    if not m:
        sys.exit(f'!! 认不出这个远端地址：{o}')
    return m.group(1), m.group(2)


def notes_from_changelog(version):
    """从 CHANGELOG.md 摘 `## [1.2]` 那一段，作为 Release 正文。"""
    if not os.path.exists('CHANGELOG.md'):
        return None
    s = io.open('CHANGELOG.md', encoding='utf-8').read()
    # 匹配 `## [1.2]` 或 `## [1.2] · 日期`，一直取到下一个 `## ` 或文末
    pat = re.compile(r'^##\s*\[?' + re.escape(version) + r'\]?[^\n]*\n(.*?)(?=^##\s|\Z)',
                     re.S | re.M)
    m = pat.search(s)
    return m.group(0).strip() if m else None


# ---------------------------------------------------------------- 主流程
def main():
    argv = [a for a in sys.argv[1:]]
    flags = {a for a in argv if a.startswith('--')}
    args = [a for a in argv if not a.startswith('--')]

    owner, repo = parse_remote()
    print(f'仓库: {owner}/{repo}')

    if '--list' in flags:
        st, data = api(f'/repos/{owner}/{repo}/releases')
        if st != 200:
            sys.exit(f'!! 列举 Release 失败 HTTP {st}: {data}')
        if not data:
            print('  (还没有任何 Release)')
        for r in data:
            print(f'  {r["tag_name"]:10s} {r["name"]}  assets={len(r.get("assets", []))}')
        return

    if not args:
        sys.exit(__doc__)
    version = args[0].lstrip('v')
    tag = 'v' + version

    explicit = notes_from_changelog(version)
    if '--notes-only' in flags:
        print(explicit or f'(CHANGELOG.md 里没有 [{version}] 段落，正文将用兜底文案)')
        return

    # 1) 工作区必须干净 —— 否则 tag 会指向一个「有未提交改动」的状态
    rc, dirty, _ = git('status', '--porcelain')
    if dirty and '--allow-dirty' not in flags:
        sys.exit('!! 工作区不干净，先提交再发版（确实要发就加 --allow-dirty）：\n' + dirty)

    # 2) 本地/远端是否已有同名 tag
    rc, out, _ = git('rev-parse', '-q', '--verify', f'refs/tags/{tag}')
    tag_local = (rc == 0)
    rc, remote_tags, _ = git('ls-remote', '--tags', 'origin', tag)
    tag_remote = bool(remote_tags)

    exists, rel = api(f'/repos/{owner}/{repo}/releases/tags/{tag}')
    already = (exists == 200)

    assets = [(p, ct) for p, ct in ASSETS if os.path.exists(p)]
    if not assets:
        print('  ⚠️ 没有找到任何可上传的产物（dist/ 与 APK 都不存在），将建一个纯文本 Release')

    print(f'\n计划：tag={tag}  本地tag={"有" if tag_local else "无"}  '
          f'远端tag={"有" if tag_remote else "无"}  Release={"已存在" if already else "无"}')
    for p, _ in assets:
        print(f'  附件 {p}  {os.path.getsize(p):,} B  md5={md5(p)}')

    if '--dry-run' in flags:
        print('\n(--dry-run：到此为止，没有改动任何东西)')
        return

    if already and '--force' not in flags:
        sys.exit(f'!! Release {tag} 已存在。要重建加 --force（会删掉旧 Release 再建）')

    # 3) 打 tag 并推送
    if not tag_local:
        msg = f'词匠 WordForge {tag}'
        rc, o, e = git('tag', '-a', tag, '-m', msg)
        if rc:
            sys.exit(f'!! 打 tag 失败：{e}')
        print(f'\n✓ 已创建本地注释 tag {tag}')
    else:
        print(f'\n· 本地已有 tag {tag}，跳过创建')
    if not tag_remote:
        rc, o, e = git('push', 'origin', tag)
        if rc:
            sys.exit(f'!! 推送 tag 失败：{e}')
        print(f'✓ 已推送 tag {tag} 到远端')
    else:
        print(f'· 远端已有 tag {tag}，跳过推送')

    # 4) 建（或重建）Release
    if already and '--force' in flags:
        st, _ = api(f'/repos/{owner}/{repo}/releases/{rel["id"]}', method='DELETE')
        print(f'✓ 已删除旧 Release（HTTP {st}）')

    body = explicit or (f'词匠 WordForge {tag}\n\n完全离线的背单词应用。\n'
                        f'详细变更见 [CHANGELOG.md](../blob/main/CHANGELOG.md)。')
    st, rel = api(f'/repos/{owner}/{repo}/releases', method='POST', body={
        'tag_name': tag,
        'name': f'词匠 WordForge {tag}',
        'body': body,
        'draft': False,
        'prerelease': False,
    })
    if st not in (200, 201):
        sys.exit(f'!! 建 Release 失败 HTTP {st}: {rel}')
    print(f'✓ Release 已建：{rel["html_url"]}')
    print(f'  正文 {len(body)} 字符（来源：{"CHANGELOG.md" if explicit else "兜底文案"}）')

    # 5) 传附件
    for path, ctype in assets:
        name = os.path.basename(path)
        q = urllib.parse.urlencode({'name': name})
        with open(path, 'rb') as f:
            blob = f.read()
        st, out = api(f'{UPLOADS}/repos/{owner}/{repo}/releases/{rel["id"]}/assets?{q}',
                      method='POST', raw=blob, ctype=ctype, timeout=900)
        if st in (200, 201):
            print(f'✓ 附件已上传 {name}  {out.get("size", 0):,} B')
            print(f'    {out.get("browser_download_url")}')
        else:
            print(f'!! 附件 {name} 上传失败 HTTP {st}: {out}')

    print(f'\n完成。Release 页：https://github.com/{owner}/{repo}/releases/tag/{tag}')


if __name__ == '__main__':
    main()
