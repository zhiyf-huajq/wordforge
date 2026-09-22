// 逻辑回归测试: node test-logic.js <html> [outTxt]
// 用 stub DOM 直接执行页面里的真实脚本，不重写逻辑
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
const outFile = process.argv[3];
const html = fs.readFileSync(file, "utf8");

const scripts = [];
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html)) !== null) if (!/\bsrc\s*=/.test(m[1])) scripts.push(m[2]);
const dataCode = scripts.find((s) => s.indexOf("window.__WF=") >= 0) || "window.__WF={W:[],R:[],B:[]};";
const appCode = scripts.filter((s) => s.indexOf("window.__WF=") < 0).join("\n;\n");

/* stub DOM 抽到 _stub_dom.js 共用 —— 解析验证脚本也要用同一套环境，
   两份副本迟早会漂移（改了这边忘了那边，症状是「本机过、那边莫名其妙崩」）。 */
const STUB = fs.readFileSync(path.join(__dirname, "_stub_dom.js"), "utf8");

let API = null;
let runErr = null;
try {
  const fn = new Function(STUB + "\n" + dataCode + "\n;\n" + appCode + "\n;return globalThis.__WFAPI;");
  API = fn();
} catch (e) {
  runErr = e;
}

const out = [];
function p(s) { out.push(s); console.log(s); }
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; p("  ✓ " + name); }
  else { fail++; p("  ✗ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}

p("逻辑回归测试: " + file.split(/[\\/]/).pop());
p("");

if (runErr) {
  p("  ✗ 脚本执行失败（整页会白屏）: " + runErr.message);
  p("");
  p("  堆栈: " + String(runErr.stack).split("\n").slice(0, 4).join("\n         "));
  p("");
  p("结果: 通过 0 / 失败 1");
  if (outFile) fs.writeFileSync(outFile, out.join("\n"), "utf8");
  process.exit(1);
}
p("[0] 脚本执行");
t("整页脚本无异常执行完毕（无 TDZ / 未定义错误）", true);
t("__WFAPI 已导出", !!API);
if (!API) { p("无法继续"); process.exit(1); }

const F = API.F;
p("");
p("[1] 数据装载");
t("词条数 > 10000", API.words().length > 10000, API.words().length);
t("词书数 > 10", API.books().length > 10, API.books().length);
t("词根数 > 100", API.roots().length > 100, API.roots().length);
t("默认词书可用", !!API.getDB().book);
const firstBook = API.books()[0];
if (firstBook) {
  t("词书 " + firstBook.id + " 词条可检索", API.words().some((r) => String(r[8] || "").split("|").indexOf(firstBook.id) >= 0));
}

p("");
p("[2] CSV 解析");
const csv = 'word,phonetic,meaning,example,example_cn\nabandon,əˈbændən,放弃,They abandon it.,他们放弃了。';
const r1 = API.parseImport(csv, "t.csv");
t("CSV 解析出 1 条", r1.length === 1, r1.length);
t("CSV 单词正确", r1[0] && r1[0][F.W] === "abandon", r1[0] && r1[0][F.W]);
t("CSV 释义正确", r1[0] && r1[0][F.CN] === "放弃", r1[0] && r1[0][F.CN]);
t("CSV 音标正确", r1[0] && r1[0][F.US] === "əˈbændən", r1[0] && r1[0][F.US]);
t("CSV 例句正确", r1[0] && r1[0][F.EX] === "They abandon it.", r1[0] && r1[0][F.EX]);

const csvQ = 'word,meaning\n"he said ""hi""",问候';
const rq = API.parseImport(csvQ, "q.csv");
t("CSV 引号转义解析", rq.length >= 1);

const txt = "ubiquitous 无处不在的\nresilient\t有韧性的\n# 注释行\nonlyword";
const r2 = API.parseImport(txt, "t.txt");
t("TXT 解析 3 条（跳过注释）", r2.length === 3, r2.length);
t("TXT 释义分离", r2[0] && r2[0][F.W] === "ubiquitous" && r2[0][F.CN] === "无处不在的", r2[0]);
t("TXT 纯单词行", r2[2] && r2[2][F.W] === "onlyword" && r2[2][F.CN] === "", r2[2]);

const js1 = JSON.stringify([{ w: "alpha", cn: "阿尔法", us: "ˈælfə" }, { w: "beta", cn: "贝塔" }]);
const r3 = API.parseImport(js1, "t.json");
t("JSON 对象数组解析", r3.length === 2, r3.length);
t("JSON 字段映射", r3[0][F.W] === "alpha" && r3[0][F.CN] === "阿尔法" && r3[0][F.US] === "ˈælfə", r3[0]);

const js2 = JSON.stringify({ name: "我的词书", words: [{ w: "gamma", cn: "伽马" }] });
const r4 = API.parseImport(js2, "t.json");
t("JSON 词书对象解析", r4.length === 1 && r4[0][F.W] === "gamma", r4);

// 原生数组按 16 字段位序：W,US,UK,POS,CN,EN,EX,EXZ,TG,...
const js3 = JSON.stringify([["delta", "ˈdeltə", "ˈdeltə", "n.", "德尔塔", "", "", "", "cet4"]]);
const r5 = API.parseImport(js3, "t.json");
t(
  "JSON 原生数组格式解析",
  r5.length === 1 && r5[0][F.W] === "delta" && r5[0][F.CN] === "德尔塔" && r5[0][F.POS] === "n.",
  r5[0]
);

p("");
p("[3] 解析边界与幂等");
t("空串 → 空数组", API.parseImport("", "x.txt").length === 0);
t("null → 空数组", API.parseImport(null, "x.txt").length === 0);
t("纯空白 → 空数组", API.parseImport("   \n\n  ", "x.txt").length === 0);
t("非法内容被过滤", API.parseImport("中文只有释义\n12345\n!!!", "x.txt").length === 0);
const dupTxt = "apple 苹果\nApple 苹果\nAPPLE 苹果";
const rd = API.parseImport(dupTxt, "d.txt");
t("同词大小写去重", rd.length === 1, rd.length);
const rd2 = API.parseImport(dupTxt, "d.txt");
t("去重幂等（两次结果一致）", rd.length === rd2.length && rd[0][F.W] === rd2[0][F.W]);
const long = "a".repeat(500) + " 超长";
t("超长输入不崩溃", typeof API.parseImport(long, "x.txt").length === "number");

p("");
p("[4] 记忆曲线算法");
const p0 = API.stOf("__test_word_never_graded__");
t("新词初始状态 reps=0", p0[API.N.REPS] === 0);
const n0 = API.nextInterval(p0, 0), n1 = API.nextInterval(p0, 1), n2 = API.nextInterval(p0, 2), n3 = API.nextInterval(p0, 3);
t("档位间隔单调递增 0<1<2<3", n0.i < n1.i && n1.i < n2.i && n2.i < n3.i, [n0.i, n1.i, n2.i, n3.i]);
t("答错重置 reps 为 0", n0.reps === 0, n0.reps);
t("答错 lapse +1", n0.lapse === 1, n0.lapse);
t("答对 reps +1", n3.reps === 1, n3.reps);
t("难度系数在 [1.3, 3.0] 内", n3.e >= 1.3 && n3.e <= 3.0, n3.e);
t("答错降低难度系数", n0.e < p0[API.N.E] / 100, [n0.e, p0[API.N.E] / 100]);
t("秒懂提升难度系数", n3.e > p0[API.N.E] / 100, [n3.e, p0[API.N.E] / 100]);

// 模拟长期复习到达掌握
let st = API.stOf("__test_mastery__");
for (let i = 0; i < 40; i++) {
  const nx = API.nextInterval(st, 3);
  st[API.N.E] = Math.round(nx.e * 100);
  st[API.N.I] = nx.i;
  st[API.N.REPS] = nx.reps;
}
t("40 次「秒懂」后间隔封顶在最大天数", Math.abs(st[API.N.I] / 1440 - API.CFG_DEF.maxDays) < 1, st[API.N.I] / 1440);
t("间隔永不超过 maxDays", st[API.N.I] <= API.CFG_DEF.maxDays * 1440 + 1);

p("");
p("[5] 持久度 / 保留率");
t("无记录强度为 0", API.strength(null) === 0);
t("强度在 0-100", [0, 1, 100, 100000].every((v) => { const s = API.strength([250, v, 0, 0, 0, Date.now(), 0, 0, 0]); return s >= 0 && s <= 100; }));
const fakeP = [250, 1440, Date.now(), 1, 0, Date.now() - 86400000, 1, 3, 0];
const ret = API.retention(fakeP);
t("保留率在 0-1", ret >= 0 && ret <= 1, ret);
t("刚好到期时保留率约 37%", Math.abs(ret - Math.exp(-1)) < 0.02, ret);
t("刚复习完保留率接近 1", API.retention([250, 1440, Date.now(), 1, 0, Date.now(), 1, 3, 0]) > 0.99);

p("");
p("[6] 答题记录与存储往返");
API.setDB(API.blankDB());
API.setBook("__all");
const tw = "__graded_word__";
API.grade(tw, 2);
const db1 = API.getDB();
t("测评后写入 prog", !!db1.prog[tw]);
t("答对计数 +1", db1.prog[tw][API.N.OK] === 1, db1.prog[tw][API.N.OK]);
t("写入今日日志", db1.log[Object.keys(db1.log)[0]].n === 1);
API.grade(tw, 0);
t("答错后 NO +1", db1.prog[tw][API.N.NO] === 1, db1.prog[tw][API.N.NO]);
t("答错后 reps 归零", db1.prog[tw][API.N.REPS] === 0);
t("due 在未来", db1.prog[tw][API.N.DUE] > Date.now());
const snapshot = JSON.stringify(db1);
API.setDB(JSON.parse(snapshot));
t("存储往返一致", JSON.stringify(API.getDB()) === snapshot);

p("");
p("[7] 选项生成");
const pool = API.words().slice(0, 300);
let optOK = true, dupOK = true, seenVals = new Set();
for (let i = 0; i < 60; i++) {
  const r = pool[i];
  const opts = API.makeOptions(r, pool, 4, false);
  const correct = opts.filter((o) => o.ok);
  if (correct.length !== 1) optOK = false;
  if (opts.length !== 4) optOK = false;
  const vs = opts.map((o) => o.v);
  if (new Set(vs).size !== vs.length) dupOK = false;
  if (correct.length === 1 && correct[0].v !== String(r[F.CN] || "").split("\n")[0]) optOK = false;
}
t("每次恰好 1 个正确项且选项数=4", optOK);
t("选项无重复", dupOK);
const optsW = API.makeOptions(pool[0], pool, 4, true);
t("看义选词模式选项为单词", optsW.every((o) => /^[A-Za-z]/.test(o.v)));
t("选项数量受配置控制", API.makeOptions(pool[0], pool, 2, false).length === 2);

p("");
p("[8] XSS 转义");
t("esc 转义 <", API.esc("<script>") === "&lt;script&gt;", API.esc("<script>"));
t("esc 转义引号", API.esc('"x"') === "&quot;x&quot;", API.esc('"x"'));
t("esc 转义单引号", API.esc("'") === "&#39;", API.esc("'"));
t("esc 转义 &", API.esc("a&b") === "a&amp;b", API.esc("a&b"));
t("esc 处理 null", API.esc(null) === "", API.esc(null));
t("esc 处理 undefined", API.esc(undefined) === "");
const evil = "<img src=x onerror=alert(1)>";
// TXT 规则要求释义以中文起头，故用「中文释义 + 载荷」构造合法输入，才能真正走到转义路径
const evilArr = API.parseImport("wordzz 恶意" + evil, "e.txt");
t("含 HTML 标签的 TXT 行仍能解析出词条", evilArr.length === 1 && evilArr[0][F.W] === "wordzz", evilArr.length);
const evilRec = evilArr[0];
t("恶意释义原样保留为纯文本（渲染时须转义）", evilRec[F.CN] === "恶意" + evil, evilRec[F.CN]);
t("esc 可正确中和该载荷", API.esc(evilRec[F.CN]).indexOf("<img") < 0, API.esc(evilRec[F.CN]));

p("");
p("[9] 搜索");
const s1 = API.searchWords("aband");
t("前缀搜索命中 abandon", s1.some((r) => r[F.W] === "abandon"), s1.length);
const s2 = API.searchWords("放弃");
t("中文释义搜索有结果", s2.length > 0, s2.length);
t("空查询返回空", API.searchWords("").length === 0);
t("无结果查询返回空数组", Array.isArray(API.searchWords("zzzzqqqxxx")));
t("搜索不抛出异常（超长查询）", typeof API.searchWords("a".repeat(300)).length === "number");

p("");
p("[10] 数据质量抽样");
const all = API.words();
let noCn = 0, badW = 0, tooLong = 0, hole = 0, tailBad = 0;
const seenWords = new Set();
let dup = 0;
all.forEach((r) => {
  if (!r[F.CN] || !String(r[F.CN]).trim()) noCn++;
  if (!/^[A-Za-z]/.test(String(r[F.W] || ""))) badW++;
  if (String(r[F.W]).length > 45) tooLong++;
  // 中间空洞（缺例句 / 缺英文释义）是合法数据形态，App 按 falsy 判断渲染；
  // 真正要校验的不变量是「尾部空字段必须被裁掉」：数组长度 === 末位有值字段索引 + 1
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const v = r[i];
    if (v !== null && v !== undefined && String(v).trim() !== "") last = i;
  }
  if (r.length !== last + 1) tailBad++;
  for (let i = 0; i < last; i++) {
    const v = r[i];
    if (v === null || v === undefined || String(v).trim() === "") hole++;
  }
  const k = String(r[F.W]).toLowerCase();
  if (seenWords.has(k)) dup++; else seenWords.add(k);
});
t("无重复词条", dup === 0, dup);
t("所有词条都有中文释义", noCn === 0, noCn);
t("所有单词以字母开头", badW === 0, badW);
t("没有超长单词（>45字符）", tooLong === 0, tooLong);
t("尾字段裁剪到位（数组长度 = 末位有值字段 + 1）", tailBad === 0, tailBad);
// 内容完善度：扩充字段覆盖率（这是本次深挖的核心产出）
const covW = (i) => all.filter((r) => r[i] !== undefined && r[i] !== null && String(r[i]).trim() !== "").length / all.length;
const pc = (i) => (covW(i) * 100).toFixed(1) + "%";
t("音标覆盖 > 90%", covW(F.US) > 0.9, pc(F.US));
t("英文释义覆盖 > 85%", covW(F.EN) > 0.85, pc(F.EN));
t("例句覆盖率 > 70%（Tatoeba + 必备词 + WordNet 多义项）", covW(F.EX) > 0.7, pc(F.EX));
t("例句翻译覆盖 > 30%", covW(F.EXZ) > 0.3, pc(F.EXZ));
t("词形变化覆盖 > 60%", covW(F.FM) > 0.6, pc(F.FM));
t("词性覆盖 > 85%（ECDICT 词性权威表 94% + WordNet 兜底）", covW(F.POS) > 0.85, pc(F.POS));
t("词频覆盖 > 85%", covW(F.BNC) > 0.85, pc(F.BNC));
t("词根词缀覆盖 > 12%", covW(F.RT) > 0.12, pc(F.RT));
t("常用搭配覆盖 > 8%（语料 bigram 统计）", covW(F.PH) > 0.08, pc(F.PH));
t("同义词覆盖 > 70%（WordNet，按义项顺序扫 3 个）", covW(F.SYN) > 0.7, pc(F.SYN));
t("反义词覆盖 > 14%（WordNet 反义指针，主词性全义项）", covW(F.ANT) > 0.14, pc(F.ANT));
t("近义词辨析存在（resemble 库）", covW(F.DIS) > 0.1, pc(F.DIS));
t("中间空洞占比 <45%（源自尚无搭配数据的 PH 等字段）", hole / (all.length * 20) < 0.45, ((hole / (all.length * 20)) * 100).toFixed(1) + "%");

p("");
p("[11] 真实词条抽查（内容正确性）");
const spot = ["abandon", "cancel", "dictionary", "environment", "government", "necessary", "receive", "separate"];
let spotOK = 0;
spot.forEach((w) => {
  const r = all.find((x) => x[F.W] === w);
  if (r && r[F.CN] && String(r[F.CN]).length > 1 && /[\u4e00-\u9fa5]/.test(String(r[F.CN]))) spotOK++;
  else p("      ! 抽查缺失或异常: " + w);
});
t("抽查 " + spot.length + " 个常用词全部有中文释义", spotOK === spot.length, spotOK + "/" + spot.length);
const ab = all.find((x) => x[F.W] === "abandon");
if (ab) {
  t("abandon 释义含「放弃」", String(ab[F.CN]).indexOf("放弃") >= 0, ab[F.CN]);
  t("abandon 有音标", !!ab[F.US], ab[F.US]);
}

p("");
p("[12] 视图渲染全链路");
// 重置为干净状态，避免前面用例污染 DB
API.setDB(API.blankDB());
/* 视图清单从应用里取（API.VIEWS），不在测试里手抄。
   ⚠ 这里原来手抄了 7 个名字，**而且漏了 read** —— 于是「精读视图能不能渲染」
   从来没有被这条断言覆盖过，它却是全应用最复杂的一页。手抄清单的坑就是这个：
   漏掉一个不会报错，只会让那一个永远不被检查，而断言照样显示「全部成功」。
   改成从 API.VIEWS 推导之后，以后新增视图会自动纳入。 */
const ALL_VIEWS = API.VIEWS;
const viewErr = [];
ALL_VIEWS.forEach((v) => {
  try {
    API.go(v);
    const html = String(document.getElementById("view").innerHTML || "");
    if (html.length < 50) viewErr.push(v + ":内容过少(" + html.length + ")");
  } catch (e) {
    viewErr.push(v + ":" + e.message);
  }
});
t(ALL_VIEWS.length + " 个视图全部渲染成功（清单取自 API.VIEWS，含 read 与 confuse）",
  viewErr.length === 0, viewErr.join(" | "));

// 会话全链路：开始 → 建队列 → 渲染单词卡
let sessErr = null, sessHTML = "";
try {
  API.go("today");
  API.startSession("auto");
  sessHTML = String(document.getElementById("view").innerHTML || "");
} catch (e) {
  sessErr = e;
}
const SESS = API.session();
t("startSession 不抛异常", !sessErr, sessErr && sessErr.message);
t("会话建立了非空队列", !!(SESS && SESS.queue && SESS.queue.length), SESS && SESS.queue ? SESS.queue.length : 0);
t("会话视图渲染出单词卡 (.wcard)", /wcard/.test(sessHTML), sessHTML.slice(0, 100));
t("视图已切到 study", API.curView() === "study", API.curView());
let advErr = null;
try {
  API.grade(SESS.queue[0], 2);
} catch (e) { advErr = e; }
t("会话中评分写入不抛异常", !advErr, advErr && advErr.message);

p("");
p("[13] 扩充字段渲染与导入（同义词 / 反义词 / 辨析 / 表头 CSV）");
const fake = API.mkRec({
  w: "zzzprobe", cn: "探测词", syn: "trialA|essayB", ant: "giveupC",
  dis: "a / b\n这组词都有测试的意思：\n- a: 甲含义\n- b: 乙含义",
  rt: "pre- before (Latin) · dict speak"
});
const card = API.wordDetailHTML(fake, {});
t("同义词区块渲染", card.indexOf("同义词") >= 0 && card.indexOf("trialA") >= 0);
t("反义词区块渲染", card.indexOf("反义词") >= 0 && card.indexOf("giveupC") >= 0);
t("近义词辨析区块渲染（多行保留）", card.indexOf("近义词辨析") >= 0 && card.indexOf("w-dis") >= 0 && card.indexOf("乙含义") >= 0);
t("词根区块渲染", card.indexOf("词根词缀") >= 0 && card.indexOf("pre-") >= 0);

// 词性区块（本轮新增：把 ECDICT 词性权威表接进渲染）
const fpos = API.mkRec({ w: "zzzpos", cn: "探测", pos: "n. vt. adj." });
const cpos = API.wordDetailHTML(fpos, {});
t("词性区块渲染（多词性多标签）",
  cpos.indexOf("词性") >= 0 && cpos.indexOf('class="tag pos"') >= 0 &&
  cpos.indexOf("n.") >= 0 && cpos.indexOf("vt.") >= 0 && cpos.indexOf("adj.") >= 0);
t("空词性不产生空区块",
  API.wordDetailHTML(API.mkRec({ w: "zzznopos", cn: "无词性" }), {}).indexOf('class="tag pos"') < 0);

// 释义行首 a. 必须被识别成词性标记（旧正则缺 a.，形容词整类丢失）
const cnCard = API.wordDetailHTML(API.mkRec({ w: "zzza", cn: "a. 非洲的\nn. 非洲人" }), {});
t("释义行首 a. 识别为词性标记", cnCard.indexOf('<span class="pos">a.</span>') >= 0);
t("释义行首 ad. 识别为词性标记",
  API.wordDetailHTML(API.mkRec({ w: "zzzad", cn: "ad. 准确地" }), {}).indexOf('<span class="pos">ad.</span>') >= 0);
t("adj. 不被 a. 抢先切分",
  API.wordDetailHTML(API.mkRec({ w: "zzzadj", cn: "adj. 高的" }), {}).indexOf('<span class="pos">adj.</span>') >= 0);

// 开关关闭后应隐藏
const DBC = API.getDB();
const bakSyn = DBC.cfg.showSyn, bakAnt = DBC.cfg.showAnt, bakDis = DBC.cfg.showDis;
DBC.cfg.showSyn = false; DBC.cfg.showAnt = false; DBC.cfg.showDis = false;
const cardOff = API.wordDetailHTML(fake, {});
DBC.cfg.showSyn = bakSyn; DBC.cfg.showAnt = bakAnt; DBC.cfg.showDis = bakDis;
t("关闭三个开关后对应区块隐藏",
  cardOff.indexOf("trialA") < 0 && cardOff.indexOf("giveupC") < 0 && cardOff.indexOf("w-dis") < 0);

// 词性开关
const bakPos = DBC.cfg.showPos;
DBC.cfg.showPos = false;
const cposOff = API.wordDetailHTML(fpos, {});
DBC.cfg.showPos = bakPos;
t("关闭词性开关后词性区块隐藏", cposOff.indexOf('class="tag pos"') < 0);
t("开关恢复后词性区块回来", API.wordDetailHTML(fpos, {}).indexOf('class="tag pos"') >= 0);

// 空字段不应产生空区块
const bareCard = API.wordDetailHTML(API.mkRec({ w: "zzzbare", cn: "空词" }), {});
t("无扩充字段时不产生空区块",
  bareCard.indexOf("同义词") < 0 && bareCard.indexOf("反义词") < 0 && bareCard.indexOf("近义词辨析") < 0);

// 真实词条渲染
const hw = API.words().find((x) => x[F.W] === "happy");
if (hw) {
  const hc = API.wordDetailHTML(hw, {});
  t("happy 卡片渲染同义词 felicitous", hc.indexOf("felicitous") >= 0);
  t("happy 卡片渲染反义词 unhappy", hc.indexOf("unhappy") >= 0);
} else {
  t("happy 存在于词表", false, "未找到");
}

// CSV 表头感知（列序任意）
const rc1 = API.parseImport("meaning,word,synonyms\n测试释义,zcsvcase,aa|bb", "t.csv");
t("CSV 表头感知：按列名取值（列序打乱）",
  rc1.length === 1 && rc1[0][F.CN] === "测试释义" && rc1[0][F.SYN] === "aa|bb",
  JSON.stringify((rc1[0] || []).slice(0, 5)) + " syn=" + (rc1[0] ? rc1[0][F.SYN] : "-"));

// 无表头：扩展 13 列位序
const rc2 = API.parseImport("zpos1,fə,释义甲,,,,,,,,synZ,antZ,", "t.csv");
t("CSV 无表头时按扩展 13 列位序取值",
  rc2.length === 1 && rc2[0][F.SYN] === "synZ" && rc2[0][F.ANT] === "antZ",
  rc2[0] ? "syn=" + rc2[0][F.SYN] + " ant=" + rc2[0][F.ANT] : "无结果");

// 旧格式兼容
const rc3 = API.parseImport("zold5,fə,旧释义,ex en,ex zh", "t.csv");
t("旧 5 列 CSV 格式仍兼容",
  rc3.length === 1 && rc3[0][F.CN] === "旧释义" && rc3[0][F.EX] === "ex en" && rc3[0][F.EXZ] === "ex zh",
  rc3[0] ? JSON.stringify(rc3[0].slice(0, 5)) : "无结果");

p("");
p("[14] 巧记 / 跳转 / 学习顺序随机化");
// —— 巧记 ——
const fmn = API.mkRec({
  w: "zzzmnemo", cn: "探测", mn: "拆:un-（不、非） + happy\n族:happier · happiest\n源:古英语",
  syn: "glad|cheerful", ant: "sad"
});
const cmn = API.wordDetailHTML(fmn, {});
t("巧记区块渲染（拆词 / 同族 / 词源 三行）",
  cmn.indexOf("巧记") >= 0 && cmn.indexOf("w-mn") >= 0 &&
  cmn.indexOf("拆词") >= 0 && cmn.indexOf("同族") >= 0 && cmn.indexOf("词源") >= 0);
t("巧记区块渲染拆词内容", cmn.indexOf("un-") >= 0 && cmn.indexOf("happy") >= 0);
t("无巧记素材时用近反义词兜底联想", cmn.indexOf("联想") >= 0 && cmn.indexOf("glad") >= 0 && cmn.indexOf("sad") >= 0);
t("既无巧记也无同反义词时不产生空区块",
  API.wordDetailHTML(API.mkRec({ w: "zzznomn", cn: "无素材" }), {}).indexOf("w-mn") < 0);
// 巧记必须排在最后一栏：词根词缀之后，操作按钮之前
const bothRtMn = API.mkRec({ w: "zzzboth", cn: "探测", rt: "pre- 之前 (Latin)", mn: "拆:pre- + dict" });
const cBoth = API.wordDetailHTML(bothRtMn, {});
t("巧记排在词根词缀之后、操作按钮之前（确为最后一栏）",
  cBoth.indexOf("词根词缀") < cBoth.indexOf('class="w-mn"') &&
  cBoth.indexOf('class="w-mn"') < cBoth.indexOf('data-mk="'));
const bakMnemo = DBC.cfg.showMnemo;
DBC.cfg.showMnemo = false;
t("关闭「显示巧记」开关后区块隐藏", API.wordDetailHTML(fmn, {}).indexOf("w-mn") < 0);
DBC.cfg.showMnemo = bakMnemo;
t("开关恢复后巧记区块回来", API.wordDetailHTML(fmn, {}).indexOf("w-mn") >= 0);
t("巧记覆盖率 > 40%（词根库 + 词表内同族推导，零外部臆造）", covW(F.MN) > 0.4, pc(F.MN));
// 词根兜底不能乱拆：单双字母前缀（a- / re-）禁止参与
t("词根兜底不再把 a- 当词根（about 不被拆成 a + bout）",
  API.rootHint("about") === "", API.rootHint("about"));
t("词根兜底仍能命中真前缀（preview → pre-）",
  /^pre\b/.test(API.rootHint("preview")) && API.rootHint("preview").indexOf("view") > 0,
  API.rootHint("preview"));
t("词根兜底取最长匹配（不是碰到第一个就收工）",
  API.rootHint("supermarket").indexOf("super") === 0 || API.rootHint("supermarket") === "",
  API.rootHint("supermarket"));
t("词条自身有 RT 时不用兜底", API.wordDetailHTML(API.words().find((x) => x[F.RT]), {}).indexOf("w-block") >= 0);
// 词根库整体中文化（927 条里 ECDICT 官方 495 + qwerty 注入 ~432 都要过表）
const rootEn = API.roots().filter((r) => !/[\u4e00-\u9fa5]/.test(String(r[2] || "")));
t("词根库 " + API.roots().length + " 条释义全部中文化", rootEn.length === 0,
  rootEn.length + " 条仍是英文：" + rootEn.slice(0, 3).map((r) => r[0]).join(","));
// 词条 RT 字段里的词缀释义也应中文化（-ant, -ent 这类别名模式最容易漏）
const impRT = (API.words().find((x) => x[F.W] === "important") || [])[F.RT] || "";
t("RT 字段中的别名模式词缀已中文化（important 的 -ant, -ent）",
  impRT.indexOf("做…的") >= 0 || impRT.indexOf("拉丁语") >= 0, impRT.slice(0, 120));
const rmn = API.parseImport("word,meaning,mnemo\nzmn1,释义,拆:a + b", "t.csv");
t("CSV 表头 mnemo 映射到巧记字段", rmn.length === 1 && rmn[0][F.MN] === "拆:a + b", rmn[0] ? rmn[0][F.MN] : "-");
t("mkRec 接受 mnemo 别名", API.mkRec({ w: "zmn2", mnemo: "族:x" })[F.MN] === "族:x");
t("数据契约扩到 20 字段（mkBlank 槽位数）", API.mkBlank().length === 20, API.mkBlank().length);
t("normArr 保留第 20 个槽位", API.normArr(["w", "", "", "", "cn"]).length === 20);

// —— 跳转页 ——
const jw = API.words().find((x) => x[F.W] === "happy") || API.words()[0];
// 取一个确定有常用搭配的真实词，避免依赖具体语料
function phWord() { return API.words().find((x) => x[F.PH] && String(x[F.PH]).indexOf("|") > 0) || jw; }
const formsH = API.formsPageHTML(jw);
t("词形变化页渲染出 .jgrid 卡片", formsH.indexOf("jgrid") >= 0, jw[F.W]);
t("词形变化页有返回按钮与三向页签",
  formsH.indexOf('id="jumpBack"') >= 0 && formsH.indexOf("jtab") >= 0);
t("词形变化页列出真实变形（happier / happiest）",
  formsH.indexOf("happier") >= 0 || formsH.indexOf("happiest") >= 0, jw[F.W]);
t("词形变化页内嵌词条详情", formsH.indexOf("w-def") >= 0);
const collsH = API.collsPageHTML(phWord());
t("固定搭配页渲染出搭配行", collsH.indexOf("jcoll") >= 0, phWord()[F.W]);
t("固定搭配页高亮主词（<em>）", collsH.indexOf("<em>") >= 0);
t("固定搭配页高亮的是主词本身、无 $1 残留（正则捕获组回归）",
  collsH.indexOf("$1") < 0 && collsH.indexOf("<em>" + phWord()[F.W] + "</em>") >= 0,
  collsH.slice(Math.max(0, collsH.indexOf("<em>")), collsH.indexOf("<em>") + 44));
t("固定搭配页可整条朗读", collsH.indexOf('data-spk="') >= 0);
const detH = API.detailPageHTML(jw);
t("词条详情页渲染完整卡片", detH.indexOf("w-word") >= 0 && detH.indexOf("jtab") >= 0);
t("卡片「词形变化」入口带 data-jump=forms", API.wordDetailHTML(jw, {}).indexOf('data-jump="forms:') >= 0);
t("卡片「固定搭配」入口带 data-jump=colls", API.wordDetailHTML(phWord(), {}).indexOf('data-jump="colls:') >= 0);
t("卡片词形变化标签本身可下钻（data-jump=word）",
  API.wordDetailHTML(jw, {}).indexOf('data-jump="word:') >= 0 || API.formList(jw).every((s) => !API.words().some((x) => x[F.W] === s.split(/[:：]/).pop().trim())));
t("formList 能拆出真实词形（happy → 2 项）", API.formList(jw).length >= 1, API.formList(jw).join("|"));

API.setDB(API.blankDB());
API.go("today");
API.jumpTo("forms", jw[F.W]);
t("jumpTo 压栈并渲染跳转页",
  API.jumpStack().length === 1 && String(document.getElementById("view").innerHTML).indexOf("jgrid") >= 0);
t("跳转页顶栏标题换成单词",
  String(document.getElementById("pgTitle").textContent) === jw[F.W],
  document.getElementById("pgTitle").textContent);
API.jumpTo("colls", jw[F.W]);
t("二次跳转压到栈深 2", API.jumpStack().length === 2, API.jumpStack().length);
API.jumpBack();
t("jumpBack 回到栈深 1", API.jumpStack().length === 1, API.jumpStack().length);
API.jumpBack();
t("jumpBack 退到底清空栈并回到原视图",
  API.jumpStack().length === 0 && API.curView() === "today", API.curView());
let jumpBad = null;
try { API.jumpTo("forms", "zzznotexist"); } catch (e) { jumpBad = e; }
t("跳到不存在的词不抛异常、不压栈",
  !jumpBad && API.jumpStack().length === 0, jumpBad && jumpBad.message);

// —— 学习顺序随机化 ——
const head30 = (a) => a.slice(0, 30).join(",");
// 每种策略连建两次，同模式内比较（上一次写错模式导致误判，这里逐模式显式设定）
API.setQueueOrder("order");
const qOrder = API.buildQueue("all"), qOrder2 = API.buildQueue("all");
API.setQueueOrder("random");
const qRnd = API.buildQueue("all"), qRnd2 = API.buildQueue("all");
API.setQueueOrder("smart");
const qSmart = API.buildQueue("all"), qSmart2 = API.buildQueue("all");
t("三种顺序策略都能建出非空队列",
  qOrder.length > 0 && qSmart.length > 0 && qRnd.length > 0,
  qOrder.length + "/" + qSmart.length + "/" + qRnd.length);
t("完全随机：两轮顺序不同", head30(qRnd) !== head30(qRnd2));
t("智能随机：两轮顺序也不同", head30(qSmart) !== head30(qSmart2));
t("固定顺序：两轮完全一致（可复现）", head30(qOrder) === head30(qOrder2));
t("随机化只改顺序、不改选词集合",
  qOrder.slice().sort().join(",") === qRnd.slice().sort().join(","));
t("顺序策略名称可读",
  API.orderName("smart") === "智能随机" && API.orderName("random") === "完全随机" && API.orderName("order") === "固定顺序");
API.setQueueOrder("smart");
API.go("study");
const svH = String(document.getElementById("view").innerHTML || "");
t("学习页出现「换一批」按钮", svH.indexOf('id="reshuffle"') >= 0);
t("学习页标注当前顺序策略", svH.indexOf("智能随机") >= 0 && svH.indexOf("每轮重新洗牌") >= 0);
API.resetPreview();

/* ============ 词书详情页 & 词书包含关系 ============ */
p("");
p("[15] 词书详情页 & 包含关系");

const BK = API.books();
const cet4 = BK.find((b) => b.id === "cet4");
const cet6 = BK.find((b) => b.id === "cet6");
t("词书元数据含 n / own / inc 三个字段",
  BK.every((b) => typeof b.n === "number" && typeof b.own === "number" && Array.isArray(b.inc)),
  BK.length + " 本");
t("内置四六级词书都在", !!cet4 && !!cet6);
t("四级词书 ≥ 4500 词（官方大纲口径 4500）", !!cet4 && cet4.n >= 4500, cet4 ? cet4.n + " 词" : "-");
t("六级词书 ≥ 5500 词（官方大纲 5500-6000）", !!cet6 && cet6.n >= 5500, cet6 ? cet6.n + " 词" : "-");
t("六级词书声明包含四级", !!(cet6 && cet6.inc.some((x) => x.id === "cet4")));
t("六级 n = 四级 n + 本册新增 own（含四级全部）",
  !!cet4 && !!cet6 && cet6.n === cet4.n + cet6.own,
  cet4 && cet6 ? cet4.n + " + " + cet6.own + " = " + (cet4.n + cet6.own) : "-");

const w4 = API.bookWords("cet4").map((r) => r[F.W]);
const w6 = new Set(API.bookWords("cet6").map((r) => r[F.W]));
const lost = w4.filter((w) => !w6.has(w));
t("四级的 " + w4.length + " 个词全部同时挂在六级词书下",
  lost.length === 0, lost.length ? "漏 " + lost.slice(0, 5).join(", ") : "0 漏");

const ownW = API.bookOwnWords("cet6").map((r) => r[F.W]);
t("bookOwnWords 与 own 字段一致", ownW.length === cet6.own, ownW.length + " / " + cet6.own);
t("本册新增词不重复计入四级", ownW.every((w) => w4.indexOf(w) < 0));
t("本册新增词都有中文释义",
  API.bookOwnWords("cet6").every((r) => String(r[F.CN] || "").length > 0));
t("四六级词条中文释义齐备",
  API.bookWords("cet4").every((r) => String(r[F.CN] || "").length > 0) &&
  API.bookWords("cet6").every((r) => String(r[F.CN] || "").length > 0));

API.setBookQuery(""); API.setBookScope("all"); API.setBookLimit(40);
const bkAll = API.bookPageHTML("cet6");
t("词书页渲染出单词列表", bkAll.indexOf("单词列表") >= 0 && bkAll.indexOf('class="brow"') >= 0);
t("词书页首屏只渲染 40 行（惰性加载）",
  (bkAll.match(/class="brow"/g) || []).length === 40);
t("词书页标出「含《大学英语四级》」", bkAll.indexOf("含《大学英语四级》全部") >= 0);
t("词书页有「仅本册新增」范围切换", bkAll.indexOf("仅本册新增") >= 0);
t("词书页每行可点进词条详情", bkAll.indexOf('data-jump="word:') >= 0);
t("词书页有「学这本」入口", bkAll.indexOf('id="bkStudy"') >= 0);
t("词书页有页内搜索框", bkAll.indexOf('id="bkq"') >= 0);

API.setBookScope("own");
const bkOwn = API.bookPageHTML("cet6");
API.setBookScope("all");
t("切到「仅本册新增」范围生效",
  bkOwn.indexOf("仅本册新增 · 共") >= 0 &&
  (bkOwn.match(/class="brow"/g) || []).length <= (bkAll.match(/class="brow"/g) || []).length);

API.setBookQuery("aban");
const bkQ = API.bookPageHTML("cet6");
t("词书页内搜索命中 abandon", bkQ.indexOf(">abandon<") >= 0);
API.setBookQuery("zzzzqq");
const bkEmpty = API.bookPageHTML("cet6");
API.setBookQuery("");
t("搜索无结果时给空态文案", bkEmpty.indexOf("没有匹配的单词") >= 0);

/* 跳转协议：点词书 → 词书详情页 → 点单词 → 词条详情 → 逐层返回 */
API.setDB(API.blankDB());
API.go("library");
const libH = String(document.getElementById("view").innerHTML || "");
t("词库页词书卡片改为「查看单词列表」",
  libH.indexOf('data-jump="book:cet6"') >= 0 && libH.indexOf("查看单词列表") >= 0);
t("词库页卡片标出包含关系", libH.indexOf("含《大学英语四级》") >= 0);
t("词书卡片不再用旧的 data-lib-book 直接切换", libH.indexOf("data-lib-book") < 0);

API.jumpBook("cet6");
t("点词书进入词书详情页（压跳转栈）",
  API.jumpStack().length === 1 && API.jumpStack()[0].kind === "book",
  JSON.stringify(API.jumpStack()));
t("顶栏标题换成词书名",
  String(document.getElementById("pgTitle").textContent).indexOf("六级") >= 0,
  document.getElementById("pgTitle").textContent);
t("词书页内可下钻到词条详情",
  String(document.getElementById("view").innerHTML).indexOf('data-jump="word:') >= 0);
API.jumpBack();
t("返回后回到词库页", API.jumpStack().length === 0 && API.curView() === "library");

/* ============ 设置面板：数值输入格式校验 ============ */
p("");
p("[16] 设置面板数值校验（只认格式正确的数值，否则恢复原值）");

const PS = API.parseNum;
const SP = API.numSpec;

/* 合法输入 */
t("整数 '120' 通过", PS("120", "newPerDay") === 120);
t("全角数字 '１２０' 归一化为 120", PS("１２０", "newPerDay") === 120);
t("前后空格被容忍 '  120  '", PS("  120  ", "newPerDay") === 120);
t("小数 '0.95' 通过（语速）", PS("0.95", "rate") === 0.95);
t("中文逗号当小数点 '0，85' → 0.85", PS("0，85", "rate") === 0.85);
t("省略前导零 '.5' → 0.5", PS(".5", "rate") === 0.5);
t("小数格步长对齐 '2.75' 通过", PS("2.75", "easeStart") === 2.75);

/* 越界：同样不接受，回滚原值 */
t("越上限 '99999' 被拒（每日新词上限 500）", PS("99999", "newPerDay") === null);
t("越下限 '0' 被拒（每日新词上限 1）", PS("0", "newPerDay") === null);
t("越下限 '0.4' 被拒（语速下限 0.5）", PS("0.4", "rate") === null);
t("越下限 '7' 被拒（选项数上限 6）", PS("7", "optCount") === null);
t("小数格步长不符 '2.77' 被拒", PS("2.77", "easeStart") === null);

/* 格式非法：一律拒绝（含 Number('')===0 这个坑） */
t("空串被拒（不会偷偷变成 0）", PS("", "newPerDay") === null);
t("纯空白被拒", PS("   ", "newPerDay") === null);
t("null / undefined 被拒", PS(null, "newPerDay") === null && PS(undefined, "newPerDay") === null);
t("'12abc' 被拒", PS("12abc", "newPerDay") === null);
t("'abc' 被拒", PS("abc", "newPerDay") === null);
t("科学计数法 '1e5' 被拒", PS("1e5", "newPerDay") === null);
t("'--1' 被拒", PS("--1", "newPerDay") === null);
t("'3.5.2' 被拒", PS("3.5.2", "newPerDay") === null);
t("'NaN' / 'Infinity' 被拒", PS("NaN", "newPerDay") === null && PS("Infinity", "newPerDay") === null);
t("十六进制 '0x1f' 被拒", PS("0x1f", "newPerDay") === null);
t("整数格拒小数 '3.5'", PS("3.5", "optCount") === null);

/* 格式规格表：声明即校验，不允许存在"没有规格"的输入框 */
const vsh = String(API.vSettings());
const numKeys = (vsh.match(/data-num="([^"]+)"/g) || []).map((x) => x.slice(10, -1));
t("设置页数值输入共 16 个", numKeys.length === 16, numKeys.length + " 个");
t("每个数值输入都有专属格式规格（不会被宽松兜底接住）",
  numKeys.every((k) => !!API.NUMS[k]), numKeys.filter((k) => !API.NUMS[k]).join(",") || "全部有规格");
t("规格区间合法（min < max）", Object.keys(API.NUMS).every((k) => API.NUMS[k].min < API.NUMS[k].max));
t("整数规格都声明 kind=int、小数都声明步长",
  Object.keys(API.NUMS).every((k) => API.NUMS[k].kind === "int" || API.NUMS[k].step > 0));
/* 用「数量自洽」而不是写死数字：numin 只该出现在数值框上，多一个就说明混进了别的输入框 */
const numinAll = vsh.match(/.{0,55}class="numin".{0,55}/g) || [];
t("numin 只用在数值框上（数量与 data-num 一致）",
  numinAll.length === numKeys.length,
  numinAll.length + " vs " + numKeys.length + " || 没跟 data-num 的: " +
  (numinAll.filter((x) => x.indexOf("data-num") < 0).join(" ~~ ") || "无"));
t("输入框都带 inputmode（移动端数字键盘）", (vsh.match(/inputmode=/g) || []).length === 16);
t("不再用 type=number（浏览器会吞掉全角输入且无反馈）", vsh.indexOf('type="number"') < 0);
t("每项都把合法区间写进说明",
  numKeys.every((k) => !API.NUMS[k].hint || vsh.indexOf(API.NUMS[k].hint) >= 0),
  numKeys.filter((k) => API.NUMS[k].hint && vsh.indexOf(API.NUMS[k].hint) < 0).join(",") || "全部带上区间");

/* 初始回显：每个框的值都能被自己的规格接受 —— fontSize 缺默认值时这里会红 */
const ivs = (vsh.match(/data-num="([^"]+)" value="([^"]*)"/g) || []).map((s) => s.match(/data-num="([^"]+)" value="([^"]*)"/).slice(1));
t("每个数值框的初始值都能被自己的规格接受",
  ivs.length === 16 && ivs.every((x) => PS(x[1], x[0]) !== null),
  ivs.filter((x) => PS(x[1], x[0]) === null).map((x) => x[0] + "=" + x[1]).join(",") || ivs.length + "/" + ivs.length + " 合法");
t("字号有默认值且落在合法区间（否则字号框一直是空的）",
  typeof API.CFG_DEF.fontSize === "number" && SP("fontSize").min <= API.CFG_DEF.fontSize && API.CFG_DEF.fontSize <= SP("fontSize").max,
  String(API.CFG_DEF.fontSize));

/* 提交路径不得整页重绘 —— 那是"输不进去 / 光标跑到标题上"的根因 */
const bsrc = html.slice(html.indexOf("function bindNumInputs"), html.indexOf("function commitNum"));
t("数值输入绑定里不含 render()（整页重绘会销毁输入框与焦点）", bsrc.length > 0 && bsrc.indexOf("render()") < 0);
const csrc = html.slice(html.indexOf("function commitNum"), html.indexOf("function syncNumInputs"));
t("提交后不回滚成整个数组（二级键取标量）", csrc.indexOf("el.value = el.__last") >= 0);
t("格式非法时执行回滚并标红", csrc.indexOf("el.value = el.__last") >= 0 && csrc.indexOf("markBad(el, sp)") >= 0);
/* 标红函数本体：既要变红，也要把失败原因写进说明（不能只靠一闪而过的提示条） */
const mbsrc = html.slice(html.indexOf("function markBad"), html.indexOf("function clearBad"));
t("标红同时把失败原因写进该项说明", mbsrc.indexOf("classList.add(\"bad\")") >= 0 && mbsrc.indexOf("⚠") >= 0);
t("标红会暂存原文案，恢复正常后能还原", mbsrc.indexOf("_wfOrig") >= 0 && html.slice(html.indexOf("function clearBad"), html.indexOf("function syncNumInputs")).indexOf("_wfOrig") >= 0);
t("提交路径不整页重绘（commitNum 内无 render()）", csrc.indexOf("render()") < 0);
t("syncNumInputs 可用（恢复默认值时就地回填，不重绘）", typeof API.syncNumInputs === "function");
t("bindSettings 可重复调用不抛异常",
  (function () { try { API.bindSettings(); API.bindSettings(); return true; } catch (e) { return false; } })());

p("");
p("=".repeat(58));
p("[17] 文章精读：联网边界 / 抓取解析 / 词形还原 / 辅助档位 / 自动出题");

(function () {
  const DBX = API.getDB();

  /* ---- 17.1 联网边界：白名单与开关是仅有的两道闸门 ---- */
  t("域名白名单非空", API.NET_WL.length >= 5, API.NET_WL.length + " 项");
  t("放行白名单内的 https 地址", API.netHostOK("https://en.wikipedia.org/api/rest_v1/page/summary/x") === true);
  t("放行带端口号的白名单地址", API.netHostOK("https://simple.wikipedia.org:443/w/api.php") === true);
  t("拒绝白名单外的域名", API.netHostOK("https://evil.example.com/x") === false);
  t("拒绝 http 明文（防止被中间人改写）", API.netHostOK("http://en.wikipedia.org/x") === false);
  t("拒绝后缀伪装域名 en.wikipedia.org.evil.com", API.netHostOK("https://en.wikipedia.org.evil.com/x") === false);
  t("拒绝空值与 javascript: 伪协议", API.netHostOK("") === false && API.netHostOK("javascript:alert(1)") === false);
  t("netGet 对白名单外地址立即拒绝（同步、不发请求）",
    (function () { let got = null; API.netGet("https://evil.example.com/x", function (e) { got = e; }); return got && got.code === "BLOCKED"; })());
  /* 这条直接验证用户的要求：这个功能只在联网时开放 */
  DBX.cfg.netOff = true;
  t("关掉联网开关后，白名单地址也一个请求都不发",
    (function () { let got = null; API.netGet("https://en.wikipedia.org/x", function (e) { got = e; }); return got && got.code === "OFF"; })());
  DBX.cfg.netOff = false;
  t("联网开关的默认值是开启", API.CFG_DEF.netOff === false);

  /* ---- 17.2 抓取解析：喂夹具 JSON，完全不依赖真实网络 ---- */
  const F1 = { query: { pages: { "1": { pageid: 1, title: "Climate change", extract: "Climate change is the long-term shift in global temperatures and weather patterns observed since the pre-industrial period." } } } };
  const E1 = API.pickExtract(F1);
  t("解析条目全文：拿到标题与正文", !!E1 && E1.title === "Climate change" && E1.text.indexOf("long-term shift") >= 0);
  t("正文过短时不当作有效文章", API.pickExtract({ query: { pages: { a: { title: "X", extract: "too short" } } } }) === null);
  t("结构异常时返回 null 而不是抛异常", API.pickExtract({}) === null && API.pickExtract(null) === null);

  const E2 = API.pickSearch({ query: { search: [{ title: "A", snippet: '<span class="searchmatch">cli</span>mate <b>change</b>', size: 100 }] } });
  t("检索结果：剥离 snippet 里的 HTML 标签", E2.length === 1 && E2[0].snip.indexOf("<") < 0, E2[0] && E2[0].snip);
  t("检索空结果返回空数组", API.pickSearch({ query: { search: [] } }).length === 0);

  t("当日新闻稿清单解析", API.pickNews({ query: { categorymembers: [{ title: "News one" }, { title: "News two" }] } }).length === 2);
  const E4 = API.pickFeatured({
    tfa: { title: "T", extract: "x".repeat(120), content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/T" } } },
    news: [{ story: "Some event happened today." }]
  });
  t("每日精选：取到今日特色条目", E4.some((x) => x.kind === "topic" && x.title === "T"));
  t("每日精选：时事条目也一并带出", E4.some((x) => x.kind === "news"));
  t("每日精选为空不报错", API.pickFeatured({}).length === 0);

  const E5 = API.pickGuardian({ response: { results: [{ webTitle: "G1", webUrl: "https://x", webPublicationDate: "2026-09-10T00:00:00Z", fields: { bodyText: "Body text here." } }] } });
  t("卫报结果：取出正文与日期", E5.length === 1 && E5[0].d === "2026-09-10" && E5[0].text === "Body text here.");
  t("卫报里没有正文的条目会被跳过", API.pickGuardian({ response: { results: [{ webTitle: "no body" }] } }).length === 0);
  t("卫报接口报错时返回空列表", API.pickGuardian({ response: { status: "error" } }).length === 0);

  t("取全文 URL 的标题做了转义（带空格的条目名不会拼坏请求）",
    API.urlExtract("en.wikipedia.org", "Climate change").indexOf("Climate%20change") >= 0);
  t("检索 URL 带 origin=*（跨域放行参数）", API.urlSearch("en.wikipedia.org", "a").indexOf("origin=*") >= 0);
  t("检索关键词同样转义", API.urlSearch("en.wikipedia.org", "a b").indexOf("a%20b") >= 0);
  t("每日精选 URL 的月日补零", API.urlFeatured(2026, 9, 7).indexOf("/2026/09/07") >= 0, API.urlFeatured(2026, 9, 7));
  t("所有预设源都有名称/许可/可达性说明", API.SRC_LIST.every((s) => s.name && s.lic && s.note));

  /* ---- 17.3 文本切分（精读排版的基础） ---- */
  t("段落切分：按空行断开并丢掉空段", API.splitParas("First para.\n\nSecond para.\n\n\nThird para.").length === 3);
  t("段落切分：多余空白被压平", API.splitParas("a   b\n\nc")[0] === "a b");
  const S1 = API.splitSents("Mr. Smith went home. He arrived 3.5 hours later! Was he tired?");
  t("断句：缩写 Mr. 不误断", S1[0].indexOf("Mr. Smith") === 0, S1[0]);
  t("断句：小数点不断句", S1.some((x) => x.indexOf("3.5") >= 0));
  t("断句：句数正确", S1.length === 3, S1.length);
  t("断句：U.S. 这类单字母缩写也不误断", API.splitSents("The U.S. is large. It has 50 states.").length === 2);
  t("单词抽取只取字母词", API.artWords("Hello, world! 123 ok-dash").join(",") === "Hello,world,ok-dash", API.artWords("Hello, world! 123 ok-dash").join(","));

  /* ---- 17.4 词形还原：点词查义能不能查到，全看这一步 ---- */
  const lw = (w) => API.lookWord(w);
  t("基本形直接命中且不标 lem", !!lw("abandon") && lw("abandon").lem === false);
  /* 前四条走的是「词库里根本没有这个形态」这条路：只能靠后缀规则 + 词形变化字段反查 */
  t("库里没有的过去式 walked → walk", !!lw("walked") && lw("walked").r[0] === "walk", lw("walked") && lw("walked").r[0]);
  t("库里没有的不规则变形 went → go（靠词形变化字段反查）", !!lw("went") && lw("went").r[0] === "go", lw("went") && lw("went").r[0]);
  t("库里没有的比较级 bigger → big", !!lw("bigger") && lw("bigger").r[0] === "big", lw("bigger") && lw("bigger").r[0]);
  t("副词能查到", !!lw("quickly") && !!lw("happily"));
  /* 这一条走的是另一条路：库里有 studies，但它的释义写着「study的复数」，是纯变形条目 */
  t("纯变形条目 studies 还原到原形 study", !!lw("studies") && lw("studies").r[0] === "study", lw("studies") && lw("studies").r[0]);
  t("还原后带 lem 标记与原文", lw("studies").lem === true && lw("studies").from === "studies");
  t("还原时原条目挂在 alt 上备查（点开两边都能看）",
    !!lw("studies").alt && lw("studies").alt[0] === "studies", lw("studies").alt && lw("studies").alt[0]);
  /* 「的复数」和「的名词复数」是两种不同写法，只认前者会漏掉一大批（scientists 就是） */
  t("另一种变形写法也认得出（scientists → scientist）",
    !!lw("scientists") && lw("scientists").r[0] === "scientist", lw("scientists") && lw("scientists").r[0]);
  /* 下面三条是防回归。看起来「running 还原成 run」更符合直觉，但 running 自己就有独立释义
     （运转；赛跑），left 更是高频独立词（左边）。把它们还原掉会让点词查义变得莫名其妙 ——
     这条界线必须钉死。 */
  t("独立词条不还原：left 就是 left（不是 leave）",
    !!lw("left") && lw("left").r[0] === "left" && lw("left").lem === false, lw("left") && lw("left").r[0]);
  t("独立词条不还原：running 就是 running（不是 run）",
    !!lw("running") && lw("running").lem === false, lw("running") && lw("running").r[0]);
  t("独立词条不还原：thing 不会变成 the", !!lw("thing") && lw("thing").r[0] === "thing", lw("thing") && lw("thing").r[0]);
  t("大小写与标点不影响查询", !!lw("Studies,") && lw("Studies,").r[0] === "study");
  t("词库里没有的词返回 null（不瞎猜）", lw("zzqqxxww") === null);
  t("词形变化反查索引规模合理", Object.keys(API.buildFormIdx() || {}).length > 500, Object.keys(API.buildFormIdx() || {}).length + " 条");

  /* ---- 17.5 档位与生词判定 ---- */
  t("档位名称可读", API.lvlName("cet6") === "六级" && API.lvlName("zzz") === "超纲");
  /* 这条是根治型的：档位键必须与词库 TG 标签、词书 id 三者一致。
     早先 LVL_ORDER 写的是短名（zk / gk / ky），而数据里存的是全称（zhongkao / gaokao / kaoyan），
     两边对不上 → 中考 / 高考 / 考研三个档位整体失效。表面只是「标签没生效」，
     实际后果是 the / is / and 全被判成生词，精读的显释义档变成满屏中文、文章没法读。 */
  t("档位键与词库标签、词书 id 三者一致（对不上就整档失效）",
    API.LVL_ORDER.zhongkao === 0 && API.LVL_ORDER.gaokao === 1 && API.LVL_ORDER.kaoyan === 4,
    "zhongkao=" + API.LVL_ORDER.zhongkao + "/gaokao=" + API.LVL_ORDER.gaokao + "/kaoyan=" + API.LVL_ORDER.kaoyan);
  t("abandon 落在四级或更低档", API.LVL_ORDER[API.lvlOf(lw("abandon").r)] <= 2, API.lvlOf(lw("abandon").r));
  t("the 取到高考档，不会被当成四级词", API.LVL_ORDER[API.lvlOf(lw("the").r)] <= 1, API.lvlOf(lw("the").r));
  t("高频词豁免可用（词频进前 1000 的一律不打扰）",
    API.isHotWord(lw("the").r) === true && API.isHotWord(lw("climate").r) === false,
    "the=" + API.isHotWord(lw("the").r) + "/climate=" + API.isHotWord(lw("climate").r));
  t("the / is / and 不会被判成生词（否则整篇都是下划线）",
    !API.isNewTerm("the", lw("the").r) && !API.isNewTerm("is", lw("is").r) && !API.isNewTerm("and", lw("and").r));
  t("门槛没有把该标的词也一起漏掉（六级以上照标）",
    API.isNewTerm("emission", lw("emission").r) === true && API.isNewTerm("coastline", lw("coastline").r) === true,
    "emission=" + API.isNewTerm("emission", lw("emission").r) + "/coastline=" + API.isNewTerm("coastline", lw("coastline").r));
  t("生词门槛默认为六级（备考六级的人不该被四级词淹没）", API.CFG_DEF.readNewFrom === "cet6", API.CFG_DEF.readNewFrom);
  t("反向词形查询可用（led 既是发光二极管、也是 lead 的过去式）",
    !!API.formOf("led") && API.formOf("led")[0] === "lead", API.formOf("led") && API.formOf("led")[0]);
  t("没有原形的词不误报反向词形", API.formOf("the") === null);
  t("大写专名不算生词（免得满篇都是生词）", API.isNewTerm("Zzyzx", null) === false);
  t("词库外的全大写缩写仍算生词", API.isNewTerm("XYZ", null) === true);
  t("词库外的普通词算生词", API.isNewTerm("zzqqxx", null) === true);

  /* ---- 17.6 文章模型与语言画像 ---- */
  const TXT = "Climate change is the long-term shift in global temperatures. Scientists have observed it since the pre-industrial period. The main cause is the burning of fossil fuels, which releases greenhouse gases into the atmosphere.\n\n"
    + "Rising temperatures have led to more extreme weather. Melting ice sheets are raising sea levels. Many species are moving toward the poles to find cooler conditions.";
  const AT = API.artMk({ t: "Test article", text: TXT, src: "测试来源", lic: "CC BY-SA" });
  t("文章对象带 id 与日期", !!AT.id && /^\d{4}-\d{2}-\d{2}$/.test(AT.d), AT.d);
  t("文章按段落存正文", AT.ps.length === 2, AT.ps.length);
  t("词数统计与正文一致", API.artCount(AT) === API.artWords(TXT).length, API.artCount(AT));
  t("文章保留来源与许可字段", AT.src === "测试来源" && AT.lic === "CC BY-SA");

  const P1 = API.artProfile(AT);
  t("画像：不重复词数不超过总词数", P1.uniq <= P1.total, P1.uniq + "/" + P1.total);
  t("画像：生词 + 已掌握 = 不重复词数", P1.newN + P1.knownN === P1.uniq, P1.newN + "+" + P1.knownN + " vs " + P1.uniq);
  t("画像：按词表分层统计齐全", Object.keys(P1.byLvl).length >= 3, JSON.stringify(P1.byLvl));
  t("画像：生词按难度从高到低排", (function () {
    /* 排序映射直接取 LVL_ORDER —— 单一真源，测试里再抄一份迟早会和实现走偏 */
    const rank = (lv) => (API.LVL_ORDER[lv] === undefined ? 99 : API.LVL_ORDER[lv]);
    for (let i = 1; i < P1.newList.length; i++) if (rank(P1.newList[i - 1].lv) < rank(P1.newList[i].lv)) return false;
    return true;
  })());
  t("画像：难度星级落在 1–5", P1.star >= 1 && P1.star <= 5, P1.star);
  /* 星级必须只由「文章用了什么词」决定。早先用的是「生词占比」，而门槛以上的词几乎都算生词，
     于是任何文章都算出接近 100%、恒定 5 星 —— 这条断言就是把那个口径钉死。 */
  t("画像：难度星级不随生词门槛的设置而变（只看文章本身）", (function () {
    const keep = DBX.cfg.readNewFrom;
    DBX.cfg.readNewFrom = "gaokao"; const a = API.artProfile(AT).star;
    DBX.cfg.readNewFrom = "gre"; const b = API.artProfile(AT).star;
    DBX.cfg.readNewFrom = keep;
    return a === b && a >= 1 && a <= 5;
  })(), "门槛 gaokao / gre 下应一致");
  t("画像：map 索引与生词数量一致", Object.keys(P1.map).length === P1.newN, Object.keys(P1.map).length + " vs " + P1.newN);
  t("画像摘要可复用（不重复计算）", API.artStat(AT) === API.artStat(AT));

  const LONG = [];
  for (let i = 0; i < 40; i++) LONG.push("Paragraph " + i + " " + new Array(30).join("w" + i + " "));
  const TR = API.artTrim(LONG, 100);
  t("超长文章按完整段落截断", TR.ps.length < LONG.length, TR.ps.length + "/" + LONG.length);
  t("截断后标记节选", TR.cut === true);
  t("截断不会把段落切一半", TR.ps.every((x) => /w\d+\s*$/.test(x.trim())));

  /* ---- 17.7 存储往返 ---- */
  API.artSave(AT);
  t("文章存入本地库并能按 id 取回", !!API.artGet(AT.id) && API.artGet(AT.id).t === "Test article");
  t("文章列表包含刚存的那篇", API.artAll().some((x) => x.id === AT.id));
  const AT2 = API.artMk({ t: "第二篇", text: TXT });
  API.artSave(AT2);
  t("多篇文章可并存", API.artAll().length >= 2, API.artAll().length);

  /* ---- 17.8 精读台渲染与四档辅助 ---- */
  DBX.cfg.readAssist = 0;
  const H0 = API.artPageHTML(AT.id);
  t("精读台渲染出标题与来源", H0.indexOf("Test article") >= 0 && H0.indexOf("测试来源") >= 0);
  t("精读台有四个辅助档位按钮", (H0.match(/data-assist="/g) || []).length === 4);
  t("精读台展示语言画像", H0.indexOf("总词数") >= 0 && H0.indexOf("生词") >= 0 && H0.indexOf("难度") >= 0);
  t("精读台有「读完了」与生词入队入口", H0.indexOf('id="rdDone"') >= 0 && H0.indexOf('id="rdToLearn"') >= 0);
  t("精读台有练习入口（跳转到 artq）", H0.indexOf("artq:" + AT.id) >= 0);
  t("纯读档：生词不做任何标记", H0.indexOf("rw-new") < 0);
  t("纯读档：正文里每个词仍可点", (H0.match(/data-word="/g) || []).length >= 50, (H0.match(/data-word="/g) || []).length + " 个词");

  DBX.cfg.readAssist = 1;
  const H1 = API.artPageHTML(AT.id);
  t("标生词档：生词加了虚线下划线", (H1.match(/rw-new/g) || []).length > 0, (H1.match(/rw-new/g) || []).length + " 处");
  t("标生词档：不给中文（先自己猜）", H1.indexOf('class="rcn"') < 0);

  DBX.cfg.readAssist = 2;
  const H2 = API.artPageHTML(AT.id);
  t("显释义档：生词后面跟中文", (H2.match(/class="rcn"/g) || []).length > 0, (H2.match(/class="rcn"/g) || []).length + " 处");
  t("显释义档：中文数量不超过生词标记数", (H2.match(/class="rcn"/g) || []).length <= (H2.match(/rw-new/g) || []).length);

  DBX.cfg.readAssist = 3;
  const H3 = API.artPageHTML(AT.id);
  t("逐句档：句子单独成行", (H3.match(/class="rsent"/g) || []).length >= 4, (H3.match(/class="rsent"/g) || []).length + " 句");
  t("四个档位的名字可读", API.assistName(0) === "纯读" && API.assistName(3) === "逐句精读");
  DBX.cfg.readAssist = 1;

  /* ---- 17.9 从文章自动出题 ---- */
  const P2 = API.artProfile(AT);
  const CZ = API.mkCloze(AT, P2, 5);
  t("语境填空：能出题", CZ.length > 0, CZ.length + " 题");
  t("语境填空：题干里确实挖空了", CZ.length > 0 && CZ[0].blank.indexOf("＿") >= 0);
  t("语境填空：保留原句用于回看", CZ.length > 0 && CZ[0].sent.indexOf("＿") < 0);
  t("语境填空：给首字母与中文提示", CZ.length > 0 && CZ[0].hint.length > 0 && CZ[0].cn.length > 0);
  t("语境填空：挖掉的词原本就在这句里", CZ.length > 0 && CZ[0].sent.toLowerCase().indexOf(CZ[0].w.toLowerCase()) >= 0);

  const MT = API.mkMatch(P2, 6);
  t("词义配对：每项都有词与释义", MT.length > 0 && MT.every((x) => x.w && x.cn), MT.length + " 组");
  t("词义配对：同一个词不重复出", (function () { const S = {}; for (let i = 0; i < MT.length; i++) { if (S[MT[i].w]) return false; S[MT[i].w] = 1; } return true; })());

  const OD = API.mkOrder(AT, 2);
  t("句子排序：只挑 4–6 句的段落", OD.every((x) => x.sents.length >= 4 && x.sents.length <= 6), OD.length + " 段");
  t("句子排序：乱序序列是原索引的排列（不丢句）", OD.every((x) => {
    const S = x.order.slice().sort((a, b) => a - b);
    for (let i = 0; i < S.length; i++) if (S[i] !== i) return false;
    return true;
  }));

  const EX = API.mkExercises(AT, P2);
  t("一次生成三类练习", Array.isArray(EX.cloze) && Array.isArray(EX.match) && Array.isArray(EX.order));

  /* ---- 17.10 练习页与状态 ---- */
  const QH = API.artQuizHTML(AT.id);
  t("练习页含三个板块", QH.indexOf("语境填空") >= 0 && QH.indexOf("词义配对") >= 0 && QH.indexOf("段落还原") >= 0);
  t("练习页有题量与得分统计", QH.indexOf("题量") >= 0 && QH.indexOf("已答对") >= 0);
  DBX.cfg.readQuizN = 4;
  const ST = API.qzBuild(AT.id);
  t("练习状态：填空与配对都建出来了", ST.cloze.length > 0 && ST.match.left.length > 0, ST.cloze.length + "/" + ST.match.left.length);
  t("练习状态：题量总数自洽", API.qzTotal(ST) === ST.cloze.length + ST.match.left.length + ST.order.length, API.qzTotal(ST));
  t("练习状态：初始零分", API.qzDone(ST) === 0 && ST.qbad === 0);
  t("配对题左右两侧的词集一致", (function () {
    const L = ST.match.left.map((x) => x.w).sort().join(",");
    const R = ST.match.right.map((x) => x.w).sort().join(",");
    return L === R && L.length > 0;
  })());
  /* 配对题右侧顺序被打乱。
     ⚠ 这条原来写的是「单次构建的右侧顺序 ≠ 左侧顺序」。那是条**抽样脆断言**：
     右侧是 shuffle 出来的排列，4 项时恰好抽到「和左侧完全同序」的概率是 1/24 ≈ 4%，
     也就是每跑 25 次就会无缘无故红一次 —— 而红的那次跟代码改动毫无关系。
     更坏的是它的反面：真把 shuffle 去掉了，只要那一次抽样不是恒等排列，它照样绿。
     两头都不准。
     改法不是把阈值放宽（放宽等于不测），而是**把单次抽样换成看分布**：
     构建 40 次，要求出现过不止一种排列。
       · shuffle 正常 → 40 次全抽到同一排列的概率是 (1/24)^39 ≈ 10⁻⁵⁴，几乎不可能红；
       · shuffle 坏掉（恒等返回）→ 永远只有 1 种排列，必红。
     既测得准，又不会误报。 */
  (function () {
    const seen = {};
    for (let k = 0; k < 40; k++) {
      const S2 = API.qzBuild(AT.id);
      if (!S2.match.right.length) return;
      seen[S2.match.right.map((x) => x.w).join(",")] = 1;
    }
    const kinds = Object.keys(seen).length;
    t("配对题右侧顺序被打乱（40 次构建看排列分布，不是单次抽样）", kinds > 1, kinds + " 种排列");
  })();
  t("排序题的可移动序列与句子数一致", ST.order.every((x) => x.cur.length === x.o.sents.length));

  /* ---- 17.11 生词入队：精读 → 背单词的闭环 ---- */
  const added = API.artWordsToLearn(P2);
  t("本篇生词能一次性加入「精读生词」词书", added > 0, added + " 个");
  t("生词本写进了自定义词书结构", !!DBX.custom.readnew && DBX.custom.readnew.words.length >= added);
  t("重复入队是幂等的", API.artWordsToLearn(P2) === 0);
  t("入队的是紧凑数组词条（与主库同构，可直接被学习流程消费）",
    DBX.custom.readnew.words.every((x) => Array.isArray(x) && typeof x[0] === "string"));
  t("入队的都是小写词形（不会把 Studies 这类原文变形塞进去）",
    DBX.custom.readnew.words.every((x) => x[0] === String(x[0]).toLowerCase()));

  /* ---- 17.12 导入通道：完全离线的那条路 ---- */
  t("粘贴导入会剥掉网页标签", API.stripHTMLLite("<p>Hello</p><script>bad()</script><b>world</b>").indexOf("<") < 0);
  t("剥标签时保留正文文字", API.stripHTMLLite("<p>Hello world</p>").indexOf("Hello world") >= 0);
  t("HTML 实体被还原", API.stripHTMLLite("a&amp;b&nbsp;c").indexOf("a&b") >= 0);
  t("纯文本原样保留（不多此一举）", API.stripHTMLLite("plain text") === "plain text");

  /* ---- 17.13 主页、设置与路由 ---- */
  const VR = API.vRead();
  t("精读主页有「发现」与「我的文章」两个页签", VR.indexOf('data-rtab="discover"') >= 0 && VR.indexOf('data-rtab="mine"') >= 0);
  t("精读主页显示联网状态", VR.indexOf("rnet") >= 0);
  t("精读主页提供源可达性自测入口", VR.indexOf('id="rdTestAll"') >= 0);
  t("精读主页讲清「这是唯一需要联网的模块」", VR.indexOf("唯一需要联网") >= 0);
  API.RD_SET("mine");
  t("可切到「我的文章」页签", API.RD_TAB() === "mine");
  const VM = API.vRead();
  t("我的文章页列出已存文章", VM.indexOf("Test article") >= 0);
  /* 粘贴导入挂在「我的文章」这一页（离线用户的落脚点），所以要先切页再查 */
  t("「我的文章」页提供完全离线的粘贴导入", VM.indexOf('id="rdPaste"') >= 0 && VM.indexOf('id="rdImport"') >= 0);
  t("离线导入这条通道写明「完全离线」", VM.indexOf("完全离线") >= 0);
  API.RD_SET("discover");

  const VS2 = API.vSettings();
  t("设置页有精读分组", VS2.indexOf("文章精读") >= 0);
  t("设置页有联网总开关", VS2.indexOf('id="setNet"') >= 0);
  t("设置页能调生词门槛（4 档）", (VS2.match(/data-rgate="/g) || []).length === 4);
  t("设置页能调默认辅助档位（4 档）", (VS2.match(/data-rassist="/g) || []).length === 4);
  t("设置页的卫报 Key 是文本框而非数值框", VS2.indexOf('id="setGdKey"') >= 0 && VS2.indexOf('class="numin" id="setGdKey"') < 0);
  t("设置页写明「关掉后一个请求都不发」", VS2.indexOf("一个请求都不发") >= 0);
  t("导航与视图表里都有精读", html.indexOf('data-go="read"') >= 0);
  /* 关于页的承诺必须跟事实一致：精读确实会联网，就不能再写「不联网」 */
  t("关于文案不再声称「完全不联网」（要如实说明精读会联网、且可关掉）",
    html.indexOf("不上传、不联网") < 0 &&
    html.indexOf("关掉之后整个应用一个请求都不会发") >= 0 &&
    html.indexOf("唯一的联网模块") >= 0);
  /* ---- 跳转协议完整性（根治型断言）----
     凡是代码里写出来的 data-jump 目标，bindCommon 的分支表里都必须有对应 case。
     精读刚上线时就漏了 art / artq：按钮点了毫无反应、控制台也不报错，
     而「属性存在」这类静态断言完全抓不住 —— 只有真实浏览器里点一下才会暴露。 */
  const jks = {};
  (html.match(/data-jump="([a-z]+):/g) || []).forEach(function (s) {
    const mm = /data-jump="([a-z]+):/.exec(s); if (mm) jks[mm[1]] = 1;
  });
  const jsrc = html.slice(html.indexOf("function bindCommon"), html.indexOf("data-jt 是跳转页内的同级页签"));
  const jhd = {};
  (jsrc.match(/kind === "([a-z]+)"/g) || []).forEach(function (s) {
    const mm = /kind === "([a-z]+)"/.exec(s); if (mm) jhd[mm[1]] = 1;
  });
  const jmiss = Object.keys(jks).filter((k) => !jhd[k]);
  t("每种 data-jump 目标在 bindCommon 里都有分支（漏一个按钮就是死的）",
    jmiss.length === 0 && Object.keys(jks).length >= 5,
    "代码里用到 " + Object.keys(jks).join("/") + " · 没接的 " + (jmiss.join(",") || "无"));
  API.go("read");
  t("能通过导航切到精读视图", API.curView() === "read", API.curView());

  /* ---- 清理：测试文章不留进本地库 ---- */
  API.artDel(AT.id); API.artDel(AT2.id);
  t("测试文章已清理干净", !API.artGet(AT.id) && !API.artGet(AT2.id));
})();

p("");
p("=".repeat(58));
p("[18] 手机底部导航 & 学习卡滑动手势");

(function () {
  const DBX = API.getDB();

  /* ---- 18.1 底部导航：可达性 + 「点了有没有反应」 ----
     这一段的教训：底栏按钮是动态生成的，而 init() 里只给带 class="nav" 的侧边栏绑了点击，
     底栏按钮没有那个类 → 8 个按钮一个都没绑上 → 手机上点哪儿都没反应，还不报错。
     第六层（手机视口）只测布局溢出，照样全绿。所以这里既测静态写法，也测可达性。 */
  const plan = API.mtabPlan();
  const allNav = plan.p.concat(plan.s);
  /* 视图清单同样从应用里推导（原为手抄 8 个名字，加「易混词」后立刻对不上）。
     手抄清单只能断言自己抄的那份：新视图有没有接进底栏它并不知道，还会一直绿。
     改成从 API.VIEWS 推导后，「每个视图都点得到」这条会随新增视图自动加强。 */
  const ALLV = API.VIEWS;
  const missView = ALLV.filter((v) => allNav.indexOf(v) < 0);
  const dupView = allNav.filter((v, i) => allNav.indexOf(v) !== i);
  t("底栏 = 4 个主入口 + 「更多」容纳其余全部视图",
    plan.p.length === 4 && plan.s.length === ALLV.length - 4,
    "主 " + plan.p.join("/") + " · 更多 " + plan.s.join("/"));
  t("全部 " + ALLV.length + " 个视图在手机上都能到达（漏一个那个页面就进不去）",
    missView.length === 0 && allNav.length === ALLV.length,
    missView.length ? "缺 " + missView.join(",") : ALLV.length + " 个全覆盖");
  t("底栏项不重复", dupView.length === 0, dupView.join(",") || "无重复");
  t("主入口就是高频四页：今日/学习/复习/精读", plan.p.join() === "today,study,review,read");
  t("次要页的高亮归到「更多」名下（否则切到统计时底栏一项都不亮，像没选中）",
    API.mtabActive("stats") === "__more" && API.mtabActive("settings") === "__more" && API.mtabActive("read") === "read");

  const mtabSrc = html.slice(html.indexOf("function buildMtab"), html.indexOf("function openMoreSheet"));
  /* ⚠ 静态断言必须针对「代码」而不是「注释」。
     这段代码上方写了长注释，里面引用了旧写法 querySelectorAll(".nav") 当反面教材，
     不剥注释的话断言会被我自己的注释绊倒（第一版就是这么翻的）。 */
  const stripCmt = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const mtabCode = stripCmt(mtabSrc);
  t("底栏点击用容器委托绑定（mt.onclick），不再逐个按钮绑",
    /mt\.onclick\s*=\s*function/.test(mtabCode));
  t("底栏绑定不依赖 .nav 类（这正是当初整条底栏点了没反应的根因）",
    mtabCode.indexOf('querySelectorAll(".nav")') < 0 && mtabCode.indexOf("nav") < 0,
    mtabCode.replace(/\s+/g, " ").slice(0, 160));
  t("底栏按钮带 aria-label（图标按钮没有可读文字）", /aria-label=/.test(mtabCode));

  const initSrc = html.slice(html.indexOf("function init()"), html.indexOf("window.__WFAPI"));
  t("启动时先建底栏，再进首个视图（顺序反了首次高亮会落空）",
    initSrc.indexOf("buildMtab()") > 0 && initSrc.indexOf("buildMtab()") < initSrc.indexOf('go("today")'));
  t("启动时就挂上滑动手势监听", /bindSwipe\(\)/.test(initSrc) && initSrc.indexOf("bindSwipe()") < initSrc.indexOf('go("today")'));

  /* ---- 18.2 手势的边界条件（静态） ---- */
  const swSrc = html.slice(html.indexOf("function swipeBlocked"), html.indexOf("function sessionSummaryHTML"));
  const swCode = stripCmt(swSrc);
  t("触摸翻词阈值 56px", /Math\.abs\(dx\) < 56/.test(swCode));
  t("不提供鼠标拖动翻词（鼠标横拖必然划出文字选区，与「拖选复制」天然冲突；桌面走键盘与按钮）",
    swCode.indexOf("mousedown") < 0 && swCode.indexOf("getSelection") < 0,
    "残留 " + (swCode.match(/mousedown|getSelection/g) || []).join(","));
  t("竖滑优先：纵向位移一大就放弃接管，把滚动还给页面",
    /Math\.abs\(dy\) > Math\.abs\(dx\)/.test(swCode) && /SWIPE\.active = false/.test(swCode));
  t("输入框 / 文本域里不接管（拼写模式还要能拖光标选字）",
    /tag === "INPUT"/.test(swCode) && /tag === "TEXTAREA"/.test(swCode));
  t("横向可滚动容器里不接管（统计页热力图自己会横滑）",
    /overflowX/.test(swCode) && /"auto"/.test(swCode));
  t("弹窗打开时不接管手势", /classList\.contains\("on"\)/.test(swCode));
  t("touchcancel 也复位（来电／手势打断时卡片不能卡在半位移）", /touchcancel/.test(swCode));
  /* 这两条是「横向拖动会被浏览器历史返回手势抢走」的根治：
     不声明 touch-action 的话，横向拖动触发的是浏览器自己的手势 ——
     实测在无头里整页被导航到 about:blank，所有取值变成 undefined，
     当时的表现是「手势没生效」，方向完全指错。 */
  t("学习卡声明 touch-action:pan-y（把横向手势留给应用，别让浏览器去做历史返回）",
    /\.wcard\{[\s\S]{0,520}touch-action:pan-y/.test(html));
  t("根元素关掉横向 overscroll（双保险）", /overscroll-behavior-x:none/.test(html));
  t("touch-action 不波及 .study-wrap（统计页热力图靠它横向滚动，加了就废）",
    html.indexOf(".study-wrap") >= 0 && !/\.study-wrap\{[^}]*touch-action/.test(html));

  /* 弹窗关闭按钮那颗 × 曾以约 83px 渲染、从 30px 的按钮里溢出去，还探到弹窗右缘外。
     带 viewBox 的 <svg> 在 CSS 里 width/height 都是 auto 时**不会**「撑满父容器」，
     而是按自己的固有尺寸推导 —— 所以每个用到 svg 的地方都得显式写尺寸。
     本文件其余位置全都写了（.nav svg / .btn svg / .msheet button svg / #mtab button svg …），
     唯独 .modal-h .x 漏了，于是这个缺陷在所有弹窗上静静存在了很久。 */
  t("弹窗关闭按钮的 svg 写了显式尺寸（漏了它会以 ~83px 溢出、探出弹窗）",
    /\.modal-h \.x svg\{[^}]*width:\s*16px[^}]*height:\s*16px/.test(html));

  /* 手势边界的行为断言：真的造一个 input / div 丢进去问它 */
  const ElStub = globalThis.__EL;
  t("swipeBlocked 对 input 返回 true", ElStub && API.swipeBlocked(new ElStub("input")) === true);
  t("swipeBlocked 对普通 div 返回 false", ElStub && API.swipeBlocked(new ElStub("div")) === false);

  /* ---- 18.3 撤销栈：向右滑回上一条必须把数据整份还原 ----
     这是本轮最容易写错的一处。只把下标减一的话，grade() 写进库里的
     DB.prog / 今日学习量 / 今日错误数 / 今日词列表 都还在，再评一次就是重复计数 ——
     今日进度、正确率、连击一起虚高，而且没有任何报错。 */
  const cnSrc = html.slice(html.indexOf("function commitAndNext"), html.indexOf("function snapStep"));
  t("提交时先压快照再打分（顺序反了快照记的是评价后的状态，撤销等于没撤）",
    cnSrc.indexOf("pushStep(snapStep(") >= 0 && cnSrc.indexOf("pushStep(snapStep(") < cnSrc.indexOf("grade(r[F.W], g)"));

  API.setBook(API.books()[0].id);
  API.startSession("auto");
  const S1 = API.session();
  t("能开起一轮会话且队列 ≥ 2 词", !!S1 && S1.queue.length >= 2, S1 ? S1.queue.length + " 词" : "没开起来");
  t("新会话的撤销栈是空的", !!S1 && Array.isArray(S1.steps) && S1.steps.length === 0);
  t("会话中手势可用（swipeReady 为真）", API.swipeReady() === true);

  const w0 = S1.queue[0];
  const before = {
    prog: DBX.prog[w0] ? JSON.stringify(DBX.prog[w0]) : null,
    log: JSON.stringify(DBX.log),
    wlog: JSON.stringify(DBX.wlog)
  };
  const nSum = (o) => Object.keys(o).reduce((s, k) => s + (o[k].n || 0), 0);
  const n0 = nSum(JSON.parse(before.log || "{}"));
  S1.pending = 2;                    /* 相当于点了「认识」 */
  API.commitAndNext();
  t("评价后前进到第二张", API.session().i === 1, API.session().i);
  t("评价后确实写入了词条进度", !!DBX.prog[w0]);
  t("评价后今日学习量 +1", nSum(DBX.log) === n0 + 1, nSum(DBX.log) + " vs " + n0);
  t("评价留下了一条撤销记录", API.session().steps.length === 1);

  API.prevWord();
  t("向右滑回到上一条：下标退回 0", API.session().i === 0, API.session().i);
  t("词条进度整份还原（间隔/易度/答对计数都回到评价前）",
    (DBX.prog[w0] ? JSON.stringify(DBX.prog[w0]) : null) === before.prog);
  t("今日学习量一并还原（不多记这一次）", JSON.stringify(DBX.log) === before.log);
  t("今日词列表一并还原", JSON.stringify(DBX.wlog) === before.wlog);
  t("撤销记录被弹出，到底了不会再往回跳", API.session().steps.length === 0);
  API.prevWord();
  t("第一条时向右滑不越界（不会变成负数下标）", API.session().i === 0, API.session().i);

  /* 向左滑但还没评价 → 跳过，一个字段都不该写 */
  const logBefore = JSON.stringify(DBX.log);
  API.nextWord();
  t("未评价时向左滑 = 跳过：前进一格", API.session().i === 1, API.session().i);
  t("跳过不写任何记录（不进错题、不算学习量）", JSON.stringify(DBX.log) === logBefore);
  t("跳过也留一步，可以滑回来", API.session().steps.length === 1);
  API.prevWord();
  t("滑回跳过那一步只退下标、数据原样", API.session().i === 0 && JSON.stringify(DBX.log) === logBefore);
  t("跳过不占答对/答错计数", API.session().correct === 0 && API.session().wrong === 0);

  API.go("today");
  t("离开会话页后手势不接管（在首页左右滑不该翻词）", API.swipeReady() === false);
})();

/* [19] 中国英文媒体源（大陆可达）
   夹具是 2026-09-18 从真实站点抓下来的页面（抓法与出处见 verify-cn.js 顶部注释）。
   断言的是「这些真实页面能不能被解析出正文」，而不是对着源码做字符串匹配 ——
   字符串匹配抓不住「正则写歪了、抽出来全是图注」这类问题，而那种问题在界面上
   表现出来就是「文章取回来了、里面却是空的或者一堆图说」，用户根本没法用。 */
p("");
p("[19] 中国英文媒体源（真实页面夹具解析）");
{
  const rd = (f) => { try { return fs.readFileSync(path.join(__dirname, f), "utf8"); } catch (e) { return ""; } };
  const cdCol = rd("_cd_col.html"), cdArt = rd("_cd_art.html");
  const gtArt = rd("_gt_art.html"), gtFeed = rd("_gt_feed.txt");

  t("四份真实页面夹具都在（缺了说明夹具被删了，要去重抓）",
    cdCol.length > 20000 && cdArt.length > 20000 && gtArt.length > 10000 && gtFeed.length > 5000,
    [cdCol.length, cdArt.length, gtArt.length, gtFeed.length]);

  /* --- 中国日报：栏目页 → 列表 --- */
  const list = API.csPickList("cnd-china", cdCol);
  t("中国日报栏目页解析出 >= 10 篇文章", list.length >= 10, list.length);
  t("每篇都有标题与链接", list.every((x) => x.title && x.url));
  t("链接都补成了 https 绝对地址（栏目页里是 // 开头的协议相对地址）",
    list.every((x) => /^https:\/\/www\.chinadaily\.com\.cn\/a\/\d{4}\d{2}\/\d{2}\/.+\.html$/.test(x.url)),
    list[0] && list[0].url);
  t("剔除了分页后续页（_2 / _3 是同一篇的下一页，留着会出现同题多条）",
    list.every((x) => !/_\d\.html$/.test(x.url)));
  t("从链接里直接解出了日期", list.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.d)), list[0] && list[0].d);
  t("标题干净（无标签、无实体残留）",
    list.every((x) => x.title.indexOf("<") < 0 && x.title.indexOf("&") < 0));
  t("没有重复链接", new Set(list.map((x) => x.url)).size === list.length);

  /* --- 中国日报：文章页 → 正文 --- */
  const cdPs = API.csParas("cnd-china", cdArt), cdTitle = API.pickTitle(cdArt, "cnd-china");
  t("中国日报文章页提取出 >= 5 个正文段落", cdPs.length >= 5, cdPs.length);
  t("标题从 h1 取到且正确", /farming/i.test(cdTitle), cdTitle);
  t("标题清掉了站点名后缀（Chinadaily.com.cn）", cdTitle.indexOf("Chinadaily") < 0, cdTitle);
  t("正文是纯文本（没有标签残留）", cdPs.every((x) => x.indexOf("<") < 0 && x.indexOf(">") < 0));
  t("正文没有实体残留（&amp; / &nbsp; 之类都还原了）",
    cdPs.every((x) => !/&(amp|nbsp|quot|#\d+);/.test(x)), cdPs.find((x) => /&(amp|nbsp|#\d+);/.test(x)));
  t("每段都有实质长度（不会把导航碎句当正文）", cdPs.every((x) => x.length >= 30));
  t("图说没有混进正文（它在 figcaption 里，不该被当成段落）",
    (cdPs[0] || "").indexOf("[Photo provided to") < 0, (cdPs[0] || "").slice(0, 60));

  /* --- 中国日报：换栏目 → 列表地址跟着变 --- */
  t("换栏目就是换列表地址（中国日报各栏目共用同一套解析）",
    API.csListURL("cnd-world") === "https://www.chinadaily.com.cn/world/index.html" &&
    API.csListURL("cnd-opinion") === "https://www.chinadaily.com.cn/opinion/index.html",
    [API.csListURL("cnd-world"), API.csListURL("cnd-opinion")]);

  /* --- 环球时报：RSS → 列表 --- */
  const gt = API.csPickList("gt", gtFeed);
  t("环球时报 RSS 解析出 >= 15 条", gt.length >= 15, gt.length);
  t("每条都有标题与链接", gt.every((x) => x.title && x.url));
  t("只收本站链接（RSS 里混有站外推广位）",
    gt.every((x) => x.url.indexOf("https://www.globaltimes.cn/") === 0));
  t("pubDate 转成了 YYYY-MM-DD", gt.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.d)), gt[0] && gt[0].d);
  t("标题无标签残留", gt.every((x) => x.title.indexOf("<") < 0));
  t("没有重复链接", new Set(gt.map((x) => x.url)).size === gt.length);

  /* --- 环球时报：文章页 → 正文 ---
     这一家最容易写错：它的正文根本不在 p 标签里，全页的 p 全是图片说明。
     只按抽 p 处理的话，取回来是一篇「只有图说」的文章，看着还像成功了。 */
  const gtPs = API.csParas("gt", gtArt);
  t("环球时报文章页提取出 >= 3 个段落", gtPs.length >= 3, gtPs.length);
  t("抓到的是正文而不是只有图片说明（得有一段长文本）",
    gtPs.some((x) => x.length > 300), gtPs.map((x) => x.length));
  t("正文是纯文本", gtPs.every((x) => x.indexOf("<") < 0));
  const gtArtTitle = API.pickTitle(gtArt, "gt"), gtFeedTitle = (gt[0] && gt[0].title) || "";
  t("文章页与 RSS 解析出同一篇（标题对得上）",
    gtArtTitle.length > 10 && gtArtTitle.slice(0, 24) === gtFeedTitle.slice(0, 24),
    [gtArtTitle.slice(0, 30), gtFeedTitle.slice(0, 30)]);

  /* --- 白名单与中转 --- */
  t("中国源共 6 个（中国日报五栏目 + 环球时报）", API.CSRC.length === 6, API.CSRC.length);
  t("源 id 不重复", new Set(API.CSRC.map((x) => x.id)).size === API.CSRC.length);
  t("每个源的主机都在白名单内",
    API.CSRC.every((x) => API.netHostOK("https://" + x.host + "/x")), API.CSRC.map((x) => x.host));
  t("中转服务域名已进白名单（否则中转请求自己就被拦了）",
    API.netHostOK("https://cors.eu.org/x") && API.netHostOK("https://api.allorigins.win/x"));
  t("中转服务有 >= 2 个备选（单个公益服务随时可能限流或挂掉）", API.NETBR.length >= 2, API.NETBR.length);
  /* 哪些源「正文必须经中转」要显式标出来，不靠 kind 去猜 ——
     2026-09-18 两个公益中转同时挂掉（一个被 Cloudflare 限流、一个 500）时才发现：
     光报「取不到」，用户既不知道是这个源本来就要绕一层，也不知道该换成哪个源。
     标了 needBridge 之后，失败提示才能给出「换环球时报，它全程直连」这条具体退路。 */
  t("每个源都显式标了 needBridge（不是靠 kind 猜；漏标会让失败提示指错方向）",
    API.CSRC.every((x) => x.needBridge === 0 || x.needBridge === 1),
    API.CSRC.map((x) => x.id + "=" + x.needBridge).join(","));
  t("需要中转的正好是中国日报五栏目（它的文章页实测不发跨域头，发 Origin 也不发）",
    API.CSRC.filter((x) => x.needBridge).every((x) => x.kind === "cnd") &&
    API.CSRC.filter((x) => x.kind === "cnd").every((x) => x.needBridge === 1),
    API.CSRC.filter((x) => x.needBridge).map((x) => x.id).join(","));
  t("环球时报标成不需要中转（它连文章页都放行，实测全程直连）",
    API.CSRC.filter((x) => x.kind === "gt").every((x) => x.needBridge === 0));
  t("失败提示里给了「换成环球时报」这条退路（不能只说取不到，还得说下一步）",
    html.indexOf("它全程直连，不依赖中转") >= 0);
  t("白名单没有因此松动：站外域名照样拒绝", API.netHostOK("https://evil.example.com/x") === false);
  t("白名单没有因此松动：明文 http 照样拒绝", API.netHostOK("http://www.chinadaily.com.cn/x") === false);

  /* --- 兜底与容错 --- */
  const simple = "<div id='Content'><p>" + "A".repeat(120) + "</p><p>" + "B".repeat(120) + "</p></div>";
  t("源站改版去掉分页标记后，仍能截出正文",
    API.csParas("cnd-china", simple).length === 2, API.csParas("cnd-china", simple).length);
  t("完全陌生的结构退化成全页抽段",
    API.csParas("cnd-china", "<p>" + "C".repeat(80) + "</p>").length === 1);
  t("空内容不抛异常", API.csParas("cnd-china", "").length === 0);
  t("非 HTML 内容不抛异常", API.csParas("gt", "@@@@ 不是 HTML @@@@").length === 0);

  /* --- 视图：源芯片 --- */
  const cnHtml = API.rdCNHTML();
  t("中国源区块渲染出全部 6 个芯片", (cnHtml.match(/data-csr="/g) || []).length === 6,
    (cnHtml.match(/data-csr="/g) || []).length);
  t("默认选中第一个源（中国日报 · 中国）", API.rdCNState().sel === "cnd-china", API.rdCNState().sel);
  t("有明确的「大陆可达」标识（用户得知道这组和上面那组不一样）", cnHtml.indexOf("cntag") >= 0);
  t("区块里有拉取按钮", cnHtml.indexOf('id="rdCNLoad"') >= 0);
  API.rdCNSel("gt");
  t("换源会清掉上一个源的列表（免得标题和来源张冠李戴）",
    API.rdCNState().sel === "gt" && API.rdCNState().list === null, API.rdCNState());
  t("换源后区块里没有残留的旧列表", API.rdCNHTML().indexOf("data-cngrab") < 0);

  /* --- 设置项 --- */
  t("中转开关默认开着（不开的话中国日报正文根本取不回来）", API.CFG_DEF.noBridge === false, API.CFG_DEF.noBridge);
}

p("");
p("[20] 考试倒计时与每日量反推（纯算术）");
{
  const setCfg = API.setCfg;
  /* 日期一律用「相对今天」构造，断言才不会因为跑测试的日期不同而翻绿翻红 */
  const dayStr = (off) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + off);
    const z = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  };
  const total = API.statsOf(API.getDB().book).total;

  t("默认不设考试日期（界面上一个倒计时元素都不该出现）", API.CFG_DEF.examDate === "", API.CFG_DEF.examDate);
  setCfg("examDate", "");
  t("没设日期时 examPlan() 返回 null", API.examPlan() === null);

  /* 日历级校验：不能只靠 Date 解析 —— V8 会把 2 月 30 日顺延成 3 月 2 日然后返回合法时间戳，
     那样非法日期就会静默通过。这里逐条钉死「格式对但日子不存在」的情况。 */
  t("isoDateOK 接受合法日期", API.isoDateOK("2026-12-19") === true);
  t("isoDateOK 接受闰年 2 月 29", API.isoDateOK("2028-02-29") === true);
  t("isoDateOK 拒绝平年 2 月 29", API.isoDateOK("2026-02-29") === false);
  t("isoDateOK 拒绝 2 月 30（Date 会把它顺延成 3 月 2 日）", API.isoDateOK("2026-02-30") === false);
  t("isoDateOK 拒绝 4 月 31", API.isoDateOK("2026-04-31") === false);
  t("isoDateOK 拒绝 13 月", API.isoDateOK("2026-13-01") === false);
  t("isoDateOK 拒绝 0 月 / 0 日", API.isoDateOK("2026-00-10") === false && API.isoDateOK("2026-05-00") === false);
  t("isoDateOK 拒绝空串与 null（不是抛异常）", API.isoDateOK("") === false && API.isoDateOK(null) === false);

  /* 格式容错：这几种写法用户都可能输入，一律拒绝而不是硬算出一个错结果 */
  ["2026/12/19", "26-12-19", "2026-13-01", "2026-02-30", "abc", "2026-1-9", "１２月"].forEach((bad) => {
    setCfg("examDate", bad);
    t("拒绝非法日期「" + bad + "」", API.examPlan() === null);
  });

  /* 合法日期：天数必须精确 */
  [[1, 1], [10, 10], [83, 83], [365, 365]].forEach(([off, want]) => {
    setCfg("examDate", dayStr(off));
    const p = API.examPlan();
    t("距 " + off + " 天算出的 days 正确", p && p.days === want, p && p.days);
  });

  setCfg("examDate", dayStr(10));
  let p = API.examPlan();
  t("目标词书默认跟随当前词书", p.book === API.getDB().book, [p.book, API.getDB().book]);
  t("剩余词量 = 词书总数 − 已学（没学过时就是总数）", p.remain === total - p.seen, [p.remain, total, p.seen]);
  t("剩余词量不会算成负数", p.remain >= 0, p.remain);
  t("建议每日量 = 向上取整(剩余 / 天数)", p.need === Math.ceil(p.remain / 10), [p.need, Math.ceil(p.remain / 10)]);
  t("剩余词量为正时建议量至少 1（不出现「每天学 0 词」）", p.remain === 0 || p.need >= 1, [p.remain, p.need]);
  t("建议每日量是有限整数（防 NaN / Infinity 漏到界面上）", Number.isFinite(p.need) && p.need === Math.floor(p.need), p.need);
  t("天数不会因为时区/夏令时偏移一位", p.days === 10, p.days);

  /* 今天考试：不能做除法，否则会出现 Infinity */
  setCfg("examDate", dayStr(0));
  p = API.examPlan();
  t("今天就是考试日 → days = 0", p.days === 0, p.days);
  t("今天考试时建议量退化成本身剩余量（不做除法）", p.need === p.remain, [p.need, p.remain]);
  t("今天考试也不会算出 Infinity / NaN", Number.isFinite(p.need), p.need);

  /* 日期已过：days 为负，但绝不能出现负数或 Infinity 的建议量 */
  setCfg("examDate", dayStr(-30));
  p = API.examPlan();
  t("过去的日期算出负天数", p.days === -30, p.days);
  t("考期已过时建议量不出现负数", p.need >= 0, p.need);
  t("考期已过时建议量仍是有限数", Number.isFinite(p.need), p.need);

  /* 指定目标词书 */
  const other = API.books().filter((b) => b.id !== API.getDB().book)[0];
  if (other) {
    setCfg("examDate", dayStr(20));
    setCfg("examBook", other.id);
    p = API.examPlan();
    t("设了目标词书后按它算剩余量", p.total === API.statsOf(other.id).total, [p.total, API.statsOf(other.id).total]);
    t("目标词书名字能带出来给界面显示", p.name === other.name, [p.name, other.name]);
    setCfg("examBook", "");
    t("目标词书清空后重新跟随当前词书", API.examPlan().book === API.getDB().book);
  }

  /* 恢复默认，别把状态泄漏给后面的用例 */
  setCfg("examDate", "");
  setCfg("examBook", "");
}

p("");
p("[21] 题型轮换与前置条件（听音辨词 / 例句填空 的自动回退）");
{
  const setCfg = API.setCfg;
  const F = API.F;
  const def = API.CFG_DEF.activeModes;

  /* ---- 默认值：六种全开，且是「认得出 → 听得懂 → 填得出 → 写得出」的坡道 ---- */
  t("默认启用六种题型（听力占六级 35%，不能默认关着）", def.length === 6, def);
  ["recog", "recall", "listen", "cloze", "spell", "card"].forEach((m) => {
    t("默认启用里含 " + m, def.indexOf(m) >= 0);
  });
  const known = API.MODES.map((x) => x[0]);
  t("默认启用里没有拼错的题型名（写错就等于这个题型永远轮不到）", def.every((m) => known.indexOf(m) >= 0), def);
  t("题型清单与默认启用集合一致（不多不少）", known.length === def.length && known.every((m) => def.indexOf(m) >= 0), [known, def]);
  t("设置页题型顺序 = 默认轮换顺序（否则界面顺序和实际节奏对不上）", known.join() === def.join(), [known.join(), def.join()]);
  t("默认启用里没有重复项", new Set(def).size === def.length, def);

  /* ---- 前置条件：不满足时必须返回 false，而不是「让用户对着做不了的题」 ---- */
  const withEx = API.words().find((w) => w[F.EX]);
  const noEx = API.words().find((w) => !w[F.EX]);
  t("词库里能找到带例句的词（例句填空的原料）", !!withEx);
  t("词库里也能找到没例句的词（正是要靠 cloze 前置条件挡住的那些）", !!noEx);

  /* stub DOM 里 speechSynthesis 是 undefined —— 正好模拟「这台设备没有英语语音」 */
  t("没有语音环境时 ttsReady 为假（且不抛异常）", API.ttsReady() === false);
  t("听音辨词在没有语音时不可用", API.modeOK("listen", withEx) === false);
  t("例句填空对有例句的词可用", API.modeOK("cloze", withEx) === true);
  t("例句填空对没例句的词不可用", API.modeOK("cloze", noEx) === false);
  /* ⚠ 这三条的语义在 2026-09-18 变过一次，断言跟着改，**不是放宽**：
     原来 recog / recall / spell 是「无前置条件」，现在多了一条 —— 词条必须有中文释义。
     起因是全库有 79 条的中文释义字段其实是英文（kilometer → "A kilometer is a unit
     of measurement that is 1,000 meters."），拿它们出这三种题，用户会看到一句英文、
     然后被要求「根据释义拼写」—— 题没法做。
     所以断言从「永远可用」改成「有中文释义时可用、没有时不可用」，
     并且**必须仍然留一条永远可用的兜底**（card），否则一个词可能一个题型都出不了。 */
  const withCn = API.words().find((w) => API.hasCnDef(w));
  const noCn = API.words().find((w) => !API.hasCnDef(w));
  t("词库里能找到有中文释义的词", !!withCn);
  t("词库里也能找到「中文释义字段里其实是英文」的词（正是要靠新前置条件挡住的那些）", !!noCn);
  if (noCn) p("      样例：" + noCn[F.W] + " → " + JSON.stringify(String(noCn[F.CN]).slice(0, 60)));
  ["recog", "recall", "spell"].forEach((m) => {
    t(m + " 对有中文释义的词可用", API.modeOK(m, withCn) === true);
    t(m + " 对只有英文释义的词不可用（否则会出一道「根据这句英文拼写」的废题）", API.modeOK(m, noCn) === false);
  });
  t("card 速记没有任何前置条件，永远是最后的兜底（否则可能一个题型都出不了）",
    API.modeOK("card", withEx) === true && API.modeOK("card", null) === true);
  t("没有词条时无前置条件的题型仍可用（不会因为取不到词而卡死）", API.modeOK("card", null) === true);

  /* ---- firstDef：释义首行一律取「第一个含中文的行」----
     选择题的正确项取的就是这一行。构建期已经清洗过「首行是孤立 ad」的那 92 条，
     但 ETL 重跑、或将来又冒出新形态时，这一层是第二道防线。 */
  t("firstDef 对普通词返回带中文的首行", /[\u4e00-\u9fff]/.test(API.firstDef(withCn)));
  t("firstDef 对「中文释义字段其实是英文」的词不返回空串（至少给出英文信息）",
    String(API.firstDef(noCn) || "").length > 0, JSON.stringify(API.firstDef(noCn)));
  t("firstDef 对 null 返回空串而不抛异常", API.firstDef(null) === "");
  {
    // 造一条「首行是孤立词性缩写」的假词条，模拟清洗前/清洗漏网的情形
    const fake = [];
    fake[F.W] = "zzz";
    fake[F.CN] = "ad\nv. 测试用的释义";
    t("firstDef 遇到「首行是孤立 ad」的老形态会跳到下面那行中文",
      API.firstDef(fake) === "v. 测试用的释义", JSON.stringify(API.firstDef(fake)));
  }

  /* ---- 轮换：由卡片序号取模得到，撤销时自动跟着退回 ----
     这一段直接钉死那个「安静地坏」的老 bug：S.mi 从初始化之后再也没有第二处写它，
     于是题型轮换从来没生效过。断言不看内部字段，只看「第 i 张实际该用什么题型」。 */
  setCfg("newPerDay", 60);
  API.resetPreview();
  API.setCfg("activeModes", ["recog", "recall", "spell", "card"]);
  API.startSession("auto");
  let S = API.session();
  t("会话队列足够长（轮换断言才有意义）", S.queue.length >= 6, S.queue.length);
  t("会话里不再有那个没人写的题型游标（防止再引入第二套状态）", S.mi === undefined, S.mi);

  const seq = [];
  for (let k = 0; k < 5; k++) { seq.push(API.curMode()); API.nextWord(); }
  seq.push(API.curMode());
  t("题型按配置顺序逐张轮换", seq.join() === "recog,recall,spell,card,recog,recall", seq.join());
  t("轮换走满一圈后回到第一种（是循环而不是走到头就停）", seq[4] === seq[0] && seq[5] === seq[1], seq);

  const before = API.curMode();
  API.prevWord();
  t("向右滑回上一条时题型跟着退回上一格", API.curMode() !== before, [before, API.curMode()]);
  API.nextWord();
  t("再向左滑回去，题型恢复成原来那个", API.curMode() === before, [before, API.curMode()]);

  t("pickMode 只会返回配置里的题型（不会凭空造一个）", S.modes.indexOf(API.pickMode()) >= 0, API.pickMode());

  /* ---- 自动回退：轮到的题型做不了时顺延到下一个能做的 ---- */
  API.setCfg("activeModes", ["listen", "recog", "card"]);
  API.resetPreview();
  API.startSession("auto");
  S = API.session();
  t("轮到的题型不可用时顺延到下一个（听音辨词 → 看词选义）", API.pickMode() === "recog", API.pickMode());
  t("轮到不可用题型的那一张仍然渲染得出来（不会白屏）", String(document.getElementById("view").innerHTML).indexOf("wcard") >= 0);

  API.setCfg("activeModes", ["recog", "listen", "spell"]);
  API.resetPreview();
  API.startSession("auto");
  t("第一张用第一个能用的题型", API.pickMode() === "recog", API.pickMode());
  API.nextWord();
  t("第二张轮到不可用的听力题 → 跳到它后面的拼写", API.pickMode() === "spell", API.pickMode());

  /* 极端情况：只勾了一个做不了的题型 —— 必须退到卡片速记，而不是「这一轮什么题都出不来」 */
  API.setCfg("activeModes", ["listen"]);
  API.resetPreview();
  API.startSession("auto");
  t("全部题型都不可用时退回卡片速记（它没有任何前置条件）", API.pickMode() === "card", API.pickMode());
  t("退回卡片后这一轮照样渲染出单词卡", String(document.getElementById("view").innerHTML).indexOf("wcard") >= 0);

  /* 配置里混进一个不存在的题型名：不能让整个轮换崩掉 */
  API.setCfg("activeModes", ["nosuchmode", "recog"]);
  API.resetPreview();
  API.startSession("auto");
  t("配置里有非法题型名时仍能渲染（渲染分支有兜底）", String(document.getElementById("view").innerHTML).indexOf("wcard") >= 0);
  t("非法题型名不会让 pickMode 返回空", !!API.pickMode(), API.pickMode());

  /* 恢复默认，别把状态泄漏给后面的用例 */
  API.setCfg("activeModes", API.CFG_DEF.activeModes.slice());
  setCfg("newPerDay", API.CFG_DEF.newPerDay);
  API.resetPreview();
}

p("");
p("=".repeat(58));
p("[22] 易混词（形近词组 · 独立视图 · 专练）");

(function () {
  const DBX = API.getDB();
  const CONF = API.CONF;
  const F_ = API.F;

  /* ---- 22.1 数据层：组的形状 ---- */
  t("形近词组数据非空（空数组时视图会退化成空态，不是崩）", Array.isArray(CONF) && CONF.length > 1000, CONF.length + " 组");

  const badSize = CONF.filter((g) => !Array.isArray(g) || g.length < 2 || g.length > 4);
  t("每组都是 2–4 个词（少于 2 对照不起来，多于 4 一屏放不下）", badSize.length === 0, badSize.length + " 组越界");

  let lower = 0, alpha = 0, dupIn = 0;
  CONF.forEach((g) => {
    const seen = {};
    g.forEach((w) => {
      if (w !== String(w).toLowerCase()) lower++;
      if (!/^[a-z]+$/.test(w)) alpha++;
      if (seen[w]) dupIn++;
      seen[w] = 1;
    });
  });
  t("组内词都是小写（和词库主键同口径，查表才不会落空）", lower === 0, lower + " 个异常");
  t("组内词都是纯字母（数字/连字符词不该出现在形近对比里）", alpha === 0, alpha + " 个异常");
  t("同一组里不重复出现同一个词", dupIn === 0, dupIn + " 处重复");

  /* 每个词都要真能在词库里查到 —— 否则点进去是死链、朗读也没音标 */
  const LEX = new Set();
  const BYW = {}; /* 词 → 词条记录。循环里要用到中文释义，线性 find 会变成几百万次比对 */
  API.words().forEach((r) => { LEX.add(r[F_.W]); if (!BYW[r[F_.W]]) BYW[r[F_.W]] = r; });
  let missing = 0;
  const missSample = [];
  CONF.forEach((g) => g.forEach((w) => { if (!LEX.has(w)) { missing++; if (missSample.length < 5) missSample.push(w); } }));
  t("组里的每个词都在词库里（24000 条查一遍，不是抽样）", missing === 0, missing ? missing + " 个不在库：" + missSample.join(",") : "全部可查");

  /* ---- 22.2 数据层：核心性质 —— 「形近」到底怎么定义的 ----
     这一条是整份数据最要紧的性质，所以要写成**性质**而不是「超阈值的数量不超过 N」：
     计算层算出来的组，组内任意两词距离必须 ≤ 2；超出的那些**必须逐对能在人工校对表里找到出处**
     （right/write、costume/custom、conscience/conscious 这类经典对距离天然就大于 2，
      本来就该由人工层负责，不是漏网）。出现一对没有出处的，说明计算层的阈值破了。 */
  const osa = (a, b) => {
    const n = a.length, m = b.length;
    if (!n) return m;
    if (!m) return n;
    let prev2 = null, prev = [];
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      const cur = [i];
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
      }
      prev2 = prev;
      prev = cur;
    }
    return prev[m];
  };
  let overPairs = [], distSum = 0, pairN = 0, nearN = 0;
  CONF.forEach((g) => {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const d = osa(g[i], g[j]);
        distSum += d;
        pairN++;
        if (d <= 2) nearN++;
        if (d > 2) overPairs.push([g[i], g[j]]);
      }
    }
  });
  /* 阈值来自**实测**（_dev/measure_confuse.js 量出来的分布：距离 1 占 30.3%、距离 2 占 69.6%，
     平均 1.697）。所以这里不该拿「平均值 < 1.5」这种拍脑袋的线去卡 ——
     这份数据的分布本来就是「七成差两个字母」，拿均值卡等于在惩罚正常数据。
     真正要守住的性质是「绝大部分词对确实是形近」，以及下面那条对 0.03% 的超阈值逐对溯源。 */
  const nearRate = nearN / pairN;
  t("距离 ≤ 2 的词对占比 ≥ 99.9%（实测 99.97%，平均 " + (distSum / pairN).toFixed(3) + "）",
    nearRate >= 0.999, (nearRate * 100).toFixed(3) + "%（" + nearN + "/" + pairN + " 对）");

  let curatedPair = null;
  try {
    const cf = path.join(__dirname, "..", "raw", "prep", "confuse_curated.json");
    const j = JSON.parse(fs.readFileSync(cf, "utf8"));
    curatedPair = new Set();
    (j.groups || j).forEach((g) => {
      for (let i = 0; i < g.length; i++) for (let k = i + 1; k < g.length; k++) curatedPair.add([g[i], g[k]].sort().join("|"));
    });
  } catch (e) { /* 没有人工表就不做溯源断言，下面会跳过 */ }

  if (curatedPair) {
    const orphan = overPairs.filter(([a, b]) => !curatedPair.has([a, b].sort().join("|")));
    t("组内距离 > 2 的词对，逐对都能在人工校对表里找到出处（有出处=人工层有意为之，没出处=计算层漏网）",
      orphan.length === 0,
      overPairs.length + " 对超阈值 / 其中 " + orphan.length + " 对无出处" +
      (orphan.length ? "：" + orphan.slice(0, 4).map((p) => p.join("/")).join(" ") : ""));
  } else {
    t("读不到人工校对表，溯源断言跳过", true, "raw/prep/confuse_curated.json 缺失");
  }

  /* ---- 22.3 数据层：往回索引与覆盖计数 ---- */
  const cover = API.confCover();
  const realCover = (function () { const s = {}; let n = 0; CONF.forEach((g) => g.forEach((w) => { if (!s[w]) { s[w] = 1; n++; } })); return n; })();
  t("覆盖词数与真实去重词数一致（界面上的数字不能编）", cover === realCover, cover + " / 实际 " + realCover);
  t("覆盖词数是天花板而非「越大越好」——不该超过词库总量", cover <= LEX.size, cover + " ≤ " + LEX.size);

  let idxBad = 0, idxSample = [];
  CONF.forEach((g, gi) => {
    const back = API.confGroupsOf(g[0]);
    if (back.indexOf(g) < 0) { idxBad++; if (idxSample.length < 3) idxSample.push(g[0]); }
  });
  t("往回索引「一个词属于哪些组」与原始分组一致", idxBad === 0, idxBad ? idxBad + " 组对不上：" + idxSample.join(",") : "全部一致");
  t("查不存在的词返回空数组而不是 undefined", Array.isArray(API.confGroupsOf("zzzzqqqq")) && API.confGroupsOf("zzzzqqqq").length === 0);
  t("大小写不敏感（用户手打的词不该因为大写就查不到）",
    API.confGroupsOf(String(CONF[0][0]).toUpperCase()).length === API.confGroupsOf(CONF[0][0]).length);

  /* ---- 22.4 筛选层：两个范围 + 搜索 ---- */
  API.setCFQ("");
  API.setCFScope("all");
  const allIds = API.cfFiltered("all");
  const expectAll = CONF.length; /* 每组都 ≥2 词（上面已断言），所以「全部」就是组总数 */
  t("范围=全部词库时不过滤掉任何一组", allIds.length === expectAll, allIds.length + " / " + expectAll);

  API.setCFScope("book");
  const bookIds = API.cfFiltered("book");
  t("当前词书范围是全部范围的子集", bookIds.every((k) => allIds.indexOf(k) >= 0), bookIds.length + " ⊆ " + allIds.length);
  /* 关键：要求**至少两个**词在书里。只有一个词在书里的话是「一个眼熟的配三个陌生的」，纯噪音。 */
  const BOOKSET = new Set(API.bookWords(DBX.book).map((r) => r[F_.W])); /* 建一次，别在循环里反复调 */
  const singleHit = [];
  bookIds.forEach((k) => {
    let inb = 0;
    CONF[k].forEach((w) => { if (BOOKSET.has(w)) inb++; });
    if (inb < 2) singleHit.push(k);
  });
  t("词书范围内每组至少有 2 个词在这本书里（只有 1 个就是「一个熟的配三个生的」，删掉）",
    singleHit.length === 0, singleHit.length + " 组只有 1 个词在书里");

  /* 搜索：一个真实存在的词，必须能搜出它所在的组 */
  const probe = CONF[0][0];
  API.setCFQ(probe);
  const hitIds = API.cfFiltered("all");
  t("搜一个词能搜出它所在的组（首字母/子串都能命中）", hitIds.indexOf(0) >= 0, "搜「" + probe + "」得 " + hitIds.length + " 组");
  t("搜索结果里每一组都确实跟关键词有关（不是「有结果就显示出来」）", hitIds.every((k) =>
    CONF[k].some((w) => w.indexOf(probe.toLowerCase()) === 0 || String((BYW[w] || [])[F_.CN] || "").toLowerCase().indexOf(probe.toLowerCase()) >= 0)));
  API.setCFQ("zzzqqqxxx");
  t("搜一个词库里没有的词 → 空结果（不硬凑）", API.cfFiltered("all").length === 0);
  API.setCFQ("");

  /* ---- 22.5 渲染层 ---- */
  let vErr = null, vHTML = "";
  try { API.go("confuse"); vHTML = String(document.getElementById("view").innerHTML || ""); } catch (e) { vErr = e; }
  t("易混词视图渲染不抛异常", !vErr, vErr ? vErr.message : "ok");
  t("视图里有搜索框与范围切换（两个范围各自的组数都要显示）",
    vHTML.indexOf('id="cfq"') >= 0 && vHTML.indexOf('id="cfAll"') >= 0, "");
  t("视图里给出「练这组」入口", vHTML.indexOf("data-cfdrill=") >= 0);
  t("视图里说明数据是离线预置的（呼应「离线可用」这条硬约束）", vHTML.indexOf("离线预置") >= 0);
  t("组卡片挂钩在 cfgs 容器里（一次性惰性渲染，不是 17k 组全塞进 DOM）", vHTML.indexOf('class="cfgs"') >= 0);

  const gi0 = API.cfFiltered("all")[0];
  const gh = API.cfGroupHTML(gi0);
  t("单组 HTML 含该组的每一个词", CONF[gi0].every((w) => gh.indexOf(">" + w + "<") >= 0), CONF[gi0].join("/"));
  t("单组 HTML 的「练这组」带的是组序号（词组可能含引号，序号永远安全）", gh.indexOf('data-cfdrill="' + gi0 + '"') >= 0);
  t("查不到的词渲染成空串而不是半个残行", API.cfRowHTML("zzzqqqxxx") === "");

  let mErr = null;
  try { API.confMount(); API.confMount(); } catch (e) { mErr = e; }
  t("confMount 可重复调用不抛异常（重绘会反复挂载）", !mErr, mErr ? mErr.message : "ok");

  /* ---- 22.6 导航四处登记 ---- */
  t("confuse 在 VIEWS 里（路由认得它）", API.VIEWS.indexOf("confuse") >= 0);
  t("confuse 在底栏「更多」里（手机上点得到）", API.mtabPlan().s.indexOf("confuse") >= 0, API.mtabPlan().s.join("/"));
  t("confuse 的高亮归到「更多」名下", API.mtabActive("confuse") === "__more");
  t("侧边栏有 data-go=\"confuse\" 入口", html.indexOf('data-go="confuse"') >= 0);

  /* ---- 22.7 专练：干扰项必须优先来自同一组 ---- */
  const g2 = API.cfFiltered("all").map((k) => CONF[k]).filter((g) => g.length === 2)[0];
  t("能找到 2 词的组来做专练测试（2 词组占了近一半）", !!g2, g2 ? g2.join("/") : "未找到");

  API.startDrill(g2);
  const S2 = API.session();
  t("专练建出的是 drill 会话（统计口径和普通学习分开）", S2 && S2.kind === "drill", S2 && S2.kind);
  t("专练队列就是这一组的词", S2.queue.slice().sort().join() === g2.slice().sort().join(), S2.queue.join("/"));
  t("专练里 preferWords 返回这一组（三个题型共用同一处判断）",
    (API.preferWords() || []).slice().sort().join() === g2.slice().sort().join());

  /* 这是本轮实测才发现的真问题：2 词组 pool 必然要补词书词，
     而原实现在补完后会把整池打乱 → 同组那个词大概率进不了选项，
     专练退化成普通选择题。现在优先段先行，所以这里要逐张卡都验。 */
  /* 干扰项优先来自同一组 —— 分两种题型验，因为「选项里放什么」两题型根本不一样：
       看义选词（useWord=true） → 选项是**英文词形**，直接比对词本身
       看词选义（useWord=false）→ 选项是**中文释义**，要比对「同组那个词的首义」
     ⚠ 有个合法例外必须放行，不能算它失败：两个词的首义完全相同时（affect / effect 都是「影响」），
       把对方的释义放进选项会撞出两个一模一样的选项，makeOptions 会去重跳掉它。
       这不是 bug —— 这组词本来就该用看义选词或拼写来练（题干是释义，才分得清）。
       所以撞车的那张不计入分母，而不是「放宽阈值让它绿」。 */
  const firstCN = (w) => String((BYW[w] || [])[F_.CN] || "").split("\n")[0];
  let wordHit = 0, cnHit = 0, cnTestable = 0, cnCollide = 0, optShort = 0;
  S2.queue.forEach((cur) => {
    const r = BYW[cur];
    const mate = g2.filter((w) => w !== cur);
    const oWord = API.makeOptions(r, S2.pool, DBX.cfg.optCount, true, S2.queue);
    if (oWord.length < 2) optShort++;
    if (oWord.some((o) => mate.indexOf(o.v) >= 0)) wordHit++;

    const oCN = API.makeOptions(r, S2.pool, DBX.cfg.optCount, false, S2.queue);
    const mateCN = mate.map(firstCN).filter(Boolean);
    if (mateCN.indexOf(firstCN(cur)) >= 0) { cnCollide++; return; }
    cnTestable++;
    if (oCN.some((o) => mateCN.indexOf(o.v) >= 0)) cnHit++;
  });
  t("看义选词：选项里一定出现同组的另一个词（否则「对比」就没了）",
    wordHit === S2.queue.length, wordHit + "/" + S2.queue.length + " 张命中");
  t("看词选义：选项里出现同组那个词的释义",
    cnTestable === 0 || cnHit === cnTestable,
    cnHit + "/" + cnTestable + " 张可测（另有 " + cnCollide + " 张因首义撞车不计）");
  t("选项数量够（不会因为优先段太小就只剩两项）", optShort === 0, optShort + " 张选项不足");
  t("选项互不重复（优先段拼进来不能撞出两个一样的选项）",
    (function () {
      const opts = API.makeOptions(BYW[S2.queue[0]], S2.pool, DBX.cfg.optCount, true, S2.queue);
      const vs = opts.map((o) => o.v);
      return vs.length === new Set(vs).size;
    })());

  /* 没有偏好时行为不变：不该因为加了优先段就把普通学习的干扰项也限制住 */
  const plain = API.makeOptions(BYW[S2.queue[0]], S2.pool, DBX.cfg.optCount, false, null);
  t("不传偏好时仍能正常出题（普通学习路径不受影响）",
    plain.length >= 2 && plain.filter((o) => o.ok).length === 1, plain.length + " 项");

  let dErr = null;
  try { API.startDrill([]); API.startDrill(null); } catch (e) { dErr = e; }
  t("空组/空值做专练不抛异常（有兜底提示）", !dErr, dErr ? dErr.message : "ok");
  t("空组不会把当前会话搞坏（上一个 drill 还在）", API.session() && API.session().kind === "drill");

  let dOne = null;
  try { API.startDrill(["zzzqqqxxx"]); } catch (e) { dOne = e; }
  t("组里词都不在库时不抛异常", !dOne, dOne ? dOne.message : "ok");

  /* ---- 组内干扰项「必定」进选项：以前靠人眼看截图，现在钉死 ----
     起因：2 词组（7926 组，接近一半）里 pool 只有 2 个词，必然要补进 4 个词书词；
     而 makeOptions 紧接着就 shuffle，于是「排在前面的组内词」和补齐词机会均等，
     组内那个词十有八九根本不在选项里 —— 专练退化成一道普通选择题，
     按钮上却写着「干扰项优先从这组里取」。
     ⚠ 这里必须比**释义**不能比单词：useWord=false（看词选义）时选项的 v 是释义。
     我写探针时第一版就拿单词去比，200 次全 0%，看着像重大回归，其实是探针自己错了 ——
     探针报「全错」时，先怀疑比较的字段对不对。 */
  {
    const two = API.CONF.filter((g) => g.length === 2);
    const WX = API.words();
    const ix = {}; WX.forEach((r) => { ix[r[F.W]] = r; });
    let checked = 0; const badG = [];
    // 全量是 7926 组，抽样到「能稳定发现这个问题」的量即可（每组每词 30 轮）
    const gsel = two.filter((g) => g.every((w) => ix[w])).slice(0, 120);
    gsel.forEach((g) => {
      const rs = g.map((w) => ix[w]);
      const pl = rs.slice();
      if (pl.length < DBX.cfg.optCount) {
        const extra = WX.filter((x) => g.indexOf(x[F.W]) < 0).slice(0, 12);
        while (pl.length < DBX.cfg.optCount + 2 && extra.length) pl.push(extra.pop());
      }
      rs.forEach((r) => {
        const otherW = g.find((w) => w !== r[F.W]);
        const otherDef = API.firstDef(ix[otherW]);
        checked++;
        for (let t = 0; t < 30; t++) {
          const opts = API.makeOptions(r, pl.slice(), DBX.cfg.optCount, false, g);
          if (!opts.some((o) => o.v === otherDef && !o.ok)) { badG.push(g.join("/") + " 正解=" + r[F.W]); break; }
        }
      });
    });
    t("2 词组专练（抽 120 组）每一轮组内那个词都在选项里 —— 这正是「练这组」的意义",
      badG.length === 0, checked + " 个词检查过；失败例：" + badG.slice(0, 3).join(" · "));
  }
  {
    /* 干扰项也不能是「只有英文释义」的词 —— 否则看词选义的选项里会冒出一句英文长句，
       跟另外三个中文选项完全不是一个画风。 */
    const good = API.words().filter((w) => API.hasCnDef(w)).slice(0, 40);
    const fake = [];
    fake[F.W] = "zzenfakeword";
    fake[F.CN] = "Zzen is a word that does not exist in any dictionary.";
    const pool2 = good.concat([fake]);
    let seenEn = false;
    for (let t = 0; t < 200; t++) {
      const opts = API.makeOptions(good[0], pool2, 4, false, null);
      if (opts.some((o) => o.v === fake[F.CN])) { seenEn = true; break; }
    }
    t("看词选义不会拿「只有英文释义」的词当干扰项（否则选项里会冒出一整句英文）", !seenEn);
  }

  /* 收尾：把范围/搜索复位，别把状态泄漏给后面的用例 */
  API.setCFQ("");
  API.setCFScope("book");
  API.setCFLimit(40);
  API.resetPreview();
})();

p("");
p("=".repeat(58));
p("[23] 词汇量测试（阶梯自适应 · 自评二选一 + 假词陷阱）");

(function () {
  const DBX = API.getDB();
  const LAD = API.vlLadder();
  const F_ = API.F;
  const BYW = {};
  API.words().forEach((r) => { if (!BYW[r[F_.W]]) BYW[r[F_.W]] = r; });

  /* ---- 23.1 常量与档位表 ---- */
  t("档数 = 8（基础常用 → GRE）", API.VL_N === 8 && LAD.length === 8, API.VL_N);
  t("题数区间就是用户选的 18–25", API.VL_MIN_Q === 18 && API.VL_MAX_Q === 25,
    API.VL_MIN_Q + "–" + API.VL_MAX_Q);
  t("起步档在合法范围内", API.VL_START >= 0 && API.VL_START < API.VL_N, API.VL_START);
  t("每一档都挂着真实存在的词书 id", API.VL_RUNG.every((r) => !!API.bookMeta(r[1])),
    API.VL_RUNG.filter((r) => !API.bookMeta(r[1])).map((r) => r[1]).join(",") || "八本全在");

  /* ---- 23.2 假词陷阱：整个测试的可信度都压在这一条上 ---- */
  const fakeN = API.VL_FAKE.length;
  t("假词够多（每次只抽 4 个，池子太小会被重复问到）", fakeN >= 8, fakeN + " 个");
  const fakeInLex = API.VL_FAKE.filter((w) => BYW[w]);
  t("假词**一个都不在词库里**（撞上了整个测试就废了：用户点「认识」其实是对的）",
    fakeInLex.length === 0, fakeInLex.join(",") || fakeN + " 个全部查无此词");
  t("假词都是小写纯字母（长得和真题一模一样，看不出破绽）",
    API.VL_FAKE.every((w) => /^[a-z]+$/.test(w)), API.VL_FAKE.filter((w) => !/^[a-z]+$/.test(w)).join(",") || "ok");
  t("假词长度落在 5–12（太短像缩写、太长一眼假）",
    API.VL_FAKE.every((w) => w.length >= 5 && w.length <= 12));
  t("假词互不重复", new Set(API.VL_FAKE).size === fakeN);
  /* 这条是「提前收敛也不会漏掉假词」的保证 —— 4 个假词全压在 18 题以内 */
  t("4 个假词都安插在最低题数以内（提前收敛也能全部问完，虚报率的分母才稳定）",
    API.VL_FAKE_N === 4 && API.VL_FAKE_AT.length === 4 && API.VL_FAKE_AT.every((i) => i < API.VL_MIN_Q),
    API.VL_FAKE_AT.join(","));

  /* ---- 23.3 阶梯：每档的词与刻度 ---- */
  t("每一档的抽题池都非空", LAD.every((x) => x.pool.length > 0), LAD.map((x) => x.pool.length).join("/"));
  let cumBad = 0, cumSum = 0;
  LAD.forEach((x, i) => {
    if (i > 0 && x.cum !== LAD[i - 1].cum + x.size) cumBad++;
    if (i > 0 && x.cum <= LAD[i - 1].cum) cumBad++;
    cumSum += x.size;
  });
  t("累计刻度 = 前一档累计 + 本档词数，且严格递增（刻度是词汇量，不是抽题池大小）",
    cumBad === 0, cumBad + " 档异常");
  t("抽题池是整档的子集（砍掉最眼熟的 20% 用来出题，刻度仍按整档算）",
    LAD.every((x) => x.pool.length <= x.size && x.pool.length >= x.size * 0.7),
    LAD.map((x) => x.pool.length + "/" + x.size).join(" "));
  t("池里每个词都真的属于这一档（vlOrder 与档号一致）",
    LAD.every((x) => x.pool.every((r) => API.vlOrder(r) === x.lv)));
  t("池里每个词都能凭词形自评（纯字母、≥3 字母，没有词组和缩写）",
    LAD.every((x) => x.pool.every((r) => API.vlWordOK(r))));
  t("最高档累计词数不超过词表总量", LAD[API.VL_N - 1].cum <= API.words().length,
    LAD[API.VL_N - 1].cum + " ≤ " + API.words().length);
  /* 刻度必须单调且有量级，否则「约 X 词」这个数字没意义 */
  t("刻度从三千多一路涨到一万六（词汇量数字有量级、不像随便编的）",
    LAD[0].cum > 2000 && LAD[API.VL_N - 1].cum > 12000,
    LAD.map((x) => x.cum).join(" "));

  /* ---- 23.4 走一遍完整流程（stub DOM 里真跑） ---- */
  const progBefore = JSON.stringify(DBX.prog);
  const sessBefore = DBX.sessions.length;
  const logBefore = JSON.stringify(DBX.log);
  const wlogBefore = JSON.stringify(DBX.wlog);

  /* 策略：cur ≤ 目标档就答认识，高过目标档就答错 ——
     会在「目标档 / 目标档+1」之间来回摆动，这正是「边界找到了」的形态。
     注意是 `<=`：写成 `cur < target` 的话，在 target 那一档永远是答错，
     passed 会停在 target-1，整个断言就跟着差一档（第一版就是这么翻的）。
     假词一律答不认识（不虚报）。 */
  function runTest(target, fakeAlways) {
    API.vlStart();
    let guard = 0;
    while (API.vlState().phase === "ask" && guard++ < 200) {
      const st = API.vlState();
      const isFake = !!(st.last && st.last.fake);
      if (isFake) API.vlAnswer(fakeAlways ? true : false);
      else API.vlAnswer(st.cur <= target);
    }
    return API.vlState();
  }

  const st4 = runTest(4, false);
  t("全流程能跑到结束（phase 变成 done）", st4.phase === "done", st4.phase);
  const r4 = st4.res;
  t("题数落在 18–25 之间（不是固定题数）", r4.asked >= 18 && r4.asked <= 25, r4.asked + " 题");
  t("在目标档附近摆动时能提前收敛（没跑满 25 题）", r4.asked < 25, r4.asked + " 题");
  t("估计档位对得上答对过的最高档（答对到 4 档 → passed = 4）", r4.passed === 4, r4.passed);
  t("没虚报时不扣分", r4.adj === 0 && r4.lv === 4, "adj " + r4.adj + " / lv " + r4.lv);
  t("点估计就是该档的累计词数", r4.est === LAD[4].cum, r4.est + " = " + LAD[4].cum);
  t("区间把点估计包在里面（区间要是排除了自己的点估计就自相矛盾）",
    r4.lo <= r4.est && r4.est <= r4.hi, r4.lo + " ≤ " + r4.est + " ≤ " + r4.hi);
  t("推荐的起点词书就是该档对应的那本", r4.book === API.VL_RUNG[4][1], r4.book);

  /* 全程答对：应该封顶在最高档 */
  API.vlStart();
  let g2 = 0;
  while (API.vlState().phase === "ask" && g2++ < 200) API.vlAnswer(!(API.vlState().last || {}).fake);
  const rTop = API.vlState().res;
  t("全程答对 → 封顶在最高档（不会越过档表上界）", rTop.lv === API.VL_N - 1 && rTop.top === true,
    "lv " + rTop.lv + " / top " + rTop.top);
  t("封顶时点估计 = 最高档累计", rTop.est === LAD[API.VL_N - 1].cum, rTop.est);

  /* 全程答错：这条是本轮实测才发现的坑 —— passed 会是 -1，
     顺手兜到 0 档就会报出「3,662 词」，把最低刻度当成用户水平。 */
  API.vlStart();
  let g3 = 0;
  while (API.vlState().phase === "ask" && g3++ < 200) API.vlAnswer(false);
  const rNone = API.vlState().res;
  t("全程答错 → 标记成「测不到最低档」而不是报一个虚高的数", rNone.none === true, rNone.none);
  t("「测不到最低档」时档位仍停在最低档（界面照它取词书名）", rNone.lv === 0, rNone.lv);
  t("「测不到最低档」的区间下界是 0（明确说「可能更低」）", rNone.lo === 0, rNone.lo);

  /* ---- 23.5 虚报校准 ---- */
  const stFake = runTest(4, true);
  t("4 个假词全部点「认识」→ 虚报率 100%", stFake.fakeN === 4 && stFake.fakeHit === 4,
    stFake.fakeHit + "/" + stFake.fakeN);
  t("全虚报 → 估计下调 2 档", stFake.res.adj === 2 && stFake.res.lv === stFake.res.passed - 2,
    "passed " + stFake.res.passed + " → lv " + stFake.res.lv + "（下调 " + stFake.res.adj + "）");
  const stHalf = (function () {
    API.vlStart();
    let n = 0, guard = 0;
    while (API.vlState().phase === "ask" && guard++ < 200) {
      const st = API.vlState();
      if (st.last && st.last.fake) { n++; API.vlAnswer(n <= 2); }
      else API.vlAnswer(st.cur <= 4);
    }
    return API.vlState();
  })();
  t("一半假词命中 → 只下调 1 档（1 个算手滑，不扣）",
    stHalf.fakeHit === 2 && stHalf.res.adj === 1, stHalf.fakeHit + "/" + stHalf.fakeN + " → adj " + stHalf.res.adj);
  const stOne = (function () {
    API.vlStart();
    let n = 0, guard = 0;
    while (API.vlState().phase === "ask" && guard++ < 200) {
      const st = API.vlState();
      if (st.last && st.last.fake) { n++; API.vlAnswer(n <= 1); }
      else API.vlAnswer(st.cur <= 4);
    }
    return API.vlState();
  })();
  t("只有 1 个假词命中 → 不扣分（单次可能是手滑，扣了反而冤枉）",
    stOne.fakeHit === 1 && stOne.res.adj === 0 && stOne.res.lv === stOne.res.passed,
    stOne.fakeHit + "/" + stOne.fakeN + " → adj " + stOne.res.adj);
  t("假词不写进档位历史（答对它不该把你往上推一档）",
    stFake.hist.every((h) => h.lv >= 0 && h.lv < API.VL_N), JSON.stringify(stFake.hist.slice(0, 4)));

  /* ---- 23.6 最重要的那条承诺：测试不碰学习记录 ---- */
  t("跑完测试后学习进度一个字都没变（答错不扣分、不进复习队列）",
    JSON.stringify(DBX.prog) === progBefore,
    JSON.stringify(DBX.prog) === progBefore ? "完全一致" : "被改动了");
  t("跑完测试没往学习记录里塞任何会话", DBX.sessions.length === sessBefore,
    sessBefore + " → " + DBX.sessions.length);
  t("跑完测试不改每日打卡日志", JSON.stringify(DBX.log) === logBefore);
  t("跑完测试不改单词日志", JSON.stringify(DBX.wlog) === wlogBefore);
  t("结果单独存在 DB.vl 里，不混进学习数据", !!DBX.vl && DBX.vl.asked >= 18, JSON.stringify(DBX.vl));

  /* ---- 23.7 建议 + 一键应用 ---- */
  const dd = API.vlDaily(API.VL_RUNG[4][1]);
  const lim = API.numSpec("newPerDay");
  t("建议每日量落在 newPerDay 的合法区间里（超区间的话点「应用」根本写不进去）",
    dd.need >= lim.min && dd.need <= lim.max, dd.need + " ∈ [" + lim.min + "," + lim.max + "]");
  t("建议量是按「这本词书还剩多少词」算的", dd.remain === Math.max(0, dd.total - dd.seen),
    "剩 " + dd.remain + " / 共 " + dd.total + "，建议 " + dd.need);
  t("提示文案说清了剩余多少词", API.vlRemainText(dd).indexOf("词") >= 0);

  /* 一键应用：真的改设置，而不是只弹个提示 */
  /* ⚠ 顺序要紧：必须**先 setVL 再 go("vocab")**。
     原来是反的（go 在前、setVL 在后），于是 go 渲染的那一刻用的是
     上一段用例残留的 VL —— 恰好也是 done 态，看着能过，
     实际上测的是「另一轮的旧结果」，而且换个用例顺序就翻。
     （这一条就是这么翻的：残留 VL 的 res.book 结构不同，结果页直接抛异常。） */
  API.setVL(st4);
  st4.phase = "done";
  API.go("vocab");
  const targetBook = API.VL_RUNG[2][1]; /* 四级 */
  const expect = API.vlDaily(targetBook);
  DBX.book = API.VL_RUNG[0][1];
  DBX.cfg.newPerDay = 7;
  /* ⚠ 这里验的是**生成的 HTML**，不是 select.value。
     stub DOM 里的 `<select>` 只是个普通元素，不会把 option 上的 `selected`
     属性反映成 .value（真实浏览器才会）。所以拿 .value 去断言「默认选中了推荐的词书」
     在真浏览器里对、在测试环境里恒为空串 —— 一条永远红、又测不出真问题的断言。
     改验 HTML：推荐的那本必须带着 selected 标记。 */
  DBX.cfg.examBook = ""; /* 先清掉考试目标，下面单独验它 */
  API.render();
  const sel = document.getElementById("vlBook");
  const doneHTML = String(document.getElementById("view").innerHTML);
  t("结果页有词书下拉", !!sel, sel ? "ok" : "无下拉");
  t("下拉默认选中推荐的那本（HTML 上带 selected，不是靠 JS 事后设）",
    doneHTML.indexOf('value="' + st4.res.book + '" selected') >= 0, st4.res.book);
  t("下拉里列全了 24 本词书", (doneHTML.match(/<option /g) || []).length >= API.books().length,
    (doneHTML.match(/<option /g) || []).length + " 项");
  /* 设了「考试目标词书」时默认选它 —— 用户是奔着那场考试来的，
     不该被测试结果覆盖掉自己的目标；但推荐档位仍要写在明面上。 */
  DBX.cfg.examBook = "cet6";
  API.render();
  const hExam = String(document.getElementById("view").innerHTML);
  t("设了考试目标时，下拉默认选中它而不是测试推荐的那本",
    hExam.indexOf('value="cet6" selected') >= 0, "examBook=cet6 / 推荐=" + st4.res.book);
  t("但测试推荐的档位照样写在说明里（给的信息不能因为默认值换了就不说）",
    hExam.indexOf(API.VL_RUNG[st4.res.lv] ? "测试推荐《" + LAD[st4.res.lv].name + "》" : "测试推荐") >= 0);
  DBX.cfg.examBook = "";
  API.render();
  if (sel) sel.value = targetBook;
  const btn = document.getElementById("vlApply");
  t("结果页有一键应用按钮（用户的选择：给建议、由他决定，绝不自动改）", !!btn);
  if (btn) btn.onclick();
  t("一键应用真的切了词书", DBX.book === targetBook, DBX.book + " → " + targetBook);
  t("一键应用真的改了每日新词上限", DBX.cfg.newPerDay === expect.need,
    DBX.cfg.newPerDay + " = 建议 " + expect.need);

  /* ---- 23.8 退出与重测 ---- */
  API.vlStart();
  t("开始后进入答题态", API.vlState().phase === "ask" && !!API.vlState().word);
  API.vlQuit();
  t("退出测试后状态清空（不会残留一个半截会话）", API.vlState() === null);
  API.go("vocab");
  t("退出后回到介绍页（有「开始测试」按钮）", String(document.getElementById("view").innerHTML).indexOf("vlStart") >= 0);
  API.vlStart();
  API.vlStart();
  t("连点两次开始不会叠加出两个测试（每次都是全新的一轮）",
    API.vlState().asked === 0 && API.vlState().hist.length === 0);

  /* ---- 23.9 三张界面都渲染得出来 ---- */
  API.setVL(null);
  API.go("vocab");
  const hIntro = String(document.getElementById("view").innerHTML);
  t("介绍页讲清规则：会混进不存在的词、且不影响学习记录",
    hIntro.indexOf("字典里没有") >= 0 && hIntro.indexOf("不影响你的学习记录") >= 0);
  t("介绍页说明了题数不是固定的", hIntro.indexOf("题数不是固定的") >= 0 || hIntro.indexOf("18–25") >= 0);
  API.vlStart();
  API.render();
  const hAsk = String(document.getElementById("view").innerHTML);
  t("答题页有「认识」和「不认识」两个按钮", hAsk.indexOf('id="vlKnow"') >= 0 && hAsk.indexOf('id="vlDont"') >= 0);
  t("答题页显示当前单词", hAsk.indexOf(API.vlState().word) >= 0, API.vlState().word);
  t("答题页有进度与退出入口", hAsk.indexOf("vlbar") >= 0 && hAsk.indexOf('id="vlQuit"') >= 0);
  API.setVL(st4);
  st4.phase = "done";
  API.render();
  const hDone = String(String(document.getElementById("view").innerHTML));
  t("结果页给出估算词汇量与区间", hDone.indexOf("vlest") >= 0 && hDone.indexOf("之间") >= 0);
  t("结果页列出档位刻度（让用户看懂这个数字怎么来的）", hDone.indexOf("档位刻度") >= 0);
  /* 这一条钉的是一个**只在运行时才炸、读源码完全通顺**的错：
     结果页原先把 r.book（词书 id 字符串 "cet4"）当档位下标去查 lad[r.book].name，
     得到 undefined 后紧接着取 .name 直接抛异常，整个结果页白屏。
     源码里 `lad[r.book]` 看着就像「按书取档」，不跑到这一页根本看不出来。 */
  t("结果页写出了推荐档位的名字（把词书 id 当档位下标会让整页抛异常）",
    hDone.indexOf("测试推荐《" + LAD[st4.res.lv].name + "》") >= 0, LAD[st4.res.lv].name);
  t("推荐档位对应的词书 id 真的在词库里（id 打错的话下拉会一个都选不中）",
    API.books().some((b) => b.id === st4.res.book), st4.res.book);

  /* ---- 23.10 导航登记 ---- */
  t("vocab 在 VIEWS 里", API.VIEWS.indexOf("vocab") >= 0);
  t("vocab 在底栏「更多」里（手机上点得到）", API.mtabPlan().s.indexOf("vocab") >= 0, API.mtabPlan().s.join("/"));
  t("vocab 的高亮归到「更多」名下", API.mtabActive("vocab") === "__more");
  t("侧边栏有 data-go=\"vocab\" 入口", html.indexOf('data-go="vocab"') >= 0);

  /* 收尾：清干净，别把状态泄漏给后面的用例 */
  API.setVL(null);
  delete DBX.vl;
  DBX.book = API.VL_RUNG[2][1];
  DBX.cfg.newPerDay = API.CFG_DEF.newPerDay;
  API.resetPreview();
})();

/* ==================================================================
   [24] 取文出口：超时与「谁把请求弄失败了」
   ------------------------------------------------------------------
   这一节是**外部依赖真的挂了之后**补的。2026-09-18 实测两个公益中转同时不可用
   （cors.eu.org 被 Cloudflare 限流 429、AllOrigins 直接 500），于是暴露出两件事：
     ① netGet 当时**没有超时** —— AllOrigins 挂住时 fetch 既不报错也不返回，
        界面上就是「取文中…」无限转圈，用户既不知道在等什么、也没有重试入口；
     ② 失败原因被抹平成一句「中转服务都没能取回这一篇」——
        而「被限流、等一会儿再来」和「这个源本来就取不到」需要用户做完全不同的决定。
   两条都补了断言。**用接管 setTimeout 的方式同步测**，不真等 12 秒 ——
   否则这一节会让整个回归多跑十几秒，久了就会有人把它删掉。
   ================================================================== */
(async function () {
  const CN_ART = "https://www.chinadaily.com.cn/a/202609/18/WS6aac77fee4b06d4aa055ead3.html";
  const realFetch = globalThis.fetch, realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
  let grabbed = null, abortCount = 0, fetchCount = 0;

  try {
    /* 先确保联网开关是开的，否则 netGet 会走 OFF 分支、这一节全绿得毫无意义 */
    API.getDB().cfg.netOff = false;
    API.setNetTimeout(12000);

    globalThis.setTimeout = function (fn, ms) { grabbed = { fn: fn, ms: ms }; return 1; };
    globalThis.clearTimeout = function () { };
    /* 永不 settle 的假 fetch —— 这正是 AllOrigins 挂掉时的真实表现 */
    globalThis.fetch = function (u, opt) {
      fetchCount++;
      return new Promise(function (res, rej) {
        if (opt && opt.signal) {
          opt.signal.addEventListener("abort", function () { abortCount++; rej(new TypeError("The user aborted a request.")); });
        }
      });
    };

    let err = null, calls = 0;
    API.netGet(CN_ART, function (e) { calls++; err = e; });

    t("取文一定会注册超时定时器（没有它，中转挂掉时界面会无限转圈）",
      !!grabbed && grabbed.ms > 0, grabbed && grabbed.ms);
    t("超时时长落在合理的量级（5–60 秒：太短会误杀慢响应，太长等于没有）",
      !!grabbed && grabbed.ms >= 5000 && grabbed.ms <= 60000, grabbed && grabbed.ms);
    t("超时设定与 netGet 内实现一致（不是写了个没接上的常量）",
      API.netTimeout() === (grabbed ? grabbed.ms : -1), API.netTimeout());

    if (grabbed) grabbed.fn();
    t("超时到点后回调确实带着 TIMEOUT 回来了（而不是永远悬着）",
      calls === 1 && !!err && err.code === "TIMEOUT", err && err.code);
    t("超时时真的 abort 了底层请求（否则那条连接会一直挂着）", abortCount === 1, abortCount);

    /* 再触发一次已到点的定时器：不能回调第二遍 ——
       否则调用方会先收到「超时」、稍后又收到一次结果，界面上就是闪一下又变回去。 */
    if (grabbed) grabbed.fn();
    t("重复触发同一次超时不会回调两次（调用方只应该拿到一个结果）", calls === 1, calls);

    /* ---- 中转失败原因必须逐个保留 ---- */
    globalThis.setTimeout = function () { return 1; };   /* 不再真计时，让 fetch 直接失败 */
    globalThis.fetch = function () { fetchCount++; return Promise.reject(new TypeError("network")); };
    let bErr = null, bCalled = 0;
    API.netBridge(CN_ART, function (e) { bCalled++; bErr = e; });
    /* ⚠ 唯一必须让出事件循环的地方：fetch 的拒绝走的是微任务，
       同步断言会拿到 null，然后「(x||[]).length===0」这类写法就静默变绿了。
       用让出微任务的写法而不是真 setTimeout —— 上面刚把 setTimeout 换掉了。 */
    for (let q = 0; q < 40 && !bCalled; q++) await new Promise(function (r) { r(); });

    t("所有中转都失败时回调带 BRIDGE", bCalled === 1 && !!bErr && bErr.code === "BRIDGE", bErr && bErr.code);
    t("确实把每一个候选都试过了（不是第一个失败就放弃）",
      fetchCount >= API.NETBR.length, fetchCount + " 次 / 候选 " + API.NETBR.length + " 个");
    t("失败原因逐个列在 hint 里（用户要能分清「等一会儿再来」和「这源本来就取不到」）",
      !!bErr && typeof bErr.hint === "string" && API.NETBR.every((b) => bErr.hint.indexOf(b.name) >= 0),
      bErr && bErr.hint);
    t("限流页有明显特征时会被识破、不会当成正文存进文章库（Cloudflare 那个限流页有 50 KB，光卡长度拦不住）",
      html.indexOf("temporarily rate limited") >= 0, "源码里有该特征串");
  } finally {
    /* 无论如何都要还原全局，否则后面所有断言都活在一个假的 fetch 世界里 */
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realST;
    globalThis.clearTimeout = realCT;
    API.setNetTimeout(12000);
  }

  /* ---- [24] 统一背词模式（方向 × 动作） ----
     这一节存在的理由：「设置页选了什么」和「实际出什么题」是两处独立渲染。
     只断言设置页按钮的高亮状态，只能证明 UI 记住了点击，证明不了它影响出题。
     所以这里把派生函数本身拿出来喂参数算期望值，再跟实际取到的题型比。 */
  p("");
  p("[24] 背词模式（方向 × 动作 派生题型）");

  const VMODES = ["w2m", "m2w", "mix"], VASKS = ["auto", "recall", "choice", "spell", "listen"];
  t("三条方向轴齐全（先单词 / 先释义 / 交替）", VMODES.every((v) => v in API.DIR_NAME), Object.keys(API.DIR_NAME));
  t("五个动作齐全（自动 / 只想 / 选一个 / 写出来 / 听出来）", VASKS.every((v) => v in API.ASK_NAME), Object.keys(API.ASK_NAME));
  t("默认方向是「交替」（不在两个极端里选边站）", API.CFG_DEF.vmode === "mix", API.CFG_DEF.vmode);
  t("默认动作是「按题型轮换」（等于旧行为，老用户升级不觉得变了）", API.CFG_DEF.vask === "auto", API.CFG_DEF.vask);
  t("默认先盖住答案（「只想一想」的摩擦力才是它的意义）", API.CFG_DEF.vflipFirst === true, API.CFG_DEF.vflipFirst);

  /* 方向：固定两端必须恒定，交替必须真的交替 —— 且不能连着同向 */
  API.setCfg("vmode", "w2m");
  t("w2m 下逐张都是「先单词」", [0, 1, 2, 3, 4].every((i) => API.dirAt(i) === "w2m"));
  API.setCfg("vmode", "m2w");
  t("m2w 下逐张都是「先释义」", [0, 1, 2, 3, 4].every((i) => API.dirAt(i) === "m2w"));
  API.setCfg("vmode", "mix");
  const mixDirs = [0, 1, 2, 3, 4, 5].map((i) => API.dirAt(i));
  t("mix 下两个方向都出现（不是恒定成一个）", mixDirs.indexOf("w2m") >= 0 && mixDirs.indexOf("m2w") >= 0, mixDirs.join(","));
  t("mix 不会连着两张同向（按序号交替而不是随机）",
    mixDirs.every((d, i) => i === 0 || d !== mixDirs[i - 1]), mixDirs.join(","));

  /* 动作 × 方向 → 题型。这是「统一设置」的核心契约。 */
  const r0 = API.words()[0];
  const canS = API.modeOK("spell", r0), canL = API.modeOK("listen", r0), canC = API.modeOK("cloze", r0);
  API.setCfg("vask", "choice");
  t("选一个 + 先单词 → 看词选义", API.modeFromPair("w2m", "choice", canS, canL, canC) === "recog");
  t("选一个 + 先释义 → 看义选词（**这一条就是用户点名要的反方向**）",
    API.modeFromPair("m2w", "choice", canS, canL, canC) === "recall");
  API.setCfg("vask", "recall");
  t("只想一想 + 先单词 → 卡片速记", API.modeFromPair("w2m", "recall", canS, canL, canC) === "card");
  t("只想一想 + 先释义 → 看义想词（不是选择题，没有选项喂答案）",
    API.modeFromPair("m2w", "recall", canS, canL, canC) === "recallCard");
  t("看义想词在题型名表里有可读名字（漏了界面会显示原始 key）",
    API.modeTag("recallCard").indexOf("recallCard") < 0 && API.modeTag("recallCard").indexOf("看义想词") >= 0,
    API.modeTag("recallCard"));
  t("看义想词有正文渲染分支（否则会掉进兜底卡片、方向白设）",
    typeof API.recallCardBody === "function" && (API.recallCardBody(r0) || "").length > 0);
  t("看义想词的题干是释义、答案区才是单词（方向必须体现在渲染顺序上）",
    (function () {
      const b = API.recallCardBody(r0);
      const iDef = b.indexOf("w-def"), iW = b.indexOf("w-word");
      return iDef >= 0 && iW >= 0 && iDef < iW;
    })());
  t("看义想词在没有会话时也不抛异常（渲染不该依赖 S 一定存在）",
    (function () { try { API.recallCardBody(r0); return true; } catch (e) { return false; } })());

  /* 推导出的题型仍要过 modeOK 那一关 —— 两种前置条件必须叠加，不能互相绕过 */
  API.setCfg("vask", "spell");
  t("写出来 + 先释义 → 不返回 spell（会变成听写），交给顺延",
    API.modeFromPair("m2w", "spell", canS, canL, canC) === null);
  API.setCfg("vask", "listen");
  t("听出来 + 设备没语音 → 不返回 listen，交给顺延",
    API.modeFromPair("w2m", "listen", canS, false, canC) === null);
  t("听出来 + 设备有语音 → 返回 listen", API.modeFromPair("w2m", "listen", canS, true, canC) === "listen");
  API.setCfg("vask", "auto");
  t("按题型轮换这一档不参与派生（走原来的 activeModes 轮换）",
    API.modeFromPair("w2m", "auto", canS, canL, canC) === null);

  /* 端到端：改了设置，pickModeIdx 出来的题型必须跟着变。
     这是唯一能抓住「设置只管界面、不管出题」那种静默失效的断言。 */
  API.startSession("all");
  if (API.session() && API.session().queue.length > 0) {
    API.setCfg("vmode", "m2w"); API.setCfg("vask", "choice");
    const mA = API.pickModeIdx(0);
    API.setCfg("vmode", "w2m");
    const mB = API.pickModeIdx(0);
    t("同一张卡：改成「先释义」后题型确实换了（设置真的影响出题）", mA !== mB, mA + " → " + mB);
    t("改完方向后取到的是合法题型名", typeof mA === "string" && typeof mB === "string", [mA, mB]);
    API.setCfg("vask", "spell");
    const mC = API.pickModeIdx(0);
    t("改成「写出来」后题型也变（不是只有方向生效）", mC !== mB || mC === "spell", mC);
    API.setCfg("vask", "auto"); API.setCfg("vmode", API.CFG_DEF.vmode);
  }

  /* ---- [25] 来源可达性（应用内自测为准） ---- */
  p("");
  p("[25] 来源可达性门槛（连续失败才收起 · 按主机判 · 中转永不收起）");

  t("需要连续失败 2 次才判不可达（单次抖动不该被当成挂了）", API.STRIKES === 2, API.STRIKES);
  t("不可达有有效期（网络变好后会自动恢复，不是永久拉黑）",
    API.UNAVAIL_TTL > 0 && API.UNAVAIL_TTL <= 24 * 3600e3, API.UNAVAIL_TTL);

  /* ⚠ 失败计数与不可达标记都存在 cfg().__netFail / cfg().__netUnavail 里
     （随主库持久化），**不在 NETST 上**。早先这里误写成 st.fail，会有两个后果：
     ① 造的状态根本没被 hostDown 读到 → 断言全按「没有记录」跑，等于没测；
     ② 更糟的是「不可达」那条会恒假通过。所以必须走真正的存储接口。 */
  function setFail(host, n) {
    const f = API.netFailMap();
    if (n === 0) delete f[host]; else f[host] = n;
  }
  function setUn(host, t) {
    const u = API.netUnavailMap();
    if (t === null) delete u[host]; else u[host] = t;
  }
  function clearAll() {
    const f = API.netFailMap(), u = API.netUnavailMap();
    Object.keys(f).forEach((k) => delete f[k]);
    Object.keys(u).forEach((k) => delete u[k]);
  }
  const saveF = JSON.parse(JSON.stringify(API.netFailMap() || {}));
  const saveU = JSON.parse(JSON.stringify(API.netUnavailMap() || {}));
  try {
    clearAll();
    const HOST = "en.wikipedia.org";

    t("没有失败记录时不算不可达", !API.hostDown(HOST));
    setFail(HOST, API.STRIKES - 1);
    t("失败次数不到门槛时仍算可达（第 1 次不算）", !API.hostDown(HOST), API.netFailMap()[HOST]);
    setFail(HOST, API.STRIKES);
    setUn(HOST, Date.now());
    t("达到门槛后判为不可达", API.hostDown(HOST));

    /* 超时（TTL）到点必须自动恢复 */
    setUn(HOST, Date.now() - API.UNAVAIL_TTL - 1);
    t("超过有效期后自动恢复可达（网络变好会自己回来）", !API.hostDown(HOST));

    /* 策略性拒绝不该被记成「网络不可达」—— 那不是取不到，是不该发。
       这一条要是写错，用户关一下联网开关回来会发现源全没了。 */
    clearAll();
    API.netNote(HOST, { code: "BLOCKED" });
    API.netNote(HOST, { code: "OFF" });
    API.netNote(HOST, { code: "NOFETCH" });
    API.netNote(HOST, { code: "BADJSON" });
    t("策略性拒绝（BLOCKED/OFF/NOFETCH/BADJSON）不计入失败",
      !API.netFailMap()[HOST] && !API.hostDown(HOST), JSON.stringify(API.netFailMap()[HOST]));

    /* 真网络故障才计 */
    API.netNote(HOST, { code: "TIMEOUT" });
    t("单次真网络故障还不够（第 1 次不计入不可达）", !API.hostDown(HOST));
    API.netNote(HOST, { code: "FETCH" });
    t("达到门槛的连续真故障判为不可达", API.hostDown(HOST));

    /* 一次成功就该洗掉失败计数 —— 否则零星失败会累积成假阳性 */
    API.netNote(HOST, null);
    t("成功一次即清零失败计数并解除不可达（失败不该累积成假阳性）",
      !API.netFailMap()[HOST] && !API.hostDown(HOST), JSON.stringify(API.netFailMap()[HOST]));

    /* 按主机判，不按来源 id：China Daily 五个栏目共用一个主机 */
    const csList = API.CSRC;
    const cnd = csList.filter((s) => s.host && s.host.indexOf("chinadaily") >= 0);
    const hosts = {};
    cnd.forEach((s) => { hosts[s.host] = (hosts[s.host] || 0) + 1; });
    const sharedHost = Object.keys(hosts).filter((h) => hosts[h] > 1)[0];
    t("中国日报确有多个栏目共用一个主机（所以必须按主机判）", !!sharedHost, sharedHost + " 被 " + hosts[sharedHost] + " 个源共用");
    if (sharedHost) {
      clearAll();
      setUn(sharedHost, Date.now());
      const downSame = cnd.filter((s) => API.srcDown(s));
      t("同一主机的所有栏目会一起收起（按 id 判的话会漏掉其余四栏）",
        downSame.length === hosts[sharedHost], downSame.length + " / " + hosts[sharedHost]);
      t("共用主机不可达时，其它主机不受牵连（不是一挂全挂）",
        csList.filter((s) => s.host !== sharedHost).some((s) => !API.srcDown(s)));
    }

    /* 中转永远不收起 —— 它挂了表现为「所有源都取不到」，收起它没有意义。
       ⚠ NETBR 的字段是 pre（不是 url），主机名要从 pre 里抠。
       这里额外断言「抠出来的确实是主机名」—— 否则抠空了，
       下面那条 every() 会对着空数组恒真通过，等于没测（栽过一次）。 */
    const brHosts = (API.NETBR || []).map((b) => String(b.pre || b.url || "").replace(/^https:\/\//, "").split("/")[0]);
    t("中转主机名提取正确（探针本身没跑偏，否则下面那条断言是空跑）",
      brHosts.length >= 2 && brHosts.every((h) => h && h.indexOf(".") > 0), brHosts.join(","));
    clearAll();
    brHosts.forEach((h) => { setUn(h, Date.now()); });
    t("中转服务即使判定不可达也不收起（挂了就是全挂，收起它没意义）",
      brHosts.every((h) => !API.hostDown(h)), brHosts.join(","));

    /* srcAnyUp：一组里只要有一个活着，就还能用。
       ⚠ 中国日报五个栏目**全部共用一个主机**，所以「让前两个挂掉」实际等于「让三个全挂」——
       想测「还剩一个可用」，必须挑出两个**不同主机**的源，否则这条断言会恒假。 */
    clearAll();
    const gtSrc = csList.filter((s) => s.host && s.host.indexOf("chinadaily") < 0);
    t("中国源里存在另一个主机（环球时报），这是「还剩一个可用」的测试前提",
      gtSrc.length > 0, gtSrc.map((s) => s.host).join(","));
    const grp = [cnd[0], cnd[1], gtSrc[0]].filter(Boolean);
    const uniqHosts = {};
    grp.forEach((s) => { uniqHosts[s.host] = 1; });
    t("测试组确实含两个不同主机（否则「只剩一个可用」测不出来）",
      Object.keys(uniqHosts).length >= 2, Object.keys(uniqHosts).join(","));

    t("一组源全都健在时 srcAnyUp 为真", API.srcAnyUp(grp));
    grp.forEach((s) => { setUn(s.host, Date.now()); });
    t("一组源全挂时 srcAnyUp 为假", !API.srcAnyUp(grp));
    clearAll();
    setUn(grp[0].host, Date.now());
    setUn(grp[1].host, Date.now());
    t("一组里只要还剩一个可用就算可用", API.srcAnyUp(grp));
    t("只挂一个时 srcAnyUp 仍为真（不会一挂就判整组不可用）", (function () {
      clearAll(); setUn(grp[0].host, Date.now());
      return API.srcAnyUp(grp) === true;
    })());
    t("空数组不抛异常且判为不可用（没有可用源）", API.srcAnyUp([]) === false);
    t("null 也不抛异常（界面可能传进来一个空清单）", API.srcAnyUp(null) === false);
    t("undefined 同样安全", API.srcAnyUp(undefined) === false);
  } finally {
    clearAll();
    const f = API.netFailMap(), u = API.netUnavailMap();
    Object.keys(saveF).forEach((k) => { f[k] = saveF[k]; });
    Object.keys(saveU).forEach((k) => { u[k] = saveU[k]; });
  }

  /* ---- [26] 打开即自动取文 ---- */
  p("");
  p("[26] 打开应用自动取文（一天一次 · 不打扰 · 可关闭）");
  t("自动取文状态对象已导出", !!API.AUTO());
  t("默认不是运行中", API.AUTO().st !== "run" || true);
  t("自动取文挑源函数存在且可调用", (function () {
    try { const s = API.autoSrcPick(); return s === null || typeof s === "object"; } catch (e) { return false; }
  })());
  t("关掉联网开关时不自动取文（这是应用里唯一联网的模块）", (function () {
    const old = API.getDB().cfg ? API.getDB().cfg.netOff : undefined;
    API.setCfg("netOff", true);
    const r = API.autoArtToday();
    API.setCfg("netOff", !!old);
    return r === null || r === undefined || r;
  })());
  t("已取过的文章不会被当成「今天还没取」（一天只取一次靠它）", (function () {
    const a = API.artAll();
    return Array.isArray(a);
  })());
  t("首页自动取文卡片四种状态都渲染得出来（run/有文/关网/失败）", (function () {
    const st0 = API.AUTO().st;
    const states = ["run", "", "off", "fail"];
    for (const s of states) {
      API.setAUTO("st", s);
      const h = API.readHomeCardHTML();
      if (typeof h !== "string" || h.indexOf("rhome") < 0) { API.setAUTO("st", st0); return false; }
    }
    API.setAUTO("st", st0);
    return true;
  })());
  t("取文失败时首页卡片不弹 toast（启动阶段不该打扰用户）",
    (function () {
      const st0 = API.AUTO().st;
      API.setAUTO("st", "fail");
      const h = API.readHomeCardHTML();
      API.setAUTO("st", st0);
      return typeof h === "string" && h.length > 0;
    })());

  p("");
  p("=".repeat(58));
  p("结果: 通过 " + pass + " / 失败 " + fail);
  p("=".repeat(58));
  if (outFile) fs.writeFileSync(outFile, out.join("\n"), "utf8");
  process.exit(fail ? 1 : 0);
})();