# -*- coding: utf-8 -*-
"""解析《大学英语四级/六级大纲单词表》纯文本，产出标准词表 JSON。

来源：mahavivo/english-wordlists（GitHub 公开仓库）
  CET4_edited.txt —— "大学英语四级大纲单词表 (共 4615 词)"
  CET6_edited.txt —— 六级新增词表（不含四级部分）
下载副本：raw/_cet4_edited.txt / raw/_cet6_edited.txt

行格式：`word [音标] 释义`，另有单大写字母的分组标题行（A/B/C…）需要剔除。
产出：raw/prep/cet_outline.json
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "raw")
PREP = os.path.join(RAW, "prep")

# 与 etl.py 的 WORD_RE 保持一致：字母开头，可含撇号 / 连字符 / 空格
WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'’\- ]{0,38}$")
# 词表行：词 + （空格 | 紧贴的音标括号）
# 用 [\s\[（(] 而不是 \s —— 原表里 "instruct[ inˈstrʌkt]"、"manager[ ˈmænidʒə]" 缺空格，
# 只认空格会漏掉这类词；而 "a.m" / "B.C." / "i.e." 因为后面是「.」仍会被正确排除。
HEAD_RE = re.compile(r"^([A-Za-z][A-Za-z'’\-]*)(?=[\s\[（(])")


def log(*a):
    print(*a)
    sys.stdout.flush()


def parse(path, label):
    if not os.path.exists(path):
        log(f"   ! 缺少 {path}")
        return [], []
    words, skipped = [], []
    with open(path, encoding="utf-8") as f:
        for ln in f:
            s = ln.strip().lstrip("\ufeff")
            if not s:
                continue
            if re.match(r"^[A-Z]$", s):          # 分组标题 A/B/C
                continue
            if re.match(r"^[（(]", s) or "词表" in s and len(s) < 30:
                continue
            m = HEAD_RE.match(s)
            if not m:
                skipped.append(s)
                continue
            w = m.group(1)
            if not WORD_RE.match(w):
                skipped.append(s)
                continue
            words.append(w.lower())
    uniq = sorted(set(words))
    log(f"   {label:12s} 解析 {len(words):5d} → 去重 {len(uniq):5d} 词" +
        (f"（跳过 {len(skipped)} 行）" if skipped else ""))
    if skipped:
        for s in skipped[:6]:
            log(f"       跳过: {s[:70]}")
    return uniq, skipped


log("→ 解析四六级大纲词表")
cet4, sk4 = parse(os.path.join(RAW, "_cet4_edited.txt"), "四级大纲")
cet6, sk6 = parse(os.path.join(RAW, "_cet6_edited.txt"), "六级新增")

out = {
    "_note": "四六级大纲词表。cet4 = 四级大纲全量；cet6 = 六级在四级之外的新增词。"
             "由 _dev/prep_cet.py 从公开大纲文本解析，仅保留合法单词形，剔除分组标题行。",
    "_source": "mahavivo/english-wordlists / CET4_edited.txt + CET6_edited.txt",
    "cet4": cet4,
    "cet6": cet6,
}
os.makedirs(PREP, exist_ok=True)
p = os.path.join(PREP, "cet_outline.json")
json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

log(f"\n四级大纲 {len(cet4)} 词   六级新增 {len(cet6)} 词")
log(f"六级含四级覆盖 {len(set(cet4) & set(cet6))}/{len(cet4)}")
log(f"写出 {p}  {os.path.getsize(p)/1024:.1f} KB")
