// 精确核对 ECDICT 列映射：抽常用词看原始行 + 逐列拆分
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const csv = path.join(__dirname, "..", "raw", "npm", "package", "assets", "ecdict.csv");
const TARGETS = new Set(["abandon", "government", "necessary", "receive", "separate", "dictionary", "environment", "run", "good", "make"]);
const HEADER = "word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio".split(",");

function parseLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const rl = readline.createInterface({ input: fs.createReadStream(csv, { encoding: "utf8" }), crlfDelay: Infinity });
(async () => {
  let first = true, done = 0;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    const prefix = line.slice(0, line.indexOf(",")).toLowerCase();
    if (!TARGETS.has(prefix)) continue;
    const c = parseLine(line);
    if (!TARGETS.has(String(c[0]).toLowerCase())) continue;
    console.log("\n========================================");
    console.log("原始行:", line.slice(0, 400));
    console.log("字段数:", c.length, "（表头", HEADER.length, "列）");
    c.forEach((v, i) => {
      const nm = HEADER[i] || "?extra" + i;
      console.log(`  [${String(i).padStart(2)}] ${nm.padEnd(12)} = ${JSON.stringify(v).slice(0, 130)}`);
    });
    done++;
    if (done >= 4) break;
  }
  console.log("\n完成，采样", done, "条");
})();
