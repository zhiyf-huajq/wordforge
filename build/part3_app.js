/* ===================== 词匠 WordForge · 离线背单词引擎 ===================== */
(function () {
"use strict";

/* ---------- 0. 字段索引（与数据契约对应） ---------- */
var F = { W:0, US:1, UK:2, POS:3, CN:4, EN:5, EX:6, EXZ:7, TG:8, FM:9, BNC:10, FRQ:11, ST:12, OX:13, PH:14, RT:15, SYN:16, ANT:17, DIS:18, MN:19 };
var NF = 20;

var KEY = "wordforge_v1";
var DATA = (typeof window !== "undefined" && window.__WF) || { W: [], R: [], B: [] };
var WORDS = DATA.W || [];
var ROOTS = DATA.R || [];
var BOOKS = DATA.B || [];
/* 形近词组（易混词）。构建期算好、随产物一起离线发布 —— 运行时不做任何计算，
   打开页面就有，断网也有。缺数据时是空数组，易混词页显示空态而不是报错。 */
var CONF = DATA.C || [];

/* ---------- 1. 工具 ---------- */
function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var CJK_RE = /[\u4e00-\u9fff]/;
/* 释义的「首行」。**别直接写 String(r[F.CN]).split("\n")[0]** —— 全库有 79 条的
   中文释义字段其实是英文（源数据如此，例：`Been is the past participle of…`），
   另有一批曾把释义首行留成一个孤立的 `ad`（构建期已清洗，但那是第二道防线）。
   选择题的正确项取的就是这一行，取错了就是「选项上写着一个 ad」这种没法做的废题。
   这里统一取「第一个含中文的行」；整条都没中文时退回第一行（至少还有英文信息）。 */
function firstDef(r) {
  if (!r) return "";
  var lines = String(r[F.CN] == null ? "" : r[F.CN]).split("\n");
  for (var i = 0; i < lines.length; i++) {
    var s = lines[i].trim();
    if (s && CJK_RE.test(s)) return s;
  }
  for (var j = 0; j < lines.length; j++) if (lines[j].trim()) return lines[j].trim();
  return "";
}
/* 这个词条有没有可用的中文释义。出题时用它挡掉「没有中文可问」的词 ——
   拿一条只有英文的词去出「看词选义」，四个选项全是英文长句，题就没法做了。 */
function hasCnDef(r) { return CJK_RE.test(String((r || {})[F.CN] == null ? "" : r[F.CN])); }
function $(id) { return document.getElementById(id); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function now() { return Date.now(); }
function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function todayKey() { return dayKey(now()); }
function startOfDay(ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function fmtNum(n) { return (n || 0).toLocaleString("en-US"); }
function fmtDays(min) { var d = min / 1440; return d < 1 ? Math.round(min) + " 分钟" : (d < 10 ? d.toFixed(1) : Math.round(d)) + " 天"; }
function fmtDate(ts) { var d = new Date(ts); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function uniq(a) { var s = {}, r = []; for (var i = 0; i < a.length; i++) if (!s[a[i]]) { s[a[i]] = 1; r.push(a[i]); } return r; }
function splitPipe(s) { return s ? String(s).split("|").filter(function (x) { return x !== ""; }) : []; }
function bytes(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB"; }
function download(name, text, mime) {
  try {
    var blob = new Blob([text], { type: mime || "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return true;
  } catch (e) { toast("导出失败：" + e.message, "bad"); return false; }
}
function pickFile(accept, cb) {
  var el = $("fileIn");
  el.accept = accept || ".json,.csv,.txt";
  el.value = "";
  el.onchange = function () {
    var f = el.files && el.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () { cb(String(fr.result), f.name); };
    fr.onerror = function () { toast("读取文件失败", "bad"); };
    fr.readAsText(f, "utf-8");
  };
  el.click();
}

/* ---------- 2. 词条访问 ---------- */
var IDX = null;      /* 内置词 word -> record */
var CIDX = null;     /* 自定义词 word -> record */
var TAGS = {}, BOWN = {};   /* 词书 id -> 词条数组 / 仅本册新增子集（都是惰性构建，一起失效） */

function buildIndex() {
  IDX = Object.create(null);
  for (var i = 0; i < WORDS.length; i++) IDX[WORDS[i][F.W]] = WORDS[i];
  CIDX = Object.create(null);
  refreshCustomIndex();
}
function refreshCustomIndex() {
  CIDX = Object.create(null);
  var c = DB.custom || {};
  for (var k in c) {
    if (!Object.prototype.hasOwnProperty.call(c, k)) continue;
    var ws = c[k].words || [];
    for (var j = 0; j < ws.length; j++) {
      var w = ws[j];
      if (w && w[F.W] && !IDX[w[F.W]]) CIDX[w[F.W]] = w;
    }
  }
}
function rec(w) { return IDX[w] || CIDX[w] || null; }
function wordTags(r) { return r ? splitPipe(r[F.TG]) : []; }
function inBook(r, bookId) {
  if (!r) return false;
  if (bookId === "__all") return true;
  if (bookId === "__fav") return isFav(r[F.W]);
  if (bookId === "__new") return !DB.prog[r[F.W]];
  if (bookId === "__hard") { var p = DB.prog[r[F.W]]; return !!(p && p[N.NO] > 0) || isHard(r[F.W]); }
  if (bookId === "__mastered") { var q = DB.prog[r[F.W]]; return q ? q[N.ST] === 3 : false; }
  if (bookId.indexOf("@") === 0) {
    var cb = DB.custom[bookId.slice(1)];
    return !!(cb && cb.words && cb.words.some(function (x) { return x[F.W] === r[F.W]; }));
  }
  var t = wordTags(r);
  for (var i = 0; i < t.length; i++) if (t[i] === bookId) return true;
  return false;
}
function bookWords(bookId) {
  if (TAGS[bookId]) return TAGS[bookId];
  var out = [];
  if (bookId.indexOf("@") === 0) {
    var cb = DB.custom[bookId.slice(1)];
    if (cb) out = (cb.words || []).slice();
  } else if (bookId === "__fav") { out = mkFilter(isFav); }
  else if (bookId === "__hard") { out = mkFilter(function (w) { var p = DB.prog[w]; return (p && p[N.NO] > 0) || isHard(w); }); }
  else if (bookId === "__mastered") { out = mkFilter(function (w) { var p = DB.prog[w]; return p && p[N.ST] === 3; }); }
  else if (bookId === "__new") { out = mkFilter(function (w) { return !DB.prog[w]; }); }
  else {
    for (var i = 0; i < WORDS.length; i++) if (wordTags(WORDS[i]).indexOf(bookId) >= 0) out.push(WORDS[i]);
  }
  TAGS[bookId] = out;
  return out;
}
function mkFilter(fn) {
  var out = [];
  var all = WORDS;
  for (var i = 0; i < all.length; i++) if (fn(all[i][F.W])) out.push(all[i]);
  var c = DB.custom || {};
  for (var k in c) { if (!Object.prototype.hasOwnProperty.call(c, k)) continue;
    var ws = c[k].words || [];
    for (var j = 0; j < ws.length; j++) if (!IDX[ws[j][F.W]] && fn(ws[j][F.W])) out.push(ws[j]);
  }
  return out;
}
function bookMeta(id) {
  for (var i = 0; i < BOOKS.length; i++) if (BOOKS[i].id === id) return BOOKS[i];
  if (id === "__fav") return { id: id, name: "生词本", desc: "手动收藏的单词", cat: "我的" };
  if (id === "__hard") return { id: id, name: "错题本", desc: "答错过的单词", cat: "我的" };
  if (id === "__mastered") return { id: id, name: "已掌握", desc: "记忆持久度达标的词", cat: "我的" };
  if (id === "__new") return { id: id, name: "未学新词", desc: "还没学过的词", cat: "我的" };
  if (id === "__all") return { id: id, name: "全部词库", desc: "所有内置词条", cat: "我的" };
  if (id.indexOf("@") === 0) { var c = DB.custom[id.slice(1)]; return c ? { id: id, name: c.name, desc: c.desc || "自定义词书", cat: "我的" } : null; }
  return null;
}

/* ---------- 3. 记忆模型（改良 SM-2 / 艾宾浩斯） ---------- */
var N = { E:0, I:1, DUE:2, REPS:3, LAPSE:4, LAST:5, ST:6, OK:7, NO:8 };
var ST = { LEARN: 0, REVIEW: 1, MASTER: 2 };

var CFG_DEF = {
  newPerDay: 20,
  revPerDay: 300,
  optCount: 4,
  /* 题型轮换顺序。默认六种全开，两种「有前置条件」的排在中间：
       recog   看词选义  —— 最轻，认脸
       recall  看义选词  —— 反向认，比 recog 难一档
       listen  听音辨词  —— 六级听力占 35%，不能默认关着
       cloze   例句填空  —— 真实例句挖空，语境回忆
       spell   拼写      —— 最难，从零产出
       card    卡片速记  —— 兜底，没有任何前置条件
     后两种（listen / cloze）分别需要「设备有英语语音」和「这个词有例句」，
     不满足时 pickMode 会自动顺延到下一个能用的题型，
     所以「全开」不等于「让用户对着做不了的题」。 */
  activeModes: ["recog", "recall", "listen", "cloze", "spell", "card"],
  initSteps: [1, 8, 30, 120],        /* 首次评价 → 分钟 */
  secondSteps: [15, 480, 1440, 4320],
  easeStart: 2.5, easeMin: 1.3, easeMax: 3.0,
  easeDelta: [-0.25, -0.15, 0.0, 0.12],
  gradeMul: [0, 0.6, 1.0, 1.4],
  lapseMul: 0.3,
  hardPenalty: 1.0,
  maxDays: 180,
  masterDays: 21,
  autoSpeak: true, autoReveal: true,
  accent: "us", rate: 0.95,
  blurDef: true,
  showPhonetic: true, showEn: true, showEx: true, showForms: true, showPh: true, showRt: true, showFreq: true,
  showSyn: true, showAnt: true, showDis: true, showPos: true, showMnemo: true,
  queueOrder: "smart",             /* smart 加权随机 / random 完全随机 / order 固定顺序 */
  wordFont: "sans", bigCard: false,
  theme: "dawn", mode: "light", fontSize: 15,   /* fontSize 必须在这里有默认值，否则设置页的字号框是空的 */
  shortcuts: true,
  quizCount: 20,
  dailyGoal: 30,
  /* —— 考试倒计时 ——
     examDate 空串 = 不显示倒计时，界面上不会多出任何元素。
     有了它，newPerDay 就不再是一个凭感觉填的数，而是由「还剩几天」倒推出来的。 */
  examDate: "",                    /* "YYYY-MM-DD" */
  examBook: "",                    /* 目标词书 id；空 = 跟随当前词书 */
  /* —— 文章精读（应用里唯一联网的模块）—— */
  netOff: false,                   /* 关闭联网后，精读「发现」页一个请求都不会发 */
  guardianKey: "",                 /* 卫报 Open Platform 的免费 API Key，可选 */
  /* 中转取文。默认开着：中国日报这类源【页面可达但不给跨域响应头】，
     不吃这条路就走不通。中转只中转一个公开文章的地址，不含任何用户数据。
     关掉后退化成纯直连 —— 更「干净」，但中国日报的正文就取不回来了。 */
  noBridge: false,
  /* 生词门槛：低于这一档的常见词不标记，免得满篇都是下划线。
     默认给六级 —— 主力用户是备考六级的大学生，四级词属于他的基本盘，
     标出来只会把真正该留意的六级以上词淹没；设置里可随时调低到高考 / 四级。
     键名用词书全称（gaokao / cet4 / cet6 / kaoyan），与词库标签、词书 id 三者统一。 */
  readNewFrom: "cet6",
  readMaxWords: 900,               /* 单篇精读文本的词数上限，超出的按完整段落截断并标注节选 */
  readAssist: 1,                   /* 辅助档位 0 纯读 / 1 标生词 / 2 显释义 / 3 逐句精读 */
  readQuizN: 6,                    /* 读后练习题量 */
  autoRefreshArt: true             /* 跨天首次进入发现页时自动拉当天内容 */
};

function cfg() { return DB.cfg; }
function newState(w) {
  var c = cfg();
  return [Math.round(c.easeStart * 100), 0, 0, 0, 0, 0, ST.LEARN, 0, 0];
}
function stOf(w) {
  var p = DB.prog[w];
  if (!p) return newState(w);
  while (p.length < 9) p.push(0);
  return p;
}
function nextInterval(p, g) {
  var c = cfg();
  var e = p[N.E] / 100;
  if (g === 0) {
    e = clamp(e + c.easeDelta[0], c.easeMin, c.easeMax);
    var i0 = Math.max(c.initSteps[0], p[N.I] * c.lapseMul);
    return { i: clamp(i0, 1, c.maxDays * 1440), e: e, reps: 0, lapse: p[N.LAPSE] + 1 };
  }
  var i;
  if (p[N.REPS] === 0) i = c.initSteps[g];
  else if (p[N.REPS] === 1) i = c.secondSteps[g];
  else i = p[N.I] * e * c.gradeMul[g];
  if (g === 3) i *= 1.05;
  i = clamp(i, 3, c.maxDays * 1440);
  return { i: i, e: clamp(e + c.easeDelta[g], c.easeMin, c.easeMax), reps: p[N.REPS] + 1, lapse: p[N.LAPSE] };
}
function grade(w, g) {
  var c = cfg();
  var p = stOf(w);
  var nx = nextInterval(p, g);
  p[N.E] = Math.round(nx.e * 100);
  p[N.I] = nx.i;
  p[N.REPS] = nx.reps;
  p[N.LAPSE] = nx.lapse;
  p[N.LAST] = now();
  p[N.DUE] = now() + Math.round(nx.i * 60000);
  p[N.ST] = nx.i >= c.masterDays * 1440 ? ST.MASTER : nx.i >= 1440 ? ST.REVIEW : ST.LEARN;
  if (g === 0) p[N.NO]++; else p[N.OK]++;
  DB.prog[w] = p;

  var dk = todayKey();
  DB.log[dk] = DB.log[dk] || { n: 0, r: 0 };
  DB.log[dk].n++;
  if (g === 0) DB.log[dk].r++;
  var wk = DB.wlog[dk] || (DB.wlog[dk] = []);
  if (wk.indexOf(w) < 0 && wk.length < 400) wk.push(w);
  return p;
}
function strength(p) {
  if (!p || !p[N.I]) return 0;
  var c = cfg();
  return clamp(Math.round((Math.log(1 + p[N.I] / 1440) / Math.log(1 + c.maxDays)) * 100), 0, 100);
}
function retention(p) {
  if (!p || !p[N.I] || !p[N.LAST]) return 0;
  var days = (now() - p[N.LAST]) / 86400000;
  var s = Math.max(0.02, p[N.I] / 1440);
  return clamp(Math.exp(-days / s), 0, 1);
}
function isDue(p) { return p && p[N.DUE] && p[N.DUE] <= now(); }
function dueWords() {
  var out = [];
  for (var w in DB.prog) {
    if (!Object.prototype.hasOwnProperty.call(DB.prog, w)) continue;
    if (isDue(DB.prog[w])) out.push(w);
  }
  return out;
}
function statsOf(bookId) {
  var ws = bookWords(bookId);
  var s = { total: ws.length, seen: 0, learn: 0, review: 0, mastered: 0, due: 0, fav: 0, hard: 0, strength: 0 };
  for (var i = 0; i < ws.length; i++) {
    var w = ws[i][F.W], p = DB.prog[w];
    if (isFav(w)) s.fav++;
    if (!p) continue;
    s.seen++;
    s.strength += strength(p);
    if (p[N.NO] > 0) s.hard++;
    if (p[N.ST] === ST.MASTER) s.mastered++;
    else if (p[N.ST] === ST.REVIEW) s.review++;
    else s.learn++;
    if (isDue(p)) s.due++;
  }
  return s;
}
function globalStats() {
  var s = { seen: 0, learn: 0, review: 0, mastered: 0, due: 0, strength: 0, wrong: 0 };
  for (var w in DB.prog) {
    if (!Object.prototype.hasOwnProperty.call(DB.prog, w)) continue;
    var p = DB.prog[w];
    s.seen++;
    s.strength += strength(p);
    if (p[N.NO] > 0) s.wrong++;
    if (p[N.ST] === ST.MASTER) s.mastered++;
    else if (p[N.ST] === ST.REVIEW) s.review++;
    else s.learn++;
    if (isDue(p)) s.due++;
  }
  return s;
}
function isFav(w) { return !!(DB.mk[w] & 1); }
function isHard(w) { return !!(DB.mk[w] & 2); }
function isMarked(w) { return !!(DB.mk[w] & 4); }
function toggleMark(w, bit) {
  DB.mk[w] = (DB.mk[w] || 0) ^ bit;
  if (!DB.mk[w]) delete DB.mk[w];
  save();
}
function streak() {
  var s = 0, d = startOfDay(now());
  for (var i = 0; i < 400; i++) {
    var k = dayKey(d - i * 86400000);
    var l = DB.log[k];
    if (l && l.n > 0) s++;
    else if (i > 0) break;
  }
  return s;
}

/* ---------- 4. 存储 ---------- */
var DB = null;
var storageOK = true;

function blankDB() {
  return {
    v: 1,
    cfg: JSON.parse(JSON.stringify(CFG_DEF)),
    prog: {},
    mk: {},
    log: {},
    wlog: {},
    custom: {},
    book: "cet4",
    sessions: [],
    created: now(),
    meta: { days: 0, totalReviews: 0 },
    /* 文章精读库。结构：{ arts: { id → 文章 }, last: 上次拉取日期 }
       老库没有这个键，load() 里的补键循环会自动补上，不需要单独写迁移。 */
    read: { arts: {}, last: "" }
  };
}
function load() {
  var d = null;
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) d = JSON.parse(raw);
  } catch (e) { storageOK = false; }
  if (!d) return blankDB();
  var b = blankDB();
  for (var k in b) if (!(k in d)) d[k] = b[k];
  var c = CFG_DEF;
  for (var ck in c) if (!(ck in d.cfg)) d.cfg[ck] = Array.isArray(c[ck]) ? c[ck].slice() : c[ck];
  return d;
}
var saveTimer = null;
function save(immediate) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (immediate) { doSave(); return; }
  saveTimer = setTimeout(doSave, 350);
}
function doSave() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); storageOK = true; }
  catch (e) {
    if (storageOK) { storageOK = false; toast("本地存储写入失败，请及时导出备份！", "bad"); }
    var b = $("storageWarn"); if (b) b.classList.remove("hide");
  }
}

/* ---------- 5. 发音（浏览器内置语音，离线可用） ---------- */
var VOICES = [];
function loadVoices() {
  try { VOICES = window.speechSynthesis ? window.speechSynthesis.getVoices() || [] : []; } catch (e) { VOICES = []; }
}
function speak(text, forceAccent) {
  if (!window.speechSynthesis) { toast("当前浏览器不支持语音朗读", "bad"); return; }
  loadVoices();
  try {
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(String(text));
    var accent = forceAccent || cfg().accent;
    u.lang = accent === "uk" ? "en-GB" : "en-US";
    u.rate = cfg().rate;
    var want = accent === "uk" ? /en[-_]GB/i : /en[-_]US/i;
    var pick = null;
    for (var i = 0; i < VOICES.length; i++) { if (want.test(VOICES[i].lang)) { pick = VOICES[i]; break; } }
    if (!pick) for (var j = 0; j < VOICES.length; j++) { if (/^en/i.test(VOICES[j].lang)) { pick = VOICES[j]; break; } }
    if (pick) u.voice = pick;
    window.speechSynthesis.speak(u);
  } catch (e) { /* 静默 */ }
}
/* 朗读到底能不能用。这个判断是「听音辨词」题型的前置条件：
   没有可用语音时，扬声器按钮点了没反应，而选项全是英文单词 —— 等于让人瞎猜。

   ⚠ 不能只看 VOICES 里有没有 en 语音。本项目的安卓壳在原生侧接管朗读，
     它的 getVoices() 是**故意返回空数组**的（见 apk-src/MainActivity.java 的 TTS_JS），
     所以「看有没有 en 语音」这条判断在手机上恒为假，会把听力题型在手机上永久禁掉。
     那种情况下改用原生桥接对象作为「朗读可用」的证据；
     真到了系统没装英语语音包的地步，原生侧自己会弹提示引导去安装。 */
var TTS_OK = null;
function ttsReady() {
  if (TTS_OK === true) return true;
  try {
    if (!window.speechSynthesis || typeof window.speechSynthesis.speak !== "function") return false;
    loadVoices();
    for (var i = 0; i < VOICES.length; i++) {
      if (VOICES[i] && /^en/i.test(String(VOICES[i].lang || ""))) { TTS_OK = true; return true; }
    }
    if (window.WordForgeNative && typeof window.WordForgeNative.ttsSpeak === "function") { TTS_OK = true; return true; }
    /* 只缓存「可用」这个结论：语音列表是异步填充的，
       过早把 false 缓存下来会让听力题在浏览器里永远不出现。 */
    return false;
  } catch (e) { return false; }
}
/* 题型的前置条件。不满足就换题，绝不让用户对着做不了的题。
   cloze 其实在 clozeBody 里已有兜底（没例句就退回卡片），这里提前判断只是为了
   让卡头的题型标签与实际渲染的东西一致。 */
function modeOK(mode, r) {
  if (mode === "listen") return ttsReady();
  if (mode === "cloze") return !!(r && r[F.EX]);
  /* recog / recall / spell 都要把中文释义摆到用户面前 —— recog 是把它当选项，
     recall 和 spell 是把它当题干。而全库有 79 条的中文释义字段其实是英文
     （源数据如此，例：kilometer → "A kilometer is a unit of measurement…"）。
     拿它们出这三种题，用户会看到一句英文长句、然后被要求「根据释义拼写」——
     题根本没法做。自动顺延到别的题型，规则和 listen / cloze 完全一致；
     万一这个设备 + 这个词一个题型都用不了，pickMode 会退回卡片速记。 */
  if (mode === "recog" || mode === "recall" || mode === "spell") return hasCnDef(r);
  return true;
}
/* 「静默回退」和「什么都别说」是两回事。
   listen 被跳过时用户看到的是「我明明勾了听音辨词，怎么一张都没出现」——
   必须如实说一句，否则「自动回退」就变成了「功能悄悄消失」。
   时机上不能立刻下结论：语音列表是异步填的，紧接着启动那一下 getVoices()
   多半还是空的（假阴性），当场提示会误报。所以延后复查一次，两次都拿不到才提示。
   一个会话只提示一次 —— 每张卡弹一次等于没弹。 */
var TTS_WARNED = false;
function ttsWarnOnce() {
  if (TTS_WARNED) return;
  setTimeout(function () {
    try {
      if (ttsReady()) return;
      loadVoices();
      setTimeout(function () {
        try {
          if (TTS_WARNED || ttsReady()) return;
          TTS_WARNED = true;
          toast("这台设备没有可用的英语语音，「听音辨词」本轮会自动跳过", "ok");
        } catch (e) { /* 语音探测失败不该影响学习流程 */ }
      }, 400);
    } catch (e) { /* 同上 */ }
  }, 250);
}

/* ---------- 6. 提示 / 弹窗 ---------- */
function toast(msg, kind) {
  var box = $("toast");
  if (!box) return;
  var el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(function () { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 1800);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2200);
}
var modalClose = null;
function openModal(title, bodyHTML, footHTML, onMount, wide) {
  var m = $("modal");
  m.className = "modal" + (wide ? " wide" : "");
  m.innerHTML = '<div class="modal-h"><b>' + esc(title) + '</b><button class="x" id="mClose"><svg><use href="#i-x"/></svg></button></div>' +
    '<div class="modal-b">' + bodyHTML + '</div>' +
    (footHTML ? '<div class="modal-f">' + footHTML + '</div>' : "");
  $("mask").classList.add("on");
  $("mClose").onclick = closeModal;
  modalClose = closeModal;
  if (onMount) onMount(m);
}
/* 关闭时连 .sheet 一起摘掉 —— 那是「底部抽屉」变体加的类，
   不清掉的话下一个居中弹窗会贴着屏幕底边弹出来。 */
function closeModal() { $("mask").classList.remove("on"); $("mask").classList.remove("sheet"); modalClose = null; }

/* ---------- 7. 主题 ---------- */
function applyTheme() {
  var c = cfg();
  document.documentElement.setAttribute("data-theme", c.theme);
  document.documentElement.setAttribute("data-mode", c.mode);
  document.documentElement.style.setProperty("--word-font",
    c.wordFont === "serif" ? "var(--serif)" : c.wordFont === "mono" ? "var(--mono)" : "var(--sans)");
  document.documentElement.style.fontSize = (c.fontSize || 15) + "px";
}
function toggleMode() {
  var c = cfg();
  c.mode = c.mode === "light" ? "dark" : "light";
  var darkThemes = { midnight: 1, ink: 1, ocean: 1 };
  var lightThemes = { dawn: 1, paper: 1, forest: 1, sakura: 1 };
  if (c.mode === "dark" && lightThemes[c.theme]) c.theme = "midnight";
  if (c.mode === "light" && darkThemes[c.theme]) c.theme = "dawn";
  applyTheme(); save(true); render();
}

/* ---------- 8. 单词卡渲染 ---------- */
var BOOKMARK = {};
/* 词根兜底（仅在词条本身没有 RT 字段时使用）。
   两条硬规则，否则会造出「a（周围/在…上/不） + bout」这种假词源：
     ① 模式至少 3 个字母 —— 单/双字母前缀会把任意同首字母的词都拆歪；
     ② 取最长匹配 —— 不能碰到第一个 a- 就收工，还要求剩余部分 ≥3 个字母。 */
function rootHint(word) {
  var w = String(word).toLowerCase();
  var best = null;
  for (var i = 0; i < ROOTS.length; i++) {
    var pat = String(ROOTS[i][0] || "").toLowerCase().replace(/[^a-z-]/g, "");
    pat = pat.replace(/^-+/, "").replace(/-+$/, "");
    if (pat.length < 3 || pat.length > w.length - 3) continue;
    if (w.indexOf(pat) !== 0) continue;
    if (!best || pat.length > best[0].length) best = [pat, ROOTS[i][2]];
  }
  if (!best) return "";
  return esc(best[0]) + " (" + esc(best[1]) + ") + " + esc(w.slice(best[0].length));
}
function ipaHTML(r) {
  if (!cfg().showPhonetic) return "";
  var us = r[F.US], uk = r[F.UK];
  if (!us && !uk) return "";
  var h = '<div class="w-ipa">';
  if (us) h += '<span><em>US</em>/' + esc(us) + '/<button class="spk" data-spk="' + esc(r[F.W]) + '" data-acc="us" title="美音"><svg><use href="#i-vol-us"/></svg></button></span>';
  if (uk && uk !== us) h += '<span><em>UK</em>/' + esc(uk) + '/<button class="spk" data-spk="' + esc(r[F.W]) + '" data-acc="uk" title="英音"><svg><use href="#i-vol"/></svg></button></span>';
  return h + "</div>";
}
function defHTML(r) {
  var cn = String(r[F.CN] || "").split("\n").filter(Boolean);
  if (!cn.length) cn = ["（暂无释义）"];
  var h = '<div class="w-def">';
  for (var i = 0; i < cn.length; i++) {
    var line = cn[i];
    // 词性标记表与 ETL 保持一致：必须含 a.（形容词）与 ad.（副词），
    // 且 a 排在 adj/adv/art/aux/abbr 之后，否则会抢先把 adj. 吃成 a. + "dj."
    var m = line.match(/^((?:adj|adv|abbr|interj|prep|conj|pron|quant|vt|vi|num|art|int|aux|phr|pl|pref|vbl|n|v|a|ad)\.)\s*(.*)$/i);
    if (m) h += '<div><span class="pos">' + esc(m[1]) + '</span>' + esc(m[2]) + '</div>';
    else h += '<div>' + esc(line) + '</div>';
  }
  return h + "</div>";
}
function formsHTML(r) {
  if (!cfg().showForms) return "";
  var fm = formList(r);
  if (!fm.length) return "";
  var h = '<div class="w-block"><div class="bt jump" data-jump="forms:' + esc(r[F.W]) + '" title="点开词形变化页">词形变化<span class="jgo">全部 ' + fm.length + " ›</span></div>" +
    '<div class="row wrap tiny">';
  for (var i = 0; i < fm.length; i++) {
    h += rec(fm[i])
      ? '<span class="tag lnk" data-jump="word:' + esc(fm[i]) + '" title="查看 ' + esc(fm[i]) + '">' + esc(fm[i]) + "</span>"
      : '<span class="tag">' + esc(fm[i]) + "</span>";
  }
  return h + "</div></div>";
}
/* 词形变化列表：兼容 "其他形式:a,b,c" 这类兜底格式 */
function formList(r) {
  var raw = String(r[F.FM] || "");
  if (!raw) return [];
  var out = [];
  var segs = raw.split("|");
  for (var i = 0; i < segs.length; i++) {
    var s = String(segs[i]).trim();
    if (!s) continue;
    var m = s.match(/^其他形式[:：]\s*(.*)$/);
    if (m) {
      var parts = m[1].split(/[,，]/);
      for (var j = 0; j < parts.length; j++) { var p = parts[j].trim(); if (p) out.push(p); }
    } else {
      out.push(s);
    }
  }
  return uniq(out);
}
function exHTML(r, blank) {
  if (!cfg().showEx) return "";
  var ex = r[F.EX], exz = r[F.EXZ];
  if (!ex) return "";
  var en = esc(ex);
  if (blank) {
    var w = r[F.W];
    var re = new RegExp("\\b(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\w*)\\b", "ig");
    en = en.replace(re, '<mark>____</mark>');
  } else {
    var w2 = r[F.W];
    var re2 = new RegExp("\\b(" + w2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\w*)\\b", "ig");
    en = en.replace(re2, "<mark>$1</mark>");
  }
  return '<div class="w-block"><div class="bt">例句</div><div class="w-ex"><div class="en">' + en + "</div>" +
    (exz ? '<div class="zh">' + esc(exz) + "</div>" : "") + "</div></div>";
}
function metaHTML(r) {
  var h = "";
  var bits = [];
  if (cfg().showFreq) {
    if (r[F.ST]) bits.push('<span class="tag gold">柯林斯 ' + esc(r[F.ST]) + "★</span>");
    if (r[F.OX]) bits.push('<span class="tag accent">牛津核心</span>');
    if (r[F.BNC]) bits.push('<span class="tag">BNC ' + fmtNum(r[F.BNC]) + "</span>");
    if (r[F.FRQ]) bits.push('<span class="tag">COCA ' + fmtNum(r[F.FRQ]) + "</span>");
  }
  var tg = wordTags(r);
  for (var i = 0; i < tg.length && i < 6; i++) {
    var bm = null, bi;
    for (bi = 0; bi < BOOKS.length; bi++) if (BOOKS[bi].id === tg[i]) { bm = BOOKS[bi]; break; }
    bits.push('<span class="tag">' + esc(bm ? bm.name : tg[i]) + "</span>");
  }
  if (bits.length) h += '<div class="row wrap" style="gap:6px;margin-top:12px">' + bits.join("") + "</div>";
  return h;
}
function phraseHTML(r) {
  if (!cfg().showPh) return "";
  var ph = splitPipe(r[F.PH]);
  if (!ph.length) return "";
  var h = '<div class="w-block"><div class="bt jump" data-jump="colls:' + esc(r[F.W]) + '" title="点开固定搭配页">固定搭配<span class="jgo">全部 ' + ph.length + " ›</span></div>" +
    '<div class="row wrap" style="gap:6px">';
  for (var i = 0; i < ph.length; i++) {
    h += '<span class="tag lnk" data-jump="colls:' + esc(r[F.W]) + '" data-coll="' + esc(ph[i]) + '">' + esc(ph[i]) + "</span>";
  }
  return h + "</div></div>";
}
/* 巧记：拆词 / 同族 / 词源 来自 mnemo 数据，联想一行由已有同反义词兜底，
   这样即使没有巧记素材的词，也能给出可用的记忆钩子 */
function mnemoHTML(r) {
  if (!cfg().showMnemo) return "";
  var rows = [];
  var mn = String(r[F.MN] || "");
  if (mn) {
    var arr = mn.split("\n");
    for (var i = 0; i < arr.length; i++) {
      var s = arr[i];
      if (!s || s.length < 3) continue;
      var k = s.slice(0, 2), v = s.slice(2);
      var lab = k === "拆:" ? "拆词" : k === "族:" ? "同族" : k === "源:" ? "词源" : "";
      if (lab && v) rows.push({ k: lab, v: v, cls: k === "拆:" ? "hl" : "" });
    }
  }
  /* 联想行取自已有的同 / 反义词，但必须尊重各自的显示开关，
     否则关掉「显示同义词」后它们会从巧记里漏回来 */
  var syn = cfg().showSyn ? splitPipe(r[F.SYN]).slice(0, 4) : [];
  var ant = cfg().showAnt ? splitPipe(r[F.ANT]).slice(0, 2) : [];
  if (syn.length || ant.length) {
    var seg = [];
    if (syn.length) seg.push("近义 " + syn.join(" / "));
    if (ant.length) seg.push("反义 " + ant.join(" / "));
    rows.push({ k: "联想", v: seg.join("　｜　"), cls: "" });
  }
  if (!rows.length) return "";
  var h = '<div class="w-block"><div class="bt">巧记</div><div class="w-mn">';
  for (var j = 0; j < rows.length; j++) {
    h += '<div class="mnrow"><span class="mnk">' + esc(rows[j].k) + '</span><span class="mnv ' + rows[j].cls + '">' + esc(rows[j].v) + "</span></div>";
  }
  return h + "</div></div>";
}
function rtHTML(r) {
  if (!cfg().showRt) return "";
  var rt = r[F.RT] || rootHint(r[F.W]);
  if (!rt) return "";
  return '<div class="w-block"><div class="bt">词根词缀</div><div class="tiny muted">' + (r[F.RT] ? esc(rt) : rt) + "</div></div>";
}
function posHTML(r) {
  if (!cfg().showPos) return "";
  var raw = String(r[F.POS] || "").trim();
  if (!raw) return "";
  var p = raw.split(/[\s,，;；|]+/), out = [];
  for (var i = 0; i < p.length; i++) if (p[i] && out.indexOf(p[i]) < 0) out.push(p[i]);
  if (!out.length) return "";
  var h = '<div class="w-block"><div class="bt">词性</div><div class="row wrap" style="gap:6px">';
  for (var j = 0; j < out.length; j++) h += '<span class="tag pos">' + esc(out[j]) + "</span>";
  return h + "</div></div>";
}
function synHTML(r) {
  if (!cfg().showSyn) return "";
  var s = splitPipe(r[F.SYN]);
  if (!s.length) return "";
  var h = '<div class="w-block"><div class="bt">同义词</div><div class="row wrap" style="gap:6px">';
  for (var i = 0; i < s.length; i++) h += '<span class="tag ok">' + esc(s[i]) + "</span>";
  return h + "</div></div>";
}
function antHTML(r) {
  if (!cfg().showAnt) return "";
  var s = splitPipe(r[F.ANT]);
  if (!s.length) return "";
  var h = '<div class="w-block"><div class="bt">反义词</div><div class="row wrap" style="gap:6px">';
  for (var i = 0; i < s.length; i++) h += '<span class="tag bad">' + esc(s[i]) + "</span>";
  return h + "</div></div>";
}
function disHTML(r) {
  if (!cfg().showDis) return "";
  var d = String(r[F.DIS] || "");
  if (!d) return "";
  var lines = d.split("\n");
  var h = '<div class="w-block"><div class="bt">近义词辨析</div><div class="w-dis">';
  var first = true;
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (!ln) continue;
    if (first) { h += '<div class="ti">' + esc(ln) + "</div>"; first = false; }
    else h += '<div class="ln">' + esc(ln) + "</div>";
  }
  return h + "</div></div>";
}
function markBtns(w) {
  return '<button class="btn ghost sm" data-mk="' + esc(w) + '" data-bit="1">' +
    (isFav(w) ? "★ 已收藏" : "☆ 收藏") + "</button>" +
    '<button class="btn ghost sm" data-mk="' + esc(w) + '" data-bit="2">' + (isHard(w) ? "标记太难" : "标记太难") + "</button>" +
    '<button class="btn ghost sm" data-mk="' + esc(w) + '" data-bit="4">' + (isMarked(w) ? "取消已会" : "标为已会") + "</button>";
}
/* 卡片正文（不含大字词头）。巧记固定放在最后一栏。 */
function wordDetailInner(r, opt) {
  opt = opt || {};
  return defHTML(r) +
    posHTML(r) +
    (cfg().showEn && r[F.EN] ? '<div class="w-en">' + esc(r[F.EN]) + "</div>" : "") +
    exHTML(r, opt.blank) +
    phraseHTML(r) + formsHTML(r) + rtHTML(r) +
    synHTML(r) + antHTML(r) + disHTML(r) +
    metaHTML(r) +
    mnemoHTML(r) +
    '<div class="row wrap" style="gap:6px;margin-top:14px">' + markBtns(r[F.W]) + "</div>";
}
function wordDetailHTML(r, opt) {
  return '<div class="w-word">' + esc(r[F.W]) + "</div>" + ipaHTML(r) +
    '<div class="w-sep"></div>' + wordDetailInner(r, opt || {});
}

/* ---------- 8.5 跳转页：词条详情 / 词形变化 / 固定搭配 ---------- */
var JSTACK = [];      /* 跳转页栈（空 = 当前不在跳转页） */
var JFROM = "today";  /* 跳转链的入口视图，退到底就回这里 */
var JSES = false;     /* 是否从学习会话里点进来的（返回时要恢复会话卡） */

function jumpTo(kind, word, coll, replace) {
  if (kind === "book") {
    if (!bookMeta(word)) { toast("找不到这本词书", "bad"); return; }
  } else if (kind === "art" || kind === "artq") {
    if (!artGet(word)) { toast("找不到这篇文章", "bad"); return; }
  } else if (!rec(word)) {
    toast("词库里没有「" + word + "」", "bad");
    return;
  }
  if (!JSTACK.length) { JFROM = cur; JSES = !!(S && (cur === "study" || cur === "review")); }
  var node = kind === "book" ? { kind: "book", book: word }
    : (kind === "art" || kind === "artq") ? { kind: kind, art: word }
      : { kind: kind, word: word, coll: coll || "" };
  if (replace && JSTACK.length) JSTACK[JSTACK.length - 1] = node;
  else JSTACK.push(node);
  render();
  var v = $("view"); if (v) v.scrollTop = 0;
}
function jumpBack() {
  if (JSTACK.length) JSTACK.pop();
  if (!JSTACK.length) {
    var wasSes = JSES, f = JFROM;
    JSES = false; JFROM = "today";
    if (wasSes && S) { renderSession(); return; }
    go(VIEWS.indexOf(f) >= 0 ? f : "today");
    return;
  }
  render();
  var v = $("view"); if (v) v.scrollTop = 0;
}
function jumpViewHTML() {
  var j = JSTACK[JSTACK.length - 1];
  if (j && j.kind === "book") return bookPageHTML(j.book);
  if (j && j.kind === "art") return artPageHTML(j.art);
  if (j && j.kind === "artq") return artQuizHTML(j.art);
  var r = j ? rec(j.word) : null;
  if (!r) {
    return '<div class="study-wrap"><div class="card">' +
      '<button class="btn ghost sm" id="jumpBack">‹ 返回</button>' +
      '<div class="empty"><b>词库里没有这个单词</b>' + esc(j ? j.word : "") + "</div></div></div>";
  }
  if (j.kind === "forms") return formsPageHTML(r);
  if (j.kind === "colls") return collsPageHTML(r);
  return detailPageHTML(r);
}
function jumpHeadHTML(r, crumb) {
  return '<div class="jhead">' +
    '<button class="btn ghost sm" id="jumpBack">‹ 返回</button>' +
    '<span class="jcrumb">' + esc(crumb) + "</span>" +
    '<span class="sp"></span>' +
    '<button class="btn ghost sm" data-spk="' + esc(r[F.W]) + '" title="朗读单词"><svg><use href="#i-vol"/></svg>朗读</button>' +
    "</div>";
}
function jumpTabsHTML(r) {
  var j = JSTACK[JSTACK.length - 1] || { kind: "detail" };
  var items = [["detail", "词条详情"], ["forms", "词形变化"], ["colls", "固定搭配"]];
  var cnt = { forms: formList(r).length, colls: splitPipe(r[F.PH]).length };
  var h = '<div class="jtab">';
  for (var i = 0; i < items.length; i++) {
    var k = items[i][0];
    h += '<button data-jt="' + k + ":" + esc(r[F.W]) + '"' + (j.kind === k ? ' class="on"' : "") + ">" +
      items[i][1] + (cnt[k] ? "<i>" + cnt[k] + "</i>" : "") + "</button>";
  }
  return h + "</div>";
}
/* 把 "过去式:went" 拆成 {k:"过去式", v:"went"}；没有冒号则整段当形式 */
function splitKV(s) {
  var m = String(s).match(/^([^:：]{1,10})[:：]\s*(.+)$/);
  return m ? { k: m[1].trim(), v: m[2].trim() } : { k: "", v: String(s).trim() };
}
/* 必须带捕获组，否则 replace 里的 $1 会原样输出成 "$1" */
function rxHead(w) { return new RegExp("^(" + esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "i"); }
function detailPageHTML(r) {
  return '<div class="study-wrap"><div class="card">' +
    jumpHeadHTML(r, "词条详情") + jumpTabsHTML(r) +
    '<div class="w-sep"></div>' + wordDetailHTML(r, {}) +
    "</div></div>";
}
function formsPageHTML(r) {
  var fm = formList(r);
  var h = '<div class="study-wrap"><div class="card">' + jumpHeadHTML(r, "词形变化") + jumpTabsHTML(r);
  h += '<div class="jtitle"><div class="jw">' + esc(r[F.W]) + "</div>" + ipaHTML(r) + "</div>";
  if (fm.length) {
    h += '<div class="jgrid">';
    for (var i = 0; i < fm.length; i++) {
      var p = splitKV(fm[i]);
      var sub = rec(p.v);
      var cn = sub ? firstDef(sub) : "";
      var lb = p.k || "词形";
      if (sub) {
        h += '<button class="jcard lnk" data-jump="word:' + esc(p.v) + '" title="查看词条 ' + esc(p.v) + '">' +
          '<span class="jk">' + esc(lb) + '</span><span class="jv">' + esc(p.v) + "</span>" +
          '<span class="jc">' + esc(cn) + ' <i class="jgo2">›</i></span></button>';
      } else {
        h += '<div class="jcard"><span class="jk">' + esc(lb) + '</span><span class="jv">' + esc(p.v) + "</span>" +
          '<span class="jc faint">词库里没有这个形式</span></div>';
      }
    }
    h += "</div>";
    h += '<div class="tiny faint jnote">上方共 ' + fm.length + ' 种词形变化。带 <i class="jgo2">›</i> 的卡片可以点开，跳到该形式的独立词条。</div>';
  } else {
    h += '<div class="empty"><svg><use href="#i-x"/></svg><b>这个词没有词形变化</b>功能词或不发生屈折的词通常没有变形</div>';
  }
  h += "</div>";
  h += '<div class="card"><div class="card-h"><h2>词条详情</h2><span class="hint">' + esc(r[F.W]) + "</span></div>" +
    wordDetailInner(r, {}) + "</div></div>";
  return h;
}
function collsPageHTML(r) {
  var ph = splitPipe(r[F.PH]);
  var w = r[F.W];
  var top = JSTACK[JSTACK.length - 1] || {};
  var h = '<div class="study-wrap"><div class="card">' + jumpHeadHTML(r, "固定搭配") + jumpTabsHTML(r);
  h += '<div class="jtitle"><div class="jw">' + esc(w) + "</div>" + ipaHTML(r) + "</div>";
  if (ph.length) {
    var re = rxHead(w);
    var tails = [];
    h += '<div class="jcolls">';
    for (var i = 0; i < ph.length; i++) {
      var s = ph[i];
      var tail = String(s).replace(rxHead(w), "").trim();
      if (tail && tails.indexOf(tail) < 0) tails.push(tail);
      h += '<div class="jcoll' + (top.coll && s === top.coll ? " on" : "") + '">' +
        '<span class="jt">' + esc(s).replace(re, "<em>$1</em>") + "</span>" +
        '<span class="sp"></span>' +
        (tail ? '<span class="tag">' + esc(tail) + "</span>" : "") +
        '<button class="btn ghost sm" data-spk="' + esc(s) + '" title="朗读这条搭配"><svg><use href="#i-vol"/></svg></button></div>';
    }
    h += "</div>";
    h += '<div class="tiny faint jnote">共 ' + ph.length + " 条语料搭配";
    if (tails.length) h += "，出现过的尾词：" + tails.slice(0, 8).map(function (t) { return "<b>~ " + esc(t) + "</b>"; }).join("、");
    h += "。<br>记搭配先记介词：把主词换成 <b>~</b>，就是一条搭配模板。</div>";
  } else {
    h += '<div class="empty"><svg><use href="#i-x"/></svg><b>这个词还没有常用搭配</b>搭配来自语料库统计，功能词通常没有</div>';
  }
  h += "</div>";
  h += '<div class="card"><div class="card-h"><h2>词条详情</h2><span class="hint">' + esc(w) + "</span></div>" +
    wordDetailInner(r, {}) + "</div></div>";
  return h;
}

/* ---------- 8.6 词书详情页：点开一本词书，列出它包含的每个单词 ---------- */
var BQ = "";          /* 词书页搜索词 */
var BSCOPE = "all";   /* all = 全量（含前置词书） / own = 仅本册新增 */
var BLIMIT = 120;     /* 已渲染条数，点「显示更多」再加一屏 */
/* BOWN 缓存与 TAGS 同级声明（见文件头部），随词库变化一起失效 */

/* 本册新增 = 挂了本册标签、但不含任何前置词书标签的词。
   六级含四级就是靠这里区分出「四级基础 4958」与「六级新增 2017」。 */
function bookOwnWords(id) {
  if (BOWN[id]) return BOWN[id];
  var b = bookMeta(id) || {};
  var inc = [];
  var raw = b.inc || [];
  for (var x = 0; x < raw.length; x++) inc.push(raw[x].id);
  var all = bookWords(id), out = [];
  for (var i = 0; i < all.length; i++) {
    var t = wordTags(all[i]), base = false;
    for (var k = 0; k < inc.length && !base; k++) if (t.indexOf(inc[k]) >= 0) base = true;
    if (!base) out.push(all[i]);
  }
  BOWN[id] = out;
  return out;
}
function bookScopeWords(b) {
  if (BSCOPE === "own" && b.inc && b.inc.length) return bookOwnWords(b.id);
  return bookWords(b.id);
}
function bookStateTag(w) {
  var p = DB.prog[w];
  if (!p) return '<span class="bwtag new">未学</span>';
  if (isDue(p)) return '<span class="bwtag due">待复习</span>';
  if (p[N.ST] === ST.MASTER) return '<span class="bwtag ok">已掌握</span>';
  return '<span class="bwtag ing">学习中</span>';
}
function bookRowHTML(r) {
  var w = r[F.W];
  var cn = firstDef(r);
  var us = String(r[F.US] || "");
  return '<button class="brow" data-jump="word:' + esc(w) + '" title="查看词条 ' + esc(w) + '">' +
    '<span class="bw">' + esc(w) + "</span>" +
    '<span class="bp">' + esc(us ? "[" + us + "]" : "") + "</span>" +
    '<span class="bc">' + esc(cn) + "</span>" +
    bookStateTag(w) + '<i class="jgo2">›</i></button>';
}
function bookPageHTML(id) {
  var b = bookMeta(id);
  if (!b) {
    return '<div class="study-wrap"><div class="card">' +
      '<div class="jhead"><button class="btn ghost sm" id="jumpBack">‹ 返回</button>' +
      '<span class="jcrumb">词书</span></div>' +
      '<div class="empty"><svg><use href="#i-x"/></svg><b>找不到这本词书</b></div></div></div>';
  }
  var all = bookWords(id);
  var hasInc = !!(b.inc && b.inc.length);
  var own = hasInc ? bookOwnWords(id) : all;
  var pool = bookScopeWords(b);

  /* 页内搜索：词形前缀 或 中文释义包含 */
  var q = BQ.trim().toLowerCase();
  var list = pool;
  if (q) {
    list = [];
    for (var i = 0; i < pool.length; i++) {
      var r = pool[i];
      if (String(r[F.W]).toLowerCase().indexOf(q) === 0 ||
          String(r[F.CN] || "").toLowerCase().indexOf(q) >= 0) list.push(r);
    }
  }
  /* 进度统计 */
  var seen = 0, mastered = 0, due = 0, p;
  for (var j = 0; j < pool.length; j++) {
    p = DB.prog[pool[j][F.W]];
    if (!p) continue;
    seen++;
    if (p[N.ST] === ST.MASTER) mastered++;
    if (isDue(p)) due++;
  }
  var pct = pool.length ? Math.round((seen / pool.length) * 100) : 0;

  var h = '<div class="study-wrap">';
  /* ---- 头部 ---- */
  h += '<div class="card"><div class="jhead">' +
    '<button class="btn ghost sm" id="jumpBack">‹ 返回</button>' +
    '<span class="jcrumb">' + esc(DB.book === id ? "当前词书" : "词书详情") + "</span>" +
    '<span class="sp"></span>' +
    '<button class="btn ghost sm" id="bkUse">' + (DB.book === id ? "✓ 已在学" : "设为当前词书") + "</button>" +
    "</div>";
  h += '<div class="jtitle"><div class="jw">' + esc(b.name) + "</div>" +
    '<div class="tiny faint" style="margin-top:3px">' + esc(b.desc || "") + "</div>" +
    '<div class="tiny faint" style="margin-top:7px">共 <b>' + fmtNum(all.length) + "</b> 词" +
    (hasInc ? " · 本册新增 <b>" + fmtNum(own.length) + "</b> 词" : "") + "</div></div>";
  /* ---- 包含关系：可点进去看前置词书 ---- */
  if (hasInc) {
    h += '<div class="row wrap" style="gap:6px;margin-top:11px">';
    for (var k = 0; k < b.inc.length; k++) {
      var x = b.inc[k];
      h += '<button class="tag lnk" data-jump="book:' + esc(x.id) + '" title="翻到《' + esc(x.name) + '》">' +
        "含《" + esc(x.name) + "》全部 " + fmtNum(x.n) + " 词 ›</button>";
    }
    h += "</div>";
  }
  /* ---- 范围切换 + 操作 ---- */
  h += '<div class="row wrap" style="gap:8px;margin-top:13px">' +
    '<button class="btn sm' + (BSCOPE === "all" ? " primary" : "") + '" id="bkAll">全部 ' + fmtNum(all.length) + "</button>" +
    (hasInc ? '<button class="btn sm' + (BSCOPE === "own" ? " primary" : "") + '" id="bkOwn">仅本册新增 ' + fmtNum(own.length) + "</button>" : "") +
    '<span class="sp"></span>' +
    '<button class="btn primary sm" id="bkStudy"><svg><use href="#i-play"/></svg>学这本</button>' +
    "</div>";
  /* ---- 进度 ---- */
  h += '<div class="pbar" style="margin-top:14px"><i style="width:' + pct + '%"></i></div>' +
    '<div class="row tiny faint" style="margin-top:7px;gap:14px;flex-wrap:wrap">' +
    "<span>已学 " + fmtNum(seen) + " / " + fmtNum(pool.length) + "（" + pct + "%）</span>" +
    "<span>已掌握 " + fmtNum(mastered) + "</span>" +
    (due ? '<span style="color:var(--warn)">待复习 ' + fmtNum(due) + "</span>" : "") +
    "</div>";
  /* ---- 页内搜索 ---- */
  h += '<div class="row" style="gap:8px;margin-top:15px">' +
    '<input type="search" id="bkq" placeholder="在这本词书里搜索：词形前缀，或「放弃」这样的中文释义" value="' + esc(BQ) + '">' +
    '<button class="btn nowrap" id="bkqClear">清空</button></div>';
  h += "</div>";

  /* ---- 单词列表 ---- */
  h += '<div class="card"><div class="card-h"><h2>单词列表</h2><span class="hint">' +
    (q ? "匹配" : BSCOPE === "own" ? "仅本册新增" : "全量") + " · 共 " + fmtNum(list.length) + " 词</span></div>";
  if (!list.length) {
    h += '<div class="empty"><svg><use href="#i-x"/></svg><b>' +
      (q ? "这本词书里没有匹配的单词" : "这本词书还没有单词") + "</b>" +
      (q ? "试试换关键词，或点「清空」看全部" : "") + "</div>";
  } else {
    var show = Math.min(BLIMIT, list.length);
    h += '<div class="bklist">';
    for (var m = 0; m < show; m++) h += bookRowHTML(list[m]);
    h += "</div>";
    if (list.length > show) {
      h += '<div class="row" style="justify-content:center;margin-top:12px">' +
        '<button class="btn" id="bkMore">显示更多（已显示 ' + fmtNum(show) + " / " + fmtNum(list.length) + "）</button></div>";
    } else {
      h += '<div class="tiny faint" style="text-align:center;margin-top:10px">已经到底了 · 共 ' + fmtNum(list.length) + " 词</div>";
    }
  }
  h += "</div></div>";
  return h;
}
/* 重绘后把光标放回搜索框末尾（否则每敲一个字就丢焦点） */
function bkFocus() {
  var n = $("bkq");
  if (!n) return;
  n.focus();
  try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) {}
}

