/* prep_mnemo.js —— 巧记（助记）数据生成  v4
 *
 * 设计原则（严格遵守"收录正确"硬约束）：
 *   巧记内容 100% 从已有权威数据推导，绝不凭空编造：
 *     · 拆词 —— ECDICT wordroot 词根库（495 条）+ root_zh.json 补充词根/词缀 + 词表内已知词
 *     · 同族 —— 词表中共享同一词干前缀的词（按长度与词频排序）
 *     · 词源 —— wordroot.txt 的 origin 字段
 *
 * 质量防护（前三版踩过的坑，逐条已修）：
 *   v1  beautiful 被错拆成 be + auti + ful    → 尾字母 i↔y 还原（beauti→beauty）
 *   v2  argument  被错拆成 ar + gum + ent     → 双字母前缀要求词干 ≥ 4 字母
 *       government 词族串到 moment/mental     → 与后缀同形的词根不参与词族
 *       careful/hopeless/subway 被长度阈值漏 → 放宽到「词干 ≥ 3」
 *   v3  predict/biology 拆不出               → 允许「剩余部分正好等于词根」
 *       careful 词族串到 scare/career/caress → 词族改用「词干前缀」匹配，不再做无边界子串搜索
 *       superstar/supermarket 拆不出          → 补 super 前缀
 *       argument 拆不出                       → 补 argu→argue 的 e 还原
 *
 * 用法：
 *   node _dev/prep_mnemo.js           # 生成 raw/prep/mnemo.json
 *   node _dev/prep_mnemo.js --stat    # 只统计，不写文件
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STAT_ONLY = process.argv.indexOf("--stat") >= 0;

/* ---------- 1. 载入 ---------- */
const words = JSON.parse(fs.readFileSync(path.join(ROOT, "build/data_words.json"), "utf8"));
const roots = JSON.parse(fs.readFileSync(path.join(ROOT, "raw/prep/roots.json"), "utf8"));
const ZH = JSON.parse(fs.readFileSync(path.join(ROOT, "raw/prep/root_zh.json"), "utf8"));
const LIST = roots.list || [];

const VOCAB = new Set();
const FRQ = {};
words.forEach((r) => {
  const w = String(r[0]).toLowerCase();
  VOCAB.add(w);
  FRQ[w] = (r[11] || r[10] || 999999);
});

/* ---------- 2. 模式规范化 ---------- */
const EXCLUDE_PRE = new Set(["with"]);
const normalizePat = (s) => {
  let p = String(s).trim().toLowerCase();
  p = p.replace(/\(.*?\)/g, "");          // 去掉 "ev (aev)" 这类括注
  p = p.replace(/^-+/, "").replace(/-+$/, "");
  p = p.replace(/[-_]?\d+$/, "").trim();
  return p;
};

const ZH_PRE = ZH["前缀"] || {}, ZH_SUF = ZH["后缀"] || {}, ZH_RD = ZH["词根"] || {};
const PRE = [], SUF = [], RD = [];
const seenPre = {}, seenSuf = {}, seenRd = {};

LIST.forEach((x, i) => {
  const cls = String(x[1] || "");
  const mean = String(x[2] || "");
  const origin = String(x[3] || "");
  const isPre = /前缀/.test(cls), isSuf = /后缀/.test(cls);
  String(x[0] || "").split(",").forEach((seg) => {
    const p = normalizePat(seg);
    if (!p || p.length < 2 || !/^[a-z]+$/.test(p)) return;
    const item = { p: p, i: i, mean: mean, origin: origin, cls: cls };
    if (isPre) { if (EXCLUDE_PRE.has(p) || seenPre[p]) return; seenPre[p] = 1; PRE.push(item); }
    else if (isSuf) { if (seenSuf[p]) return; seenSuf[p] = 1; SUF.push(item); }
    else { if (seenRd[p]) return; seenRd[p] = 1; RD.push(item); }
  });
});
Object.keys(ZH_PRE).forEach((k) => {
  const p = normalizePat(k);
  if (!p || p.length < 2 || seenPre[p] || EXCLUDE_PRE.has(p)) return;
  seenPre[p] = 1; PRE.push({ p: p, i: -1, mean: "", origin: "", cls: "前缀", zh: ZH_PRE[k] });
});
Object.keys(ZH_SUF).forEach((k) => {
  const p = normalizePat(k);
  if (!p || p.length < 2 || seenSuf[p]) return;
  seenSuf[p] = 1; SUF.push({ p: p, i: -1, mean: "", origin: "", cls: "后缀", zh: ZH_SUF[k] });
});
Object.keys(ZH_RD).forEach((k) => {
  const p = normalizePat(k);
  if (!p || p.length < 2 || seenRd[p]) return;
  seenRd[p] = 1; RD.push({ p: p, i: -1, mean: "", origin: "", cls: "词根", zh: ZH_RD[k] });
});

