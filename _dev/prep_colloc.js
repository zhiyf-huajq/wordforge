// 从语料统计「词 + 介词/副词小品词」搭配 -> raw/prep/colloc.json
// 语料：Tatoeba 英文句 + WordNet 例句
// 只保留出现 >= 2 次的搭配，且限定搭配词为介词/副词小品词（这正是学习者最需要的固定搭配类型）
const fs = require("fs");

const vocab = new Set(
  JSON.parse(fs.readFileSync("build/data_words.json", "utf8")).map((r) => String(r[0]).toLowerCase())
);

/* ---------- 1. 汇集语料 ---------- */
const texts = [];
const pairs = JSON.parse(fs.readFileSync(
  "raw/npm2/tatoeba-sentence-pairs-in-mandarin-chinese-english-0.20260520.0/package/sentences.json", "utf8"));
pairs.forEach((p) => { if (p && p[3]) texts.push(p[3]); });
const wn = JSON.parse(fs.readFileSync("raw/prep/wordnet.json", "utf8"));
Object.keys(wn).forEach((w) => (wn[w].e || []).forEach((s) => texts.push(s)));
console.log("语料句数: " + texts.length);

/* ---------- 2. bigram 统计 ---------- */
const PART = new Set([
  "on", "up", "in", "out", "off", "for", "with", "to", "at", "by", "from", "into", "over", "down",
  "about", "through", "after", "against", "of", "away", "back", "forward", "together", "around",
  "along", "across", "upon", "without", "under", "behind", "beyond", "toward", "towards", "onto",
  "among", "between", "during", "before", "above", "below", "near", "past", "since", "than",
  "until", "via", "within", "beside", "despite", "except", "inside", "outside", "beneath", "amid",
]);
const TOK = /[a-z]+(?:'[a-z]+)?/g;
const biz = new Map();
texts.forEach((t) => {
  const tk = String(t).toLowerCase().match(TOK) || [];
  for (let i = 0; i < tk.length - 1; i++) {
    const a = tk[i], b = tk[i + 1];
    if (!vocab.has(a)) continue;
    if (!PART.has(b)) continue;
    if (a.length < 2) continue;
    const k = a + "|" + b;
    biz.set(k, (biz.get(k) || 0) + 1);
  }
});
console.log("bigram 候选: " + biz.size);

/* ---------- 3. 组装 ---------- */
const byWord = new Map();
biz.forEach((n, k) => {
  if (n < 2) return;
  const i = k.indexOf("|");
  const a = k.slice(0, i), b = k.slice(i + 1);
  const arr = byWord.get(a) || [];
  arr.push([b, n]);
  byWord.set(a, arr);
});

const out = {};
let total = 0;
byWord.forEach((arr, w) => {
  arr.sort((x, y) => y[1] - x[1]);
  const list = arr.slice(0, 4).map((x) => w + " " + x[0]);
  out[w] = list.join("|");
  total += list.length;
});

fs.mkdirSync("raw/prep", { recursive: true });
const dp = "raw/prep/colloc.json";
fs.writeFileSync(dp, JSON.stringify(out), "utf8");

console.log("");
console.log("=".repeat(56));
console.log("输出 " + dp + "  " + (fs.statSync(dp).size / 1024).toFixed(0) + " KB");
console.log("  覆盖 " + Object.keys(out).length + " 词 / " + vocab.size + "  (" +
  (Object.keys(out).length * 100 / vocab.size).toFixed(1) + "%)  共 " + total + " 条搭配");
console.log("");
console.log("抽样:");
["give", "depend", "interested", "look", "afraid", "take", "come", "put", "run", "break"].forEach((w) => {
  console.log("  " + w.padEnd(12) + (out[w] || "(无)"));
});