/* ---------- 9. 选项生成 ---------- */
/* prefer：优先当干扰项的词表（不传就是纯随机）。
   ⚠ 加这个参数是因为一个**看代码看不出来、跑起来才发现的错**：
     易混词专练原本只把同组词排在 pool 前面，以为「排在前面就会被选中」——
     但下面紧接着就是 shuffle(cands)，顺序被打乱，前面的词和补齐的词机会完全均等。
     结果：4 词组（6303 组）的干扰项确实全部来自组内，看着没问题；
     而 2 词组（7926 组，接近一半）pool 只有 2 个词、必然要补进 4 个词书词，
     于是「另一个词」十有八九根本不出现在选项里 ——
     专练退化成一道普通选择题，而按钮上还写着「干扰项优先从这组里取」。
     修法不是加大分组（那会让「练这组」变成「练一堆」），而是让偏好显式传进来：
     先给优先段补满，不够再动其余候选。 */
function makeOptions(r, pool, n, useWord, prefer) {
  var correct = useWord ? r[F.W] : firstDef(r);
  var opts = [{ v: correct, ok: true }];
  /* 干扰项也得挑得出「中文首行」：看词选义题里若混进一条只有英文释义的词，
     选项就会出现一句英文长句，跟另外三个中文选项完全不是一个画风。 */
  var cands = pool.filter(function (x) { return x[F.W] !== r[F.W] && (useWord || hasCnDef(x)); });
  /* 切成「优先段 / 其余」两段，**两段各自打乱后再拼接**。
     两段都要打乱：优先段不打乱的话，2 词组专练会永远拿同一个词当干扰项，
     练三遍就变成背位置了。 */
  if (prefer && prefer.length) {
    var pm = {};
    for (var q = 0; q < prefer.length; q++) pm[prefer[q]] = 1;
    var head = [], tail = [];
    for (var h = 0; h < cands.length; h++) (pm[cands[h][F.W]] ? head : tail).push(cands[h]);
    shuffle(head);
    shuffle(tail);
    cands = head.concat(tail);
  } else {
    shuffle(cands);
  }
  for (var i = 0; i < cands.length && opts.length < n; i++) {
    var v = useWord ? cands[i][F.W] : firstDef(cands[i]);
    if (!v || v === correct) continue;
    var dup = false;
    for (var j = 0; j < opts.length; j++) if (opts[j].v === v) { dup = true; break; }
    if (!dup) opts.push({ v: v, ok: false });
  }
  return shuffle(opts);
}
/* 这一轮里该优先当干扰项的词。目前只有易混词专练有偏好。
   抽成函数是为了让三个题型（看词选义 / 看义选词 / 听音辨词）走同一处判断 ——
   哪天专练扩到别的题型，不会漏掉其中一个。 */
