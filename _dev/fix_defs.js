/* 释义字段清洗：把「第一行只是一个孤立的词性缩写」的残缺行去掉。
 *
 * 背景（实测数据，不是猜测）：
 *   raw/ecdict.csv 里有一批副词条目的 translation 长这样：
 *       accurately  →  "ad\nv. 正确无误地，准确地精确地"
 *       whatsoever  →  "pro\nn. 无论什么"
 *       each other  →  "pro\nn. 互相, 各自"
 *   第一行那个 "ad" / "pro" 是 ECDICT 的词性缩写残留，**它自己的词性还标错了**
 *   （accurately 是副词，第二行却写 "v."）。后果有两处，都很实在：
 *     ① 卡片上多出一行没有任何意义的 "ad"；
 *     ② **选择题的正确项取的是 [0] 行** —— 于是整道题的正确选项就显示成一个 "ad"，
 *        那是一道没法做的废题。
 *   全库 24027 条里有 92 条是这个形态，其中 30 条在四六级词书里
 *   （awfully / bitterly / closely / thoroughly / subsequently …全是六级眼熟的词）。
 *
 * 规则（三条同时成立才删，实测 92 条命中、零误伤）：
 *   - 第一行不含中文；
 *   - 第一行整体就是一个纯 ASCII 词性缩写（ad / pro / a. / n. / adv …）；
 *   - 后面至少还有一行中文。
 *   三条同时成立才删，且最多删 2 行（实测没有超过 1 行的）。
 *
 * 另一类修不了：整条都是英文释义（79 条，如 `Been is the past participle of…`，
 * 四六级里 3 条：demography / dissatisfy / kilometer）。源数据就没有中文，
 * 不硬造 —— 交给渲染层用 firstDef() 兜底 + 出题时避开。
 */
const fs = require("fs");
const path = require("path");

const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s);
/* 纯词性缩写：ad / pro / a. / n. / adv. / prep. … 只认 ASCII 字母 + 可选点 */
const POS_ONLY = /^[a-z]{1,6}\.?$/i;

function cleanDefLines(cn, pos) {
  let lines = String(cn == null ? "" : cn).split("\n").map((s) => s.trim());
  // 先丢掉空行（尾部换行很常见），但保留至少一行
  lines = lines.filter((s, i) => s.length > 0 || i === 0);
  let removed = 0;
  const firstTag = lines[0] || "";
  while (
    removed < 2 &&
    lines.length > 1 &&
    lines[0] &&
    !hasCJK(lines[0]) &&
    POS_ONLY.test(lines[0]) &&
    lines.slice(1).some(hasCJK)
  ) {
    lines.shift();
    removed++;
  }
  if (!removed) return null;

  /* 第二处错位（同一个根因的另一半）：ECDICT 把 `adv.` 切成了 `ad` + `v.` 两段。
     证据是三条独立字段互证，不是推断：
       ① 被删掉的残留行是 `ad`；
       ② 词性字段 F.POS 写的是 `adv.`（这个是对的）；
       ③ 剩下那行的开头偏偏是 `v.`。
     三个都对上才改 —— 因为「副词释义被标成动词」是会被用户当真的错：
     卡片上写着「v. 一年一次；每年」，学的人就会记成动词。
     注意 importantly 那种是 `v.重要地`（点后没有空格），所以用 \s*。 */
  if (
    /^(ad|adv)\.?$/i.test(firstTag) &&
    /adv/i.test(String(pos || "")) &&
    /^v\.\s*/.test(lines[0])
  ) {
    lines[0] = lines[0].replace(/^v\.\s*/, "adv. ");
  }
  return { v: lines.join("\n"), removed: removed, before: String(cn), retag: removed && firstTag };
}

/* 纯函数：不改传入的数组，返回新数组 + 统计 */
function fixWords(words, ci, pi) {
  const out = [];
  const changed = [];
  for (let i = 0; i < words.length; i++) {
    const r = words[i];
    const cn = r[ci];
    const res = cleanDefLines(cn, pi === undefined ? "" : r[pi]);
    if (!res) { out.push(r); continue; }
    const nr = r.slice();
    nr[ci] = res.v;
    out.push(nr);
    changed.push({ w: r[0], before: res.before, after: res.v, retagged: res.v.indexOf("adv. ") === 0 });
  }
  return { words: out, changed: changed };
}

