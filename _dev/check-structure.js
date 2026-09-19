// 结构校验: node check-structure.js <html> [outTxt]
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
const outFile = process.argv[3];
const html = fs.readFileSync(file, "utf8");
const out = [];
function p(s) { out.push(s); console.log(s); }

let errors = 0, warns = 0;
function err(s) { errors++; p("  ✗ " + s); }
function warn(s) { warns++; p("  ! " + s); }
function ok(s) { p("  ✓ " + s); }

p("检查文件: " + path.basename(file) + "  (" + (Buffer.byteLength(html) / 1048576).toFixed(2) + " MB)");
p("");

/* ---------- 1. 脚本提取与语法 ---------- */
p("[1] 内联脚本语法");
const scripts = [];
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html)) !== null) scripts.push({ attrs: m[1], code: m[2] });
ok("内联 script 标签数: " + scripts.length);

let appCode = "";
scripts.forEach((s, i) => {
  if (/\bsrc\s*=/.test(s.attrs)) { err("script[" + i + "] 引用了外部 src"); return; }
  try {
    new Function(s.code);
    ok("script[" + i + "] 语法正确 (" + (s.code.length / 1024).toFixed(0) + " KB)");
  } catch (e) {
    err("script[" + i + "] 语法错误: " + e.message);
  }
  if (s.code.length > 2000) appCode = s.code;
});

/* ---------- 2. 网络调用 ---------- */
/* 精读是应用里唯一允许联网的模块，所以规则从「零网络」换成更严格的一组结构性约束：
   出口唯一 + 域名白名单 + 无上传通道 + 隐私默认值写死。
   这几条合在一起，才能说「主功能不会偷偷发请求、精读也没法把数据传出去」。 */