function preferWords() {
  return S && S.kind === "drill" ? S.queue : null;
}

/* ---------- 10. 路由 ---------- */
var VIEWS = ["today", "study", "review", "quiz", "read", "confuse", "vocab", "library", "stats", "settings"];
var TITLES = { today: ["今日", "每天进步一点点"], study: ["学习", "新词 + 复习混排"], review: ["复习", "按记忆曲线到期"], quiz: ["测试", "检验真实掌握度"], read: ["精读", "读真实文章，把词学活"], confuse: ["易混词", "长得像、意思不同，放一起才记得住"], vocab: ["词汇量", "先量一下底，再决定从哪本词书开始"], library: ["词库", "选词书 / 管理自定义词书"], stats: ["统计", "看见自己的积累"], settings: ["设置", "高度自定义"] };

/* ---------- 10b. 手机底部导航 ---------- */
/* 手机上侧边栏整体隐藏（#side{display:none}），底下这条是唯一导航。
   原来一次塞了 8 个：360px 屏每个只剩 44px 宽、10px 字，挤成一团看不清也点不准。
   现在留 4 个高频入口 + 一个「更多」，次要项（测试 / 易混词 / 词库 / 统计 / 设置）收进底部抽屉。 */
var MTAB_PRIMARY = [
  ["today", "i-sun", "今日"],
  ["study", "i-book", "学习"],
  ["review", "i-rotate", "复习"],
  ["read", "i-read", "精读"]
];
var MTAB_SECOND = [
  ["quiz", "i-target", "测试"],
  ["confuse", "i-confuse", "易混词"],
  ["vocab", "i-vocab", "词汇量"],
  ["library", "i-layers", "词库"],
  ["stats", "i-chart", "统计"],
  ["settings", "i-cog", "设置"]
];
/* 当前视图对应哪个页签：次要页都算到「更多」头上，
   否则切到「统计」时底栏一个高亮的都没有，看着像没选中。 */