/* 统计「第一行完全没有中文」的条目（清洗后仍然存在的那些 = 修不了的一类） */
function stats(words, ci) {
  let tagOnly = 0, english = 0;
  words.forEach((r) => {
    const lines = String(r[ci] == null ? "" : r[ci]).split("\n").map((s) => s.trim()).filter(Boolean);
    const f = lines[0] || "";
    if (hasCJK(f)) return;
    if (lines.length > 1 && POS_ONLY.test(f) && lines.slice(1).some(hasCJK)) tagOnly++;
    else english++;
  });
  return { tagOnly: tagOnly, english: english };
}

module.exports = { fixWords, cleanDefLines, stats, hasCJK, POS_ONLY, fieldIdx };

/* 从 part3_app.js 的字段表 `var F = { W:0, ..., CN:4, ... }` 里解析下标。
   ⚠ 一律不许硬编码：第一版我凭印象写 CI=2（以为 CN 是第二个字段），
   而实际 F.CN = 4（POS 占了 3）—— 错下标的后果不是报错，
   是**悄悄拿音标/词性字段当释义去改**，静默毁数据。 */
function fieldIdx(appSrc) {
  const fm = appSrc.match(/var F = \s*\{([^}]*)\}/);
  if (!fm) throw new Error("找不到字段表 var F = {...}");
  const g = (k) => {
    const m = new RegExp("(?:^|[,\\s])" + k + ":\\s*(\\d+)").exec(fm[1]);
    if (!m) throw new Error("字段表里没有 " + k);
    return Number(m[1]);
  };
  return { CN: g("CN"), POS: g("POS"), W: g("W"), table: fm[1].trim() };
}

/* ---------- CLI：直接修补 build/data_words.json（原地 + 备份） ---------- */
if (require.main === module) {
  const ROOT = path.join(__dirname, "..");
  const F = path.join(ROOT, "build", "data_words.json");
  const dry = process.argv.indexOf("--dry") >= 0;
  /* ⚠ 下标从 part3_app.js 的字段表里解析出来，不硬编码（见 fieldIdx 的注释）。 */
  const FI = fieldIdx(fs.readFileSync(path.join(ROOT, "build", "part3_app.js"), "utf8"));
  const CI = FI.CN, PI = FI.POS;
  console.log("从源码解析出的字段下标：CN = " + CI + "，POS = " + PI + "（" + FI.table + "）");
  console.log("");

  const words = JSON.parse(fs.readFileSync(F, "utf8"));
  const before = stats(words, CI);
  const r = fixWords(words, CI, PI);

  console.log("清洗前：第一行无中文的条目 " + (before.tagOnly + before.english) +
    " 条 = 词性缩写残留 " + before.tagOnly + " + 纯英文 " + before.english);
  console.log("本次会删掉孤立词性缩写行: " + r.changed.length + " 条" +
    "（其中把 `v.` 改回 `adv.` 的 " + r.changed.filter((c) => c.retagged).length + " 条）");
  console.log("");
  r.changed.slice(0, 12).forEach((c) => {
    console.log("  " + String(c.w).padEnd(18) + JSON.stringify(c.before.slice(0, 44)) + "  →  " + JSON.stringify(c.after.slice(0, 44)));
  });
  const nonRetag = r.changed.filter((c) => !c.retagged);
  console.log("  …其余 " + (r.changed.length - 12) + " 条同形态；其中 " + nonRetag.length +
    " 条只删残留行、未改词性标记：" + nonRetag.slice(0, 6).map((c) => c.w).join(" / "));

  const after = stats(r.words, CI);
  console.log("");
  console.log("清洗后：词性缩写残留 " + after.tagOnly + "（应降到 0）  纯英文 " + after.english + "（修不了，保持）");

  if (dry) { console.log("\n--dry：没有写文件。"); process.exit(0); }

  const ARCH = path.join(__dirname, "_archive");
  fs.mkdirSync(ARCH, { recursive: true });
  const bak = path.join(ARCH, "data_words.before-fixdef.json");
  if (!fs.existsSync(bak)) { fs.copyFileSync(F, bak); console.log("\n已备份原文件 → " + bak); }
  else console.log("\n备份已存在，未覆盖 → " + bak);

  fs.writeFileSync(F, JSON.stringify(r.words), "utf8");
  console.log("已写回 " + F + "（" + (fs.statSync(F).size / 1048576).toFixed(2) + " MB）");
}
