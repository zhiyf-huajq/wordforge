# -*- coding: utf-8 -*-
# 反查 ECDICT translation 字段实际使用的词性标记集合与分布
# 目的：用数据确定 POS 提取正则的 token 表，而不是凭印象猜
import csv, re, json, collections

csv.field_size_limit(10 ** 7)

vocab = set()
for r in json.load(open("build/data_words.json", encoding="utf-8")):
    vocab.add(str(r[0]).lower())

# 宽松扫描：任何 1~8 个字母 + 点，且左边不是字母（避免 adv. 里的 v.）
TOK = re.compile(r"(?<![A-Za-z])([A-Za-z]{1,8})\.")

cnt = collections.Counter()
lead = collections.Counter()       # 行首词性
samples = collections.defaultdict(list)
rows = 0
lines_total = 0
lines_with_lead = 0
lines_with_any = 0

with open("raw/ecdict.csv", encoding="utf-8", newline="") as f:
    rd = csv.DictReader(f)
    for row in rd:
        w = (row.get("word") or "").strip().lower()
        if w not in vocab:
            continue
        tr = row.get("translation") or ""
        rows += 1
        for line in tr.split("\n"):
            line = line.strip()
            if not line:
                continue
            lines_total += 1
            found = TOK.findall(line)
            if found:
                lines_with_any += 1
            m0 = TOK.match(line)
            if m0:
                lines_with_lead += 1
                lead[m0.group(1).lower()] += 1
            for t in found:
                t = t.lower()
                cnt[t] += 1
                if len(samples[t]) < 2:
                    samples[t].append(w + " | " + line[:66])

print("命中词条      ", rows)
print("释义总行数    ", lines_total)
print("含词性标记行  ", lines_with_any, " (%.1f%%)" % (lines_with_any / lines_total * 100))
print("行首即词性    ", lines_with_lead, " (%.1f%%)" % (lines_with_lead / lines_total * 100))
print()
print("--- 全部词性 token 频次（按出现次数，含非行首）---")
for t, c in cnt.most_common(60):
    print("  %-8s %7d   例: %s" % (t + ".", c, samples[t][0] if samples[t] else ""))
print()
print("--- 行首词性频次 ---")
for t, c in lead.most_common(30):
    print("  %-8s %7d" % (t + ".", c))