function mtabActive(v) {
  for (var i = 0; i < MTAB_PRIMARY.length; i++) if (MTAB_PRIMARY[i][0] === v) return v;
  for (var j = 0; j < MTAB_SECOND.length; j++) if (MTAB_SECOND[j][0] === v) return "__more";
  return v;
}
function syncMtab() {
  var mt = $("mtab");
  if (!mt) return;
  var act = mtabActive(cur);
  mt.querySelectorAll("button").forEach(function (b) {
    var on = b.getAttribute("data-go") === act;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
}
function buildMtab() {
  var mt = $("mtab");
  if (!mt) return;
  var items = MTAB_PRIMARY.concat([["__more", "i-menu", "更多"]]);
  mt.innerHTML = items.map(function (it) {
    return '<button type="button" data-go="' + it[0] + '" aria-label="' + it[2] + '">' +
      '<svg><use href="#' + it[1] + '"/></svg><span>' + it[2] + "</span></button>";
  }).join("");
  /* ⚠ 绑定必须挂在 #mtab 容器上做事件委托，不能像侧边栏那样逐个 button.onclick。
     这里历史上是「安静地坏」的典型：
       init() 里只有一句 document.querySelectorAll(".nav").forEach(...) 给侧边栏绑了点击，
       底栏按钮身上没有 .nav 类（侧边栏才有），所以 8 个按钮一个都没绑上 ——
       手机上点哪儿都没反应，不报错、控制台干净，第六层只测布局也照样全绿。
     容器委托一次解决「按钮是动态生成的」和「以后加项忘了绑」两件事：
     往 MTAB_PRIMARY / MTAB_SECOND 里加项，这里不用改。 */
  mt.onclick = function (e) {
    var b = e.target;
    while (b && b !== mt && !(b.getAttribute && b.getAttribute("data-go"))) b = b.parentNode;
    if (!b || b === mt) return;
    var v = b.getAttribute("data-go");
    if (v === "__more") openMoreSheet(); else go(v);
  };
  syncMtab();
}
function openMoreSheet() {
  var body = '<div class="msheet">' + MTAB_SECOND.map(function (it) {
    var t = TITLES[it[0]] || ["", ""];
    return '<button type="button" data-go="' + it[0] + '"' + (cur === it[0] ? ' class="on"' : "") + '>' +
      '<svg><use href="#' + it[1] + '"/></svg><span>' + esc(it[2]) + "</span><small>" + esc(t[1]) + "</small></button>";
  }).join("") + "</div>";
  openModal("更多", body, "", function (m) {
    m.querySelectorAll("button[data-go]").forEach(function (b) {
      b.onclick = function () { closeModal(); go(b.getAttribute("data-go")); };
    });
  });
  /* 贴底扇出，而不是屏幕正中弹一个对话框 */
  $("mask").classList.add("sheet");
}

var cur = "today";
function go(v) {
  if (VIEWS.indexOf(v) < 0) v = "today";
  cur = v;
  /* 点导航即放弃整条跳转链 */
  JSTACK = []; JFROM = "today"; JSES = false;
  /* 词书详情页的浏览状态也一并归零，下次点进去是干净的第一屏 */
  BQ = ""; BSCOPE = "all"; BLIMIT = 120;
  document.querySelectorAll(".nav").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-go") === v); });
  syncMtab();
  $("pgTitle").textContent = TITLES[v][0];
  $("pgSub").textContent = TITLES[v][1];
  render();
  var view = $("view"); if (view) view.scrollTop = 0;
}
function render() {
  var v = $("view");
  if (!v) return;
  if (JSTACK.length) v.innerHTML = jumpViewHTML();
  else if (cur === "today") v.innerHTML = vToday();
  else if (cur === "study") v.innerHTML = vStudy();
  else if (cur === "review") v.innerHTML = vReview();
  else if (cur === "quiz") v.innerHTML = vQuiz();
  else if (cur === "read") v.innerHTML = vRead();
  else if (cur === "confuse") v.innerHTML = vConfuse();
  else if (cur === "vocab") v.innerHTML = vVocab();
  else if (cur === "library") v.innerHTML = vLibrary();
  else if (cur === "stats") v.innerHTML = vStats();
  else if (cur === "settings") v.innerHTML = vSettings();
  if (cur === "quiz" && typeof quizMount === "function") quizMount();
  if (cur === "read" && typeof readMount === "function") readMount();
  if (cur === "confuse" && typeof confMount === "function") confMount();
  if (cur === "vocab" && typeof vlMount === "function") vlMount();
  bindCommon();
  updateChrome();
}
function updateChrome() {
  /* 跳转页：顶栏标题改成当前正在看的单词 */
  if (JSTACK.length) {
    var jt = JSTACK[JSTACK.length - 1];
    var pt = $("pgTitle"), ps = $("pgSub");
    var isBook = jt.kind === "book";
    var isArt = jt.kind === "art" || jt.kind === "artq";
    if (pt) pt.textContent = isBook ? ((bookMeta(jt.book) || {}).name || "词书")
      : isArt ? ((artGet(jt.art) || {}).t || "文章") : jt.word;
    if (ps) ps.textContent = isBook ? "词书详情 · 单词列表"
      : jt.kind === "art" ? "文章精读"
        : jt.kind === "artq" ? "读后练习"
          : jt.kind === "forms" ? "词形变化" : jt.kind === "colls" ? "固定搭配" : "词条详情";
  }
  var g = globalStats();
  var nm = $("navDue");
  if (nm) { if (g.due > 0) { nm.textContent = g.due > 999 ? "999+" : g.due; nm.classList.remove("hide"); } else nm.classList.add("hide"); }
  var bm = bookMeta(DB.book);
  var cb = $("curBookName");
  if (cb) cb.textContent = bm ? bm.name : "未选择";
  var sf = $("sideFoot");
  if (sf) {
    var tot = WORDS.length;
    sf.innerHTML = "词库 " + fmtNum(tot) + " 词 · 已学 " + fmtNum(g.seen) +
      "<br>连续打卡 " + streak() + " 天" + (storageOK ? "" : ' <span style="color:var(--bad)">· 存储异常，请导出备份</span>');
  }
  syncMtab();
  /* 手机上侧边栏是隐藏的，那个到期数量 badge 根本看不见 —— 挪一份到「学习」页签上 */
  var mt2 = $("mtab");
  if (mt2) {
    var sb2 = mt2.querySelector('button[data-go="study"]');
    if (sb2) sb2.classList.toggle("has-due", g.due > 0);
  }
}

/* ---------- 11. 今日 ---------- */
function goalPct() {
  var dk = todayKey();
  var l = DB.log[dk] || { n: 0, r: 0 };
  return clamp(Math.round((l.n / Math.max(1, cfg().dailyGoal)) * 100), 0, 100);
}
/* 严格的 ISO 日期校验：YYYY-MM-DD，且这一天必须真实存在。
   ⚠ 不能只靠 new Date("2026-02-30T00:00:00") 判断 —— V8 的 ISO 解析有宽松回退，
   2 月 30 日会被「顺延」成 3 月 2 日并返回一个合法时间戳，于是非法日期静默通过。
   唯一可靠的办法是回代：用 (年, 月-1, 日) 造一个本地日期，再取回年月日比对，
   对不上就说明这一天不存在（2 月 30 日、4 月 31 日、13 月都会被这里挡住）。 */
function isoDateOK(s) {
  var v = String(s == null ? "" : s).replace(/^\s+|\s+$/g, "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  var y = Number(v.slice(0, 4)), mo = Number(v.slice(5, 7)), d = Number(v.slice(8, 10));
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  var t = new Date(y, mo - 1, d);
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d;
}
/* 考试倒计时反推：纯算术，零外部依赖。
   为什么需要它：newPerDay 那个数字本身是没有依据的 —— 真实约束是「还剩几天 × 每天能学多少」。
   应该由截止日期倒推，而且每过一天都要重算，而不是开学时拍一个数就不管了。

   返回 null 的情况：没设日期、或日期不是合法的一天 —— 此时界面上一个倒计时元素都不出现。
   天数用「当天 00:00 相减再除以一天的毫秒数」算，不用 getDate 差值，跨月 / 跨年不会错。 */
function examPlan() {
  var c = cfg();
  var ds = String(c.examDate == null ? "" : c.examDate).replace(/^\s+|\s+$/g, "");
  if (!isoDateOK(ds)) return null;
  var t = new Date(ds + "T00:00:00").getTime();
  if (isNaN(t)) return null;
  var now = new Date();
  now.setHours(0, 0, 0, 0);
  var days = Math.round((t - now.getTime()) / 86400000);
  var bid = c.examBook || DB.book;
  var bs = statsOf(bid);
  var remain = Math.max(0, bs.total - bs.seen);
  /* 天数 <= 0 时不做除法：否则会算出 Infinity 或负数，界面上会显示成「每天学 NaN 词」 */
  var need = days > 0 ? Math.ceil(remain / days) : remain;
  return {
    date: ds, days: days, remain: remain, need: need, cur: c.newPerDay,
    book: bid, total: bs.total, seen: bs.seen, mastered: bs.mastered,
    name: (bookMeta(bid) || { name: "" }).name || "当前词书"
  };
}
function vToday() {
  var g = globalStats();
  var c = cfg();
  var dk = todayKey();
  var l = DB.log[dk] || { n: 0, r: 0 };
  var pct = goalPct();
  var C = 2 * Math.PI * 52;
  var bookStat = statsOf(DB.book);
  var bm = bookMeta(DB.book) || { name: "未选择", desc: "" };
  var h = '<div class="study-wrap">';

  h += '<div class="grid g4 keep" style="margin-bottom:16px">' +
    statCard("今日学习", l.n, "词", "目标 " + c.dailyGoal + " 词") +
    statCard("待复习", g.due, "词", "按记忆曲线到期") +
    statCard("已学单词", fmtNum(g.seen), "词", "共 " + fmtNum(WORDS.length) + " 词") +
    statCard("连续打卡", streak(), "天", "累计 " + fmtNum(Object.keys(DB.log).length) + " 天") +
    "</div>";

  /* 考试倒计时：只有设了考试日期才出现，放在最前面 ——
     它回答的是「今天到底该学多少」，比任何统计数字都更该先看到。
     正常 / 紧张两种配色只用一个 over 类区分，不新增状态变量。 */
  var ep = examPlan();
  if (ep) {
    var eTip, eCls = "";
    if (ep.days < 0) { eTip = "考试日期已过，去「设置 → 考试倒计时」改成下一场"; eCls = "over"; }
    else if (ep.remain === 0) { eTip = "这本词书已经学完，保持复习节奏就好"; }
    else if (ep.days === 0) { eTip = "就是今天。不学新词了，把到期复习清完"; eCls = "over"; }
    else if (ep.need > ep.cur) { eTip = "按剩余天数算，每天要学 " + ep.need + " 词；当前上限 " + ep.cur + " 词，差 " + (ep.need - ep.cur); eCls = "over"; }
    else { eTip = "按当前上限每天 " + ep.cur + " 词，能在考试前学完还留出余量"; }
    h += '<div class="card exambar' + (eCls ? " " + eCls : "") + '">' +
      '<div class="examnum"><b>' + (ep.days > 0 ? ep.days : 0) + "</b><span>" + (ep.days > 0 ? "天" : "已到期") + "</span></div>" +
      '<div style="flex:1;min-width:170px">' +
      '<div class="examttl">' + esc(ep.name) + " 还剩 <b>" + fmtNum(ep.remain) + "</b> 词 · 目标 " + esc(ep.date) + "</div>" +
      '<div class="tiny faint" style="margin-top:3px">' + esc(eTip) + "</div></div>" +
      (ep.days > 0 && ep.remain > 0 && ep.need !== ep.cur
        ? '<button class="btn primary sm nowrap" id="applyExamPace">设为 ' + ep.need + " 词/天</button>"
        : "") +
      "</div>";
  }

  h += '<div class="card"><div class="row wrap" style="gap:26px;align-items:center">' +
    '<div class="ring"><svg width="124" height="124" viewBox="0 0 124 124">' +
    '<circle cx="62" cy="62" r="52" fill="none" stroke="var(--panel-3)" stroke-width="11"/>' +
    '<circle cx="62" cy="62" r="52" fill="none" stroke="var(--accent)" stroke-width="11" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + (C * (1 - pct / 100)) + '"/>' +
    '</svg><div class="ctr"><b>' + pct + "%</b><span>今日目标</span></div></div>" +
    '<div style="flex:1;min-width:250px">' +
    '<div class="row" style="margin-bottom:6px"><b style="font-size:16px">' + esc(bm.name) + "</b>" +
    '<span class="tag accent">' + fmtNum(bookStat.total) + " 词</span>" +
    '<button class="btn ghost sm sp" id="switchBook" style="justify-content:flex-end">换词书</button></div>' +
    '<div class="tiny faint" style="margin-bottom:12px">' + esc(bm.desc || "") + "</div>" +
    progressRow("已学", bookStat.seen, bookStat.total, "") +
    progressRow("复习中", bookStat.review, bookStat.total, "warn") +
    progressRow("已掌握", bookStat.mastered, bookStat.total, "ok") +
    "</div></div>" +
    '<div class="row wrap" style="gap:10px;margin-top:20px">' +
    '<button class="btn primary lg" id="startStudy"><svg><use href="#i-zap"/></svg>开始学习</button>' +
    (g.due ? '<button class="btn lg" id="startReview"><svg><use href="#i-rotate"/></svg>复习 ' + g.due + " 词</button>" : "") +
    '<button class="btn lg" id="startQuiz"><svg><use href="#i-target"/></svg>来个小测</button>' +
    "</div></div>";

  /* 未来 7 天到期预测 */
  h += '<div class="card"><div class="card-h"><h2>未来 7 天复习量预测</h2><span class="hint">提前安排时间</span></div>' +
    forecastBars() + "</div>";

  /* 近 14 天 */
  h += '<div class="card"><div class="card-h"><h2>近 14 天学习量</h2><span class="hint">每日测评次数</span></div>' +
    barsHTML(14) + "</div>";

  if (g.due > 0) {
    h += '<div class="card"><div class="card-h"><h2>即将到期</h2><span class="hint">按遗忘风险排序</span></div>' +
      duePreview(8) + "</div>";
  }
  h += "</div>";
  return h;
}
/* 「学习」页：未进入会话时的待学队列总览。
   进入会话后由 renderSession() 接管同一个 #view 容器。
   注意：render() 的 study 分支依赖本函数存在，缺失会导致整个学习流程中断。 */
function vStudy() {
  var c = cfg();
  var dk = todayKey();
  var l = DB.log[dk] || { n: 0, r: 0 };
  var q = previewQueue("auto") || [];
  var pool = bookWords(DB.book);
  var bm = bookMeta(DB.book) || { name: "未选择", desc: "" };
  var newCnt = 0, dueCnt = 0;
  for (var i = 0; i < q.length; i++) { if (DB.prog[q[i]]) dueCnt++; else newCnt++; }

  var h = '<div class="study-wrap">';
  h += '<div class="grid g4 keep" style="margin-bottom:16px">' +
    statCard("本轮待学", q.length, "词", "新词 " + newCnt + " · 复习 " + dueCnt) +
    statCard("今日已学", l.n, "词", "目标 " + c.dailyGoal + " 词") +
    statCard("词书规模", fmtNum(pool.length), "词", esc(bm.name)) +
    statCard("连续打卡", streak(), "天", "累计 " + fmtNum(Object.keys(DB.log).length) + " 天") +
    "</div>";

  h += '<div class="card"><div class="card-h"><h2>开始今天的学习</h2><span class="hint">' + esc(bm.name) + "</span></div>" +
    '<div class="row wrap" style="gap:10px">' +
    '<button class="btn primary lg" id="startStudy"><svg><use href="#i-zap"/></svg>' + (q.length ? "开始学习" : "自由学习") + "</button>" +
    (dueCnt ? '<button class="btn lg" id="startReview"><svg><use href="#i-rotate"/></svg>只复习到期 ' + dueCnt + " 词</button>" : "") +
    '<button class="btn lg" id="startQuiz"><svg><use href="#i-target"/></svg>来个小测</button>' +
    '<button class="btn lg" id="switchBook"><svg><use href="#i-book"/></svg>换词书</button>' +
    "</div>";

  if (q.length) {
    var n = Math.min(q.length, 30);
    h += '<div style="margin-top:20px"><div class="row" style="margin-bottom:6px;gap:8px">' +
      '<span style="font-size:11.5px;color:var(--text-faint);letter-spacing:1px;font-weight:700">本轮队列 · 前 ' + n + " 个</span>" +
      '<span class="sp"></span>' +
      '<span class="tiny faint">顺序 ' + orderName(cfg().queueOrder) + " · 每轮重新洗牌</span>" +
      '<button class="btn ghost sm" id="reshuffle" title="重新洗牌，看看下一轮的顺序">↻ 换一批</button>' +
      "</div>" + '<div class="wlist">';
    for (var j = 0; j < n; j++) {
      var r = rec(q[j]);
      if (!r) continue;
      var p = DB.prog[q[j]];
      h += '<div class="wrow"><div style="flex:1;min-width:0"><div class="wn">' + esc(r[F.W]) +
        '<span class="ipa">' + esc(r[F.US] || r[F.UK] || "") + "</span></div>" +
        '<div class="wt">' + esc(firstDef(r)) + "</div></div>" +
        (p
          ? '<span class="tag ' + (retention(p) < 0.5 ? "bad" : "warn") + '">保留率 ' + Math.round(retention(p) * 100) + "%</span>"
          : '<span class="tag accent">新词</span>') + "</div>";
    }
    h += "</div>";
    if (q.length > n) h += '<div class="tiny faint" style="padding:8px 0">队列还有 ' + (q.length - n) + " 个词，开始后依次出现</div>";
    h += "</div>";
  } else {
    h += '<div class="tiny faint" style="margin-top:14px">当前词书暂时没有可学的词，换个词书或明天再来吧。</div>';
  }

  h += "</div></div>";
  return h;
}
function statCard(lb, vl, unit, ex) {
  return '<div class="stat"><div class="lb">' + esc(lb) + '</div><div class="vl">' + (typeof vl === "number" ? fmtNum(vl) : esc(vl)) + (unit ? "<small>" + esc(unit) + "</small>" : "") + '</div><div class="ex">' + esc(ex || "") + "</div></div>";
}
function progressRow(name, v, tot, cls) {
  var p = tot ? Math.round((v / tot) * 100) : 0;
  return '<div style="margin-bottom:9px"><div class="row tiny" style="margin-bottom:4px"><span class="muted">' + esc(name) + '</span><span class="sp"></span><span class="faint">' + fmtNum(v) + " / " + fmtNum(tot) + "</span></div>" +
    '<div class="pbar ' + (cls || "") + '"><i style="width:' + p + '%"></i></div></div>';
}
function barsHTML(days) {
  var arr = [], max = 1;
  var base = startOfDay(now());
  var dk = todayKey();
  for (var i = days - 1; i >= 0; i--) {
    var k = dayKey(base - i * 86400000);
    var l = DB.log[k];
    var v = l ? l.n : 0;
    if (v > max) max = v;
    arr.push({ k: k, v: v, now: k === dk });
  }
  var h = '<div class="bars">';
  for (var j = 0; j < arr.length; j++) {
    var pctv = Math.round((arr[j].v / max) * 100);
    h += '<div class="bar" style="height:' + Math.max(2, pctv) + "%" + (arr[j].now ? ";opacity:1" : "") + '" title="' + arr[j].k + ": " + arr[j].v + ' 次">' +
      (j % 2 === 0 || arr[j].now ? '<span>' + arr[j].k.slice(5) + "</span>" : "") + "</div>";
  }
  return h + "</div>";
}
function forecastBars() {
  var buckets = [], max = 1;
  for (var d = 0; d < 7; d++) buckets.push({ d: d, n: 0 });
  for (var w in DB.prog) {
    if (!Object.prototype.hasOwnProperty.call(DB.prog, w)) continue;
    var p = DB.prog[w];
    var dd = Math.floor((p[N.DUE] - startOfDay(now())) / 86400000);
    if (dd < 0) dd = 0;
    if (dd < 7) buckets[dd].n++;
  }
  var todayOver = 0;
  for (var w2 in DB.prog) { if (Object.prototype.hasOwnProperty.call(DB.prog, w2) && isDue(DB.prog[w2])) todayOver++; }
  buckets[0].n = todayOver;
  for (var i = 0; i < 7; i++) if (buckets[i].n > max) max = buckets[i].n;
  var h = '<div class="bars">';
  var names = ["今天", "明天", "后天", "3 天", "4 天", "5 天", "6 天"];
  for (var j = 0; j < 7; j++) {
    h += '<div class="bar" style="height:' + Math.max(2, Math.round((buckets[j].n / max) * 100)) + '%" title="' + names[j] + ": " + buckets[j].n + ' 词"><span>' + names[j] + "</span></div>";
  }
  return h + "</div>";
}
function duePreview(n) {
  var ws = dueWords();
  ws.sort(function (a, b) { return retention(DB.prog[a]) - retention(DB.prog[b]); });
  var h = '<div class="wlist">';
  for (var i = 0; i < ws.length && i < n; i++) {
    var r = rec(ws[i]);
    if (!r) continue;
    var p = DB.prog[ws[i]];
    h += '<div class="wrow"><div style="flex:1;min-width:0"><div class="wn">' + esc(r[F.W]) +
      '<span class="ipa">' + esc(r[F.US] || r[F.UK] || "") + "</span></div>" +
      '<div class="wt">' + esc(firstDef(r)) + "</div></div>" +
      '<span class="tag ' + (retention(p) < 0.5 ? "bad" : "warn") + '">保留率 ' + Math.round(retention(p) * 100) + "%</span></div>";
  }
  return h + "</div>";
}

/* ---------- 12. 学习会话 ---------- */
var S = null;

function buildQueue(kind) {
  var c = cfg();
  var book = DB.book;
  var pool = bookWords(book);
  if (!pool.length) return null;
  var due = [], fresh = [];
  var seen = {};
  for (var i = 0; i < pool.length; i++) {
    var w = pool[i][F.W];
    if (seen[w]) continue;
    seen[w] = 1;
    var p = DB.prog[w];
    if (p) { if (isDue(p)) due.push(w); }
    else fresh.push(w);
  }
  /* 到期优先按保留率升序（遗忘风险高的先来） */
  due.sort(function (a, b) { return retention(DB.prog[a]) - retention(DB.prog[b]); });
  /* 新词按词频优先（BNC/COCA 靠前的先学） */
  fresh.sort(function (a, b) { return (rec(a)[F.FRQ] || rec(a)[F.BNC] || 999999) - (rec(b)[F.FRQ] || rec(b)[F.BNC] || 999999); });

  var maxRev = kind === "all" ? 99999 : c.revPerDay;
  var maxNew = kind === "all" ? 99999 : c.newPerDay;
  var dk = todayKey();
  var dlog = DB.log[dk] || { n: 0, r: 0 };
  if (kind !== "all") maxNew = Math.max(0, maxNew - Math.max(0, dlog.n - (dlog.r || 0)));

  /* 选词仍按优先级取前 N 个；顺序则交给 applyOrder 打乱，
     这样「学哪些词」稳定，「先学哪个」每轮都不同 */
  var q = applyOrder(due.slice(0, maxRev)).concat(applyOrder(fresh.slice(0, maxNew)));
  if (!q.length) {
    /* 没有到期也没有新词 → 取遗忘风险最高的已学词 */
    var all = [];
    for (var w2 in DB.prog) if (Object.prototype.hasOwnProperty.call(DB.prog, w2)) all.push(w2);
    all.sort(function (a, b) { return retention(DB.prog[a]) - retention(DB.prog[b]); });
    q = applyOrder(all.slice(0, 20));
  }
  return q;
}

/* 队列顺序策略（设置里可切）：
   smart  —— 位置加权随机。越靠前的词权重越大、越容易留在前面，
             但整条队列每轮重新洗牌，所以顺序不会两次一样。
   random —— 完全随机。
   order  —— 固定顺序（旧行为，按优先级严格排序）。 */
function applyOrder(arr) {
  var mode = cfg().queueOrder || "smart";
  if (arr.length <= 1 || mode === "order") return arr;
  if (mode === "random") return shuffle(arr.slice());
  /* Efraimidis–Spirakis 加权随机采样：key = U^(1/w)，取 key 降序 */
  var n = arr.length, pair = new Array(n);
  for (var i = 0; i < n; i++) {
    var w = Math.max(1, n - i * 0.85);
    pair[i] = { v: arr[i], k: Math.pow(Math.random(), 1 / w) };
  }
  pair.sort(function (a, b) { return b.k - a.k; });
  var out = new Array(n);
  for (var j = 0; j < n; j++) out[j] = pair[j].v;
  return out;
}

function orderName(m) { return m === "random" ? "完全随机" : m === "order" ? "固定顺序" : "智能随机"; }

/* 预览队列缓存：避免「学习」页每次重绘都跳一次顺序；
   真正开始学习时会清空缓存重新洗牌。 */
var PQ = null;
function previewQueue(kind) {
  var dl = DB.log[todayKey()] || {};
  /* 缓存键覆盖「词书 / 日期 / 每日配额 / 顺序策略 / 今日已学次数」，
     任一变化都会重新洗牌；点「换一批」则直接清空缓存。 */
  var key = [DB.book, todayKey(), cfg().newPerDay, cfg().revPerDay, cfg().queueOrder, dl.n || 0].join("|");
  if (!PQ || PQ.key !== key) PQ = { key: key, q: buildQueue(kind) };
  return PQ.q;
}

function startSession(kind) {
  /* 学习页上看到的顺序就是真正要学的顺序（所见即所得）；
     学完这轮后清缓存，下一轮重新洗牌。 */
  var q = (kind === "auto" && PQ && PQ.q && PQ.q.length) ? PQ.q : buildQueue(kind);
  if (!q) { toast("当前词书是空的，先选一个词书吧", "bad"); return; }
  if (!q.length) { toast("暂无需要学习或复习的词，休息一下吧", "ok"); return; }
  PQ = null;
  var modes = sessionModes();
  var r = rec(q[0]) || WORDS[0];
  var pool = bookWords(DB.book);
  if (pool.length < cfg().optCount) pool = WORDS;
  S = {
    kind: kind, queue: q, i: 0, modes: modes,
    pool: pool, results: [], start: now(), answered: false,
    pending: null, typed: "", revealed: false, correct: 0, wrong: 0, newCount: 0, revCount: 0,
    quiz: null,
    steps: []   /* 滑动翻词的撤销栈：每前进一步压一份现场快照，向右滑时整份还原 */
  };
  for (var i = 0; i < q.length; i++) { if (DB.prog[q[i]]) S.revCount++; else S.newCount++; }
  go(kind === "review" ? "review" : "study");
  if (cur !== "study" && cur !== "review") { cur = "study"; go("study"); }
  if (modes.indexOf("listen") >= 0) ttsWarnOnce();
  renderSession();
}

/* 本轮用哪些题型。抽出来给 startSession 和 startDrill 共用 ——
   两处各写一份的话，哪天改了默认值（比如加一种新题型）必然漏掉一处，
   而漏掉的那处不会报错，只是那一种入口永远用不上新题型。 */
function sessionModes() {
  var a = cfg().activeModes;
  return a && a.length ? a.slice() : ["card"];
}

/* ---------- 8d. 形近词组（易混词）数据 ----------
   CONF 是构建期算好的分组：每组 2–4 个「拼写相近、意思不同」的词。
   存成「组」而不是逐词的伙伴列表，是因为组内成员本来就互相共享 ——
   4 个词一组写 4 次，写成逐词伙伴表要写 12 次，
   对 11 MB 的单文件产物来说这个差别不小。

   反向索引（词 → 它所在的组）**懒建**：不是每次打开应用都会翻易混词页，
   没必要为了一个可能用不到的页面在启动时多跑一遍全表。
   两万条组、五万条词次，建索引是毫秒级的事，但「不需要就不做」是更省的做法。 */
var CONFIX = null;
var CONFCOVER = 0;
function confIndex() {
  if (CONFIX) return CONFIX;
  var ix = {}, seen = {};
  CONFCOVER = 0;
  for (var i = 0; i < CONF.length; i++) {
    var g = CONF[i];
    if (!g || !g.length) continue;
    for (var j = 0; j < g.length; j++) {
      var w = g[j];
      if (!ix[w]) ix[w] = [];
      ix[w].push(i);
      if (!seen[w]) { seen[w] = 1; CONFCOVER++; }
    }
  }
  CONFIX = ix;
  return ix;
}
/* 某个词在哪些组里。传入词库里没有的词返回空数组，绝不抛异常 ——
   这个函数会被「用户随手敲的搜索词」直接喂到。 */
function confGroupsOf(w) {
  var ids = confIndex()[String(w == null ? "" : w).toLowerCase()];
  if (!ids) return [];
  var out = [];
  for (var i = 0; i < ids.length; i++) out.push(CONF[ids[i]]);
  return out;
}
function confCover() { confIndex(); return CONFCOVER; }
/* 这一组里有多少个词属于指定的词书（用于「只看当前词书」的筛选） */
function confInBook(g, bid) {
  var n = 0;
  for (var i = 0; i < g.length; i++) {
    var tags = wordTags(rec(g[i]));
    if (tags.indexOf(bid) >= 0) n++;
  }
  return n;
}

/* 「练这组」：把一组易混词直接当成一轮练习。
   和普通学习只差一处，但正是关键的那处 —— **干扰项优先从这一组内部取**。
   看词选义时四个选项全是长得像的那几个，选错就说明确实没分清，
   而不是靠「排除掉三个明显不对的」蒙对的。
   组里凑不满一屏选项时才拿当前词书的词补齐；补齐的只是凑数，组内词一定在里面。 */
function startDrill(words) {
  if (!words || !words.length) { toast("这一组没有可练的词", "bad"); return; }
  var q = [], recs = [];
  for (var i = 0; i < words.length; i++) {
    var r0 = rec(words[i]);
    if (r0) { q.push(r0[F.W]); recs.push(r0); }
  }
  if (q.length < 2) { toast("这一组的词不在词库里", "bad"); return; }
  PQ = null;
  var pool = recs.slice();
  if (pool.length < cfg().optCount) {
    var extra = bookWords(DB.book).filter(function (x) { return q.indexOf(x[F.W]) < 0; });
    shuffle(extra);
    for (var k = 0; k < extra.length && pool.length < cfg().optCount + 2; k++) pool.push(extra[k]);
  }
  S = {
    kind: "drill", queue: q, i: 0, modes: sessionModes(),
    pool: pool, results: [], start: now(), answered: false,
    pending: null, typed: "", revealed: false, correct: 0, wrong: 0, newCount: 0, revCount: 0,
    quiz: null, steps: []
  };
  for (var m = 0; m < q.length; m++) { if (DB.prog[q[m]]) S.revCount++; else S.newCount++; }
  go("study");
  renderSession();
}

function curWord() { return S && S.i < S.queue.length ? rec(S.queue[S.i]) : null; }
/* 当前这一张该用哪个题型：**由卡片序号取模得到**，不是另设一个自增游标。
   ⚠ 这里踩过一个真实的坑（安静地坏，最难发现的那种）：
     原实现是 S.modes[S.mi % n]，而 S.mi 除了初始化那一行，全代码再没有第二处写它 ——
     于是「题型轮换」从来就没生效过。用户勾了六种题型，实际每一张都还是第一种。
     不报错、控制台干净、六层验收全绿，只有盯着源码读才看得出来。
   改成直接由 S.i 取模之后，「轮换」和「撤销」自动对齐，不需要任何同步代码：
     · commitAndNext / nextWord 里 S.i++  → 题型前进一格
     · prevWord 里 S.i = st.i            → 题型跟着退回上一格
   也就不存在「游标」和「卡片序号」两套状态漂移的可能。 */
function curMode() { return S.modes[S.i % S.modes.length]; }
/* 当前这一张该用哪个题型：从轮到的那个开始往后顺延，跳到第一个「这个设备 + 这个词」能用的。
   全部都用不了时退回卡片速记 —— 它不需要任何前置条件。
   注意返回的必须是**实际渲染**的那个题型，因为卡头的题型标签读的就是它；
   否则会出现「标签写着听音辨词、画面却是一张卡片」的错位。 */
function pickMode() {
  var r = curWord();
  var n = S.modes.length;
  var base = S.i % n;
  for (var k = 0; k < n; k++) {
    var m = S.modes[(base + k) % n];
    if (modeOK(m, r)) return m;
  }
  return "card";
}

function renderSession() {
  var v = $("view");
  if (!S) { go("today"); return; }
  if (S.i >= S.queue.length) { v.innerHTML = sessionSummaryHTML(); bindCommon(); return; }
  var r = curWord();
  var mode = pickMode();
  if (S.renderedIdx !== S.i) {
    S.renderedIdx = S.i;
    S.answered = false; S.pending = null; S.typed = ""; S.revealed = false;
    S.picked = undefined; S.opts = null;
  }

  var h = '<div class="study-wrap">';
  h += '<div class="row tiny faint" style="margin-bottom:10px;gap:14px">' +
    '<span>' + (S.kind === "review" ? "复习" : S.kind === "drill" ? "易混词专练" : S.kind === "all" ? "自由学习" : "学习") + "</span>" +
    '<span>进度 ' + (S.i + 1) + " / " + S.queue.length + "</span>" +
    (S.newCount ? '<span style="color:var(--accent)">新词 ' + S.newCount + "</span>" : "") +
    (S.revCount ? '<span style="color:var(--warn)">复习 ' + S.revCount + "</span>" : "") +
    '<span class="sp"></span><button class="btn ghost sm" id="quitSes">结束</button></div>';

  h += '<div class="wcard" id="wcard">';
  h += '<div class="wcard-top">' + modeTag(mode) + statusTag(r) + '<span class="sp"></span>' +
    (r[F.FRQ] || r[F.BNC] ? '<span class="tag">词频 ' + fmtNum(r[F.FRQ] || r[F.BNC]) + "</span>" : "") + "</div>";
  h += cardBody(r, mode);
  h += "</div>";

  if (S.answered) h += gradeBarHTML();
  h += progressDots();
  /* 手势提示只在手机上显示（.swipehint 默认 display:none，窄屏媒体查询里才打开） */
  h += '<div class="swipehint">在卡片上左右滑动翻词 · <b>向右滑</b> 回上一条 · <b>向左滑</b> 跳下一条</div>';
  h += "</div>";
  v.innerHTML = h;
  bindCommon();
  bindSession();
  if (!S.answered && cfg().autoSpeak && (mode === "listen" || mode === "spell" || mode === "card")) {
    setTimeout(function () { speak(r[F.W]); }, 160);
  }
}
function modeTag(m) {
  var names = { recog: "看词选义", recall: "看义选词", spell: "拼写", listen: "听音辨词", card: "卡片速记", cloze: "例句填空" };
  return '<span class="tag accent">' + esc(names[m] || m) + "</span>";
}
function statusTag(r) {
  var p = DB.prog[r[F.W]];
  if (!p) return '<span class="tag">新词</span>';
  var st = p[N.ST] === ST.MASTER ? ["ok", "已掌握"] : p[N.ST] === ST.REVIEW ? ["warn", "复习中"] : ["", "学习中"];
  return '<span class="tag ' + st[0] + '">' + st[1] + "</span>" +
    '<span class="tag">持久度 ' + strength(p) + "%</span>" +
    '<span class="tag">答对 ' + p[N.OK] + " / 错 " + p[N.NO] + "</span>";
}
function cardBody(r, mode) {
  if (mode === "recog") return recogBody(r);
  if (mode === "recall") return recallBody(r);
  if (mode === "spell") return spellBody(r);
  if (mode === "listen") return listenBody(r);
  if (mode === "cloze") return clozeBody(r);
  return cardBodyFlip(r);
}
function recogBody(r) {
  var opts = makeOptions(r, S.pool, cfg().optCount, false, preferWords());
  S.opts = opts;
  var h = '<div class="w-word">' + esc(r[F.W]) + "</div>" + ipaHTML(r) +
    '<button class="btn sm" id="say" style="margin-top:12px"><svg><use href="#i-vol"/></svg>朗读</button>';
  h += '<div class="opts">';
  for (var i = 0; i < opts.length; i++) {
    h += '<button class="opt" data-pick="' + i + '"><span class="k">' + (i + 1) + "</span><span>" + esc(opts[i].v) + "</span></button>";
  }
  return h + "</div>";
}
function recallBody(r) {
  var opts = makeOptions(r, S.pool, cfg().optCount, true, preferWords());
  S.opts = opts;
  var h = '<div class="w-block"><div class="bt">根据释义选择单词</div>' + defHTML(r) +
    (cfg().showEn && r[F.EN] ? '<div class="w-en">' + esc(r[F.EN]) + "</div>" : "") + "</div>";
  h += '<div class="opts">';
  for (var i = 0; i < opts.length; i++) h += '<button class="opt" data-pick="' + i + '"><span class="k">' + (i + 1) + "</span><span>" + esc(opts[i].v) + "</span></button>";
  return h + "</div>";
}
function spellBody(r) {
  var w = r[F.W];
  var hint = [];
  for (var i = 0; i < w.length; i++) {
    var ch = w[i];
    if (ch === " " || ch === "-" || ch === "'") hint.push('<i class="given">' + esc(ch) + "</i>");
    else if (i === 0) hint.push('<i class="given">' + esc(ch) + "</i>");
    else hint.push('<i class="blank">_</i>');
  }
  return '<div class="w-block"><div class="bt">根据释义与音标拼写单词</div>' + defHTML(r) + "</div>" +
    (cfg().showEn && r[F.EN] ? '<div class="w-en">' + esc(r[F.EN]) + "</div>" : "") +
    '<div class="spell-box"><div class="spell-hint">' + hint.join("") + "</div>" +
    '<input class="spell-input" id="spellIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + w.length + ' 个字母">' +
    '<div class="row" style="gap:8px;margin-top:12px"><button class="btn" id="say"><svg><use href="#i-vol"/></svg>听发音</button>' +
    '<button class="btn primary sp" id="spellOk">确认</button></div></div>';
}
function listenBody(r) {
  var opts = makeOptions(r, S.pool, cfg().optCount, true, preferWords());
  S.opts = opts;
  var h = '<div style="text-align:center;padding:10px 0 4px">' +
    '<button class="spk" id="say" style="width:64px;height:64px;border-radius:50%"><svg style="width:28px;height:28px"><use href="#i-vol"/></svg></button>' +
    '<div class="tiny faint" style="margin-top:12px">点击喇叭重听 · 按 S 慢速朗读</div></div>';
  h += '<div class="opts">';
  for (var i = 0; i < opts.length; i++) h += '<button class="opt" data-pick="' + i + '"><span class="k">' + (i + 1) + "</span><span>" + esc(opts[i].v) + "</span></button>";
  return h + "</div>";
}
function clozeBody(r) {
  if (!r[F.EX]) return cardBodyFlip(r);
  var h = '<div class="w-block"><div class="bt">填空：把例句补完整</div>' +
    '<div class="w-ex"><div class="en">' + esc(r[F.EX]).replace(new RegExp("\\b(" + esc(r[F.W]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\w*)\\b", "ig"), "<mark>____</mark>") + "</div>" +
    (r[F.EXZ] ? '<div class="zh">' + esc(r[F.EXZ]) + "</div>" : "") + "</div></div>" +
    '<div class="spell-box"><input class="spell-input" id="spellIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="填入缺失的单词">' +
    '<div class="row" style="gap:8px;margin-top:12px"><button class="btn" id="say"><svg><use href="#i-vol"/></svg>听发音</button>' +
    '<button class="btn primary sp" id="spellOk">确认</button></div></div>';
}
function cardBodyFlip(r) {
  var blur = cfg().blurDef && !S.revealed;
  var h = '<div class="w-word">' + esc(r[F.W]) + "</div>" + ipaHTML(r) +
    '<button class="btn sm" id="say" style="margin-top:12px"><svg><use href="#i-vol"/></svg>朗读</button>' +
    '<div class="w-sep"></div><div class="' + (blur ? "blurred" : "") + '" id="revBox">' +
    defHTML(r) + (cfg().showEn && r[F.EN] ? '<div class="w-en">' + esc(r[F.EN]) + "</div>" : "") +
    exHTML(r) + phraseHTML(r) + formsHTML(r) + rtHTML(r) + metaHTML(r) + mnemoHTML(r) + "</div>";
  if (blur) h += '<div class="reveal">点击「显示释义」或按空格揭晓</div>' +
    '<div class="row" style="gap:8px"><button class="btn primary sp" id="reveal">显示释义（空格）</button></div>';
  h += '<div class="row wrap" style="gap:6px;margin-top:14px" id="mkBar">' + markBtns(r[F.W]) + "</div>";
  return h;
}
function progressDots() {
  var h = '<div class="underbar"><div class="dots">';
  var from = Math.max(0, S.i - 12), to = Math.min(S.queue.length, S.i + 13);
  for (var i = from; i < to; i++) {
    var cls = i === S.i ? "cur" : "";
    var res = S.results[i];
    if (i < S.i && res !== undefined) cls = "g" + res;
    h += '<i class="dot ' + cls + '"></i>';
  }
  return h + '</div><span class="sp"></span><span class="tiny faint" id="hintLine">' +
    (S.answered ? "按 1-4 调整评价，Enter 下一张" : "按 1-4 或点击选择，空格揭晓") + "</span></div>";
}
function gradeBarHTML() {
  var g = S.pending;
  var nexts = [0, 1, 2, 3].map(function (x) {
    var p = stOf(curWord()[F.W]);
    var nx = nextInterval(p, x);
    return fmtDays(nx.i);
  });
  var names = [["忘记", "完全没印象"], ["模糊", "想起来一点"], ["认识", "确定认识"], ["秒懂", "太简单了"]];
  var h = '<div class="grade">';
  for (var i = 0; i < 4; i++) {
    h += '<button class="gbtn" data-g="' + i + '"' + (g === i ? ' style="border-color:currentColor;background:var(--panel-3)"' : "") + '>' +
      "<b>" + names[i][0] + '<span class="kd">' + (i + 1) + "</span></b>" +
      "<span>" + names[i][1] + "</span>" +
      '<span style="color:var(--text-dim)">下次 ' + nexts[i] + "</span></button>";
  }
  return h + "</div>";
}
function markAnswer(ok) {
  var r = curWord();
  if (!r) return;
  var opts = S.opts || [];
  document.querySelectorAll(".opt").forEach(function (b) {
    var idx = Number(b.getAttribute("data-pick"));
    if (opts[idx] && opts[idx].ok) b.classList.add("right");
    else if (idx === (S.picked === undefined ? -1 : S.picked)) b.classList.add("wrong");
    b.disabled = true;
  });
  S.pending = ok ? 2 : 0;
  S.answered = true;
  S.autoGraded = true;
  revealAnswer();
}
function revealAnswer() {
  var r = curWord();
  var card = $("wcard");
  if (!card) return;
  if (!$("extraBox")) {
    var d = document.createElement("div");
    d.id = "extraBox";
    d.innerHTML = '<div class="w-sep"></div>' + defHTML(r) +
      (cfg().showEn && r[F.EN] ? '<div class="w-en">' + esc(r[F.EN]) + "</div>" : "") +
      exHTML(r) + phraseHTML(r) + formsHTML(r) + rtHTML(r) + metaHTML(r) + mnemoHTML(r) +
      '<div class="row wrap" style="gap:6px;margin-top:14px">' + markBtns(r[F.W]) + "</div>";
    card.appendChild(d);
  }
  var rb = $("revBox");
  if (rb) rb.classList.remove("blurred");
  bindCommon();
  refreshGradeHost();
  document.querySelectorAll(".gbtn").forEach(function (b) {
    b.onclick = function () {
      if (!S) return;
      S.pending = Number(b.getAttribute("data-g"));
      document.querySelectorAll(".gbtn").forEach(function (x) {
        var on = Number(x.getAttribute("data-g")) === S.pending;
        x.style.borderColor = on ? "currentColor" : "";
        x.style.background = on ? "var(--panel-3)" : "";
      });
    };
  });
  var dots = $("hintLine");
  if (dots) dots.textContent = "按 1-4 或点击评价，Enter 下一张";
}
function commitAndNext() {
  if (!S) return;
  var r = curWord();
  if (!r) return;
  var g = S.pending === null || S.pending === undefined ? 2 : S.pending;
  pushStep(snapStep(r[F.W], g));   /* 先留快照再打分：向右滑回上一条时靠它把四处数据整份还原 */
  grade(r[F.W], g);
  S.results[S.i] = g;
  if (g === 0) S.wrong++; else S.correct++;
  S.i++;
  save();
  if (S.i >= S.queue.length) { finishSession(); return; }
  renderSession();
}
function finishSession() {
  var dur = Math.round((now() - S.start) / 1000);
  DB.sessions.push({ t: now(), k: S.kind, n: S.queue.length, ok: S.correct, no: S.wrong, d: dur });
  if (DB.sessions.length > 200) DB.sessions = DB.sessions.slice(-200);
  DB.meta.days = uniq(Object.keys(DB.log).filter(function (k) { return DB.log[k].n > 0; })).length;
  save(true);
  toast("本轮完成！共 " + S.queue.length + " 词", "ok");
}

/* ---------- 15b. 学习卡左右滑动翻词 ---------- */
/* 需求：学习 / 复习时「从左向右滑」回到上一条，「从右向左滑」跳到下一条。
   手机上没有键盘，原来想回头改一个刚评错的词只能点「结束」再重进，队列状态还会丢。

   ⚠ 最要紧的一点：上一条必须是「撤销」，不能只把下标减一退回去。
     grade() 一次就改了四处持久化数据：
       DB.prog[词]        —— 间隔 / 易度 / 复习次数 / 答对答错计数
       DB.log[今天].n     —— 今日学习量
       DB.log[今天].r     —— 今日错误数
       DB.wlog[今天]      —— 今日学过的单词列表
     只退下标的话那条记录还留在库里，再评一次就是**重复计数** ——
     今日进度、正确率、连续打卡会一起虚高，而且看不出来（数字只是偏大，不报错）。
     所以每次前进都压一份完整快照进 S.steps，退回时整份还原，等于这次评价没发生过。 */

function snapStep(w, g) {
  var dk = todayKey();
  /* 「整份还原」要连「这个键当时存不存在」一起记。grade() 会顺手创建
     DB.log[今天] 和 DB.wlog[今天] 两个键，如果快照前它们本来没有，
     回滚时只赋成 0 / 空数组会凭空留下两个空壳 —— 读起来等价，
     但严格说就不是原样了，何况 wlog 会被统计页当成「今天学过词」的依据。 */
  var hasLog = Object.prototype.hasOwnProperty.call(DB.log, dk);
  var hasWlog = Object.prototype.hasOwnProperty.call(DB.wlog, dk);
  return {
    i: S.i,
    kind: g === undefined ? "skip" : "grade",
    w: w, g: g,
    prog: DB.prog[w] ? JSON.stringify(DB.prog[w]) : null,
    logKey: hasLog,
    logN: hasLog ? (DB.log[dk].n || 0) : 0,
    logR: hasLog ? (DB.log[dk].r || 0) : 0,
    wlogKey: hasWlog,
    wlog: hasWlog ? DB.wlog[dk].slice() : []
  };
}
function pushStep(st) {
  if (!S.steps) S.steps = [];
  S.steps.push(st);
  if (S.steps.length > 80) S.steps.shift();   /* 只留最近 80 步，免得长会话堆内存 */
}
/* 向右滑：回上一条，并把上一条的评价整份撤销 */
function prevWord() {
  if (!S) return;
  if (!S.steps || !S.steps.length) { toast("已经是这一轮的第一条了", "ok"); return; }
  var st = S.steps.pop();
  var dk = todayKey();
  if (st.kind === "grade") {
    if (st.prog === null) delete DB.prog[st.w];
    else { try { DB.prog[st.w] = JSON.parse(st.prog); } catch (e) { delete DB.prog[st.w]; } }
    if (st.logKey) {
      DB.log[dk] = DB.log[dk] || { n: 0, r: 0 };
      DB.log[dk].n = st.logN;
      DB.log[dk].r = st.logR;
    } else delete DB.log[dk];
    if (st.wlogKey) DB.wlog[dk] = st.wlog; else delete DB.wlog[dk];
    if (st.g === 0) S.wrong = Math.max(0, S.wrong - 1); else S.correct = Math.max(0, S.correct - 1);
    S.results[st.i] = undefined;
  }
  S.i = st.i;
  save();
  renderSession();
  toast(st.kind === "grade" ? "回到上一条（上次评价已撤销）" : "回到上一条", "ok");
}
/* 向左滑：跳下一条。已评价就等同按 Enter 提交前进；没评价则纯跳过，不计对错。 */
function nextWord() {
  if (!S) return;
  if (S.answered) { commitAndNext(); return; }
  if (S.i >= S.queue.length - 1) { toast("已经是这一轮的最后一条了", "ok"); return; }
  var r = curWord();
  pushStep(snapStep(r ? r[F.W] : "", undefined));
  S.i++;
  save();
  renderSession();
  toast("已跳过（未评价，不计入对错）", "ok");
}

/* 手势本身。三个「不抢手势」的边界，缺一个就会出现「想滚页面结果翻了词」：
   ① 竖滑优先：纵向位移一旦超过横向，立刻放弃接管，把滚动还给页面
   ② 起点在输入框 / 文本域里不接管（拼写模式正在打字，还要能拖光标选字）
   ③ 起点在横向可滚动容器里不接管（比如统计页那张能左右滑的热力图）
   触摸阈值 56px、鼠标 110px：鼠标拖拽最常用来选文字，阈值大一点才不容易误伤。 */
var SWIPE = { active: false, x: 0, y: 0, t: 0 };
function swipeBlocked(node) {
  /* 用 tagName 而不是 nodeType === 1 来认「是不是元素」：
     两种写法在真浏览器里都对，但 stub DOM 里没有 nodeType，
     用 nodeType 写会让这一层测不了它（只能靠字符串匹配，抓不住行为）。 */
  while (node && node.tagName) {
    var tag = node.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (node.getAttribute && node.getAttribute("data-noswipe") !== null) return true;
    var ox = "";
    try { ox = getComputedStyle(node).overflowX; } catch (e) { }
    if (ox === "auto" || ox === "scroll") return true;
    node = node.parentNode;
  }
  return false;
}
function swipeReady() {
  if (!S || JSTACK.length) return false;                       /* 跳转页（词条详情等）不接管 */
  if (cur !== "study" && cur !== "review") return false;
  if (S.i >= S.queue.length) return false;                     /* 总结页不接管 */
  var mask = $("mask");
  if (mask && mask.classList.contains("on")) return false;      /* 弹窗开着不接管 */
  return !!$("wcard");
}
function swipeReset() {
  var card = $("wcard");
  if (!card) return;
  card.style.transition = "transform .18s cubic-bezier(.2,.8,.3,1)";
  card.style.transform = "";
  setTimeout(function () { if (card && card.style) card.style.transition = ""; }, 240);
}
function swipeFollow(dx) {
  var card = $("wcard");
  if (!card) return;
  card.style.transition = "";
  card.style.transform = "translateX(" + clamp(dx * .32, -30, 30) + "px)";
}
function bindSwipe() {
  var host = $("view");
  if (!host || host.__wfSwipe) return;   /* #view 是常驻容器（只换 innerHTML），只绑一次就够 */
  host.__wfSwipe = true;

  host.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) { SWIPE.active = false; return; }
    SWIPE.active = swipeReady() && !swipeBlocked(e.target);
    if (!SWIPE.active) return;
    SWIPE.x = e.touches[0].clientX; SWIPE.y = e.touches[0].clientY; SWIPE.t = now();
  }, { passive: true });

  host.addEventListener("touchmove", function (e) {
    if (!SWIPE.active || e.touches.length !== 1) return;
    var dx = e.touches[0].clientX - SWIPE.x, dy = e.touches[0].clientY - SWIPE.y;
    if (Math.abs(dy) > Math.abs(dx)) { SWIPE.active = false; swipeReset(); return; }
    swipeFollow(dx);   /* 手指带着卡片走一点，手感上能看出「翻得动」 */
  }, { passive: true });

  host.addEventListener("touchend", function (e) {
    if (!SWIPE.active) { SWIPE.active = false; return; }
    SWIPE.active = false;
    var t = e.changedTouches && e.changedTouches[0];
    swipeReset();
    if (!t) return;
    var dx = t.clientX - SWIPE.x, dy = t.clientY - SWIPE.y;
    if (now() - SWIPE.t > 1000) return;
    if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 56) return;
    if (dx > 0) prevWord(); else nextWord();
  });

  host.addEventListener("touchcancel", function () { SWIPE.active = false; swipeReset(); });

  /* 为什么不做鼠标拖动版本（曾经写过，删掉了）：
     鼠标横向拖动**本身就会划出文字选区** —— 这是浏览器的默认行为，拦不掉（除非在
     mousedown 里 preventDefault，那又会把正经的「拖选文字来复制」一并废掉）。
     于是「按着拖 → 出了选区 → 判定用户在选字 → 放弃接管」必然每次都成立，
     这条路径等于永远不生效。而它一旦生效，桌面用户想复制卡片上的单词就会被翻词打断。
     两头不讨好。手机上真正用的是触摸路径（快速横滑不会产生选区，长按才会），
     所以这里只保留触摸；桌面用键盘（1-4 / Enter / 空格）和评价按钮，本来就不缺入口。
     无头验证同理：用 CDP 的 Input.dispatchTouchEvent 驱动**真实触摸路径**，
     而不是为了「好测」在应用里加一条只有测试才走的鼠标分支。 */
}
function sessionSummaryHTML() {
  var dur = Math.round((now() - S.start) / 1000);
  var tot = S.correct + S.wrong;
  var acc = tot ? Math.round((S.correct / tot) * 100) : 0;
  var g = globalStats();
  return '<div class="study-wrap"><div class="card" style="text-align:center;padding:40px 26px">' +
    '<div style="font-size:44px;margin-bottom:6px">🎉</div>' +
    '<h2 style="font-size:22px;margin-bottom:6px">本轮完成</h2>' +
    '<div class="muted tiny" style="margin-bottom:22px">坚持就是胜利</div>' +
    '<div class="grid g3 keep" style="margin-bottom:22px">' +
    statCard("测评单词", S.queue.length, "词", "新词 " + S.newCount + " · 复习 " + S.revCount) +
    statCard("正确率", acc, "%", "对 " + S.correct + " / 错 " + S.wrong) +
    statCard("用时", Math.max(1, Math.round(dur / 60)), "分钟", "平均 " + (S.queue.length / Math.max(1, dur / 60)).toFixed(1) + " 词/分") +
    "</div>" +
    '<div class="row" style="gap:10px;justify-content:center">' +
    (g.due ? '<button class="btn primary lg" id="againSes">继续复习 ' + g.due + " 词</button>" : '<button class="btn primary lg" id="againSes">再来一轮</button>') +
    '<button class="btn lg" id="homeSes">回到首页</button></div>' +
    "</div></div>";
}
function bindSession() {
  var say = $("say");
  if (say) say.onclick = function () { var r = curWord(); if (r) speak(r[F.W]); };
  var rv = $("reveal");
  if (rv) rv.onclick = function () { S.revealed = true; S.answered = true; S.pending = null; renderSession(); };
  document.querySelectorAll(".opt").forEach(function (b) {
    b.onclick = function () {
      if (!S || S.answered) return;
      S.picked = Number(b.getAttribute("data-pick"));
      var ok = !!(S.opts && S.opts[S.picked] && S.opts[S.picked].ok);
      markAnswer(ok);
    };
  });
  document.querySelectorAll(".gbtn").forEach(function (b) {
    b.onclick = function () {
      if (!S) return;
      S.pending = Number(b.getAttribute("data-g"));
      document.querySelectorAll(".gbtn").forEach(function (x) {
        var on = Number(x.getAttribute("data-g")) === S.pending;
        x.style.borderColor = on ? "currentColor" : "";
        x.style.background = on ? "var(--panel-3)" : "";
      });
    };
  });
  var si = $("spellIn");
  if (si) {
    si.focus();
    si.oninput = function () { S.typed = si.value; };
    si.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); checkSpell(); } };
  }
  var so = $("spellOk");
  if (so) so.onclick = checkSpell;
  var qs = $("quitSes");
  if (qs) qs.onclick = function () {
    openModal("结束本轮？", "<p class='muted'>已测评的单词会正常记录，未测评的将保留在队列中下次继续。</p>",
      '<button class="btn" id="mNo">继续学习</button><button class="btn primary" id="mYes">结束本轮</button>',
      function () {
        $("mNo").onclick = closeModal;
        $("mYes").onclick = function () { closeModal(); S = null; go("today"); };
      });
  };
  var ag = $("againSes");
  if (ag) ag.onclick = function () { startSession("auto"); };
  var hm = $("homeSes");
  if (hm) hm.onclick = function () { S = null; go("today"); };
}
function checkSpell() {
  var r = curWord();
  if (!r || S.answered) return;
  var inp = $("spellIn");
  var val = (inp ? inp.value : S.typed || "").trim().toLowerCase();
  var ok = val === String(r[F.W]).toLowerCase();
  if (inp) { inp.classList.add(ok ? "ok" : "no"); inp.disabled = true; }
  S.spellOK = ok;
  if (ok) {
    S.pending = 2; S.answered = true; S.autoGraded = true;
    addExtra(r); bindCommon();
    var dots = document.querySelector(".underbar .tiny"); if (dots) dots.textContent = "拼写正确！按 1-4 调整评价，Enter 下一张";
    refreshGradeHost();
  } else {
    S.pending = 0; S.answered = true; S.autoGraded = true;
    addExtra(r); bindCommon();
    var d2 = document.querySelector(".underbar .tiny"); if (d2) d2.textContent = "正确拼写：" + r[F.W] + " · 按 1-4 调整，Enter 下一张";
    refreshGradeHost();
  }
}
function addExtra(r) {
  var card = $("wcard");
  if (!card || $("extraBox")) return;
  var d = document.createElement("div");
  d.id = "extraBox";
  d.innerHTML = '<div class="w-sep"></div>' + defHTML(r) +
    (cfg().showEn && r[F.EN] ? '<div class="w-en">' + esc(r[F.EN]) + "</div>" : "") +
    exHTML(r) + phraseHTML(r) + formsHTML(r) + rtHTML(r) + metaHTML(r) + mnemoHTML(r) +
    '<div class="row wrap" style="gap:6px;margin-top:14px">' + markBtns(r[F.W]) + "</div>";
  card.appendChild(d);
}
function refreshGradeHost() {
  var card = $("wcard");
  if (!card) return;
  var host = document.getElementById("gradeHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "gradeHost";
    card.parentNode.insertBefore(host, card.nextSibling);
  }
  host.innerHTML = gradeBarHTML();
}

