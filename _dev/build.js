// 组装单文件 HTML: node build.js
const fs = require("fs");
const path = require("path");
const B = path.join(__dirname, "..", "build");
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
fs.mkdirSync(DIST, { recursive: true });

function rd(p) { return fs.readFileSync(p, "utf8"); }

const head = rd(path.join(B, "part1_head.html"));
const body = rd(path.join(B, "part2_body.html"));
const app = rd(path.join(B, "part3_app.js"));
const read = rd(path.join(B, "part3b_read.js"));
const rview = rd(path.join(B, "part4b_read.js"));
const views = rd(path.join(B, "part4_views.js"));

// 组装前先编译校验，拦住引号/括号笔误（part3 + 精读 + part4 是同一个 IIFE 的几段，必须合并校验）
const vm = require("vm");
try {
  new vm.Script(app + "\n" + read + "\n" + rview + "\n" + views, { filename: "app.bundle.js" });
  console.log("语法预检通过");
} catch (e) {
  console.error("语法错误: " + e.message);
  if (e.stack) console.error(e.stack.split("\n").slice(0, 6).join("\n"));
  console.error("\n构建中止：脚本存在语法错误");
  process.exit(1);
}

const words0 = JSON.parse(rd(path.join(B, "data_words.json")));
const books = JSON.parse(rd(path.join(B, "data_books.json")));
const roots = JSON.parse(rd(path.join(B, "data_roots.json")));

/* 释义清洗（构建期必跑，不是可选项）：
   把 ECDICT 里「第一行只是一个孤立的词性缩写」的残缺行去掉，并把被错切成
   `ad` + `v.` 的 `adv.` 改回来。不清洗的后果很实在 ——
   选择题的正确项取的是释义第一行，于是整道题的正确选项显示成一个「ad」，
   那是一道没法做的废题；卡片上也会多出一行莫名其妙的「ad」。
   放在这里而不是只跑一次脚本，是为了「有人重跑 ETL 之后修复不会静默消失」。
   纯函数、不改原数组；明细见 _dev/fix_defs.js 顶部注释。 */
const { fixWords, fieldIdx, stats } = require("./fix_defs.js");
const FI = fieldIdx(app);
const _fx = fixWords(words0, FI.CN, FI.POS);
const words = _fx.words;
if (_fx.changed.length) {
  const _st = stats(words, FI.CN);
  console.log("释义清洗：修掉 " + _fx.changed.length + " 条（其中把 `v.` 改回 `adv.` 的 " +
    _fx.changed.filter((c) => c.retagged).length + " 条）；" +
    "剩余「第一行无中文」" + _st.english + " 条 —— 那类源数据本身只有英文，不硬造");
}
/* 形近词组（易混词）。**单独一个顶层键**，不塞进词条的字段里：
   词条是定长数组（20 个槽位），加第 21 个槽位会牵动 mkBlank / normArr /
   数据契约断言一整条链；而且这份数据是按「组」组织的，跟单个词条不是一回事。
   缺文件时退化成空数组，应用侧照常跑（易混词页会显示空态），构建不因此失败 ——
   这跟「词库缺失」不是一个严重级别，不该把整次构建拦下来。 */
let confuse = [];
try { confuse = JSON.parse(rd(path.join(B, "data_confuse.json"))); }
catch (e) { console.warn("⚠ 没有 build/data_confuse.json（易混词数据），本次构建该项为空。先跑 node _dev/prep_confuse.js"); }

const payload = JSON.stringify({ W: words, R: roots, B: books, C: confuse });
// 防止数据中意外出现 </script>
const safe = payload.replace(/<\//g, "<\\/");

const html = [
  head,
  body,
  "",
  '<script id="wf-data">window.__WF=' + safe + ";</script>",
  "<script>",
  app,
  "",
  read,
  "",
  rview,
  "",
  views,
  "</script>",
  "</body>",
  "</html>",
  "",
].join("\n");

const outName = "词匠-离线背单词.html";
const outPath = path.join(DIST, outName);
fs.writeFileSync(outPath, html, "utf8");

console.log("构建完成");
console.log("  词条", words.length);
console.log("  词书", books.length);
console.log("  词根", roots.length);
console.log("  易混词组", confuse.length);
console.log("  数据 " + (payload.length / 1048576).toFixed(2) + " MB");
console.log("  文件 " + (fs.statSync(outPath).size / 1048576).toFixed(2) + " MB");
console.log("  " + outPath);
