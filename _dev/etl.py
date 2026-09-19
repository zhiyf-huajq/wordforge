# -*- coding: utf-8 -*-
"""
词匠 WordForge · 词库构建
数据源：
  qwerty-learner 词书 (GPL-3.0)  -> 词书构成 + 美/英音标 + 精校中文释义
  ECDICT (MIT)                   -> 词形变化 / 英文释义 / 词频 / 柯林斯星级 / 牛津标记
  4000 Essential English Words   -> 部分例句
输出：build/data_words.json / build/data_books.json / build/data_roots.json
"""
import csv, json, os, re, sys, io

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "raw")
QW = os.path.join(RAW, "qwerty")
BUILD = os.path.join(HERE, "..", "build")
os.makedirs(BUILD, exist_ok=True)

# 字段索引（与 App 的 F 表一致）
W, US, UK, POS, CN, EN, EX, EXZ, TG, FM, BNC, FRQ, ST, OX, PH, RT, SYN, ANT, DIS, MN = range(20)

# 各文本字段上限（超出截断，控制单文件体积）
EN_MAXLEN = 180
EX_MAXLEN = 150
RT_MAXLEN = 110
DIS_MAXLEN = 420

# ---------- 词书定义 ----------
# (id, 名称, 描述, 分类, qwerty 词书文件, ECDICT 大纲 tag, 大纲词表键, 包含的词书)
#
#   qwerty 文件   —— 社区精校词书（含音标、中文释义），但是“核心词”不是考纲全量
#   ECDICT tag    —— ECDICT 主表 tag 列标注的官方考纲词（如 cet4=3846 / cet6=5406）
#   大纲词表键     —— _dev/prep_cet.py 从公开大纲文本解析出的全量词表
#   包含的词书     —— 全量口径下还应收录这些基础词书的全部词汇（六级含四级）
#
# 三者取并集，才既“不漏考纲”又“留着社区精校释义”。只靠 qwerty 时，
# 四级只有 2607 词、六级 2345 词，且六级完全不含四级 —— 考纲覆盖率严重不足。
BOOKS = [
    ("cet4",      "大学英语四级",   "CET-4 大纲词汇 4500+",       "大学考试", "CET4_T.json", "cet4", "cet4", []),
    ("cet6",      "大学英语六级",   "CET-6 大纲词汇 · 含四级全部", "大学考试", "CET6_T.json", "cet6", "cet6", ["cet4"]),
    ("kaoyan",    "考研英语",       "考研大纲核心词",              "考研",     "KaoYan_2024.json", "ky", None, []),
    ("ielts",     "雅思 IELTS",     "雅思学术类核心词",            "出国考试", "IELTS_3_T.json", "ielts", None, []),
    ("toefl",     "托福 TOEFL",     "托福核心词",                  "出国考试", "TOEFL_3_T.json", "toefl", None, []),
    ("gre",       "GRE",            "GRE 高频核心词",              "出国考试", "GRE_3_T.json", "gre", None, []),
    ("bec2",      "商务英语中级",   "BEC 中级商务词汇",            "商务",     "BEC_2_T.json", None, None, []),
    ("bec3",      "商务英语高级",   "BEC 高级商务词汇",            "商务",     "BEC_3_T.json", None, None, []),
    ("gaokao",    "高考 3500",      "高中英语考纲词",              "中学",     "GaoKao_3500.json", "gk", None, []),
    ("zhongkao",  "中考核心",       "初中英语核心词",              "中学",     "ZhongKaoHeXin.json", "zk", None, []),
    ("oxford3000","牛津核心 3000",  "Oxford 3000 最常用词",        "高频核心", "Oxford3000.json", None, None, []),
    ("oxford5000","牛津核心 5000",  "Oxford 5000 高频词",          "高频核心", "Oxford5000.json", None, None, []),
    ("coca20000", "COCA 两万高频",  "当代美语语料库前 20000 词",   "高频核心", "coca20000.json", None, None, []),
    ("longman3000","朗文交际 3000", "朗文口语交际高频词",          "高频核心", "Longman_Communication_3000.json", None, None, []),
    ("macmillan7000","麦克米伦 7000","Macmillan 高频词",           "高频核心", "Macmillan7000.json", None, None, []),
    ("essential4000","4000 必备词", "4000 Essential English Words","教材",     "4000_Essential_English_Words-meaning.json", None, None, []),
    ("nce1",      "新概念英语 1",   "NCE Book 1 词汇",             "教材",     "nce-new-1.json", None, None, []),
    ("nce2",      "新概念英语 2",   "NCE Book 2 词汇",             "教材",     "nce-new-2.json", None, None, []),
    ("nce3",      "新概念英语 3",   "NCE Book 3 词汇",             "教材",     "nce-new-3.json", None, None, []),
    ("nce4",      "新概念英语 4",   "NCE Book 4 词汇",             "教材",     "nce-new-4.json", None, None, []),
    ("voa",       "VOA 常速词汇",   "VOA 常用词",                  "听说",     "voa.json", None, None, []),
    ("verb1000",  "高频动词 1000",  "最常用动词",                  "专项",     "Top1000VerbWords.json", None, None, []),
    ("noun1500",  "高频名词 1500",  "最常用名词",                  "专项",     "Top1500NounWords.json", None, None, []),
    ("adj500",    "高频形容词 500", "最常用形容词",                "专项",     "Top500AdjectiveWords.json", None, None, []),
]

WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'’\- ]{0,38}$")
# ---- 词性标记表 ----
# token 由 _dev/pos_token_scan.py 对 ECDICT translation 字段实测反查得到，不靠猜：
#   n. 11541 / a. 5482 / vt. 1685 / vi. 431 / v. 486 / adv. 965 / adj. 26 / ad. 1
#   num. pron. prep. interj. abbr. conj. pl. int. aux. pref. quant. vbl. art.
# 旧版正则有两个硬 bug，导致词性覆盖率只有 43%（ECDICT 里 94.3% 的释义行其实都带词性）：
#   1) 缺 a. 与 ad. —— 形容词整类丢失
#   2) 要求词性前必须是空白，中文后紧贴的 vt. 全部漏掉（如「称赞vt. 称赞」）
# 两个 lookaround 是必需的：
#   (?<![A-Za-z])  防止把 adv. 里的 v. 当成独立词性
#   (?![A-Za-z])   防止 a 抢先吃掉 adj. / art. / adv.
_POS_TOK = ("adj|adv|abbr|interj|prep|conj|pron|quant|vt|vi|num|art|int|aux|phr|pl|pref|vbl"
            "|n|v|a|ad")
POS_RE = re.compile(r"^\s*((?:" + _POS_TOK + r")\.)\s*", re.I)
POS_FIND = re.compile(r"(?<![A-Za-z])((?:" + _POS_TOK + r")\.)(?![A-Za-z])", re.I)
# 归一：ECDICT 同时用 a./adj. 与 ad./adv.，统一成读者熟悉的形式
POS_NORM = {"a": "adj", "ad": "adv", "interj": "int", "vbl": "v"}

EX_MAP = {}   # word -> 英文例句
EN_MAP = {}   # word -> 英文释义（4000 必备词）

def log(*a):
    print(*a)
    sys.stdout.flush()

