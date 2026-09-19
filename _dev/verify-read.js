// 第五层验证：文章精读在真实浏览器里的交互
// 为什么单开一层：精读的核心体验全是「真 DOM 行为」——
//   辅助档位切换会不会把阅读位置顶回顶部、点词是不是弹窗而不是跳页、
//   弹窗里的按钮能不能接上跳转协议、关掉联网后按钮是不是真的禁用。
//   这些在 stub DOM 里全部测不到（stub 的 querySelectorAll 返回空数组，classList 是假的）。
// 用法：node _dev/verify-read.js [dist路径]
// 注意：这一层**绝不点击任何会发真实请求的按钮**（拉取推荐 / 源自测 / 主题检索），
//   否则在没有外网的环境里会挂到超时，把「应用有问题」和「网络有问题」混为一谈。
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
  /* 整个探针包一层 try：中途任何一步抛异常，已跑过的断言也必须照常输出，
     否则只能看到「失败 1 项」却不知道死在哪 —— 那种反馈等于没有。 */
  try {

  /* 造一篇用于验证的文章。要有 4 句以上的段落，段落还原题才出得来 */
  var TXT = "Climate change is the long-term shift in global temperatures. "
    + "Scientists have observed it since the pre-industrial period. "
    + "The main cause is the burning of fossil fuels, which releases greenhouse gases into the atmosphere. "
    + "Rising temperatures have already led to more extreme weather events around the world.\\n\\n"
    + "Melting ice sheets are raising sea levels along many coastlines. "
    + "Many species are moving toward the poles to find cooler conditions. "
    + "Governments have promised to cut emissions in the coming decades. "
    + "Whether those promises will be kept remains an open question.";
  var art = A.artMk({ t: "Verify article", text: TXT, src: "验证来源", lic: "CC BY-SA" });
  A.artSave(art);

  /* ---- 1. 精读主页：页签切换走真实点击 ---- */
  A.RD_SET("discover"); A.go("read");
  ok("精读主页渲染出页签", document.querySelectorAll("[data-rtab]").length >= 2, document.querySelectorAll("[data-rtab]").length);
  ok("精读主页有联网状态条", !!document.querySelector(".rnet"));
  document.querySelector('[data-rtab="mine"]').click();
  ok("点页签能切到「我的文章」", A.RD_TAB() === "mine", A.RD_TAB());
  ok("「我的文章」页有离线粘贴框", !!document.getElementById("rdPaste") && !!document.getElementById("rdImport"));

  /* ---- 2. 进精读台：走真实的跳转按钮，而不是内部直接跳 ---- */
  var go = document.querySelector('[data-jump="art:' + art.id + '"]');
  ok("文章列表里有精读入口", !!go, go ? go.outerHTML.slice(0, 70) : "找不到 data-jump=art:" + art.id);
  if (go) go.click();
  ok("点进精读台（出现正文容器）", !!document.getElementById("rdBody"));
  ok("精读台有 4 个辅助档位按钮", document.querySelectorAll("[data-assist]").length === 4, document.querySelectorAll("[data-assist]").length);
  ok("精读台显示语言画像（画像条真的渲染了）", !!document.querySelector(".rprof"));
  var pf = A.artProfile(A.artGet(art.id));
  ok("语言画像给出 1-5 星难度", pf.star >= 1 && pf.star <= 5, pf.star);
  ok("语言画像给出不重复词数", pf.uniq > 20, pf.uniq);

  /* ---- 3. 辅助档位：就地换正文 —— 这是「不打乱阅读位置」的关键 ---- */
  var body0 = document.getElementById("rdBody");
  var as3 = document.querySelector('[data-assist="3"]');
  if (as3) as3.click();
  ok("切到逐句档会写入配置", A.getDB().cfg.readAssist === 3, A.getDB().cfg.readAssist);
  ok("就地换正文（正文容器没被重建）", !!body0 && document.getElementById("rdBody") === body0);
  ok("逐句档每句单独成行", document.querySelectorAll("#rdBody .rsent").length >= 8, document.querySelectorAll("#rdBody .rsent").length);
  ok("档位按钮的高亮跟着走", !!(as3 && as3.classList.contains("on")));

  document.querySelector('[data-assist="1"]').click();
  ok("标生词档画出下划线生词", document.querySelectorAll("#rdBody .rw-new").length > 0, document.querySelectorAll("#rdBody .rw-new").length);
  ok("标生词档先不给中文（让人自己猜）", !document.querySelector("#rdBody .rcn"));
  document.querySelector('[data-assist="2"]').click();
  ok("显释义档给出中文", document.querySelectorAll("#rdBody .rcn").length > 0, document.querySelectorAll("#rdBody .rcn").length);
  document.querySelector('[data-assist="0"]').click();
  ok("纯读档不标任何生词", document.querySelectorAll("#rdBody .rw-new").length === 0);
  ok("纯读档每个词仍可点", document.querySelectorAll("#rdBody [data-word]").length > 80, document.querySelectorAll("#rdBody [data-word]").length);

  /* ---- 4. 点词查义：必须弹窗，不能把人从文章里踢走 ---- */
  var cand = null;
  document.querySelectorAll('#rdBody [data-word]').forEach(function (sp) {
    if (cand) return;
    if (A.lookWord(sp.getAttribute("data-word"))) cand = sp;
  });
  ok("正文里能找到词库里有的词", !!cand);
  if (cand) cand.click();
  ok("点词是弹窗、人还留在精读台", !!document.getElementById("wpAdd") && !!document.getElementById("rdBody"));
  ok("弹窗遮罩已升起", document.getElementById("mask").classList.contains("on"));
  ok("弹窗里有读音与释义内容", document.getElementById("modal").textContent.length > 20);
  var n0 = A.getDB().custom.readnew ? A.getDB().custom.readnew.words.length : 0;
  document.getElementById("wpAdd").click();
  var n1 = A.getDB().custom.readnew ? A.getDB().custom.readnew.words.length : 0;
  ok("弹窗里能一键加入精读生词", n1 === n0 + 1, n0 + "\\u2192" + n1);
  document.getElementById("mClose").click();
  ok("关掉弹窗后遮罩收起", !document.getElementById("mask").classList.contains("on"));

  /* 弹窗里的「完整词条」必须接上跳转协议 */
  cand.click();
  document.getElementById("wpFull").click();
  ok("弹窗里点「完整词条」会离开精读台进词条页", !document.getElementById("rdBody"));
  A.go("read");
  document.querySelector('[data-rtab="mine"]').click();
  document.querySelector('[data-jump="art:' + art.id + '"]').click();
  ok("可以再回到精读台", !!document.getElementById("rdBody"));

  /* ---- 5. 精读 → 背单词的闭环 ---- */
  var b0 = A.getDB().custom.readnew ? A.getDB().custom.readnew.words.length : 0;
  document.getElementById("rdToLearn").click();
  var b1 = A.getDB().custom.readnew ? A.getDB().custom.readnew.words.length : 0;
  ok("一键把本篇生词加入精读生词词书", b1 >= b0, b0 + "\\u2192" + b1);
  document.getElementById("rdDone").click();
  ok("「读完了」写进这篇文章的记录", !!(A.artGet(art.id).rd && A.artGet(art.id).rd.done === true));
  ok("标记读完后仍停在精读台（没被踢回列表）", !!document.getElementById("rdBody"));

  /* ---- 6. 读后练习页 ---- */
  var qbtn = document.querySelector('[data-jump="artq:' + art.id + '"]');
  ok("精读台有练习入口", !!qbtn);
  if (qbtn) qbtn.click();
  ok("练习页有语境填空板块", document.body.innerHTML.indexOf("语境填空") >= 0);
  ok("练习页有词义配对板块", document.body.innerHTML.indexOf("词义配对") >= 0);
  ok("练习页有段落还原板块", document.body.innerHTML.indexOf("段落还原") >= 0);
  ok("练习页显示题量与得分", document.body.innerHTML.indexOf("题量") >= 0 && document.body.innerHTML.indexOf("已答对") >= 0);
  ok("填空题是可输入的文本框", document.querySelectorAll("input.qzin").length > 0, document.querySelectorAll("input.qzin").length);

  /* ---- 7. 离线通路：粘贴导入不依赖网络 ---- */
  A.getDB().cfg.netOff = true;
  A.RD_SET("mine"); A.go("read");
  ok("关掉联网后「我的文章」页照常能用", !!document.getElementById("rdPaste"));
  /* 注意字数：导入通道有 120 字的下限（太短的碎片当不了精读材料），
     夹具必须长过这条线，否则测的是「下限生效」而不是「导入成功」 */
  document.getElementById("rdPaste").value =
    "标题：粘贴导入验证\\n\\nThis is a pasted article we use to verify the offline import channel. "
    + "It contains only a few sentences, but it is long enough to pass the minimum length check. "
    + "The reader should be able to open it in the reading desk right away.";
  document.getElementById("rdImport").click();
  ok("粘贴导入后直接进精读台", !!document.getElementById("rdBody"));
  ok("手动导入的文章写进了本地库", A.artAll().length >= 2, A.artAll().length + " 篇");

  /* ---- 8. 联网开关的联动：关掉就该禁用，而不是偷偷发请求 ---- */
  A.RD_SET("discover"); A.go("read");
  var pull = document.getElementById("rdPull");
  ok("关掉联网后「拉取推荐」被禁用", !!pull && pull.disabled === true, pull ? String(pull.disabled) : "没有按钮");
  ok("关掉联网时状态条给出离线导入的出路", document.body.innerHTML.indexOf("粘贴导入") >= 0);
  A.getDB().cfg.netOff = false;
  A.go("read");
  ok("打开联网后按钮恢复可用", document.getElementById("rdPull").disabled === false);

  /* 清理：不留痕 */
  A.setDB(A.blankDB()); A.go("today");

  } catch (e) {
    ok("探针跑到底（中途没抛异常）", false, e.message);
  }

  log.unshift("RESULT " + pass + " / " + (pass + fail) + "  (失败 " + fail + ")");
  document.title = "PROBE::" + log.join(" || ");
})();
`;

/* 外面再兜一层 try：万一连 ok() 本身都挂了，也要把消息写进标题，不能静默 */
const html = base.replace("</body>", `<script>window.addEventListener('load',function(){setTimeout(function(){try{${probe}}catch(e){document.title="PROBE::THROW " + e.message + " @ " + String(e.stack||"").split("\\n").slice(1,3).join(" ~ ");}},700);});</script></body>`);
const vp = path.join(TMP, "_verify_read.html");
fs.writeFileSync(vp, html, "utf8");

let out = "";
try {
  out = execFileSync(BROWSER, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--allow-file-access-from-files", "--virtual-time-budget=12000",
    "--window-size=1500,1120", "--dump-dom", "file:///" + vp.replace(/\\/g, "/"),
  ], { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
} catch (e) { out = String(e.stdout || e.message || ""); }

console.log("文章精读交互校验: " + path.basename(DIST));
const m = out.match(/<title>([\s\S]*?)<\/title>/);
if (!m) { console.log("  ! 没拿到探针输出（DOM 长度 " + out.length + "）"); process.exit(1); }
const lines = m[1].replace(/^PROBE::/, "").split(" || ");
lines.forEach((l) => console.log(l));
const rm = lines[0].match(/(\d+) \/ (\d+)  \(失败 (\d+)\)/);
const fails = rm ? Number(rm[3]) : 1;
console.log("=".repeat(58));
console.log(fails === 0 ? "结果: 通过 " + (rm ? rm[1] : "?") + " / 失败 0" : "结果: 失败 " + fails + " 项");
console.log("=".repeat(58));
/* 失败时保留注入后的页面，方便按行号定位抛异常的那一句 */
if (fails) console.log("调试文件（含行号）：" + vp); else fs.unlinkSync(vp);
process.exit(fails ? 1 : 0);
