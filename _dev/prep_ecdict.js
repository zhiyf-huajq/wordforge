// 1) 校验 ECDICT 字段内换行是「字面 \n」还是「真换行」
// 2) 把 csv / lemma / wordroot 放到 etl.py 期待的位置
const fs = require("fs");
const path = require("path");
const RAW = path.join(__dirname, "..", "raw");
const SRC = path.join(RAW, "npm", "package", "assets");

function probeLine(file, keyword) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(1 << 20); // 1MB
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const txt = buf.slice(0, n).toString("utf8");
  const lines = txt.split(/\r?\n/);
  for (const l of lines) {
    if (l.toLowerCase().startsWith(keyword + ",")) {
      const hasLiteral = l.indexOf("\\n") >= 0;
      const q = (l.match(/"/g) || []).length;
      console.log(`\n【${keyword}】行长 ${l.length}`);
      console.log(`  含字面 \\n : ${hasLiteral}`);
      console.log(`  引号数量（应为偶数）: ${q}`);
      console.log(`  片段: ${l.slice(0, 200)}`);
      return;
    }
  }
  console.log(`  未在前 1MB 找到 ${keyword}`);
}

console.log("=== 换行符形态校验 ===");
probeLine(path.join(SRC, "ecdict.csv"), "abandon");

console.log("\n=== 复制到 etl.py 期待路径 ===");
const JOBS = [
  ["ecdict.csv", "ecdict.csv"],
  ["lemma.en.txt", "lemma.en.txt"],
  ["wordroot.txt", "wordroot.txt"],
  ["resemble.txt", "resemble.txt"],
];
for (const [s, d] of JOBS) {
  const sp = path.join(SRC, s);
  const dp = path.join(RAW, d);
  if (!fs.existsSync(sp)) { console.log(`  ! 源缺失 ${s}`); continue; }
  fs.copyFileSync(sp, dp);
  console.log(`  ✓ ${d.padEnd(16)} ${(fs.statSync(dp).size / 1048576).toFixed(2)} MB`);
}
console.log("\n完成");
