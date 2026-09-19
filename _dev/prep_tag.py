# -*- coding: utf-8 -*-
"""从 ECDICT 主表抽取官方大纲 tag 词表（cet4 / cet6 / gk / zk / ky / toefl / ielts / gre）
产出 raw/prep/tag.json —— 只保留小写纯字母词形，按 word 归一化。
用途：为内置词书提供「大纲全量」词表，并建立词书间的层级包含关系。
"""
import csv, json, os, re, collections

csv.field_size_limit(10 ** 7)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "raw", "ecdict.csv")
OUT = os.path.join(ROOT, "raw", "prep", "tag.json")

TAGS = ["zk", "gk", "cet4", "cet6", "ky", "toefl", "ielts", "gre"]

WORDFORM = re.compile(r"^[a-z][a-z\-'. ]*$")


def norm(w):
    w = w.strip().lower()
    if not w or len(w) > 32:
        return ""
    if not WORDFORM.match(w):
        return ""
    if " " in w or "'" in w or "." in w:      # 只收单词，不收短语/缩写
        return ""
    return w


bucket = collections.defaultdict(set)
raw_rows = 0
for row in csv.DictReader(open(SRC, encoding="utf-8", newline="")):
    raw_rows += 1
    t = (row.get("tag") or "").strip().lower().split()
    if not t:
        continue
    w = norm(row.get("word") or "")
    if not w:
        continue
    for x in t:
        if x in TAGS:
            bucket[x].add(w)

out = {t: sorted(bucket[t]) for t in TAGS}

print("=== ECDICT 官方 tag 词表 ===")
for t in TAGS:
    print("  %-6s %5d" % (t, len(out[t])))

print("\n=== 层级包含关系（上者含下者的比例）===")
for a in TAGS:
    for b in TAGS:
        if a == b:
            continue
        A, B = bucket[a], bucket[b]
        if not B:
            continue
        inter = len(A & B)
        if inter / len(B) > 0.9:
            print("  %-6s ⊇ %-6s  %5d/%5d  (%.1f%%)" % (a, b, inter, len(B), 100.0 * inter / len(B)))

json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("\n写出 %s  %.1f KB" % (OUT, os.path.getsize(OUT) / 1024.0))
