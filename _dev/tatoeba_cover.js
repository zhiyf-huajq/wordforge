// 评估 Tatoeba 中英句对对我方词表的覆盖率
const fs = require("fs");
const W = 0, CN = 4, TG = 8;

const words = JSON.parse(fs.readFileSync("build/data_words.json", "utf8"));
const pairs = JSON.parse(fs.readFileSync(
  "raw/npm2/tatoeba-sentence-pairs-in-mandarin-chinese-english-0.20260520.0/package/sentences.json", "utf8"));

console.log("词表 " + words.length + " 词 / 句对 " + pairs.length + " 条");

// 建词索引（含简单变形还原：直接匹配词边界）
const vocab = new Map();
words.forEach((r, i) => {
  const w = String(r[W]).toLowerCase();
  if (!vocab.has(w)) vocab.set(w, i);
});

// 繁简判定：常见繁体字符集（用于统计，决定是否需要转换）
const TRAD = "們試幹什麼臺灣來對時會後這為與說點還過沒發現應該實學國問題話語讓東西樣種體華電話買賣員頭歲從";
let tradHit = 0, total = 0;

const hit = new Set();      // 命中的词
const hitCount = new Map(); // 词 -> 命中句数
let candShort = 0;          // 12 词以内的短句

function tokens(s) {
  return String(s).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
}

pairs.forEach(([zhId, zh, enId, en]) => {
  total++;
  for (const ch of zh) if (TRAD.indexOf(ch) >= 0) { tradHit++; break; }
  const tk = tokens(en);
  if (tk.length <= 12) candShort++;
  const seen = new Set();
  for (const t of tk) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (vocab.has(t)) {
      hit.add(t);
      hitCount.set(t, (hitCount.get(t) || 0) + 1);
    }
  }
});

console.log("");
console.log("=== 覆盖率 ===");
console.log("  命中词数     " + hit.size + " / " + words.length + "  (" + (hit.size * 100 / words.length).toFixed(1) + "%)");
console.log("  含繁体句子   " + tradHit + " / " + total + "  (" + (tradHit * 100 / total).toFixed(1) + "%)");
console.log("  短句(<=12词) " + candShort + " / " + total + "  (" + (candShort * 100 / total).toFixed(1) + "%)");

// 按词书统计覆盖率（看哪些人群受益）
const bookStat = new Map();
words.forEach((r) => {
  const tg = String(r[TG] || "").split("|").filter(Boolean);
  const w = String(r[W]).toLowerCase();
  const ok = hit.has(w) ? 1 : 0;
  tg.forEach((b) => {
    const cur = bookStat.get(b) || { n: 0, ok: 0 };
    cur.n++; cur.ok += ok;
    bookStat.set(b, cur);
  });
});
console.log("");
console.log("=== 各词书例句覆盖率 ===");
[...bookStat.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([b, s]) => {
  console.log("  " + b.padEnd(14) + String(s.ok).padStart(6) + " / " + String(s.n).padStart(6) +
    "  " + (s.ok * 100 / s.n).toFixed(0) + "%");
});

// 命中句数分布
const buckets = { "1": 0, "2-3": 0, "4-9": 0, "10+": 0 };
hitCount.forEach((n) => {
  if (n === 1) buckets["1"]++;
  else if (n <= 3) buckets["2-3"]++;
  else if (n <= 9) buckets["4-9"]++;
  else buckets["10+"]++;
});
console.log("");
console.log("=== 每词可选句数分布 ===");
Object.entries(buckets).forEach(([k, v]) => console.log("  " + k.padEnd(6) + v));

// 抽样看质量
console.log("");
console.log("=== 抽样（前 12 个命中词的可用例句）===");
let shown = 0;
const byWord = new Map();
pairs.forEach(([zhId, zh, enId, en]) => {
  tokens(en).forEach((t) => {
    if (vocab.has(t)) {
      if (!byWord.has(t)) byWord.set(t, []);
      const arr = byWord.get(t);
      if (arr.length < 3) arr.push([en, zh]);
    }
  });
});
for (const [w, arr] of byWord) {
  if (shown >= 12) break;
  if (w.length < 4) continue;
  console.log("  【" + w + "】");
  arr.forEach(([en, zh]) => console.log("      " + en + "  ||  " + zh));
  shown++;
}
