// WordNet 预处理 v2：同义词 / 反义词 / 英文例句
// 关键改进：
//   1. 修正 data 行 ss_type 的字符位（应为第 12 位，v1 取错导致 pointers/gloss 全丢）
//   2. 按 index 的 tagsense_cnt 选【主词性】，只取该词性最常用义项的同反义词，避免混词性
//
// index 行: lemma pos synset_cnt p_cnt [ptr_symbol...] sense_cnt tagsense_cnt offset [offset...]
// data  行: offset lex_filenum ss_type w_cnt(hex) (word lex_id)* p_cnt (sym off pos src)* | gloss
const fs = require("fs");
const path = require("path");

const DB = "raw/npm2/wordnet-2.0.0/package/db";

const vocab = new Set(
  JSON.parse(fs.readFileSync("build/data_words.json", "utf8")).map((r) => String(r[0]).toLowerCase())
);

/* ---------- 1. index ---------- */
const wordPos = new Map();      // lemma -> Map(pos -> {tags, offsets:[]})
const synsetLemmas = new Map(); // "pos|off" -> [lemma]

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

/* ---------- 2. data（只对词表相关义项保留详情）---------- */
const want = new Set();
vocab.forEach((w) => {
  const pm = wordPos.get(w);
  if (!pm) return;
  pm.forEach((v, pos) => v.offsets.forEach((o) => want.add(pos + "|" + o)));
});
console.log("词表命中义项: " + want.size);

const detail = new Map();   // "pos|off" -> {words, ptr, gloss}

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
    // 补全 synset 词表
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

const res = {};
let nS = 0, nA = 0, nE = 0;

vocab.forEach((w) => {
  const pm = wordPos.get(w);
  if (!pm) return;
  // 主词性：语料标注次数最多的那个
  let mainPos = null, bestTags = -1;
  pm.forEach((v, pos) => {
    const t = v.tags || (v.offsets.length * 0.1);
    if (t > bestTags) { bestTags = t; mainPos = pos; }
  });
  if (!mainPos) return;
  const info = pm.get(mainPos);
  const key0 = mainPos + "|" + info.offsets[0];
  const d0 = detail.get(key0);

  const syn = new Set(), ant = new Set(), ex = [];

  // 同义词：第一义项优先，不足再取第二义项
  const collectSyn = (k) => {
    (synsetLemmas.get(k) || []).forEach((x) => { if (x !== w && clean(x) && syn.size < 5) syn.add(x); });
  };
  collectSyn(key0);
  if (syn.size < 2 && info.offsets[1]) collectSyn(mainPos + "|" + info.offsets[1]);

  if (d0) {
    // 例句
    const re = /"([^"]{12,150})"/g;
    let mm;
    while ((mm = re.exec(d0.gloss)) && ex.length < 2) ex.push(mm[1]);
    // 反义词 + 形容词近义指针
    d0.ptr.forEach((p) => {
      const tk = p.pos + "|" + p.off;
      const tw = synsetLemmas.get(tk) || [];
      if (p.s === "!") tw.forEach((x) => { if (x !== w && clean(x) && ant.size < 3) ant.add(x); });
      else if (p.s === "&") tw.forEach((x) => { if (x !== w && clean(x) && syn.size < 4) syn.add(x); });
    });
  }
  // 例句兜底：取第二义项 gloss
  if (!ex.length && info.offsets[1]) {
    const d1 = detail.get(mainPos + "|" + info.offsets[1]);
    if (d1) {
      const re = /"([^"]{12,150})"/g;
      let mm;
      while ((mm = re.exec(d1.gloss)) && ex.length < 2) ex.push(mm[1]);
    }
  }

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
console.log("  有同义词   " + nS);
console.log("  有反义词   " + nA);
console.log("  有英文例句 " + nE);
console.log("");
["happy", "abandon", "increase", "difficult", "give", "system", "repeal", "beautiful"].forEach((w) => {
  console.log("  " + w.padEnd(12) + (res[w] ? JSON.stringify(res[w]).slice(0, 220) : "(未命中)"));
});