def load_json(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

def norm_word(s):
    return str(s or "").strip()

def split_tags(s):
    return [x for x in str(s or "").split("|") if x]

def clean_trans(items, limit=6, maxlen=140):
    out = []
    for it in items:
        s = str(it or "").strip()
        if not s:
            continue
        s = s.replace("；；", "；").strip()
        if len(s) > maxlen:
            s = s[:maxlen].rstrip() + "…"
        if s not in out:
            out.append(s)
        if len(out) >= limit:
            break
    return out

def pos_of(lines):
    """从释义行里抽取词性标记，按出现顺序去重，最多 6 个。"""
    got = []
    for s in lines:
        for m in POS_FIND.finditer(str(s or "")):
            t = m.group(1)[:-1].lower()
            t = POS_NORM.get(t, t) + "."
            if t not in got:
                got.append(t)
    return " ".join(got[:6])

# ---------- 1. 读 qwerty 词书 + 官方考纲词表 ----------
def _load_opt(name):
    p = os.path.join(RAW, "prep", name)
    if not os.path.exists(p):
        log(f"   ! 缺少 {name}（该来源的词表将为空）")
        return {}
    return json.load(open(p, encoding="utf-8"))

log("→ 读取官方考纲词表")
TAG_WORDS = _load_opt("tag.json")              # ECDICT tag：cet4/cet6/ky/gk/zk/…
OUTLINE_WORDS = _load_opt("cet_outline.json")  # 公开大纲文本解析出的四六级词表
OUTLINE_ALL = set()
for _v in OUTLINE_WORDS.values():
    if isinstance(_v, list):
        OUTLINE_ALL |= {str(x).lower() for x in _v}
for _k in ("cet4", "cet6"):
    log(f"   ECDICT {_k:5s} {len(TAG_WORDS.get(_k) or []):5d} 词   "
        f"大纲表 {len(OUTLINE_WORDS.get(_k) or []):5d} 词")

log("→ 读取 qwerty-learner 词书")
book_own = {}                                 # 本册自有词表（qwerty ∪ 考纲 tag ∪ 大纲表）
qw_only = {}
w_us, w_uk, w_trans = {}, {}, {}
for bid, name, desc, cat, fn, tg, ok, _inc in BOOKS:
    p = os.path.join(QW, fn)
    if not os.path.exists(p):
        log(f"   ! 缺失 {fn}")
        continue
    d = load_json(p)
    ws = []
    for it in d:
        if not isinstance(it, dict):
            continue
        w = norm_word(it.get("name"))
        if not w or not WORD_RE.match(w):
            continue
        key = w.lower()
        if key in ws:
            continue
        ws.append(key)
        if key not in w_us and it.get("usphone"):
            w_us[key] = str(it["usphone"]).strip()
        if key not in w_uk and it.get("ukphone"):
            w_uk[key] = str(it["ukphone"]).strip()
        if key not in w_trans:
            tr = it.get("trans") or []
            if isinstance(tr, str):
                tr = [tr]
            w_trans[key] = clean_trans(tr)
    qw_only[bid] = set(ws)
    extra = set()
    if tg:
        extra |= set(TAG_WORDS.get(tg) or [])
    if ok:
        extra |= set(OUTLINE_WORDS.get(ok) or [])
    book_own[bid] = set(ws) | {x.lower() for x in extra}
    log(f"   {bid:14s} qwerty {len(ws):6d}  + 考纲 {len(book_own[bid]) - len(ws):6d}  "
        f"= 自有 {len(book_own[bid]):6d} 词")

# ---- 展开「包含关系」：全量 = 自有 ∪ 所有前置词书的全量（递归 + 环保护）----
# 六级含四级就是在这里落地的：六级词条的 TG 会带上 cet4，四级词条的 TG 也会带上 cet6。
INC_MAP = {b[0]: list(b[7]) for b in BOOKS}
book_words = {}


def _full(bid, stack):
    if bid in book_words:
        return book_words[bid]
    if bid in stack:
        log(f"   ! 词书包含关系成环：{bid}")
        return set()
    stack.add(bid)
    s = set(book_own.get(bid) or ())
    for pre in INC_MAP.get(bid, []):
        s |= _full(pre, stack)
    stack.discard(bid)
    book_words[bid] = s
    return s


for _b in BOOKS:
    if _b[0] in book_own:
        _full(_b[0], set())
NAME_OF = {b[0]: b[1] for b in BOOKS}
for bid, inc in INC_MAP.items():
    if inc and bid in book_words:
        names = " / ".join(NAME_OF.get(x, x) for x in inc)
        base = set().union(*[book_words[x] for x in inc if x in book_words])
        log(f"   {bid:14s} 含《{names}》→ 全量 {len(book_words[bid]):6d} 词"
            f"（其中本册新增 {len(book_words[bid] - base):5d}）")

# 例句 / 英文释义补充
for fn, target in [("4000_Essential_English_Words-sentence.json", EX_MAP),
                   ("4000_Essential_English_Words-meaning.json", EN_MAP)]:
    p = os.path.join(QW, fn)
    if not os.path.exists(p):
        continue
    for it in load_json(p):
        w = norm_word(it.get("name")).lower()
        tr = it.get("trans") or []
        if w and tr and w not in target:
            target[w] = str(tr[0]).strip()

all_words = sorted(set().union(*book_words.values())) if book_words else []
log(f"→ 全部词书合计去重 {len(all_words)} 词")

# ---------- 2. 读 ECDICT ----------
ecd = {}
ep = os.path.join(RAW, "ecdict.csv")
if os.path.exists(ep) and os.path.getsize(ep) > 1000000:
    log(f"→ 读取 ECDICT ({os.path.getsize(ep)/1048576:.1f} MB)")
    tagset = {"cet4", "cet6", "ky", "toefl", "ielts", "gre", "zk", "gk"}
    with open(ep, encoding="utf-8", errors="ignore", newline="") as f:
        rd = csv.DictReader(f)
        n = 0
        for row in rd:
            n += 1
            w = (row.get("word") or "").strip().lower()
            if not w:
                continue
            tg = (row.get("tag") or "")
            # 保留条件：qwerty 词书词 / 命中考纲 tag / 命中大纲词表
            # （大纲表里有一批词 ECDICT 没打 tag，不显式放行就拿不到它的音标与释义）
            keep = w in w_trans or w in OUTLINE_ALL
            if not keep and tg:
                for t in tg.split():
                    if t in tagset:
                        keep = True
                        break
            if not keep:
                continue
            ex = row.get("exchange") or ""
            forms = []
            if ex:
                mp = {"p": "过去式", "d": "过去分词", "i": "现在分词", "3": "第三人称单数",
                      "r": "比较级", "t": "最高级", "s": "复数"}
                for seg in ex.split("/"):
                    if ":" in seg:
                        k, v = seg.split(":", 1)
                        if k in mp and v:
                            forms.append(mp[k] + ":" + v.strip())
            ecd[w] = {
                "ph": (row.get("phonetic") or "").strip(),
                "def": (row.get("definition") or "").strip(),
                "tr": (row.get("translation") or "").strip(),
                "pos": (row.get("pos") or "").strip(),
                "col": (row.get("collins") or "").strip(),
                "oxf": (row.get("oxford") or "").strip(),
                "bnc": (row.get("bnc") or "").strip(),
                "frq": (row.get("frq") or "").strip(),
                "tag": tg,
                "fm": "|".join(forms),
            }
        log(f"   ECDICT 总行 {n}, 命中 {len(ecd)} 词")
else:
    log("→ ! 未找到 ecdict.csv，仅用 qwerty 数据（词形变化/词频/英文释义将缺失）")

# ---------- 3. 读预处理后的扩充语料 ----------
PREP = os.path.join(RAW, "prep")
def load_prep(name, label):
    p = os.path.join(PREP, name)
    if not os.path.exists(p):
        log(f"   ! 缺少 {name}（{label} 将为空）")
        return {}
    d = json.load(open(p, encoding="utf-8"))
    log(f"   {label:12s} {os.path.getsize(p)/1024:7.0f} KB")
    return d

log("→ 读取扩充语料")
TATOEBA = load_prep("tatoeba.json", "中英例句")
WORDNET = load_prep("wordnet.json", "词网同反义")
ROOTS = load_prep("roots.json", "词根词缀")
RESEMBLE = load_prep("resemble.json", "近义词辨析")
LEMMA = load_prep("lemma.json", "词形还原")
COLLOC = load_prep("colloc.json", "常用搭配")
ECDICT_POS = load_prep("ecdict_pos.json", "词性权威表")
MNEMO = load_prep("mnemo.json", "巧记素材")
# 词根/词缀的中文释义表（人工校对：前缀 / 后缀 / 词根 三块）
ROOT_ZH = {}
_rzp = os.path.join(PREP, "root_zh.json")
if os.path.exists(_rzp):
    _rz = json.load(open(_rzp, encoding="utf-8"))
    for _sec in ("前缀", "后缀", "词根"):
        for _k, _v in (_rz.get(_sec) or {}).items():
            _kk = re.sub(r"\(.*?\)", "", _k)                      # 去掉 "ev (aev)" 这类括注
            _kk = re.sub(r"[-_]?\d+$", "", _kk.strip().lower().lstrip("-").rstrip("-"))
            if _kk:
                ROOT_ZH[_kk] = _v
    log(f"   词根中文释义 {len(ROOT_ZH)} 条")
else:
    log("   ! 缺少 root_zh.json（词根将显示英文原文）")

ORIGIN_ZH = {"Latin": "拉丁语", "Greek": "希腊语", "Old English": "古英语",
             "Middle English": "中古英语", "Latin and Greek": "拉丁语 / 希腊语"}


def _norm_pat(s):
    """模式归一化：去括注 → 去尾部序号 → 小写 → 去首尾连字符"""
    k = re.sub(r"\(.*?\)", "", str(s))
    k = re.sub(r"[-_]?\d+$", "", k.strip().lower())
    return k.strip().lstrip("-").rstrip("-").strip()


def root_zh(pat):
    """把词根/词缀模式转成中文释义，取不到时返回空串（调用方回退英文）。

    ECDICT 的模式常写成别名列表 —— "ab-, abs"、"ant, -ent"、"circu-, circum"。
    只拿整串查表必然落空，这 191 条会退回英文原文，所以要拆开逐个查。
    """
    base = re.sub(r"\(.*?\)", "", str(pat)).strip()
    cands = [base] + [x.strip() for x in re.split(r"[,，/|]", base)]
    for c in cands:
        k = _norm_pat(c)
        if k and k in ROOT_ZH:
            return ROOT_ZH[k]
    return ""

ROOT_LIST = ROOTS.get("list") or []
ROOT_BY_WORD = ROOTS.get("byWord") or {}
DIS_GROUPS = RESEMBLE.get("g") or []
DIS_BY_WORD = RESEMBLE.get("byWord") or {}
LEMMA_FM = LEMMA.get("fm") or {}

def build_rt(w):
    idxs = ROOT_BY_WORD.get(w)
    if not idxs:
        return ""
    parts = []
    for i in idxs:
        if i >= len(ROOT_LIST):
            continue
        pat, cls, mean, origin, _n = ROOT_LIST[i]
        # 前缀补尾连字符、后缀补头连字符，便于一眼分辨词缀位置
        if "前缀" in cls:
            disp = pat + "-"
        elif "后缀" in cls:
            disp = "-" + pat
        else:
            disp = pat
        # 释义优先用人工校对的中文，取不到再回退 ECDICT 英文原文
        mz = root_zh(pat) or mean
        oz = ORIGIN_ZH.get(origin, origin)
        seg = disp + ("（" + mz + "）" if mz else "")
        if oz:
            seg += " " + oz
        parts.append(seg)
    return " · ".join(parts)[:RT_MAXLEN]

def build_dis(w):
    idxs = DIS_BY_WORD.get(w)
    if not idxs:
        return ""
    i = idxs[0]
    if i >= len(DIS_GROUPS):
        return ""
    g = DIS_GROUPS[i]
    t = g["w"] + "\n" + g["b"]
    if len(t) > DIS_MAXLEN:
        t = t[:DIS_MAXLEN].rstrip() + "…"
    return t

# ---------- 4. 合并 ----------
log("→ 合并生成词条")
VOCAB_SET = set(all_words)

def pref_in_vocab(lst, n):
    """词表内的词优先展示（学习者能直接查到），词表外的顺位补充。
    只调整顺序、不删条目，因此不会损失覆盖率。"""
    inside = [x for x in lst if x in VOCAB_SET]
    outside = [x for x in lst if x not in VOCAB_SET]
    return (inside + outside)[:n]

words = []
for w in all_words:
    e = ecd.get(w, {})
    tg_list = []
    for _b in BOOKS:
        bw = book_words.get(_b[0])
        if bw and w in bw:
            tg_list.append(_b[0])
    tr = list(w_trans.get(w) or [])
    if not tr and e.get("tr"):
        tr = clean_trans(re.split(r"\\n|\n", e["tr"]))
    if not tr:
        continue
    us = w_us.get(w) or e.get("ph") or ""
    uk = w_uk.get(w) or ""
    if us and uk and us == uk:
        uk = ""
    en = e.get("def") or EN_MAP.get(w, "")
    # ECDICT 的 definition 用「字面 \n」分段（反斜杠+n 两字符），需还原成单行可读文本
    en = re.sub(r"[ \t]*\\n[ \t]*", " / ", en)
    en = re.sub(r"\s*\n\s*", " / ", en)
    en = re.sub(r"(?:\s*/\s*){2,}", " / ", en)
    en = en.strip(" /").strip()
    if len(en) > EN_MAXLEN:
        en = en[:EN_MAXLEN].rstrip() + "…"

    # ---- 例句：Tatoeba(中英) > 4000必备(中英) > WordNet(纯英语境) ----
    wn = WORDNET.get(w) or {}
    ex, exz = "", ""
    tat = TATOEBA.get(w)
    if tat:
        ex, exz = tat[0], tat[1]
    elif EX_MAP.get(w):
        ex = EX_MAP[w]
    else:
        for cand in (wn.get("e") or []):
            if len(cand) >= 14:
                ex = cand
                break
    if len(ex) > EX_MAXLEN:
        ex = ex[:EX_MAXLEN].rstrip() + "…"

    # ---- 同义词 / 反义词（WordNet 词网）----
    syn = "|".join(pref_in_vocab(wn.get("s") or [], 6))
    ant = "|".join(pref_in_vocab(wn.get("a") or [], 4))

    # ---- 词形变化：ECDICT 为主，空缺时用 lemma 库补「其他形式」----
    fm = e.get("fm", "")
    if not fm:
        lf = LEMMA_FM.get(w, "")
        if lf:
            extra = [x for x in lf.split(",") if x and len(x) > 1]
            if extra:
                fm = "其他形式:" + ",".join(extra[:4])

    rec = [""] * 20
    rec[W] = w
    rec[US] = us
    rec[UK] = uk
    # ---- 词性：ECDICT 词性权威表 → 最终释义抽取 → WordNet 主词性兜底 ----
    # 权威表覆盖 94.4%（ECDICT 释义行首即词性），且不受「最终释义取自哪本词书」影响
    pos = ECDICT_POS.get(w, "") or pos_of(tr)
    if not pos:
        wp = str(wn.get("pos") or "").strip()
        if wp:
            pos = wp + "."
    rec[POS] = pos
    rec[CN] = "\n".join(tr)
    rec[EN] = en
    rec[EX] = ex
    rec[EXZ] = exz
    rec[TG] = "|".join(tg_list)
    rec[FM] = fm
    rec[BNC] = int(e["bnc"]) if e.get("bnc", "").isdigit() else 0
    rec[FRQ] = int(e["frq"]) if e.get("frq", "").isdigit() else 0
    rec[ST] = int(e["col"]) if e.get("col", "").isdigit() else 0
    rec[OX] = 1 if e.get("oxf") == "1" else 0
    rec[PH] = COLLOC.get(w, "")
    rec[RT] = build_rt(w)
    rec[SYN] = syn
    rec[ANT] = ant
    rec[DIS] = build_dis(w)
    rec[MN] = MNEMO.get(w, "")
    # 去掉全空的尾字段以压缩体积（TG 必有值，故最小长度 9 即安全）
    while len(rec) > 9 and (rec[-1] == "" or rec[-1] == 0):
        rec.pop()
    words.append(rec)

log(f"   最终词条 {len(words)}")

# ---------- 5. 词根词缀 ----------
log("→ 生成词根词缀库")
roots = []
# 优先注入 ECDICT 官方词根库（wordroot.txt，含词源与例词，质量为上）
if ROOT_LIST:
    for r in ROOT_LIST:
        pat, cls, mean, origin, _n = r
        roots.append([pat, cls, root_zh(pat) or mean, ORIGIN_ZH.get(origin, origin)])
    log(f"   ECDICT 官方词根 {len(ROOT_LIST)} 条（释义已中文化）")
def add_root(pat, typ, mean, exs):
    pat = pat.strip().lower()
    if not pat or len(pat) > 12:
        return
    # 和 ECDICT 官方条目走同一条中文化路径：只对 ROOT_LIST 查表的话，
    # 从 qwerty 注入的这一批（927 里的 ~432 条）会原样留下英文释义。
    roots.append([pat, typ, root_zh(pat) or mean.strip()[:90], exs[:140]])

rp = os.path.join(QW, "word_roots1.json")
if os.path.exists(rp):
    for it in load_json(rp):
        raw = (it.get("trans") or [""])[0]
        exs = " ".join(it.get("name", "").split()[:3])
        head = raw.split(";")[0]
        if "-" not in head:
            continue
        left, right = head.split("-", 1)
        left = left.split("/")[0]
        for p in re.split(r"[,\s]+", left):
            p = p.strip().strip("/")
            if p and re.match(r"^[a-z]+$", p):
                add_root(p, "前缀", right, exs)
sp = os.path.join(QW, "suffix_word.json")
if os.path.exists(sp):
    for it in load_json(sp):
        raw = (it.get("trans") or [""])[0]
        exs = " ".join(it.get("name", "").split()[:3])
        m = re.match(r"^\s*(-[a-z()\s]+?)\s{2,}(.+)$", raw)
        if not m:
            m2 = re.match(r"^\s*(-?[a-z]+(?:\(-[a-z]+\))?)\s+([a-z].+)$", raw)
            if not m2:
                continue
            m = m2
        suf = m.group(1).strip()
        suf = suf.split("(")[0].strip("-").strip()
        if suf:
            add_root(suf, "后缀", m.group(2), exs)
# 去重
seen = {}
uniq_roots = []
for r in roots:
    k = r[1] + ":" + r[0]
    if k in seen:
        continue
    seen[k] = 1
    uniq_roots.append(r)
uniq_roots.sort(key=lambda x: (x[1], x[0]))
log(f"   词根词缀 {len(uniq_roots)} 条")

# ---------- 6. 输出 ----------
books_out = []
_allsets = [set(split_tags(r[TG])) for r in words]
for bid, name, desc, cat, fn, tg, ok, inc in BOOKS:
    n = sum(1 for s in _allsets if bid in s)
    if not n:
        continue
    # own = 本册新增：挂了本册标签、且不含任何前置词书标签的词
    own = sum(1 for s in _allsets if bid in s and not any(x in s for x in inc)) if inc else n
    books_out.append({
        "id": bid, "name": name, "desc": desc, "cat": cat,
        "n": n,          # 全量词数（含前置词书）
        "own": own,      # 本册新增词数
        "inc": [{"id": x, "name": NAME_OF.get(x, x),
                 "n": sum(1 for s in _allsets if x in s)} for x in inc],
    })

json.dump(words, open(os.path.join(BUILD, "data_words.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
json.dump(books_out, open(os.path.join(BUILD, "data_books.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
json.dump(uniq_roots, open(os.path.join(BUILD, "data_roots.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))

sz = os.path.getsize(os.path.join(BUILD, "data_words.json"))
# 覆盖率统计
def cov(i, pred=lambda v: bool(v)):
    return sum(1 for r in words if i < len(r) and pred(r[i]))
def show(label, i, pred=lambda v: bool(v)):
    c = cov(i, pred)
    log(f"  {label:12s} {c:6d} / {len(words)}  ({c*100//max(1,len(words)):3d}%)")
log("")
log("=" * 62)
log(f"词条 {len(words)}  词书 {len(books_out)}  词根 {len(uniq_roots)}  数据 {sz/1048576:.2f} MB")
show("美音标", 1)
show("英音标", 2)
show("词性", 3)
show("英文释义", 5)
show("例句", 6)
show("例句翻译", 7)
show("词形变化", 9)
show("词频", 11, lambda v: v > 0)
show("柯林斯星级", 12, lambda v: v > 0)
show("牛津标记", 13, lambda v: v > 0)
show("常用搭配", 14)
show("词根词缀", 15)
show("同义词", 16)
show("反义词", 17)
show("近义词辨析", 18)
show("巧记", 19)
log("=" * 62)
for b in books_out:
    log(f"  {b['cat']:6s} {b['name']:16s} {b['n']:6d}")
