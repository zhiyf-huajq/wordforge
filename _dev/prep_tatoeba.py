# -*- coding: utf-8 -*-
"""
Tatoeba 中英平行句对 -> 每词挑 1 条最合适的例句（含中文翻译）
输出 raw/prep/tatoeba.json  { word: [英文句, 中文句] }
挑选策略：句长适中、目标词位置靠前、无怪异符号、中文长度合理
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
RAW = os.path.join(ROOT, "raw")
P = os.path.join(RAW, "npm2", "tatoeba-sentence-pairs-in-mandarin-chinese-english-0.20260520.0",
                 "package", "sentences.json")

def log(*a):
    print(*a); sys.stdout.flush()

words = json.load(open(os.path.join(ROOT, "build", "data_words.json"), encoding="utf-8"))
vocab = set()
for r in words:
    vocab.add(str(r[0]).lower())
log(f"词表 {len(vocab)} 词")

pairs = json.load(open(P, encoding="utf-8"))
log(f"句对 {len(pairs)} 条")

# 变形 -> 原形 反查（只收录「本身不在词表」的变形，避免抢占其他词的正确匹配）
LEM = os.path.join(RAW, "prep", "lemma.json")
form2lemma = {}
if os.path.exists(LEM):
    lem = json.load(open(LEM, encoding="utf-8"))
    for lemma_w, forms in (lem.get("lm") or {}).items():
        if lemma_w not in vocab:
            continue
        for f in forms.split(","):
            f = f.strip()
            if f and f not in vocab and f not in form2lemma:
                form2lemma[f] = lemma_w
    log(f"变形反查表 {len(form2lemma)} 条")
else:
    log("! 无 lemma.json，跳过变形匹配")

TOK = re.compile(r"[a-z]+(?:'[a-z]+)?")
WEIRD = set('%#"()[]{}*<>~^|\\/')

def tokens(s):
    return TOK.findall(s.lower())

def score(en, zh, w, tk, form):
    n = len(tk)
    if n < 4 or n > 16:
        return None
    if len(zh) < 4 or len(zh) > 72:
        return None
    # 目标词（或其变形）首次出现位置
    pos = None
    for i, t in enumerate(tk):
        if t == form:
            pos = i
            break
    if pos is None:
        for i, t in enumerate(tk):
            if t == w:
                pos = i
                break
    if pos is None:
        return None
    weird = sum(1 for ch in en if ch in WEIRD)
    caps = sum(1 for t in tk[1:] if t[0].isupper()) if len(tk) > 1 else 0
    s = 0.0
    s -= abs(n - 9) * 1.0
    s -= pos * 1.6
    s -= weird * 3.0
    s -= caps * 2.0
    s -= abs(len(zh) - 22) * 0.12
    if form != w:
        s -= 1.2          # 变形匹配略降权，优先原形精确匹配
    return s

best = {}
scanned = 0
exact_hit = 0
for item in pairs:
    if not isinstance(item, list) or len(item) < 4:
        continue
    zh, en = item[1], item[3]
    if not zh or not en:
        continue
    scanned += 1
    tk = tokens(en)
    if not tk:
        continue
    # 候选：(原形, 句中实际形态)
    cands = []
    seen_t = set()
    for t in tk:
        if t in seen_t:
            continue
        seen_t.add(t)
        if t in vocab:
            cands.append((t, t))
        elif t in form2lemma:
            cands.append((form2lemma[t], t))
    for w, form in cands:
        if form == w:
            exact_hit += 1
        sc = score(en, zh, w, tk, form)
        if sc is None:
            continue
        cur = best.get(w)
        if cur is None or sc > cur[0]:
            best[w] = (sc, en, zh)

log(f"扫描 {scanned} 句对（原形命中 {exact_hit} 次），覆盖 {len(best)} 词")
log(f"→ 繁体转换")
try:
    import zhconv
    conv = lambda s: zhconv.convert(s, "zh-cn")
except Exception as e:
    log("   ! zhconv 不可用，保留原文: " + str(e))
    conv = lambda s: s

out = {}
for w, (sc, en, zh) in best.items():
    en = en.strip()
    zh = conv(zh).strip()
    # 清理全角数字、多余空格
    zh = re.sub(r"[０-９]", lambda m: chr(ord(m.group(0)) - 0xFEE0), zh)
    en = re.sub(r"\s{2,}", " ", en)
    if len(en) > 150:
        en = en[:150].rstrip() + "…"
    if len(zh) > 90:
        zh = zh[:90].rstrip() + "…"
    out[w] = [en, zh]

os.makedirs(os.path.join(RAW, "prep"), exist_ok=True)
dst = os.path.join(RAW, "prep", "tatoeba.json")
json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
sz = os.path.getsize(dst)
log("")
log("=" * 56)
log(f"输出 {dst}  {sz/1024:.0f} KB")
log(f"  覆盖 {len(out)} / {len(vocab)} 词  ({len(out)*100/len(vocab):.1f}%)")
log("")
log("抽样：")
for w in ["happy", "abandon", "system", "increase", "difficult", "password", "sleep", "repeal"]:
    if w in out:
        log(f"  {w:12s} {out[w][0]}")
        log(f"  {'':12s} {out[w][1]}")
    else:
        log(f"  {w:12s} (未命中)")