const byLen = (a, b) => b.p.length - a.p.length || a.p.localeCompare(b.p);
PRE.sort(byLen); SUF.sort(byLen); RD.sort(byLen);

/* 查中文释义。ECDICT 的模式常写成别名列表（"ant, -ent" / "ab-, abs" / "circu-, circum"），
   整串查表必然落空、退回英文，所以要拆开逐个查。 */
function zhPick(dict, p) {
  const base = String(p).replace(/\(.*?\)/g, "").trim();
  const list = [base].concat(base.split(/[,，/|]/).map((s) => s.trim()));
  for (const c of list) {
    const k = String(c).toLowerCase().replace(/[-_]?\d+$/, "").replace(/^-+/, "").replace(/-+$/, "").trim();
    if (k && dict[k]) return dict[k];
  }
  return "";
}
function zhOf(item) {
  if (item.zh) return item.zh;
  if (/前缀/.test(item.cls)) return zhPick(ZH_PRE, item.p) || item.mean;
  if (/后缀/.test(item.cls)) return zhPick(ZH_SUF, item.p) || item.mean;
  return zhPick(ZH_RD, item.p) || item.mean;
}

const SUF_FORMS = new Set(SUF.map((x) => x.p));
const bucket = (arr, keyFn) => { const m = {}; arr.forEach((r) => { const k = keyFn(r); (m[k] = m[k] || []).push(r); }); return m; };
const PRE_BY1 = bucket(PRE, (r) => r.p[0]);
const SUF_BYLAST = bucket(SUF, (r) => r.p[r.p.length - 1]);
const RD_BY1 = bucket(RD, (r) => r.p[0]);

/* 词干还原：i↔y / 双写辅音 / 尾 e 脱落 / 补回尾 e */
function restore(mid) {
  if (VOCAB.has(mid)) return mid;
  const cands = [];
  if (mid.length > 3 && mid[mid.length - 1] === "i") cands.push(mid.slice(0, -1) + "y");
  if (mid.length > 3 && /([bcdfglmnprstz])\1$/.test(mid)) cands.push(mid.slice(0, -1));
  if (mid.length > 3 && mid[mid.length - 1] === "e") cands.push(mid.slice(0, -1));
  if (mid.length >= 3) cands.push(mid + "e");           // argu → argue
  for (let i = 0; i < cands.length; i++) if (VOCAB.has(cands[i])) return cands[i];
  return null;
}
/* 中段是词根：完全匹配，或仅多 1 个连接元音 */
function rootExact(mid) {
  const cand = RD_BY1[mid[0]] || [];
  for (let i = 0; i < cand.length; i++) {
    const r = cand[i];
    if (mid === r.p) return r;
    if (mid.startsWith(r.p) && mid.length - r.p.length <= 1) return r;
  }
  return null;
}

