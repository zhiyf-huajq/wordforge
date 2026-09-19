// 扫描 JS 中"字符串未闭合"的行（引号笔误）：node lint-quotes.js <file>...
const fs = require("fs");

function scan(file) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  const bad = [];
  let i = 0, line = 1, state = null, startLine = 0, startCol = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "\n") {
      if (state === "'" || state === '"') {
        bad.push({ line: startLine, col: startCol, msg: "字符串用 " + state + " 开启但本行未闭合", text: lines[startLine - 1] });
        state = null;
      }
      line++; i++; continue;
    }
    if (state) {
      if (c === "\\") { i += 2; continue; }
      if (c === state) state = null;
      i++; continue;
    }
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; } i += 2; continue; }
    if (c === "/") {
      // 判断是正则字面量还是除号：看前一个有效字符
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j--;
      const prev = j >= 0 ? src[j] : "";
      let word = "";
      let k = j;
      while (k >= 0 && /[A-Za-z$_]/.test(src[k])) { word = src[k] + word; k--; }
      const KW = ["return", "typeof", "instanceof", "in", "of", "case", "delete", "void", "do", "else", "yield", "await", "new"];
      const regexOK = prev === "" || "(,=:[!&|?{};+-*%~^<>".indexOf(prev) >= 0 || KW.indexOf(word) >= 0;
      if (regexOK) {
        i++;
        let cls = false;
        while (i < n && src[i] !== "\n") {
          if (src[i] === "\\") { i += 2; continue; }
          if (src[i] === "[") cls = true;
          else if (src[i] === "]") cls = false;
          else if (src[i] === "/" && !cls) break;
          i++;
        }
        i++;
        continue;
      }
    }
    if (c === "'" || c === '"' || c === "`") { state = c; startLine = line; startCol = i; i++; continue; }
    i++;
  }
  if (state) bad.push({ line: startLine, col: startCol, msg: "文件结束时字符串仍未闭合", text: lines[startLine - 1] });
  return bad;
}

let total = 0;
process.argv.slice(2).forEach((f) => {
  const bad = scan(f);
  if (bad.length) {
    console.log("\n" + f);
    bad.forEach((b) => {
      total++;
      console.log("  第 " + b.line + " 行: " + b.msg);
      console.log("    " + String(b.text || "").trim().slice(0, 160));
    });
  } else console.log("OK  " + f);
});
console.log("\n合计问题行: " + total);
process.exit(total ? 1 : 0);
