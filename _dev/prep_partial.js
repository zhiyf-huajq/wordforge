// 把已下载的部分文件切成分块，供 dl2.js 续传
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = path.join(ROOT, "raw", "ecdict.csv");
const partdir = src + ".parts";
const CHUNK = 4 * 1048576;

if (!fs.existsSync(src)) { console.log("没有部分文件"); process.exit(0); }
const size = fs.statSync(src).size;
console.log(`部分文件 ${(size / 1048576).toFixed(2)} MB`);
fs.mkdirSync(partdir, { recursive: true });
const full = Math.floor(size / CHUNK);
const fd = fs.openSync(src, "r");
for (let i = 0; i < full; i++) {
  const buf = Buffer.alloc(CHUNK);
  fs.readSync(fd, buf, 0, CHUNK, i * CHUNK);
  fs.writeFileSync(path.join(partdir, "p" + String(i).padStart(5, "0")), buf);
}
fs.closeSync(fd);
console.log(`已生成 ${full} 个完整分块可复用，丢弃尾部 ${((size - full * CHUNK) / 1048576).toFixed(2)} MB`);
fs.renameSync(src, src + ".old");
console.log("原文件重命名为 ecdict.csv.old（确认下载完成后再删）");
