/* 形近词组数据的「内禀性质」实测脚本 —— 一次性排查工具，不是验收层。
 *
 * 为什么要有它：给 test-logic 写断言之前，必须先在真数据上量一遍。
 * 「距离 ≤ 2」这种阈值如果只凭设计意图写进断言，会出现两种错：
 *   ① 实际数据比设想宽（比如某些组是真 Damerau 距离 3），断言从第一天就红，
 *      然后就会有人去把断言放宽 —— 于是它再也不测任何东西；
 *   ② 实际数据比设想窄（其实全都很近），断言写得过松，混进不相干的词也发现不了。
 * 先量后写，阈值才有依据。
 *
 * 用法：node _dev/measure_confuse.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const B = path.join(__dirname, "..", "build");
const CONF = JSON.parse(fs.readFileSync(path.join(B, "data_confuse.json"), "utf8"));
const RAW = JSON.parse(fs.readFileSync(path.join(B, "data_words.json"), "utf8"));

const words = Array.isArray(RAW) ? RAW : RAW.W;
const LEX = new Set();
for (const w of words) {
  if (Array.isArray(w) && typeof w[0] === "string") LEX.add(w[0]);
  else if (typeof w === "string") LEX.add(w);
}

/* 最优串对齐距离（OSA）。与本项目 prep 脚本同族；
   真 Damerau-Levenshtein（无限制）只会更小，所以这里量到的是「偏保守的上界」。 */
function osa(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev2 = null;
  let prev = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1);
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

const distHist = {};
const lenDiffHist = {};
let sizeHist = [0, 0, 0, 0, 0];
let notLex = 0, notLower = 0, dupInGroup = 0, nonAlpha = 0;
let maxDistPairs = [];
let sameFirstSensePairs = 0;

for (const g of CONF) {
  sizeHist[Math.min(g.length, 4)]++;
  const seen = new Set();
  for (const w of g) {
    if (!LEX.has(w)) notLex++;
    if (w !== w.toLowerCase()) notLower++;
    if (!/^[a-z]+$/.test(w)) nonAlpha++;
    if (seen.has(w)) dupInGroup++;
    seen.add(w);
  }
  for (let i = 0; i < g.length; i++) {
    for (let j = i + 1; j < g.length; j++) {
      const a = g[i], b = g[j];
      const d = osa(a, b);
      distHist[d] = (distHist[d] || 0) + 1;
      const ld = Math.abs(a.length - b.length);
      lenDiffHist[ld] = (lenDiffHist[ld] || 0) + 1;
      if (d > 2) maxDistPairs.push([a, b, d]);
    }
  }
}

const pairsTotal = Object.values(distHist).reduce((s, v) => s + v, 0);

console.log("=".repeat(60));
console.log("形近词组 · 内禀性质实测");
console.log("=".repeat(60));
console.log("组数            ", CONF.length);
console.log("覆盖词数        ", (function () { const s = new Set(); for (const g of CONF) for (const w of g) s.add(w); return s.size; })());
console.log("词表词数        ", LEX.size);
console.log("");
console.log("组大小分布       2 词 " + sizeHist[2] + " · 3 词 " + sizeHist[3] + " · 4 词 " + sizeHist[4] +
  (sizeHist[0] + sizeHist[1] ? " · ⚠ 少于 2 词的 " + (sizeHist[0] + sizeHist[1]) : ""));
console.log("");
console.log("组内词对总数    ", pairsTotal);
const keys = Object.keys(distHist).map(Number).sort((a, b) => a - b);
keys.forEach((k) => {
  console.log("  距离 " + k + " 的词对  " + distHist[k] + "  (" + (distHist[k] / pairsTotal * 100).toFixed(3) + "%)");
});
console.log("");
console.log("组内词长差分布  ", Object.keys(lenDiffHist).map(Number).sort((a, b) => a - b)
  .map((k) => k + ":" + lenDiffHist[k]).join(" · "));
console.log("");
console.log("不在词表里的词  ", notLex);
console.log("非小写的词      ", notLower);
console.log("非纯字母的词    ", nonAlpha);
console.log("组内重复的词    ", dupInGroup);
console.log("");
if (maxDistPairs.length) {
  console.log("⚠ 距离 > 2 的词对共 " + maxDistPairs.length + " 对，样例（前 20）：");
  maxDistPairs.slice(0, 20).forEach((p) => console.log("   " + p[0] + " / " + p[1] + " = " + p[2]));
} else {
  console.log("✅ 没有任何组内词对的距离超过 2 —— 「距离 ≤ 2」可以直接写成硬断言。");
}

/* ---- 关键问题：超阈值的那几对，是不是每一对都能在人工校对表里找到出处？ ----
   如果能，断言就可以写成「超阈值的必须逐对有出处」——
   这比「超阈值的数量不超过 N」强得多：前者是性质，后者只是把观测值抄了一遍。 */
console.log("");
console.log("-".repeat(60));
console.log("超阈值词对 × 人工校对表 的溯源核对");
console.log("-".repeat(60));
let curated = null;
try {
  const cf = path.join(__dirname, "..", "raw", "prep", "confuse_curated.json");
  const j = JSON.parse(fs.readFileSync(cf, "utf8"));
  curated = j.groups || j;
} catch (e) {
  console.log("读不到人工校对表：" + e.message);
}
if (curated) {
  const curPair = new Set();
  for (const g of curated) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        curPair.add([g[i], g[j]].sort().join("|"));
      }
    }
  }
  console.log("人工表组数      ", curated.length);
  console.log("人工表词对数    ", curPair.size);
  let orphan = [];
  for (const [a, b, d] of maxDistPairs) {
    if (!curPair.has([a, b].sort().join("|"))) orphan.push([a, b, d]);
  }
  if (!orphan.length) {
    console.log("✅ 全部 " + maxDistPairs.length + " 对超阈值词对都能在人工表里找到出处。");
    console.log("   断言可写成：「距离 > 2 的词对，逐对必须出现在人工校对表里」——性质而非计数。");
  } else {
    console.log("⚠ 有 " + orphan.length + " 对超阈值词对在人工表里找不到出处：");
    orphan.forEach((p) => console.log("   " + p[0] + " / " + p[1] + " = " + p[2]));
  }
}
console.log("=".repeat(60));