/* ---------- 3. 拆词 ---------- */
function splitWord(w) {
  if (w.length < 5 || w.indexOf(" ") >= 0 || w.indexOf("-") >= 0) return null;
  let best = null;
  const consider = (o) => { if (!best || o.score > best.score) best = o; };

  const preCand = PRE_BY1[w[0]] || [];
  for (let a = 0; a < preCand.length; a++) {
    const pr = preCand[a];
    const plen = pr.p.length;
    if (w.length <= plen + 2) continue;
    if (w.slice(0, plen) !== pr.p) continue;
    const rest = w.slice(plen);
    if (rest.length < 3) continue;
    const shortPre = plen <= 2;

    // A1. 剩余整体是词表词（权重最高：im+possible 不该输给 im+posse+ible）
    const rw = restore(rest);
    if (rw && rw !== w) {
      consider({ pre: pr, mid: rw, raw: rest, suf: null, kind: "word", score: (shortPre ? 112 : 130) - Math.abs(rw.length - 5) });
    }
    // A2. 剩余整体是词根（含「剩余正好等于词根」，如 pre+dict）
    if (!shortPre) {
      const rh = rootExact(rest);
      if (rh) consider({ pre: pr, mid: rest, raw: rest, suf: null, kind: "root", root: rh, score: 95 - Math.abs(rest.length - 5) });
    }
    // A3. 剩余 = 词 / 词根 + 后缀
    const sufCand = SUF_BYLAST[rest[rest.length - 1]] || [];
    for (let b = 0; b < sufCand.length; b++) {
      const sf = sufCand[b];
      if (rest.length <= sf.p.length + 2) continue;
      if (rest.slice(rest.length - sf.p.length) !== sf.p) continue;
      const mid = rest.slice(0, rest.length - sf.p.length);
      if (mid.length < 2) continue;
      if (shortPre && mid.length < 4) continue;
      const mw = restore(mid);
      if (mw) {
        consider({ pre: pr, mid: mw, raw: mid, suf: sf, kind: "word", score: (shortPre ? 92 : 108) - Math.abs(mw.length - 4) + sf.p.length });
      } else if (!shortPre) {
        const rh2 = rootExact(mid);
        if (rh2) consider({ pre: pr, mid: mid, raw: mid, suf: sf, kind: "root", root: rh2, score: 74 - Math.abs(mid.length - 4) + sf.p.length });
      }
    }
  }

  // B. 无前缀：词 / 词根 + 后缀（词干 ≥ 3）
  const sufCand2 = SUF_BYLAST[w[w.length - 1]] || [];
  for (let b = 0; b < sufCand2.length; b++) {
    const sf = sufCand2[b];
    if (w.length <= sf.p.length + 2) continue;
    if (w.slice(w.length - sf.p.length) !== sf.p) continue;
    const mid = w.slice(0, w.length - sf.p.length);
    if (mid.length < 3) continue;
    const mw = restore(mid);
    if (mw && mw.length >= 3) {
      consider({ pre: null, mid: mw, raw: mid, suf: sf, kind: "word", score: (mw.length >= 4 ? 84 : 70) - Math.abs(mw.length - 5) + sf.p.length });
    } else {
      const rh = rootExact(mid);
      if (rh && mid === rh.p) consider({ pre: null, mid: mid, raw: mid, suf: sf, kind: "root", root: rh, score: 68 - Math.abs(mid.length - 5) + sf.p.length });
    }
  }
  return best;
}

/* ---------- 4. 同族：共享词干前缀的词（有词边界，不会串到 scare/career） ---------- */
const FAMILY_CACHE = {};
function familyOf(key) {
  if (FAMILY_CACHE[key]) return FAMILY_CACHE[key];
  const stem = key.slice(0, Math.min(5, key.length));
  const maxLen = key.length + 6;
  const list = [];
  for (const w of VOCAB) {
    if (w === key || w.length <= stem.length || w.length > maxLen || w.indexOf(" ") >= 0) continue;
    if (w.slice(0, stem.length) !== stem) continue;
    list.push(w);
  }
  list.sort((a, b) => (a.length - b.length) || (FRQ[a] - FRQ[b]) || a.localeCompare(b));
  FAMILY_CACHE[key] = list;
  return list;
}

/* ---------- 5. 生成 ---------- */
const ORIGIN_ZH = { Latin: "拉丁语", Greek: "希腊语", "Old English": "古英语", "Middle English": "中古英语", "Latin and Greek": "拉丁语 / 希腊语" };

const OUT = {};
let nSplit = 0, nFam = 0, nOrigin = 0;

