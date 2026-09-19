# -*- coding: utf-8 -*-
"""README 体检：行尾、标签配对、图片/链接是否存在、站内锚点是否对得上标题。

零依赖、零出网，所以能进 CI（见 .github/workflows/verify.yml）。
它守的是最容易悄悄坏掉的一类东西：README 里引用了 42 张截图和若干对外下载地址，
谁改一次文件名、或者写错一个 `#锚点`，网页上就是一张碎图或一个死链 ——
而 git 不会报错、构建也不会报错。

用法：
    python _dev/check-readme.py [README.md]

要点：扫标签【必须先剥掉代码块 / 行内代码 / 注释】。
README 里到处是 `<select>`、`node <skills>/...` 这种字面标签与尖括号，
不剥就会报一堆假的「未闭合」—— 这个坑本项目栽过三次。
"""
import io
import os
import re
import sys

P = sys.argv[1] if len(sys.argv) > 1 else 'README.md'
raw = io.open(P, 'rb').read()
s = raw.decode('utf-8')

# ---- 1) 行尾 --------------------------------------------------------------
crlf = raw.count(b'\r\n')
print(f'行尾：CRLF {crlf} 处，LF {raw.count(chr(10).encode())} 处  '
      f'{"✓ 全 LF" if crlf == 0 else "!! 混入 CRLF"}')

# ---- 2) 剥掉不该参与标签扫描的部分 ------------------------------------------
stripped = s
stripped = re.sub(r'```.*?```', '', stripped, flags=re.S)      # 围栏代码块
stripped = re.sub(r'`[^`\n]*`', '', stripped)                  # 行内代码
stripped = re.sub(r'<!--.*?-->', '', stripped, flags=re.S)     # HTML 注释
stripped = re.sub(r'^\s{4,}.*$', '', stripped, flags=re.M)     # 缩进代码块

# ---- 3) 标签配对 ----------------------------------------------------------
VOID = {'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'col'}
tags = re.findall(r'<(/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?(/?)>', stripped)
stack = []
bad = []
for close, name, _, selfclose in tags:
    n = name.lower()
    if n in VOID or selfclose:
        continue
    if close:
        if not stack:
            bad.append(f'多余的 </{n}>')
        elif stack[-1] != n:
            bad.append(f'</{n}> 与最近的 <{stack[-1]}> 不匹配')
            stack.pop()
        else:
            stack.pop()
    else:
        stack.append(n)
print(f'标签：扫描到 {len(tags)} 个，未闭合 {len(stack)} 个 {stack}，异常 {len(bad)} 处')
for b in bad:
    print('   !!', b)

# ---- 4) 相对引用（Markdown 图片/链接 + HTML 的 src/href）是否都存在 --------
md_img = re.findall(r'!\[[^\]]*\]\(([^)]+)\)', s)
md_lnk = re.findall(r'(?<!!)\[[^\]]*\]\(([^)]+)\)', s)
html_src = re.findall(r'<img[^>]*\ssrc="([^"]+)"', s)
html_href = re.findall(r'<a[^>]*\shref="([^"]+)"', s)
refs = md_img + md_lnk + html_src + html_href

local = [r for r in refs if not re.match(r'^[a-z]+://', r) and not r.startswith('#')]
missing = []
for r in local:
    path = r.split('#')[0].split('?')[0].replace('%20', ' ')
    if path and not os.path.exists(path):
        missing.append(r)
print(f'\n相对引用：共 {len(local)} 个'
      f'（Markdown 图 {len(md_img)} / Markdown 链 {len(md_lnk)} /'
      f' HTML src {len(html_src)} / HTML href {len(html_href)}），失效 {len(missing)} 个')
for m in missing:
    print('   !! 找不到', m)

# ---- 5) 站内锚点链接是否对得上标题 ------------------------------------------
def slug(h):
    h = re.sub(r'[`*_\[\]()]', '', h).strip()
    h = h.lower().replace(' ', '-')
    h = re.sub(r'[^\w\u4e00-\u9fff\-]', '', h)
    return h

heads = set()
in_fence = False
for line in s.splitlines():
    if line.strip().startswith('```'):
        in_fence = not in_fence
        continue
    if in_fence:
        continue
    m = re.match(r'^(#{1,6})\s+(.*)$', line)
    if m:
        heads.add(slug(m.group(2)))
anchors = [r[1:] for r in refs if r.startswith('#')]
bad_anchor = [a for a in anchors if a not in heads]
print(f'站内锚点：{len(anchors)} 个，对不上标题的 {len(bad_anchor)} 个')
for a in bad_anchor:
    print(f'   !! #{a}   （现有标题 slug 里有：{[h for h in heads if a[:3] in h][:3]}）')

# ---- 6) 外部链接清单（只列 github 的，确认都指向本仓） ----------------------
ext = sorted({r for r in refs if r.startswith('http')})
print(f'\n外部链接 {len(ext)} 条：')
for e in ext:
    print('   ', e)

ok = (crlf == 0 and not stack and not bad and not missing and not bad_anchor)
print('\n' + ('✓ README 体检通过' if ok else '!! README 体检有问题'))
sys.exit(0 if ok else 1)