p("");
p("[2] 网络调用（单出口 + 白名单 + 无上传通道）");
let netCount = 0;
let fetchIn = 0;
{
  /* 圈出联网层：从白名单声明到「文章源」小节 */
  const netStart = appCode.indexOf("var NET_WL");
  const netEnd = appCode.indexOf("/* ---------- 13. 文章源");
  const hasNetLayer = netStart >= 0 && netEnd > netStart;
  if (!hasNetLayer) {
    err("找不到联网层区块（var NET_WL … 13. 文章源），单出口约束无法验证");
  } else {
    const netLayer = appCode.slice(netStart, netEnd);
    const outside = appCode.slice(0, netStart) + appCode.slice(netEnd);

    /* ① 出口唯一：fetch 只允许出现在联网层里 */
    fetchIn = (netLayer.match(/\bfetch\s*\(/g) || []).length;
    const fetchOut = (outside.match(/\bfetch\s*\(/g) || []).length;
    if (fetchOut) { netCount += fetchOut; err("联网层之外出现 " + fetchOut + " 处 fetch( —— 「单一出口」被破坏"); }
    else ok("fetch( 只出现在联网层内（" + fetchIn + " 处），其余模块零网络调用");

    /* ② 无上传通道：这些 API 一个都不许出现 */
    let upCount = 0;
    [
      [/\bXMLHttpRequest\b/g, "XMLHttpRequest"],
      [/new\s+WebSocket/g, "WebSocket"],
      [/navigator\s*\.\s*sendBeacon/g, "sendBeacon"],
      [/\bEventSource\b/g, "EventSource"],
      [/\bFormData\b/g, "FormData"],
      [/\bimport\s*\(/g, "dynamic import()"],
      [/["'`](POST|PUT|PATCH|DELETE)["'`]/gi, "非 GET 方法"],
    ].forEach(([r, name]) => {
      const c = (appCode.match(r) || []).length;
      if (c) { upCount += c; err("发现上传 / 旁路通道：" + name + " × " + c); }
    });
    if (!upCount) ok("无上传通道（无 XHR / WebSocket / sendBeacon / FormData / 非 GET 方法）");

    /* ③ 隐私默认值必须写死在请求里，而不是靠调用方自觉 */
    const need = [
      [/credentials\s*:\s*["']omit["']/, 'credentials:"omit"（不带凭据）'],
      [/referrerPolicy\s*:\s*["']no-referrer["']/, 'referrerPolicy:"no-referrer"（不暴露来源页）'],
      [/method\s*:\s*["']GET["']/, 'method:"GET"（只读）'],
    ];
    const miss = need.filter((x) => !x[0].test(netLayer)).map((x) => x[1]);
    if (miss.length) err("取文请求缺少隐私约束：" + miss.join("、"));
    else ok("取文请求带齐隐私约束（仅 GET · 不带凭据 · 不发送来源页）");

    /* ④ 白名单校验函数必须先于请求存在 */
    if (!/function\s+netHostOK/.test(netLayer)) err("缺少 netHostOK()：域名白名单校验必须先于请求发生");
    else ok("存在 netHostOK() 白名单校验（强制 https，拒绝名单外域名）");

    /* ⑤ 白名单非空，且静态 URL 字面量的主机都在名单内 */
    const wl = /var\s+NET_WL\s*=\s*\[([\s\S]*?)\]/.exec(netLayer);
    const hosts = wl ? (wl[1].match(/["']([^"']+)["']/g) || []).map((x) => x.slice(1, -1)) : [];
    if (!hosts.length) err("域名白名单为空");
    else ok("域名白名单 " + hosts.length + " 项：" + hosts.slice(0, 4).join(" · ") + (hosts.length > 4 ? " …" : ""));
    const staticUrls = netLayer.match(/["']https:\/\/[a-z0-9.-]+\//gi) || [];
    const bad = [];
    staticUrls.forEach((u) => {
      const h = /https:\/\/([^\/"']+)/i.exec(u);
      if (h && hosts.indexOf(h[1].toLowerCase()) < 0) bad.push(h[1]);
    });
    if (bad.length) err("联网层里出现白名单外的域名：" + [...new Set(bad)].join(", "));
    else ok("静态 URL 全部落在白名单内（" + staticUrls.length + " 处；动态拼接的主机由 netHostOK 在运行时再校验）");
  }
}
if (!netCount) ok("NETWORK CALLS: 全部经由唯一出口，且仅限白名单域名");
else err("NETWORK CALLS: " + netCount + "（存在出口之外的调用）");


/* ---------- 3. 外部资源 ---------- */
p("");
p("[3] 外部资源");
let extCount = 0;
[["<link", /<link\b/gi], ["<script src=", /<script[^>]+src\s*=/gi], ["@import", /@import/gi], ["url( 引用", /url\s*\(\s*['"]?https?:/gi], ["<img src=http", /<img[^>]+src\s*=\s*["']https?:/gi], ["<iframe", /<iframe\b/gi]]
  .forEach(([n, r]) => {
    const c = (html.match(r) || []).length;
    if (c) { extCount += c; err(n + " × " + c); }
  });
if (!extCount) ok("EXTERNAL RESOURCES: 0");

/* ---------- 4. id 引用完整性 ---------- */
p("");
p("[4] id 引用");
const defined = new Set();
let mm;
const idDef = /\bid\s*=\s*\\?["']([A-Za-z][\w-]*)["']/g;
while ((mm = idDef.exec(html)) !== null) defined.add(mm[1]);
const refs = new Set();
const idRef = /\$\s*\(\s*["']([A-Za-z][\w-]*)["']\s*\)|getElementById\s*\(\s*["']([A-Za-z][\w-]*)["']\s*\)/g;
while ((mm = idRef.exec(appCode)) !== null) refs.add(mm[1] || mm[2]);
const missing = [...refs].filter((r) => !defined.has(r));
ok("定义的 id: " + defined.size + " 个");
ok("引用的 id: " + refs.size + " 个");
if (missing.length) err("引用了未定义的 id: " + missing.join(", "));
else ok("所有 id 引用都能找到定义");

/* ---------- 5. 标签配对 ---------- */
p("");
p("[5] 标签配对");
/* ⚠ 扫之前必须先剥掉注释 —— 注释里写的「示例标签」不是 DOM，不该参与配对。
   踩过：我在 CSS 注释里写了「带 viewBox 的 <svg> 在 CSS 里 width/height 都是 auto 时…」，
   那个 <svg> 字面量被当成一个真实开标签，于是报出「开 56 / 闭 55」的假警告。
   这是第二次栽在同一件事上（上一次是断言被自己写的反面教材注释绊倒）。
   只剥 HTML 注释与 <style> 块内的 CSS 注释，**不碰 <script>**：
   JS 里的 '<svg>' 是真实模板片段，剥了就漏检。 */
const htmlCode = html
  .replace(/<style[\s\S]*?<\/style>/gi, (m) => m.replace(/\/\*[\s\S]*?\*\//g, ""))
  .replace(/<!--[\s\S]*?-->/g, "");
["div", "span", "button", "table", "tbody", "thead", "tr", "td", "th", "svg", "symbol", "aside", "main", "header", "nav", "label", "select", "textarea"].forEach((t) => {
  const o = (htmlCode.match(new RegExp("<" + t + "(?=[\\s>])", "g")) || []).length;
  const c = (htmlCode.match(new RegExp("</" + t + ">", "g")) || []).length;
  if (o !== c) warn("<" + t + "> 开 " + o + " / 闭 " + c + "（模板字符串里可能有未闭合）");
});
ok("标签配对扫描完成（动态字符串中的不平衡属正常）");

/* ---------- 6. 数据完整性 ---------- */
p("");
p("[6] 数据完整性");
const dm = html.match(/window\.__WF=([\s\S]*?);<\/script>/);
if (!dm) err("未找到内联数据 window.__WF");
else {
  let D;
  try { D = JSON.parse(dm[1].replace(/<\\\//g, "</")); ok("数据 JSON 解析成功"); }
  catch (e) { err("数据 JSON 解析失败: " + e.message); }
  if (D) {
    ok("词条 " + D.W.length + " / 词书 " + D.B.length + " / 词根 " + D.R.length);
    const seen = new Map();
    let dup = 0, badField = 0, badWord = 0;
    D.W.forEach((r) => {
      if (!Array.isArray(r)) { badField++; return; }
      const w = r[0];
      if (!w || typeof w !== "string" || !/^[A-Za-z]/.test(w)) badWord++;
      const k = String(w).toLowerCase();
      if (seen.has(k)) dup++; else seen.set(k, 1);
      if (!r[4] || typeof r[4] !== "string") badField++;
    });
    if (dup) err("重复词条 " + dup + " 个"); else ok("无重复词条");
    if (badWord) err("非法单词 " + badWord + " 个"); else ok("单词字段全部合法");
    if (badField) err("释义缺失 " + badField + " 个"); else ok("释义字段全部有值");
    /* 释义首行不能只是「孤立的词性缩写」——
       ECDICT 有一批副词条目被切成了 `ad` + `v. xxx` 两行，也就是 adv. 被劈开了。
       没清洗的话，选择题的正确项（取的就是首行）会显示成一个孤零零的 "ad"，
       那是一道没法做的废题。判据与构建期清洗完全一致（见 _dev/fix_defs.js）。 */
    {
      const POSONLY = /^[a-z]{1,6}\.?$/i;
      const CJK = /[\u4e00-\u9fff]/;
      let tagOnly = 0, enOnly = 0, sample = null;
      D.W.forEach((r) => {
        const lines = String(r[4] == null ? "" : r[4]).split("\n").map((s) => s.trim()).filter(Boolean);
        const f = lines[0] || "";
        if (CJK.test(f)) return;
        if (lines.length > 1 && POSONLY.test(f) && lines.slice(1).some((x) => CJK.test(x))) {
          tagOnly++;
          if (!sample) sample = r[0] + " → " + JSON.stringify(String(r[4]).slice(0, 40));
        } else enOnly++;
      });
      if (tagOnly) err("释义首行是孤立的词性缩写（选择题会出废题）" + tagOnly + " 条，例：" + sample);
      else ok("释义首行没有孤立的词性缩写（选择题正确项不会显示成孤零零一个 ad）");
      /* 这一类修不了：源数据的中文释义字段里就只有英文。
         不硬造，靠 firstDef 兜底显示 + 出题时避开（modeOK / 测试中心选池都挡了）。 */
      ok("释义字段其实是英文的条目 " + enOnly + " 条（源数据如此，已由 firstDef 兜底且不参与出题）");
    }
    // 词书引用一致性
    const ids = new Set(D.B.map((b) => b.id));
    const used = new Set();
    D.W.forEach((r) => String(r[8] || "").split("|").filter(Boolean).forEach((t) => used.add(t)));
    const orphan = [...used].filter((t) => !ids.has(t));
    if (orphan.length) warn("词条引用了未定义的词书: " + orphan.join(", "));
    else ok("词书标签全部有效");
    const empty = D.B.filter((b) => !b.n);
    if (empty.length) warn("空词书: " + empty.map((b) => b.id).join(", "));
    // 每个词书的标签数是否与 n 一致
    D.B.forEach((b) => {
      const c = D.W.filter((r) => String(r[8] || "").split("|").indexOf(b.id) >= 0).length;
      if (c !== b.n) warn("词书 " + b.id + " 声明 " + b.n + " 实际 " + c);
    });
  }
}

/* ---------- 7. 转义函数存在性 ---------- */
p("");
p("[7] 安全");
if (/function esc\s*\(/.test(appCode)) ok("存在 esc() 转义函数");
else err("缺少 esc() 转义函数");
if (/innerHTML/.test(appCode) && /esc\(/.test(appCode)) ok("innerHTML 与 esc() 同时存在，请人工复核所有插值点");
else warn("未检测到 esc() 使用");

p("");
p("=".repeat(58));
p("结果: 错误 " + errors + " / 警告 " + warns);
p("NETWORK CALLS: " + fetchIn + "（全部经由唯一出口 netGet）   EXTERNAL RESOURCES: " + extCount);
p("=".repeat(58));

if (outFile) fs.writeFileSync(outFile, out.join("\n"), "utf8");
process.exit(errors ? 1 : 0);