for (const w of VOCAB) {
  const lines = [];
  const sp = splitWord(w);
  if (sp) {
    nSplit++;
    const segs = [];
    if (sp.pre) segs.push(sp.pre.p + "-（" + zhOf(sp.pre) + "）");
    segs.push(sp.mid + (sp.kind === "root" ? "（" + zhOf(sp.root) + "）" : ""));
    if (sp.suf) segs.push("-" + sp.suf.p + "（" + zhOf(sp.suf) + "）");
    lines.push("拆:" + segs.join(" + "));
  }
  let famKey = null;
  if (sp && sp.kind === "root" && sp.root && sp.root.p.length >= 4 && !SUF_FORMS.has(sp.root.p)) famKey = sp.root.p;
  else if (sp && sp.kind === "word" && sp.mid && sp.mid.length >= 4) famKey = sp.mid;
  if (famKey) {
    const fam = familyOf(famKey).filter((x) => x !== w).slice(0, 5);
    if (fam.length >= 2) { lines.push("族:" + fam.join(" · ")); nFam++; }
  }
  if (lines.length && sp && sp.pre && sp.pre.origin) {
    lines.push("源:" + (ORIGIN_ZH[sp.pre.origin] || sp.pre.origin));
    nOrigin++;
  }
  if (lines.length) OUT[w] = lines.join("\n");
}

/* ---------- 6. 统计 ---------- */
const total = VOCAB.size;
console.log("=== 巧记素材生成统计 v4 ===");
console.log("模式库  前缀 " + PRE.length + " / 后缀 " + SUF.length + " / 词根 " + RD.length + "（含中文表补充）");
console.log("词表总数            " + total);
console.log("有拆词              " + nSplit + "  (" + (nSplit / total * 100).toFixed(1) + "%)");
console.log("有同族              " + nFam);
console.log("有词源              " + nOrigin);
console.log("产生巧记的词        " + Object.keys(OUT).length + "  (" + (Object.keys(OUT).length / total * 100).toFixed(1) + "%)");
console.log("");
console.log("=== 抽样 ===");
const samples = ["unhappy", "predict", "import", "export", "important", "dictionary", "beautiful", "importantly",
  "impossible", "production", "teacher", "careful", "hopeless", "rewrite", "preview", "telephone",
  "biology", "geology", "construction", "develop", "understand", "computer", "happiness", "quickly",
  "international", "subway", "supermarket", "remark", "disagree", "prehistoric", "confidence",
  "invisible", "reporter", "unfortunately", "meaningful", "childhood", "actively", "government",
  "popularity", "attention", "solution", "musician", "argument", "encourage", "modernize"];
samples.forEach((w) => {
  const t = OUT[w];
  console.log("  " + w.padEnd(16) + (t ? t.replace(/\n/g, "  |  ") : "—"));
});
console.log("");
console.log("=== 回归校验 ===");
[["beautiful", "beauty + ful"], ["argument", "argue/argu + ment"], ["government", "不串 moment"], ["careful", "不串 scare/career"],
  ["hopeless", "不串 orthopedic"], ["subway", "sub + way"], ["invisible", "in- = 不"], ["predict", "pre + dict"],
  ["biology", "bio + logy"], ["supermarket", "super + market"], ["withdraw", "拆不出"], ["believe", "拆不出"], ["between", "拆不出"]].forEach((x) => {
  const sp = splitWord(x[0]);
  const fam = sp ? (function () {
    let k = null;
    if (sp.kind === "root" && sp.root && sp.root.p.length >= 4 && !SUF_FORMS.has(sp.root.p)) k = sp.root.p;
    else if (sp.kind === "word" && sp.mid && sp.mid.length >= 4) k = sp.mid;
    if (!k) return "";
    const f = familyOf(k).filter((y) => y !== x[0]).slice(0, 5);
    return f.length >= 2 ? "  族: " + f.join(",") : "";
  })() : "";
  console.log("  " + x[0].padEnd(13) + (sp ? ((sp.pre ? sp.pre.p : "—") + " | " + sp.mid + " | " + (sp.suf ? sp.suf.p : "—") + "  [" + sp.kind + "]") : "拆不出").padEnd(34) + fam + "    期望: " + x[1]);
});

if (!STAT_ONLY) {
  const p = path.join(ROOT, "raw/prep/mnemo.json");
  fs.writeFileSync(p, JSON.stringify(OUT), "utf8");
  console.log("");
  console.log("已写出 " + p + "  (" + (fs.statSync(p).size / 1024).toFixed(0) + " KB)");
}
