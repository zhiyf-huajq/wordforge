// 诊断当前 data_words.json 的字段覆盖率，并输出首条记录全貌
const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "build", "data_words.json");
const words = JSON.parse(fs.readFileSync(p, "utf8"));
const F = { W: 0, US: 1, UK: 2, POS: 3, CN: 4, EN: 5, EX: 6, EXZ: 7, TG: 8, FM: 9, BNC: 10, FRQ: 11, ST: 12, OX: 13, PH: 14, RT: 15, SYN: 16, ANT: 17, DIS: 18, MN: 19 };
const NF = 20;
const NAMES = {
  0: "W 单词", 1: "US 美音标", 2: "UK 英音标", 3: "POS 词性", 4: "CN 中文释义",
  5: "EN 英文释义", 6: "EX 例句", 7: "EXZ 例句翻译", 8: "TG 词书标签", 9: "FM 词形变化",
  10: "BNC 词频排名", 11: "FRQ 当代词频", 12: "ST 柯林斯星级", 13: "OX 牛津标记",
  14: "PH 常用搭配", 15: "RT 词根词缀", 16: "SYN 同义词", 17: "ANT 反义词", 18: "DIS 近义词辨析",
  19: "MN 巧记",
};
console.log("词条总数:", words.length, "\n");
console.log("--- 前 3 条记录全貌 ---");
for (let i = 0; i < 3; i++) {
  const r = words[i];
  console.log(`\n[${i}] 数组长度 = ${r.length}`);
  for (let k = 0; k < NF; k++) {
    const v = r[k];
    const shown = v === undefined ? "(undefined)" : v === null ? "(null)" : JSON.stringify(v).slice(0, 70);
    console.log(`   ${String(k).padStart(2)} ${NAMES[k].padEnd(14)} = ${shown}`);
  }
}

console.log("\n--- 字段覆盖率 ---");
const n = words.length;
for (let k = 0; k < NF; k++) {
  let has = 0;
  for (const r of words) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") has++;
  }
  const bar = "█".repeat(Math.round((has / n) * 24));
  console.log(`  ${NAMES[k].padEnd(14)} ${String(has).padStart(6)} / ${n}  ${String(((has / n) * 100).toFixed(1)).padStart(5)}%  ${bar}`);
}

// 数组长度分布
const lenDist = {};
for (const r of words) lenDist[r.length] = (lenDist[r.length] || 0) + 1;
console.log("\n--- 数组长度分布 ---");
Object.keys(lenDist).sort((a, b) => a - b).forEach((k) => console.log(`  长度 ${k}: ${lenDist[k]} 条`));

// 中间空洞检查
let hole = 0, holeWords = [];
for (const r of words) {
  let last = -1;
  for (let i = 0; i < NF; i++) if (r[i] !== undefined && r[i] !== null && String(r[i]).trim() !== "") last = i;
  for (let i = 0; i <= last; i++) {
    const v = r[i];
    if (v === undefined || v === null) { hole++; if (holeWords.length < 5) holeWords.push(r[0]); }
  }
}
console.log("\n--- 中间空洞（有值字段之间夹空）---");
console.log(`  空洞数: ${hole}`, holeWords.length ? "  样例: " + holeWords.join(", ") : "");
