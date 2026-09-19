# -*- coding: utf-8 -*-
# Pass A：从 ECDICT translation 字段提取「词 → 词性」权威表
#
# 为什么要单独做一步：
#   1. ECDICT 的 translation 有 94.3% 的行以词性标记开头（n./a./vt./adv. ...），
#      是一份独立于 WordNet 的中文词典词性来源，可用来给 WordNet 的多词性做仲裁。
#   2. qwerty 词书自带的释义基本不带词性，早期把 POS 提取挂在「最终释义」上，
#      导致覆盖率只有 43%；本表让词性不再依赖释义来源。
#
# token 表由 _dev/pos_token_scan.py 实测反查得到，不靠猜：
#   n. 11541 / a. 5482 / vt. 1685 / vi. 431 / v. 486 / adv. 965 / adj. 26 / ad. 1
#   num. pron. prep. interj. abbr. conj. pl. int. aux. pref. quant. vbl. art.
#
# 两个 lookaround 是关键：
#   (?<![A-Za-z])  防止把 adv. 里的 v. 当成独立词性
#   (?![A-Za-z])   防止 a 抢先吃掉 adj. / art. / adv.
import csv, re, json, os, collections

csv.field_size_limit(10 ** 7)

VOCAB = set()
for r in json.load(open("build/data_words.json", encoding="utf-8")):
    VOCAB.add(str(r[0]).lower())

_POS_TOK = ("adj|adv|abbr|interj|prep|conj|pron|quant|vt|vi|num|art|int|aux|phr|pl|pref|vbl"
            "|n|v|a|ad")
POS_FIND = re.compile(r"(?<![A-Za-z])((?:" + _POS_TOK + r")\.)(?![A-Za-z])", re.I)
SPLIT = re.compile(r"\\r\\n|\\n|\r\n|\n")

# 归一：ECDICT 同时用 a. 与 adj.、ad. 与 adv.，统一成读者熟悉的形式
POS_NORM = {"a": "adj", "ad": "adv", "interj": "int", "vbl": "v"}
MAXPOS = 6

out = {}
rows = 0
hits = 0
lines = 0
lines_with = 0
tokcnt = collections.Counter()

with open("raw/ecdict.csv", encoding="utf-8", newline="") as f:
    rd = csv.DictReader(f)
    for row in rd:
        w = (row.get("word") or "").strip().lower()
        if w not in VOCAB:
            continue
        rows += 1
        tr = row.get("translation") or ""
        got = []
        for ln in SPLIT.split(tr):
            ln = ln.strip()
            if not ln:
                continue
            lines += 1
            found = POS_FIND.findall(ln)
            if found:
                lines_with += 1
            for t in found:
                t = t[:-1].lower()
                t = POS_NORM.get(t, t)
                tokcnt[t] += 1
                if t not in got and len(got) < MAXPOS:
                    got.append(t)
        if got:
            hits += 1
            out[w] = " ".join(x + "." for x in got)

os.makedirs("raw/prep", exist_ok=True)
p = "raw/prep/ecdict_pos.json"
with open(p, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

print("ECDICT 命中词条     ", rows)
print("释义行数            ", lines)
print("含词性标记的行      ", lines_with, "(%.1f%%)" % (lines_with / lines * 100))
print("提取到词性的词条    ", hits, "/", rows, "(%.1f%%)" % (hits / rows * 100))
print()
print("归一后词性 token 分布：")
for t, c in tokcnt.most_common(20):
    print("  %-8s %7d" % (t + ".", c))
print()
print("输出 " + p + "  %.0f KB" % (os.path.getsize(p) / 1024))
print()
for w in ["abandon", "acclaim", "about", "african", "beautiful", "accurately",
          "abide", "happy", "affluent", "abduct", "increase", "give"]:
    print("  " + w.ljust(12) + repr(out.get(w, "")))
