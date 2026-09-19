// WordNet 预处理 v3：同义词 / 反义词 / 英文例句
// 相对 v2 的改进（全部来自 WordNet 官方关系，零猜测）：
//   1. 反义词：从「主词性首义项」扩展到【主词性全部义项】的 `!` 指针（首义项优先，后义项补位）
//   2. 相似词：`&` similar-to 指针同样扫全部义项，同义词上限 5 → 6
//   3. 英文例句：首义项无引例时，依次尝试后续 4 个义项的 gloss
//   4. 同时导出主词性，供 ETL 兜底 POS 字段
//
// index 行: lemma pos synset_cnt p_cnt [ptr_symbol...] sense_cnt tagsense_cnt offset [offset...]
// data  行: offset lex_filenum ss_type w_cnt(hex) (word lex_id)* p_cnt (sym off pos src)* | gloss
const fs = require("fs");
const path = require("path");

const DB = "raw/npm2/wordnet-2.0.0/package/db";
const CAP_SYN = 6;
const CAP_ANT = 4;
const SENSE_SCAN = 5;   // 例句最多扫几个义项
// 反义词最多扫几个义项：义项越靠后语义越冷僻，跨义项反义词会影响学习者理解
const ANT_SENSE = parseInt(process.argv[2] || "99", 10);

const vocab = new Set(
  JSON.parse(fs.readFileSync("build/data_words.json", "utf8")).map((r) => String(r[0]).toLowerCase())
);

/* ---------- 0. ECDICT 词性提示（Pass A 产物）---------- */
// 用途：WordNet 里一多半词的 tagsense_cnt 全是 0，此时旧实现靠 Map 迭代顺序定夺，
// 会把 affluent 判成名词（水文「支流」义），于是反义词变成 distributary。
// ECDICT 中文释义的词性是一份独立权威来源，按它的排列顺序做仲裁。
let ECDICT_POS = {};
try {
  ECDICT_POS = JSON.parse(fs.readFileSync("raw/prep/ecdict_pos.json", "utf8"));
} catch (e) {
  console.log("! 未找到 raw/prep/ecdict_pos.json，主词性仲裁退化为仅按语料标注次数");
}
const HINT = {};        // word -> [wnPos,...] 按 ECDICT 出现顺序
for (const k in ECDICT_POS) {
  const seen = [];
  ECDICT_POS[k].split(/\s+/).forEach((t) => {
    const b = t.replace(/\.$/, "");
    let c = null;
    if (b === "n" || b === "pl") c = "n";
    else if (b === "v" || b === "vt" || b === "vi" || b === "vbl") c = "v";
    else if (b === "adj") c = "a";
    else if (b === "adv") c = "r";
    if (c && seen.indexOf(c) < 0) seen.push(c);
  });
  if (seen.length) HINT[k] = seen;
}
console.log("ECDICT 词性提示: " + Object.keys(HINT).length + " 词");

const cmpKey = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/* ---------- 1. index ---------- */
const wordPos = new Map();
const synsetLemmas = new Map();

for (const ext of ["noun", "verb", "adj", "adv"]) {
  const file = path.join(DB, "index." + ext);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line || line[0] === " ") continue;
    const p = line.trim().split(/\s+/);
    const lemma = p[0].replace(/_/g, " ").toLowerCase();
    const pos = p[1];
    const pCnt = parseInt(p[3], 10) || 0;
    const tags = parseInt(p[5 + pCnt], 10) || 0;
    const offsets = p.slice(6 + pCnt).filter((x) => /^\d+$/.test(x));
    if (!offsets.length) continue;

    let pm = wordPos.get(lemma);
    if (!pm) { pm = new Map(); wordPos.set(lemma, pm); }
    const cur = pm.get(pos) || { tags: 0, offsets: [] };
    if (tags > cur.tags) cur.tags = tags;
    offsets.forEach((o) => { if (cur.offsets.indexOf(o) < 0) cur.offsets.push(o); });
    pm.set(pos, cur);

    offsets.forEach((o) => {
      const key = pos + "|" + o;
      const arr = synsetLemmas.get(key) || [];
      if (arr.indexOf(lemma) < 0) arr.push(lemma);
      synsetLemmas.set(key, arr);
    });
  }
}
console.log("index: " + wordPos.size + " 词形 / " + synsetLemmas.size + " 同义词集");

/* ---------- 2. data ---------- */
const want = new Set();
vocab.forEach((w) => {
  const pm = wordPos.get(w);
  if (!pm) return;
  pm.forEach((v, pos) => v.offsets.forEach((o) => want.add(pos + "|" + o)));
});
console.log("词表命中义项: " + want.size);

const detail = new Map();

for (const ext of ["noun", "verb", "adj", "adv"]) {
  const file = path.join(DB, "data." + ext);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line || line[0] === " ") continue;
    const m = /^(\d{8})\s+(\d{2})\s+([nvasr])\s+([0-9a-f]{2})\s/.exec(line);
    if (!m) continue;
    const off = m[1];
    const rawType = m[3];
    const pos = rawType === "s" ? "a" : rawType;
    const key = pos + "|" + off;

    const bar = line.indexOf("|");
    const head = (bar >= 0 ? line.slice(0, bar) : line).trim().split(/\s+/);
    const gloss = bar >= 0 ? line.slice(bar + 1).trim() : "";

    const wCnt = parseInt(m[4], 16);
    const words = [];
    let i = 4;
    for (let k = 0; k < wCnt; k++, i += 2) words.push(head[i].replace(/_/g, " ").toLowerCase());
    const pCnt = parseInt(head[i], 10) || 0;
    i += 1;
    const ptr = [];
    for (let k = 0; k < pCnt; k++, i += 4) {
      if (head[i] && head[i + 1]) ptr.push({ s: head[i], off: head[i + 1], pos: head[i + 2] === "s" ? "a" : head[i + 2] });
    }
    if (words.length) {
      const cur = synsetLemmas.get(key) || [];
      words.forEach((w) => { if (cur.indexOf(w) < 0) cur.push(w); });
      synsetLemmas.set(key, cur);
    }
    if (want.has(key)) detail.set(key, { words, ptr, gloss });
  }
}
console.log("data: 词表相关义项详情 " + detail.size);