/* ---------- 13. 复习 ---------- */
function vReview() {
  var g = globalStats();
  var ws = dueWords();
  var h = '<div class="study-wrap">';
  h += '<div class="grid g3 keep" style="margin-bottom:16px">' +
    statCard("待复习", ws.length, "词", "到期需巩固") +
    statCard("学习中", g.learn, "词", "未达 1 天间隔") +
    statCard("复习中", g.review, "词", "间隔 1-21 天") +
    "</div>";
  h += '<div class="card"><div class="card-h"><h2>复习队列</h2><span class="hint">遗忘风险高的排在前面</span></div>';
  if (!ws.length) {
    h += '<div class="empty"><svg><use href="#i-check"/></svg><b>暂时没有到期单词</b>所有学过的词都还在记忆有效期内，休息一下吧</div>';
  } else {
    ws.sort(function (a, b) { return retention(DB.prog[a]) - retention(DB.prog[b]); });
    h += '<div class="row wrap" style="gap:10px;margin-bottom:16px">' +
      '<button class="btn primary" id="startReview"><svg><use href="#i-rotate"/></svg>开始复习全部 ' + ws.length + " 词</button></div>";
    h += '<div class="wlist">';
    for (var i = 0; i < ws.length && i < 60; i++) {
      var r = rec(ws[i]); if (!r) continue;
      var p = DB.prog[ws[i]];
      h += '<div class="wrow"><div style="flex:1;min-width:0"><div class="wn">' + esc(r[F.W]) + '<span class="ipa">' + esc(r[F.US] || "") + "</span></div>" +
        '<div class="wt">' + esc(firstDef(r)) + "</div></div>" +
        '<span class="tag">持久度 ' + strength(p) + "%</span>" +
        '<span class="tag ' + (retention(p) < 0.5 ? "bad" : "warn") + '">保留率 ' + Math.round(retention(p) * 100) + "%</span>" +
        '<button class="btn ghost sm" data-spk="' + esc(r[F.W]) + '"><svg><use href="#i-vol"/></svg></button></div>';
    }
    if (ws.length > 60) h += '<div class="tiny faint" style="padding:12px 4px">还有 ' + (ws.length - 60) + " 词未列出…</div>";
    h += "</div>";
  }
  h += "</div></div>";
  return h;
}

