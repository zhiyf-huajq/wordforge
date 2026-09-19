// 评估 ECDICT 对我们的 22390 词表的实际覆盖率（决定值不值得灌）
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const wp = path.join(__dirname, "..", "build", "data_words.json");
const words = JSON.parse(fs.readFileSync(wp, "utf8"));
const F = { W: 0, US: 1, UK: 2, POS: 3, CN: 4, EN: 5, EX: 6, EXZ: 7, TG: 8, FM: 9, BNC: 10, FRQ: 11, ST: 12, OX: 13, PH: 14, RT: 15 };

// 目标词集合（小写）
const want = new Set();
for (const r of words) {
  const w = String(r[F.W] || "").toLowerCase();
  if (w) want.add(w);
}
console.log("我方词表:", words.length, "条，去重小写:", want.size);

// ECDICT 列序: word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
const csv = path.join(__dirname, "..", "raw", "npm", "package", "assets", "ecdict.csv");

// 简易 CSV 行解析（支持引号包裹 + 双引号转义）
function parseLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const hit = { phonetic: 0, definition: 0, translation: 0, pos: 0, collins: 0, oxford: 0, tag: 0, bnc: 0, frq: 0, exchange: 0 };
const found = new Set();
const rl = readline.createInterface({ input: fs.createReadStream(csv, { encoding: "utf8" }), crlfDelay: Infinity });
(async () => {
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    // 快速预筛：取逗号/引号前的前缀
    const m = line.match(/^([^,]*)/);
    let w = (m ? m[1] : "").toLowerCase();
    if (!want.has(w)) continue;
    const c = parseLine(line);
    if (c[0].toLowerCase() !== w) w = c[0].toLowerCase();
    if (!want.has(w)) continue;
    found.add(w);
    if (c[1]) hit.phonetic++;
    if (c[2]) hit.definition++;
    if (c[3]) hit.translation++;
    if (c[4]) hit.pos++;
    if (c[5] && c[5] !== "0") hit.collins++;
    if (c[6] && c[6] !== "0") hit.oxford++;
    if (c[7]) hit.tag++;
    if (c[8] && c[8] !== "0") hit.bnc++;
    if (c[9] && c[9] !== "0") hit.frq++;
    if (c[10]) hit.exchange++;
  }
  const n = words.length;
  console.log("\n--- ECDICT 命中情况 ---");
  console.log(`  词表命中: ${found.size} / ${n}  (${((found.size / n) * 100).toFixed(1)}%)`);
  console.log(`  未命中:   ${n - found.size} 条`);
  console.log("\n--- 可补充字段覆盖率（以命中的 " + found.size + " 条为分母）---");
  const dn = found.size || 1;
  for (const k of Object.keys(hit)) {
    const count = hit[k];
    const pct = (count / dn) * 100;
    const bar = "█".repeat(Math.round(pct / 4));
    console.log(`  ${k.padEnd(12)} ${String(count).padStart(6)}  ${pct.toFixed(1).padStart(5)}%  ${bar}`);
  }
  console.log("\n--- 相对全词表（" + n + "）的净增益 ---");
  for (const k of Object.keys(hit)) {
    console.log(`  ${k.padEnd(12)} 可覆盖 ${((hit[k] / n) * 100).toFixed(1)}% 的词`);
  }
})();
