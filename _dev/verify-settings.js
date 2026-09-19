// 第四层验证：设置面板数值输入的真实浏览器行为
// 为什么必须单独一层：stub DOM 的 querySelectorAll 返回空数组，测不到「提交后是否重建 DOM /
// 焦点是否被销毁」这类问题 —— 而这正是用户报的「输不进去、光标跑到标题上」的根因。
// 用法：node _dev/verify-settings.js [dist路径]
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = process.argv[2] || path.join(ROOT, "dist", "词匠-离线背单词.html");
const TMP = path.join(ROOT, "_dev", "_shots");
fs.mkdirSync(TMP, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BROWSER = fs.existsSync(CHROME) ? CHROME : EDGE;

if (!fs.existsSync(DIST)) { console.error("! 找不到交付物：" + DIST); process.exit(1); }
const base = fs.readFileSync(DIST, "utf8");

const probe = `
(function(){
  var log = [], pass = 0, fail = 0;
  function ok(name, cond, extra){ (cond?pass++:fail++); log.push((cond?"  \\u2713 ":"  \\u2717 ") + name + (extra!==undefined && String(extra)!==""?" ["+extra+"]":"")); }
  var A = window.__WFAPI;
  A.go("settings");

  function inp(key){ return document.querySelector('input[data-num="' + key + '"]'); }
  /* 模拟真实路径：聚焦 → 改值 → 失焦（提交） */
  function submit(key, val){ var el = inp(key); el.focus(); el.value = val; el.blur(); return el; }
  function cfgv(key){ var p = key.split("."), c = A.getDB().cfg; return p.length === 2 ? c[p[0]][Number(p[1])] : c[p[0]]; }

  ok("输入框存在（16 个）", document.querySelectorAll("input[data-num]").length === 16, document.querySelectorAll("input[data-num]").length);
  ok("界面约束来自规格表（1 – 500 的整数）", document.body.innerHTML.indexOf("1 – 500 的整数") >= 0);
  ok("用 text + inputmode 承接全角输入", inp("newPerDay").type === "text" && inp("newPerDay").getAttribute("inputmode") === "numeric");

  /* 合法值：写入成功，且 DOM 不被重建 */
  var before = inp("newPerDay");
  submit("newPerDay", "77");
  ok("合法值写入配置", cfgv("newPerDay") === 77, cfgv("newPerDay"));
  ok("提交后输入框未被替换（不再整页重绘）", before === inp("newPerDay"));
  ok("输入框回显规范化值", inp("newPerDay").value === "77", inp("newPerDay").value);

  /* 越界：拒绝 + 回滚设置前状态 */
  submit("newPerDay", "99999");
  ok("超上限被拒绝", cfgv("newPerDay") === 77, cfgv("newPerDay"));
  ok("回滚到设置前状态", inp("newPerDay").value === "77", inp("newPerDay").value);
  ok("标红提示", inp("newPerDay").classList.contains("bad"));
  submit("newPerDay", "0");
  ok("低于下限同样被拒绝", cfgv("newPerDay") === 77, cfgv("newPerDay"));

  /* 空值不再被当成 0 */
  submit("newPerDay", "");
  ok("空值被拒（没有变成 0）", cfgv("newPerDay") === 77, cfgv("newPerDay"));

  /* 整数格不接受小数 */
  submit("optCount", "3.5");
  ok("整数格拒绝小数", cfgv("optCount") === 4, cfgv("optCount"));
  submit("optCount", "3");
  ok("合法整数被接受", cfgv("optCount") === 3, cfgv("optCount"));

  /* 假数字文本 */
  ["12abc", "1e5", "--1", "abc", "3,5", "  ", "3.5.2"].forEach(function (bad, i) {
    var keep = cfgv("optCount"); submit("optCount", bad);
    ok("拒绝 '" + bad + "'", cfgv("optCount") === keep, cfgv("optCount"));
  });

  /* 小数格：步长整数倍才算合法 */
  submit("easeStart", "2.75");
  ok("步长整数倍被接受", cfgv("easeStart") === 2.75, cfgv("easeStart"));
  submit("easeStart", "2.77");
  ok("非步长整数倍被拒绝", cfgv("easeStart") === 2.75, cfgv("easeStart"));
  submit("rate", "0.95");
  ok("语速 0.95 被接受（不再 stepMismatch）", cfgv("rate") === 0.95, cfgv("rate"));

  /* 全角与中文标点容错 */
  submit("newPerDay", "１２０");
  ok("全角 '１２０' → 120", cfgv("newPerDay") === 120, cfgv("newPerDay"));
  submit("rate", "0，85");
  ok("中文逗号 '0，85' → 0.85", cfgv("rate") === 0.85, cfgv("rate"));

  /* 二级键 */
  submit("initSteps.2", "99999");
  ok("二级键超范围回滚", cfgv("initSteps.2") === 30, cfgv("initSteps.2"));
  ok("回滚后是数字而不是数组字符串", /^\\d+$/.test(inp("initSteps.2").value), inp("initSteps.2").value);

  /* 全页初始值 */
  var bad2 = [];
  document.querySelectorAll("input[data-num]").forEach(function (x) {
    var k = x.getAttribute("data-num"), v = String(x.value).trim();
    if (v === "" || A.parseNum(v, k) === null) bad2.push(k + "=空/非法");
    else if (A.parseNum(v, k) !== cfgv(k)) bad2.push(k + " 回显不一致");
  });
  ok("14 个框初始值全合法且与配置一致", bad2.length === 0, bad2.join(","));

  /* 失败原因就地显示在说明行（不依赖一闪而过的 toast） */
  submit("revPerDay", "99999");
  var dsp = document.querySelector('[data-num="revPerDay"]').parentNode.querySelector(".setrow-t span");
  ok("非法输入后说明行就地报错", !!dsp && dsp.textContent.indexOf("只接受") >= 0 && dsp.classList.contains("warn"), dsp ? dsp.textContent : "-");
  submit("revPerDay", "300");
  var dsp2 = document.querySelector('[data-num="revPerDay"]').parentNode.querySelector(".setrow-t span");
  ok("改回合法值后说明行恢复原文", !!dsp2 && dsp2.textContent.indexOf("一天最多") >= 0 && !dsp2.classList.contains("warn"), dsp2 ? dsp2.textContent : "-");
  submit("maxDays", "5");
  var dfd = document.querySelector('[data-num="maxDays"]').parentNode.querySelector(".desc");
  ok("记忆算法项的说明行同样就地报错", !!dfd && dfd.textContent.indexOf("只接受") >= 0, dfd ? dfd.textContent : "-");
  submit("maxDays", "180");
  var dfd2 = document.querySelector('[data-num="maxDays"]').parentNode.querySelector(".desc");
  ok("恢复后 desc 复原", !!dfd2 && dfd2.textContent.indexOf("间隔封顶") >= 0, dfd2 ? dfd2.textContent : "-");

  /* 连续编辑互不干扰 */  submit("dailyGoal", "50");
  var g1 = inp("dailyGoal");
  submit("revPerDay", "200");
  ok("前一字段未被重建", inp("dailyGoal") === g1);
  ok("两字段都写对", cfgv("dailyGoal") === 50 && cfgv("revPerDay") === 200, cfgv("dailyGoal") + "/" + cfgv("revPerDay"));

  /* 设置页其余按钮不再整页重绘 */
  var card0 = document.querySelectorAll("#view .card")[0];
  document.querySelector('[data-order="random"]').click();
  document.querySelector('[data-order="order"]').click();
  ok("学习顺序按钮就地高亮、未重绘", document.querySelectorAll("#view .card")[0] === card0);
  ok("顺序已写入", A.getDB().cfg.queueOrder === "order", A.getDB().cfg.queueOrder);
  document.querySelector('[data-font="serif"]').click();
  ok("字体按钮未重绘", document.querySelectorAll("#view .card")[0] === card0);
  ok("字体已写入", A.getDB().cfg.wordFont === "serif", A.getDB().cfg.wordFont);
  document.querySelector('[data-theme-pick="forest"]').click();
  ok("主题按钮未重绘", document.querySelectorAll("#view .card")[0] === card0);
  ok("主题已写入", A.getDB().cfg.theme === "forest", A.getDB().cfg.theme);
  document.querySelector('[data-mode="listen"]').click();
  ok("题型按钮未重绘", document.querySelectorAll("#view .card")[0] === card0);

  /* ---- 考试倒计时（新增控件）：真实浏览器里测焦点 / 回滚 / 下拉 / 按键 ---- */
  A.go("settings");
  var ed = document.getElementById("setExamDate");
  ok("考试日期框存在", !!ed);
  ok("用 text 而不是 date（安卓 WebView 的 date 表现不一致、占位符跟系统语言变）",
    !!ed && ed.type === "text", ed ? ed.type : "无");
  ok("占位符写明格式", !!ed && ed.placeholder === "YYYY-MM-DD", ed ? ed.placeholder : "-");
  ok("限 10 字符（正好 YYYY-MM-DD）", !!ed && ed.maxLength === 10, ed ? ed.maxLength : "-");
  var ebSel = document.getElementById("setExamBook");
  ok("目标词书下拉存在，第一项是「跟随当前词书」",
    !!ebSel && ebSel.options[0].value === "" && ebSel.options.length === A.books().length + 1,
    ebSel ? ebSel.options.length + " 项（词书 " + A.books().length + "）" : "无");

  /* 这里**不复用**上面 inp()/submit() 的写法：那两个只认 input[data-num]，
     而日期框走的是自己的一套（oninput / onkeydown / onblur）。
     如果偷懒按 data-num 找，会拿到 null 然后 ok() 全部静默判失败 —— 看不出原因。 */
  function edSubmit(v){ ed.focus(); ed.value = v; ed.blur(); }

  edSubmit("2026-12-19");
  ok("合法日期写入配置", A.getDB().cfg.examDate === "2026-12-19", A.getDB().cfg.examDate);
  var hint = document.getElementById("setExamHint");
  ok("提示行就地变成倒计时（不需要整页重绘）",
    !!hint && hint.textContent.indexOf("还有") >= 0 && hint.textContent.indexOf("天") >= 0,
    hint ? hint.textContent.slice(0, 44) : "-");
  ok("提示行里同时给出「剩多少词 → 建议每天多少」",
    !!hint && hint.textContent.indexOf("建议每天") >= 0);

  edSubmit("2026-13-45");
  ok("月份 13 被拒", A.getDB().cfg.examDate === "2026-12-19", A.getDB().cfg.examDate);
  ok("被拒后输入框回滚到上一个合法值", ed.value === "2026-12-19", ed.value);
  edSubmit("2026-02-30");
  ok("真实不存在的日期（2 月 30 日）也被拒 —— 光验格式会漏掉它",
    A.getDB().cfg.examDate === "2026-12-19", A.getDB().cfg.examDate);
  var edm = document.getElementById("setExamDateMsg");
  ok("被拒时说明行就地标红（不依赖一闪而过的 toast）",
    !!edm && (edm.className === "badtxt" || edm.textContent.indexOf("只接受") >= 0),
    edm ? edm.textContent.slice(0, 34) : "-");

  /* 过去的日期**允许**存进去：输入框只负责「这是不是一个真实的日期」，
     「已经过了」是业务判断，由倒计时提示行去说 —— 拦在输入框里会让用户
     在改日期时莫名其妙地被拒绝，而且历史记录也改不动了。 */
  edSubmit("2020-01-01");
  ok("过去的日期能存进去（是否已过交给提示行说，不由输入框拦）",
    A.getDB().cfg.examDate === "2020-01-01", A.getDB().cfg.examDate);
  ok("已过的日期给出明确提示而不是空白",
    (document.getElementById("setExamHint") || {}).textContent.indexOf("已过") >= 0,
    (document.getElementById("setExamHint") || {}).textContent.slice(0, 34));

  edSubmit("2026-12-19");
  ed.focus(); ed.value = "2030-01-01";
  ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok("Esc 撤销未提交的编辑（改到一半想放弃最顺手的动作）",
    ed.value === "2026-12-19" && A.getDB().cfg.examDate === "2026-12-19", ed.value);

  ed.focus(); ed.value = "2027-06-06";
  ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  ok("回车即提交（不用去点别处）", A.getDB().cfg.examDate === "2027-06-06", A.getDB().cfg.examDate);

  edSubmit("");
  ok("留空是合法值 = 关闭倒计时（不能当格式错误拦下来）", A.getDB().cfg.examDate === "", JSON.stringify(A.getDB().cfg.examDate));
  ok("关闭后提示行说清「还没设考试日期」",
    (document.getElementById("setExamHint") || {}).textContent.indexOf("还没设") >= 0,
    (document.getElementById("setExamHint") || {}).textContent.slice(0, 30));

  ebSel.value = "cet6"; ebSel.dispatchEvent(new Event("change", { bubbles: true }));
  ok("目标词书下拉写入配置", A.getDB().cfg.examBook === "cet6", A.getDB().cfg.examBook);
  ebSel.value = ""; ebSel.dispatchEvent(new Event("change", { bubbles: true }));
  ok("选回「跟随当前词书」= 空串（不是字符串 'undefined'）",
    A.getDB().cfg.examBook === "", JSON.stringify(A.getDB().cfg.examBook));

  /* 一键应用：期望值**自己算一遍**，不拿界面写进去的值读回来跟自己比（那种断言永远绿） */
  edSubmit("2026-12-19");
  ebSel.value = "cet6"; ebSel.dispatchEvent(new Event("change", { bubbles: true }));
  var npSpec = A.numSpec("newPerDay");
  var ep = A.examPlan();
  var wantNp = Math.min(npSpec.max, Math.max(npSpec.min, ep.need));
  document.getElementById("setExamApply").click();
  ok("「设为建议值」写入的正是倒推出来的值（并夹进 1–500）",
    A.getDB().cfg.newPerDay === wantNp, A.getDB().cfg.newPerDay + " 期望 " + wantNp);
  ok("同时把输入框回显一起改掉（否则界面显示的和配置不一致）",
    document.querySelector('input[data-num="newPerDay"]').value === String(wantNp),
    document.querySelector('input[data-num="newPerDay"]').value);
  ok("没设日期时点它不会乱写（先提示、不改配置）", (function () {
    edSubmit("");
    var keep = A.getDB().cfg.newPerDay;
    document.getElementById("setExamApply").click();
    return A.getDB().cfg.newPerDay === keep;
  })(), A.getDB().cfg.newPerDay);

  /* ---- 版式体检：说明文字不能被同一行的控件挤成竖条 ----
     这条抓的是一个**溢出诊断看不见的**缺陷：没有任何元素超出视口，
     scrollWidth 等于 clientWidth、完美成立，但左边说明被压到 1 个字宽。
     起因：select 的自动最小尺寸 = 它最宽那个 option 的宽度，
     选项里有「大学英语六级（6,975 词）」时下拉撑到 430px 且拒绝收缩，
     同一行里 flex:1 的说明块就被啃到 0 —— 四字标题「目标词书」竖着排成四行。
     截图才发现（第一版交付里就是这个样子），所以补成断言钉住。
     ⚠ 这段在模板字符串里，注释中**不能出现反引号**（会把模板提前截断成语法错）。
     判据：说明块 / 所在行 < 0.34 且文本 ≥ 10 字。实测坏的两行是 0.06 / 0.08，正常行 0.6+。 */
  function squeezeReport(sel){
    var out = [];
    document.querySelectorAll(sel).forEach(function (row) {
      var t = row.querySelector(".setrow-t"); if (!t) return;
      var rr = row.getBoundingClientRect(), tr = t.getBoundingClientRect();
      var txt = String(t.textContent || "").replace(/\\s+/g, "");
      if (txt.length < 10) return;
      var ratio = rr.width ? tr.width / rr.width : 1;
      if (ratio < 0.34) out.push(txt.slice(0, 14) + " 占 " + (Math.round(ratio * 100) / 100));
    });
    return out;
  }
  A.go("settings");
  var sq1 = squeezeReport("#view .setrow");
  ok("设置页每行说明都占了足够宽度（下拉没把它挤成竖条）", sq1.length === 0, sq1.join(" | "));

  /* 同一个 bug 也长在词汇量结果页上（那里的下拉选项更长），一起钉住 */
  A.go("vocab");
  A.setVL(null);
  A.vlStart();
  (function () {
    var g = 0;
    while (A.vlState().phase === "ask" && g++ < 60) A.vlAnswer(A.vlState().cur <= 4);
  })();
  A.render();
  var sq2 = squeezeReport("#view .setrow");
  ok("词汇量结果页的说明同样没被下拉挤扁（选项文本比设置页更长，更容易撑爆）",
    sq2.length === 0, sq2.join(" | "));
  A.setVL(null);
  A.go("settings");

  /* 恢复出厂态，避免污染后续截图 */
  A.setDB(A.blankDB()); A.go("today");

  log.unshift("RESULT " + pass + " / " + (pass + fail) + "  (失败 " + fail + ")");
  document.title = "PROBE::" + log.join(" || ");
})();
`;

const html = base.replace("</body>", `<script>window.addEventListener('load',function(){setTimeout(function(){${probe}},700);});</script></body>`);
const vp = path.join(TMP, "_verify_settings.html");
fs.writeFileSync(vp, html, "utf8");

let out = "";
try {
  out = execFileSync(BROWSER, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--allow-file-access-from-files", "--virtual-time-budget=9000",
    "--window-size=1500,1120", "--dump-dom", "file:///" + vp.replace(/\\/g, "/"),
  ], { encoding: "utf8", timeout: 90000, maxBuffer: 64 * 1024 * 1024 });
} catch (e) { out = String(e.stdout || e.message || ""); }

console.log("设置面板数值输入校验: " + path.basename(DIST));
const m = out.match(/<title>([\s\S]*?)<\/title>/);
if (!m) { console.log("  ! 没拿到探针输出（DOM 长度 " + out.length + "）"); process.exit(1); }
const lines = m[1].replace(/^PROBE::/, "").split(" || ");
lines.forEach((l) => console.log(l));
const rm = lines[0].match(/(\d+) \/ (\d+)  \(失败 (\d+)\)/);
const fails = rm ? Number(rm[3]) : 1;
console.log("=".repeat(58));
console.log(fails === 0 ? "结果: 通过 " + (rm ? rm[1] : "?") + " / 失败 0" : "结果: 失败 " + fails + " 项");
console.log("=".repeat(58));
fs.unlinkSync(vp);
process.exit(fails ? 1 : 0);