/* ---------- 3. 组装 ---------- */
const POS_ZH = { n: "n", v: "v", a: "adj", r: "adv" };
const clean = (x) => x && x.length > 1 && !x.includes(" ") && /^[a-z][a-z'-]*$/.test(x);
const QUOTE = /"([^"]{12,150})"/g;

const res = {};
let nS = 0, nA = 0, nE = 0;
let nAntAllSense = 0;

vocab.forEach((w) => {
  const pm = wordPos.get(w);
  if (!pm) return;
  // 主词性仲裁：WordNet 语料标注次数 → ECDICT 中文释义词性提示（按出现顺序）→ 义项数
  const hint = HINT[w] || [];
  let mainPos = null, bestKey = null;
  pm.forEach((v, pos) => {
    const hi = hint.indexOf(pos);
    const key = [v.tags || 0, hi >= 0 ? 1 : 0, hi >= 0 ? 10 - hi : 0, v.offsets.length];
    if (!bestKey || cmpKey(key, bestKey) > 0) { bestKey = key; mainPos = pos; }
  });
  if (!mainPos) return;

  const info = pm.get(mainPos);
  const offs = info.offsets;
  const syn = new Set(), ant = new Set(), ex = [];

  const collectSyn = (k) => {
    (synsetLemmas.get(k) || []).forEach((x) => { if (x !== w && clean(x) && syn.size < CAP_SYN) syn.add(x); });
  };

  // ---- 同义词：按义项顺序扫描（首义项优先），凑够 4 条或扫满 3 个义项即止 ----
  // 只扫首义项会让 right / light 这类「首义项是单成员同义词集」的常用词拿不到同义词
  for (let si = 0; si < offs.length && si < 3 && syn.size < 4; si++) {
    collectSyn(mainPos + "|" + offs[si]);
  }

  // ---- 例句：按义项顺序扫描，取到 2 条即止 ----
  for (let si = 0; si < offs.length && si < SENSE_SCAN && ex.length < 2; si++) {
    const d = detail.get(mainPos + "|" + offs[si]);
    if (!d) continue;
    QUOTE.lastIndex = 0;
    let mm;
    while ((mm = QUOTE.exec(d.gloss)) && ex.length < 2) {
      if (ex.indexOf(mm[1]) < 0) ex.push(mm[1]);
    }
  }

  // ---- 反义词 + 相似词：扫主词性全部义项（首义项优先，故先入者为高置信）----
  let fromLater = false;
  for (let si = 0; si < offs.length; si++) {
    const d = detail.get(mainPos + "|" + offs[si]);
    if (!d) continue;
    d.ptr.forEach((p) => {
      const tw = synsetLemmas.get(p.pos + "|" + p.off) || [];
      if (p.s === "!") {
        if (si >= ANT_SENSE) return;
        tw.forEach((x) => {
          if (x !== w && clean(x) && ant.size < CAP_ANT && !syn.has(x)) {
            if (!ant.has(x)) { ant.add(x); if (si > 0) fromLater = true; }
          }
        });
      } else if (p.s === "&") {
        tw.forEach((x) => { if (x !== w && clean(x) && syn.size < CAP_SYN && !ant.has(x)) syn.add(x); });
      }
    });
  }
  if (fromLater) nAntAllSense++;

  const S = [...syn], A = [...ant];
  if (!S.length && !A.length && !ex.length) return;
  const o = { pos: POS_ZH[mainPos] };
  if (S.length) { o.s = S; nS++; }
  if (A.length) { o.a = A; nA++; }
  if (ex.length) { o.e = ex; nE++; }
  res[w] = o;
});

fs.mkdirSync("raw/prep", { recursive: true });
fs.writeFileSync("raw/prep/wordnet.json", JSON.stringify(res), "utf8");
const sz = fs.statSync("raw/prep/wordnet.json").size;

console.log("");
console.log("=".repeat(56));
console.log("输出 raw/prep/wordnet.json  " + (sz / 1024).toFixed(0) + " KB");
console.log("  命中词条   " + Object.keys(res).length + " / " + vocab.size);
console.log("  有主词性   " + Object.keys(res).length);
console.log("  有同义词   " + nS);
console.log("  有反义词   " + nA + "   （义项深度 " + (ANT_SENSE > 90 ? "全部" : ANT_SENSE) + "，含非首义项补充 " + nAntAllSense + " 词）");
console.log("  有英文例句 " + nE);
console.log("");
["happy", "abandon", "increase", "difficult", "give", "system", "repeal", "beautiful", "right", "light"].forEach((w) => {
  console.log("  " + w.padEnd(12) + (res[w] ? JSON.stringify(res[w]).slice(0, 240) : "(未命中)"));
});
