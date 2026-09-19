// 预处理三个杂项数据源 -> raw/prep/*.json
//   1. raw/wordroot.txt  -> 词根词缀库 + 例词反查表（RT）
//   2. raw/resemble.txt  -> 近义词辨析（DIS）
//   3. raw/lemma.en.txt  -> 词形还原反查表（用于例句匹配与词形补充）
const fs = require("fs");

const vocab = new Set(
  JSON.parse(fs.readFileSync("build/data_words.json", "utf8")).map((r) => String(r[0]).toLowerCase())
);
fs.mkdirSync("raw/prep", { recursive: true });

/* ---------- 1. 词根词缀 ---------- */
const roots = JSON.parse(fs.readFileSync("raw/wordroot.txt", "utf8"));
const rootList = [];          // [pattern, class, meaning, origin, exampleCount]
const rootByWord = new Map(); // word -> [rootIndex]

const CLASS_ZH = {
  "root": "词根",
  "prefix": "前缀",
  "adjective-forming suffix": "形容词后缀",
  "noun-forming suffix": "名词后缀",
  "verb-forming suffix": "动词后缀",
  "adverb-forming suffix": "副词后缀",
  "adjective- and noun-forming suffix": "形/名后缀",
};

Object.keys(roots).forEach((rawPat) => {
  const o = roots[rawPat];
  if (!o || typeof o !== "object") return;
  // 模式清理：去掉 ped1 / -en2 / di-2 这类编号与连字符
  let pat = String(o.root || rawPat).trim();
  pat = pat.replace(/\d+$/, "").replace(/^-+/, "").replace(/-+$/, "");
  if (!pat || pat.length > 14) return;
  const cls = CLASS_ZH[o.class] || o.class || "词根";
  const meaning = String(o.meaning || "").trim().slice(0, 60);
  const origin = String(o.origin || "").trim();
  const ex = Array.isArray(o.example) ? o.example : [];

  const idx = rootList.length;
  rootList.push([pat, cls, meaning, origin, ex.length]);
  ex.forEach((w) => {
    const k = String(w).trim().toLowerCase();
    if (!k || k.includes(" ")) return;      // 只索引单词
    const arr = rootByWord.get(k) || [];
    if (arr.indexOf(idx) < 0) arr.push(idx);
    rootByWord.set(k, arr);
  });
});
console.log("词根词缀 " + rootList.length + " 条，例词索引 " + rootByWord.size + " 词");

// 只保留能命中词表的部分（例词反查 + 词根本身命中词表）
const rootOut = { list: rootList, byWord: {} };
let rtHit = 0;
vocab.forEach((w) => {
  let idxs = rootByWord.get(w) || [];
  // 词根模式本身等于该词（如 "tele" 是词也是词根）
  if (!idxs.length) {
    rootList.forEach((r, i) => { if (r[0] === w) idxs.push(i); });
  }
  if (idxs.length) { rootOut.byWord[w] = idxs.slice(0, 3); rtHit++; }
});
console.log("词表命中词根 " + rtHit + " / " + vocab.size);
const rp = "raw/prep/roots.json";
fs.writeFileSync(rp, JSON.stringify(rootOut), "utf8");
console.log("输出 " + rp + "  " + (fs.statSync(rp).size / 1024).toFixed(0) + " KB");

/* ---------- 2. 近义词辨析 ---------- */
const lines = fs.readFileSync("raw/resemble.txt", "utf8").split(/\r?\n/);
const groups = [];
let cur = null;
for (const line of lines) {
  const t = line.trim();
  if (t.startsWith("%")) {
    if (cur && cur.words.length && cur.body.length) groups.push(cur);
    const ws = t.slice(1).split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    cur = { words: ws, body: [] };
  } else if (cur && t) {
    cur.body.push(t);
  } else if (!t && cur && cur.body.length) {
    cur.body.push("");
  }
}
if (cur && cur.words.length && cur.body.length) groups.push(cur);

