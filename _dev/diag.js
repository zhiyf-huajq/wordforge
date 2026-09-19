const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(process.argv[2], "utf8");
const scripts = [];
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html)) !== null) scripts.push({ attrs: m[1], code: m[2] });
console.log("script 数量: " + scripts.length);
scripts.forEach((s, i) => console.log(`  [${i}] attrs="${s.attrs.trim()}" len=${(s.code.length / 1024).toFixed(1)}KB 头部=${JSON.stringify(s.code.slice(0, 60))}`));
const app = scripts.find((s) => s.code.indexOf("__WFAPI") >= 0) || scripts[scripts.length - 1];
const tmp = path.join(__dirname, "_app_extracted.js");
fs.writeFileSync(tmp, app.code, "utf8");
console.log("\n已导出应用脚本到 " + tmp + "  (" + app.code.length + " 字符)");

// 用 vm 编译，拿到行列号
const vm = require("vm");
try {
  new vm.Script(app.code, { filename: "app.js" });
  console.log("vm.Script 编译通过");
} catch (e) {
  console.log("\n编译错误: " + e.message);
  if (e.stack) console.log(e.stack.split("\n").slice(0, 6).join("\n"));
  // 手动定位：正则查找常见的未转义问题
  const lines = app.code.split("\n");
  console.log("\n文件共 " + lines.length + " 行");
}
