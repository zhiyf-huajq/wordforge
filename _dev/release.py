#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按版本号打 tag 并建 GitHub Release，自动把产物挂成 Release 附件。

为什么需要它：安卓 APK 是二进制，每重新打包一次就会在 git 历史里永久留一个副本（删不掉）。
正确做法是「源码进仓库、产物进 Release」，但手动做这件事很容易漏步骤（忘了推 tag、
忘了传附件、Release 正文和 CHANGELOG 不一致）。这个脚本把这几步固定下来。

用法：
    python _dev/release.py 1.2              # 打 tag v1.2 + 建 Release + 上传附件
    python _dev/release.py 1.2 --dry-run    # 只打印将要做什么，不动远端
    python _dev/release.py --list           # 列出已有 Release 与附件
    python _dev/release.py --self-test      # 核对「版本号 → CHANGELOG 段落」逐段对得上
    python _dev/release.py 1.2 --notes-only # 只打印从 CHANGELOG 摘出来的正文
    python _dev/release.py 1.2 --sync-notes # 只把已发 Release 的正文按 CHANGELOG 重刷

约定：
  · Release 正文自动从 CHANGELOG.md 里 `## [1.2]` 那一段摘取（单一事实来源，不会两边不一致）
  · 附件默认传 dist/词匠-离线背单词.html 与词匠.apk，存在什么传什么
  · 凭据走 `git credential fill`（即 Git Credential Manager 已存的那份），**脚本里不存任何密钥**
  · 需要 token 具备 `repo` 权限（建/改 Release 属于写操作）

⚠️ 附件名必须【纯 ASCII】—— 这是踩过的坑，GitHub 不报错、不回滚，只是静默改名：
   GitHub 会把附件名里的非 ASCII 字符直接剥掉。`词匠-离线背单词.html` 剥掉中文只剩 `-.html`；
   `词匠.apk` 剥成空名，于是回退成 `default.apk`。症状是「上传成功、体积和 MIME 都对，只有名字坏了」，
   所以只看返回的 size 就会以为没问题，必须回读 name 才算验过。
   故一律用 ASCII 名（见 ASSETS 第三列），中文说明放 label（label 允许中文）。
   另外故意【不带版本号】，这样下载地址可以永久写成
   https://github.com/<owner>/<repo>/releases/latest/download/wordforge.apk
   以后每次发版都不必再改 README 里的链接。
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
#   (仓库内路径, MIME, Release 附件名【必须纯 ASCII】, 中文标签)
# 附件名不带版本号，是为了让 releases/latest/download/<名字> 这个地址永久有效。
ASSETS = [
    ('dist/词匠-离线背单词.html', 'text/html',
     'wordforge.html', '单文件网页版 · 下载后双击即用'),
    ('词匠.apk', 'application/vnd.android.package-archive',
     'wordforge.apk', '安卓安装包'),
]

# 原名（人类看的）与 ASCII 附件名的对应，仅用于把旧 Release 里被改坏的附件清掉
LEGACY_BAD_NAMES = ['-.html', 'default.apk', '词匠-离线背单词.html', '词匠.apk']


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
    """从 CHANGELOG.md 摘 `## [1.2]` 那一段，作为 Release 正文。

    ⚠️ 版本号必须**整段**匹配，不能是前缀匹配。踩过的坑（真造成过破坏）：
    原写法 `^##\\s*\\[?1\\.1\\]?` 在文件里存在 `## [1.1.1]` 时会把 `1.1` 配到 `[1.1.1]` 上
    —— 因为 `]` 是可选量词，多余的 `1]` 被后面的 `[^\\n]*` 顺手吃掉了。
    于是「同步 1.1 的正文」实际写进去的是 1.1.1 的内容，
    **静默覆盖了已发布的 Release，全程没有任何报错**。
    现在要求版本号后面紧跟 `]`（有方括号时）或行尾 / 分隔符。
    配套的 `--self-test` 会逐段核对，别只测「能不能返回非空」——
    前缀误配时它照样返回非空，只是内容错了。
    """
    if not os.path.exists('CHANGELOG.md'):
        return None
    s = io.open('CHANGELOG.md', encoding='utf-8').read()
    v = re.escape(version)
    pat = re.compile(
        r'^##[ \t]*(?:\[(?P<br>' + v + r')\]|(?P<plain>' + v + r'))'
        r'(?=[ \t·—\-–|]|$)[^\n]*\n'
        r'(?P<body>.*?)(?=^##[ \t]|\Z)',
        re.S | re.M)
    m = pat.search(s)
    return m.group(0).strip() if m else None