/* ---------- 14. 通用事件绑定 ---------- */
function bindCommon() {
  document.querySelectorAll("[data-spk]").forEach(function (b) {
    b.onclick = function (e) { e.stopPropagation(); speak(b.getAttribute("data-spk"), b.getAttribute("data-acc")); };
  });
  document.querySelectorAll("[data-mk]").forEach(function (b) {
    b.onclick = function (e) {
      e.stopPropagation();
      var w = b.getAttribute("data-mk"), bit = Number(b.getAttribute("data-bit"));
      toggleMark(w, bit);
      TAGS = {}; BOWN = {};
      toast(bit === 1 ? (isFav(w) ? "已加入生词本" : "已移出生词本") : bit === 2 ? "已标记难度" : (isMarked(w) ? "已标记为会" : "已取消标记"), "ok");
      if (cur === "library" || cur === "stats") render();
      else {
        var host = b.parentNode;
        if (host && host.parentNode) {
          var idx = Array.prototype.indexOf.call(host.children, b);
          host.innerHTML = markBtns(w);
          bindCommon();
        }
      }
    };
  });
  var sb = $("switchBook"); if (sb) sb.onclick = showBookPicker;
  var ss = $("startStudy"); if (ss) ss.onclick = function () { startSession("auto"); };
  var sr = $("startReview"); if (sr) sr.onclick = function () { startSession("review"); };
  var sq = $("startQuiz"); if (sq) sq.onclick = function () { go("quiz"); };
  var bb = $("btnBook"); if (bb) bb.onclick = showBookPicker;
  var bt = $("btnTheme"); if (bt) bt.onclick = toggleMode;
  var bq = $("btnQuick"); if (bq) bq.onclick = function () { startSession("auto"); };
  /* 今日页倒计时条上的「设为 N 词/天」。
     和设置页那个按钮共用同一份推算（examPlan），这里改完可以放心 render()——
     它是按钮点击不是输入框提交，不存在「重绘把焦点弄丢」的问题。 */
  var ap = $("applyExamPace");
  if (ap) ap.onclick = function () {
    var p = examPlan();
    if (!p || p.days <= 0) return;
    var lim = numSpec("newPerDay");
    var val = clamp(p.need, lim.min, lim.max);
    cfg().newPerDay = val;
    save(true);
    render();
    toast(val === p.need
      ? "每日新词上限已设为 " + val + " 词 —— " + p.name + " 剩 " + fmtNum(p.remain) + " 词 / " + p.days + " 天"
      : "建议值 " + p.need + " 超过上限，已取最大值 " + val + " 词", "ok");
  };

  /* 跳转协议：
       data-jump="word:xxx"   → 词条详情（可层层下钻）
       data-jump="forms:xxx"  → 词形变化页
       data-jump="colls:xxx"  → 固定搭配页
       data-jump="book:xxx"   → 词书详情页（列出这本词书包含的每个单词）
         data-jump="art:xxx"   → 文章精读台
       data-jump="artq:xxx"  → 读后练习页
   不处理的话这些按钮点了没反应，学习卡上的「词形变化 / 固定搭配」就是死的。
   ⚠ 漏登记一个 kind，对应按钮就是死的，而且**安静地死**：不跳转、不报错、控制台干净。
     精读刚上线时 art / artq 就这样漏过一次，静态断言全绿、手工点一下才发现。
     所以 test-logic 里有一条根治型断言：HTML 里出现过的每种 data-jump 目标，
     都必须在下面这份分支表里有 case。新增跳转目标时，这里与 jumpViewHTML 的分派要一起改。 */
  document.querySelectorAll("[data-jump]").forEach(function (b) {
    b.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      var t = b.getAttribute("data-jump") || "";
      var i = t.indexOf(":");
      if (i < 0) return;
      var kind = t.slice(0, i), val = t.slice(i + 1);
      if (!val) return;
      if (kind === "word") jumpTo("detail", val, "");
      else if (kind === "forms") jumpTo("forms", val, "");
      else if (kind === "colls") jumpTo("colls", val, b.getAttribute("data-coll") || "");
      else if (kind === "book") jumpTo("book", val, "");
      else if (kind === "art") jumpTo("art", val, "");
      else if (kind === "artq") jumpTo("artq", val, "");
    };
  });
  /* data-jt 是跳转页内的同级页签，替换栈顶而不是压栈 */
  document.querySelectorAll("[data-jt]").forEach(function (b) {
    b.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      var t = b.getAttribute("data-jt") || "", i = t.indexOf(":");
      if (i < 0) return;
      jumpTo(t.slice(0, i), t.slice(i + 1), "", true);
    };
  });
  var jb = $("jumpBack"); if (jb) jb.onclick = jumpBack;
  var rs = $("reshuffle");
  if (rs) rs.onclick = function () {
    PQ = null;
    previewQueue("auto");
    render();
    toast("队列已重新洗牌", "ok");
  };

  /* ---- 词书详情页 ---- */
  function curBookId() {
    var j = JSTACK[JSTACK.length - 1];
    return j && j.kind === "book" ? j.book : null;
  }
  var bkAll = $("bkAll");
  if (bkAll) bkAll.onclick = function () { BSCOPE = "all"; BLIMIT = 120; render(); };
  var bkOwn = $("bkOwn");
  if (bkOwn) bkOwn.onclick = function () { BSCOPE = "own"; BLIMIT = 120; render(); };
  var bkUse = $("bkUse");
  if (bkUse) bkUse.onclick = function () {
    var id = curBookId();
    if (!id || DB.book === id) return;
    DB.book = id; TAGS = {}; BOWN = {}; PQ = null;
    save(true);
    toast("当前词书已切换到《" + (bookMeta(id) || {}).name + "》", "ok");
    render();
  };
  var bkStudy = $("bkStudy");
  if (bkStudy) bkStudy.onclick = function () {
    var id = curBookId();
    if (!id) return;
    DB.book = id; TAGS = {}; BOWN = {}; PQ = null;
    save(true);
    BQ = ""; BSCOPE = "all"; BLIMIT = 120;
    go("study");
  };
  var bkMore = $("bkMore");
  if (bkMore) bkMore.onclick = function () {
    var v0 = $("view"), top = v0 ? v0.scrollTop : 0;
    BLIMIT += 120;
    render();
    var v1 = $("view");
    if (v1) v1.scrollTop = top;
  };
  var bkqClear = $("bkqClear");
  if (bkqClear) bkqClear.onclick = function () { BQ = ""; BLIMIT = 120; render(); };
  var bkq = $("bkq");
  if (bkq) {
    var bkTimer = null;
    bkq.oninput = function () {
      BQ = bkq.value;
      BLIMIT = 120;
      clearTimeout(bkTimer);
      bkTimer = setTimeout(function () { render(); bkFocus(); }, 220);
    };
    bkq.onkeydown = function (e) {
      e.stopPropagation();
      if (e.key === "Enter") { clearTimeout(bkTimer); render(); bkFocus(); }
    };
    bkq.onchange = function () { clearTimeout(bkTimer); render(); bkFocus(); };
  }

  var mask = $("mask");
  if (mask) mask.onclick = function (e) { if (e.target === mask) closeModal(); };
}
function showBookPicker() {
  var groups = {};
  for (var i = 0; i < BOOKS.length; i++) {
    var b = BOOKS[i];
    var c = b.cat || "词书";
    (groups[c] = groups[c] || []).push(b);
  }
  var mine = [bookMeta("__fav"), bookMeta("__hard"), bookMeta("__mastered"), bookMeta("__new")];
  var h = "";
  var order = [];
  for (var k in groups) if (Object.prototype.hasOwnProperty.call(groups, k)) order.push(k);
  order.forEach(function (cat) {
    h += '<div class="tiny faint b" style="margin:4px 0 8px;letter-spacing:1px">' + esc(cat) + "</div><div class='grid g2' style='gap:8px'>";
    groups[cat].forEach(function (b) {
      var s = statsOf(b.id);
      h += '<button class="bookcard' + (DB.book === b.id ? " cur" : "") + '" data-book="' + esc(b.id) + '">' +
        '<div class="bt">' + esc(b.name) + "</div>" +
        '<div class="bd">' + esc(b.desc || "") + "</div>" +
        '<div class="pbar"><i style="width:' + (s.total ? Math.round((s.seen / s.total) * 100) : 0) + '%"></i></div>' +
        '<div class="meta"><span>' + fmtNum(s.total) + " 词</span><span>已学 " + fmtNum(s.seen) + "</span></div></button>";
    });
    h += "</div>";
  });
  h += '<div class="tiny faint b" style="margin:14px 0 8px;letter-spacing:1px">我的</div><div class="grid g2" style="gap:8px">';
  mine.forEach(function (b) {
    if (!b) return;
    var s = statsOf(b.id);
    h += '<button class="bookcard' + (DB.book === b.id ? " cur" : "") + '" data-book="' + esc(b.id) + '">' +
      '<div class="bt">' + esc(b.name) + "</div><div class=\"bd\">" + esc(b.desc) + "</div>" +
      '<div class="meta"><span>' + fmtNum(s.total) + " 词</span></div></button>";
  });
  h += "</div>";
  var cm = DB.custom || {};
  var ckeys = Object.keys(cm);
  if (ckeys.length) {
    h += '<div class="tiny faint b" style="margin:14px 0 8px;letter-spacing:1px">自定义词书</div><div class="grid g2" style="gap:8px">';
    ckeys.forEach(function (k) {
      var b = bookMeta("@" + k); var s = statsOf("@" + k);
      h += '<button class="bookcard' + (DB.book === "@" + k ? " cur" : "") + '" data-book="@' + esc(k) + '">' +
        '<div class="bt">' + esc(b.name) + "</div><div class=\"bd\">" + esc(b.desc || "") + "</div>" +
        '<div class="meta"><span>' + fmtNum(s.total) + " 词</span></div></button>";
    });
    h += "</div>";
  }
  openModal("选择词书", h, '<button class="btn" id="mClose2">关闭</button>', function () {
    $("mClose2").onclick = closeModal;
    document.querySelectorAll("[data-book]").forEach(function (b) {
      b.onclick = function () {
        DB.book = b.getAttribute("data-book");
        TAGS = {}; BOWN = {}; save(true); closeModal(); render();
        toast("已切换到「" + (bookMeta(DB.book) || {}).name + "」", "ok");
      };
    });
  }, true);
}