// 组表 + 词索引（避免每个词复制整份文本）
const disGroups = [];
const disByWord = {};
let disHit = 0;
groups.forEach((g) => {
  // 正文首尾空行清理
  while (g.body.length && !g.body[0]) g.body.shift();
  while (g.body.length && !g.body[g.body.length - 1]) g.body.pop();
  if (!g.body.length) return;
  // 只有组内至少一个词在词表里才收录
  const hitWords = g.words.map((w) => w.toLowerCase().trim()).filter((k) => k && !k.includes(" ") && vocab.has(k));
  if (!hitWords.length) return;
  const gi = disGroups.length;
  disGroups.push({ w: g.words.join(" / "), b: g.body.join("\n") });
  hitWords.forEach((k) => {
    const arr = disByWord[k] || [];
    if (arr.length < 2) { arr.push(gi); disHit++; }
    disByWord[k] = arr;
  });
});
console.log("");
console.log("近义词辨析 " + disGroups.length + " 组，命中词表 " + Object.keys(disByWord).length + " 词");
const dp = "raw/prep/resemble.json";
fs.writeFileSync(dp, JSON.stringify({ g: disGroups, byWord: disByWord }), "utf8");
console.log("输出 " + dp + "  " + (fs.statSync(dp).size / 1024).toFixed(0) + " KB");
if (disGroups.length) {
  const k = Object.keys(disByWord)[0];
  const gi = disByWord[k][0];
  console.log("  抽样【" + k + "】:");
  console.log(("      " + disGroups[gi].w + "\n" + disGroups[gi].b).split("\n").slice(0, 6).map((l) => "      " + l).join("\n"));
}

/* ---------- 3. 词形还原反查表 ---------- */
const lemmaLines = fs.readFileSync("raw/lemma.en.txt", "utf8").split(/\r?\n/);
const formToLemma = new Map();  // 变形 -> 原形
const lemmaToForms = new Map(); // 原形 -> [变形...]
let lc = 0;
for (const line of lemmaLines) {
  if (!line || line.startsWith(";")) continue;
  const m = /^([a-zA-Z'’\- ]+?)\/\d+\s*->\s*(.+)$/.exec(line.trim());
  if (!m) continue;
  const lemma = m[1].trim().toLowerCase();
  const forms = m[2].split(",").map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z][a-z'’-]*$/.test(x));
  if (!forms.length) continue;
  lc++;
  forms.forEach((f) => { if (!formToLemma.has(f)) formToLemma.set(f, lemma); });
  if (!lemmaToForms.has(lemma)) lemmaToForms.set(lemma, forms);
}
console.log("");
console.log("词形还原 " + lc + " 组 / 变形索引 " + formToLemma.size + " 词");

// 只输出词表相关（例句匹配 + 词形补充用）；变形列表压成逗号字符串省体积
const lemOut = { fm: {}, lm: {} };
let fl = 0, ff = 0;
vocab.forEach((w) => {
  const fs2 = lemmaToForms.get(w);
  if (!fs2) return;
  const inVocab = fs2.filter((f) => vocab.has(f));
  if (inVocab.length) { lemOut.fm[w] = inVocab.slice(0, 10).join(","); ff++; }
  lemOut.lm[w] = fs2.slice(0, 20).join(",");
  fl++;
});
const lp = "raw/prep/lemma.json";
fs.writeFileSync(lp, JSON.stringify(lemOut), "utf8");
console.log("输出 " + lp + "  " + (fs.statSync(lp).size / 1024).toFixed(0) + " KB  （有变形 " + fl + " 词，词表内互链 " + ff + " 词）");

// 抽样
console.log("");
console.log("抽样（词形）:");
["give", "child", "run", "be", "go", "good"].forEach((w) => {
  if (lemOut.fm[w]) console.log("  " + w.padEnd(10) + " -> " + lemOut.fm[w]);
  else console.log("  " + w.padEnd(10) + " (无)");
});