def self_test():
    """核对「版本号 -> CHANGELOG 段落」的映射逐段都对得上。

    这是回归保护：前缀误配是静默的，不核对内容就发现不了。
    """
    if not os.path.exists('CHANGELOG.md'):
        sys.exit('!! 找不到 CHANGELOG.md')
    s = io.open('CHANGELOG.md', encoding='utf-8').read()
    vers = re.findall(r'^##[ \t]*\[([^\]]+)\]', s, re.M)
    if not vers:
        sys.exit('!! CHANGELOG.md 里没有 `## [x.y.z]` 形式的段落')

    bad = []
    for v in vers:
        got = notes_from_changelog(v)
        head = got.splitlines()[0] if got else None
        ok = bool(head) and head.startswith(f'## [{v}]')
        print(f'  {"✓" if ok else "!!"} 问 {v:8s} -> {head!r}')
        if not ok:
            bad.append(v)

    # 反向：不存在的版本号必须摘不到
    ghost = notes_from_changelog('99.99.99')
    ok = ghost is None
    print(f'  {"✓" if ok else "!!"} 问不存在的 99.99.99 -> {ghost!r}')
    if not ok:
        bad.append('99.99.99')

    print()
    if bad:
        sys.exit(f'!! 版本号匹配有问题：{bad}（前缀误配会静默写错 Release 正文）')
    print(f'✓ 版本号匹配自检通过（{len(vers)} 个段落逐一对上）')


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
            print(f'  {r["tag_name"]:10s} {r["name"]}  附件 {len(r.get("assets", []))} 个'
                  f'{"  draft" if r.get("draft") else ""}')
            for a in r.get('assets', []):
                flag = '' if a['name'].isascii() else '   ← 名字含非 ASCII，不正常'
                print(f'      · {a["name"]:26s} {a["size"]:>12,} B{flag}')
        return

    if not args:
        sys.exit(__doc__)
    version = args[0].lstrip('v')
    tag = 'v' + version

    explicit = notes_from_changelog(version)
    if '--notes-only' in flags:
        print(explicit or f'(CHANGELOG.md 里没有 [{version}] 段落，正文将用兜底文案)')
        return

    # 只把已发布 Release 的正文按 CHANGELOG 重刷一遍 —— 不碰 tag、不碰附件。
    # 用途：发完版才发现 CHANGELOG 写漏了一句，或措辞要改。
    # 之所以要专门做一条路径，是因为「Release 正文只有一个来源」这件事
    # 一旦破了例，下次两边就再也对不上了。
    if '--sync-notes' in flags:
        if not explicit:
            sys.exit(f'!! CHANGELOG.md 里没有 [{version}] 段落，不知道要同步什么')
        st, rel = api(f'/repos/{owner}/{repo}/releases/tags/{tag}')
        if st != 200:
            sys.exit(f'!! Release {tag} 不存在（HTTP {st}），没什么可同步的')
        st, out = api(f'/repos/{owner}/{repo}/releases/{rel["id"]}', method='PATCH',
                      body={'body': explicit})
        if st != 200:
            sys.exit(f'!! 同步正文失败 HTTP {st}: {out}')
        print(f'✓ Release {tag} 的正文已按 CHANGELOG.md 更新（{len(explicit)} 字符）')
        print(f'  {rel["html_url"]}')
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

    assets = [(p, ct, n, lb) for p, ct, n, lb in ASSETS if os.path.exists(p)]
    if not assets:
        print('  ⚠️ 没有找到任何可上传的产物（dist/ 与 APK 都不存在），将建一个纯文本 Release')

    # 附件名必须是纯 ASCII，先自己拦一道，别等 GitHub 静默改名
    for p, _, n, _ in assets:
        if not n.isascii():
            sys.exit(f'!! 附件名 {n!r} 含非 ASCII —— GitHub 会静默剥字符改名，必须换掉')

    print(f'\n计划：tag={tag}  本地tag={"有" if tag_local else "无"}  '
          f'远端tag={"有" if tag_remote else "无"}  Release={"已存在" if already else "无"}')
    for p, _, n, lb in assets:
        print(f'  附件 {os.path.basename(p)}  →  {n}   {os.path.getsize(p):,} B  md5={md5(p)}')
        print(f'        label = {lb}')

    if '--dry-run' in flags:
        print('\n(--dry-run：到此为止，没有改动任何东西)')
        return

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
    #    「已存在」不是错误 —— 重跑时应该只同步附件，而不是整体报错退出。
    if already and '--force' in flags:
        st, _ = api(f'/repos/{owner}/{repo}/releases/{rel["id"]}', method='DELETE')
        if st not in (200, 204):
            sys.exit(f'!! 删除旧 Release 失败 HTTP {st}')
        print(f'✓ 已删除旧 Release（HTTP {st}）')
        already = False

    if already:
        print(f'\n· Release 已存在，跳过创建：{rel["html_url"]}')
        print('  （tag 与正文都不动，只做附件同步；要整体重建加 --force）')
    else:
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
        print(f'\n✓ Release 已建：{rel["html_url"]}')
        print(f'  正文 {len(body)} 字符（来源：{"CHANGELOG.md" if explicit else "兜底文案"}）')

    # 5) 同步附件（幂等）
    #    先列出远端现有的附件：
    #      · 已知的坏名字（被 GitHub 剥掉中文留下的），删掉
    #      · 名字对但体积不符的，删掉重传
    #      · 名字对且体积一致的，跳过
    cur = {}
    st, lst = api(f'/repos/{owner}/{repo}/releases/{rel["id"]}/assets')
    if st == 200:
        cur = {a['name']: a for a in lst}

    want = {n: (p, ct, lb) for p, ct, n, lb in assets}

    for name, a in list(cur.items()):
        if name not in want:
            # 只清我们自己会产的格式，别动用户手动上传的其它文件
            if name in LEGACY_BAD_NAMES or name.endswith(('.html', '.apk')):
                st, _ = api(f'/repos/{owner}/{repo}/releases/assets/{a["id"]}', method='DELETE')
                print(f'· 清掉多余/坏名附件 {name}（HTTP {st}）')
                cur.pop(name)

    if not assets:
        print('（没有产物可传）')
    for path, ctype, name, label in assets:
        a = cur.get(name)
        if a and a.get('size') == os.path.getsize(path):
            print(f'· 附件 {name} 已存在且体积一致，跳过')
            continue
        if a:
            st, _ = api(f'/repos/{owner}/{repo}/releases/assets/{a["id"]}', method='DELETE')
            print(f'· 附件 {name} 体积不符，已删除旧的重传（HTTP {st}）')

        q = urllib.parse.urlencode({'name': name, 'label': label})
        with open(path, 'rb') as f:
            blob = f.read()
        st, out = api(f'{UPLOADS}/repos/{owner}/{repo}/releases/{rel["id"]}/assets?{q}',
                      method='POST', raw=blob, ctype=ctype, timeout=900)
        if st in (200, 201):
            got = out.get('name')
            # 关键：回读 name。只看 size 会漏掉「被静默改名」这种失败。
            ok = (got == name)
            print(f'{"✓" if ok else "!!"} 附件已上传 {name}  {out.get("size", 0):,} B'
                  f'  回读 name={got!r}' + ('' if ok else '  ← 名字不对，GitHub 改名了'))
            print(f'    {out.get("browser_download_url")}')
        else:
            print(f'!! 附件 {name} 上传失败 HTTP {st}: {out}')

    print(f'\n完成。Release 页：https://github.com/{owner}/{repo}/releases/tag/{tag}')
    print(f'稳定下载地址（以后换版本也不用改）：')
    for _, _, name, _ in assets:
        print(f'  https://github.com/{owner}/{repo}/releases/latest/download/{name}')


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        self_test()
        sys.exit(0)
    main()
