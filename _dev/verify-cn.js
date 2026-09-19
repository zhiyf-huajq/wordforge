// 用【真实抓下来的页面】验证中国英文媒体的解析链路。
// 断言的是「这一段真实 HTML 能不能被解析出正文」，而不是对着源码做字符串匹配。
//
// 夹具来自 2026-09-18 的真实抓取（脚本 _probe_list.py / _probe_struct2.py 产出）：
//   _cd_col.html   https://www.chinadaily.com.cn/china/index.html   栏目页
//   _cd_art.html   https://www.chinadaily.com.cn/a/202609/18/WS6aac955be4b06d4aa055eb95.html
//   _gt_art.html   https://www.globaltimes.cn/page/202608/1368830.shtml
//   _gt_feed.txt   https://www.globaltimes.cn/rss/outbrain.xml
// 站点改版后夹具会过期 —— 届时重新抓一份即可，别为了让它变绿去放宽断言。
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
const D = __dirname;
const html = fs.readFileSync(file, "utf8");

const scripts = [];
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html)) !== null) if (!/\bsrc\s*=/.test(m[1])) scripts.push(m[2]);
const dataCode = scripts.find((s) => s.indexOf("window.__WF=") >= 0) || "window.__WF={W:[],R:[],B:[]};";
const appCode = scripts.filter((s) => s.indexOf("window.__WF=") < 0).join("\n;\n");

const STUB = fs.readFileSync(path.join(D, "_stub_dom.js"), "utf8");

let API = null, runErr = null;
try {
  API = new Function(STUB + "\n" + dataCode + "\n;\n" + appCode + "\n;return globalThis.__WFAPI;")();
} catch (e) { runErr = e; }

const out = [];
function p(s) { out.push(s); console.log(s); }
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; p("  ✓ " + name); }
  else { fail++; p("  ✗ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
function read(f) { try { return fs.readFileSync(path.join(D, f), "utf8"); } catch (e) { return ""; } }

p("中国英文媒体解析验证（真实页面夹具）");
p("");
if (runErr) { p("脚本执行失败: " + runErr.message); process.exit(1); }

const cdCol = read("_cd_col.html");
const cdArt = read("_cd_art.html");
const gtArt = read("_gt_art.html");
const gtFeed = read("_gt_feed.txt");

p("[1] 夹具");
t("中国日报栏目页夹具已就位", cdCol.length > 20000, cdCol.length);
t("中国日报文章页夹具已就位", cdArt.length > 20000, cdArt.length);
t("环球时报文章页夹具已就位", gtArt.length > 10000, gtArt.length);
t("环球时报 RSS 夹具已就位", gtFeed.length > 5000, gtFeed.length);

p("");
p("[2] 中国日报 · 栏目页 → 文章列表");
const list = API.csPickList("cnd-china", cdCol);
t("解析出 >= 10 篇文章", list.length >= 10, list.length);
t("每条都有标题与链接", list.every((x) => x.title && x.url), list.slice(0, 2));
t("链接都是 https 绝对地址", list.every((x) => /^https:\/\/www\.chinadaily\.com\.cn\/a\/\d{4}\d{2}\/\d{2}\/[^"]+\.html$/.test(x.url)),
  list[0] && list[0].url);
t("链接不含分页后缀（_2 / _3 那些是同题后续页）", list.every((x) => !/_\d\.html$/.test(x.url)));
t("日期解析成 YYYY-MM-DD", list.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.d)), list[0] && list[0].d);
t("标题不含 HTML 标签或实体残留", list.every((x) => x.title.indexOf("<") < 0 && x.title.indexOf("&") < 0),
  list.find((x) => x.title.indexOf("<") >= 0 || x.title.indexOf("&") >= 0));
t("无重复链接", new Set(list.map((x) => x.url)).size === list.length);
p("      样本: " + (list[0] ? list[0].d + "  " + list[0].title.slice(0, 60) : "-"));
p("      样本: " + (list[1] ? list[1].d + "  " + list[1].title.slice(0, 60) : "-"));

p("");
p("[3] 中国日报 · 文章页 → 正文段落");
const cdPs = API.csParas("cnd-china", cdArt);
const cdTitle = API.pickTitle(cdArt, "cnd-china");
t("提取出 >= 5 个段落（真实文章是 7 段）", cdPs.length >= 5, cdPs.length);
t("标题提取正确", /farming/i.test(cdTitle), cdTitle);
t("标题不含站点名后缀", cdTitle.indexOf("Chinadaily") < 0, cdTitle);
t("段落是纯文本（无标签残留）", cdPs.every((x) => x.indexOf("<") < 0 && x.indexOf(">") < 0));
t("段落无 HTML 实体残留", cdPs.every((x) => !/&(amp|nbsp|quot|#\d+);/.test(x)),
  cdPs.find((x) => /&(amp|nbsp|quot|#\d+);/.test(x)));
t("每段都有实质长度（>= 30 字符）", cdPs.every((x) => x.length >= 30));
t("没有把图片说明当成正文开头（图注在 figcaption 里，不该混进来）",
  (cdPs[0] || "").indexOf("[Photo provided to CHINA DAILY]") < 0, (cdPs[0] || "").slice(0, 80));
p("      正文首段: " + (cdPs[0] || "").slice(0, 110));

p("");
p("[4] 环球时报 · RSS → 文章列表");
const gt = API.csPickList("gt", gtFeed);
t("解析出 >= 15 条（列表上限 18，feed 本身有 50 条）", gt.length >= 15, gt.length);
t("每条都有标题与链接", gt.every((x) => x.title && x.url));
t("链接限定在本站", gt.every((x) => x.url.indexOf("https://www.globaltimes.cn/") === 0));
t("日期解析成 YYYY-MM-DD", gt.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.d)), gt[0] && gt[0].d);
t("标题无标签残留", gt.every((x) => x.title.indexOf("<") < 0));
t("无重复链接", new Set(gt.map((x) => x.url)).size === gt.length);
p("      样本: " + (gt[0] ? gt[0].d + "  " + gt[0].title.slice(0, 60) : "-"));

p("");
p("[5] 环球时报 · 文章页 → 正文段落");
const gtPs = API.csParas("gt", gtArt);
t("提取出 >= 3 个段落", gtPs.length >= 3, gtPs.length);
t("不是只抓到图片说明（正文得比图注长）", gtPs.some((x) => x.length > 300), gtPs.map((x) => x.length));
t("段落是纯文本", gtPs.every((x) => x.indexOf("<") < 0));
const gtArtTitle = API.pickTitle(gtArt, "gt");
const gtFeedTitle = (gt[0] && gt[0].title) || "";
t("文章页与 RSS 里的标题一致（说明两边解析的是同一篇）",
  gtArtTitle.length > 10 && gtArtTitle.slice(0, 24) === gtFeedTitle.slice(0, 24),
  [gtArtTitle.slice(0, 34), gtFeedTitle.slice(0, 34)]);
p("      正文首段: " + (gtPs[0] || "").slice(0, 110));

p("");
p("[6] 源清单与白名单");
const cs = API.CSRC;
t("中国源共 6 个（中国日报五栏目 + 环球时报）", cs.length === 6, cs.length);
t("源 id 不重复", new Set(cs.map((x) => x.id)).size === cs.length);
t("每个源的主机都在白名单里", cs.every((x) => API.netHostOK("https://" + x.host + "/x")), cs.map((x) => x.host));
t("中国日报各栏目列表地址正确", API.csListURL("cnd-world") === "https://www.chinadaily.com.cn/world/index.html", API.csListURL("cnd-world"));
t("环球时报列表走 RSS", API.csListURL("gt") === "https://www.globaltimes.cn/rss/outbrain.xml", API.csListURL("gt"));
t("中转服务域名已进白名单", API.netHostOK("https://cors.eu.org/x") && API.netHostOK("https://api.allorigins.win/x"));
t("中转服务有两个备选", API.NETBR.length >= 2, API.NETBR.map((b) => b.id));
t("非白名单域名仍被拒绝", API.netHostOK("https://evil.example.com/x") === false);
t("http 明文仍被拒绝", API.netHostOK("http://www.chinadaily.com.cn/x") === false);

p("");
p("[7] 兜底解析（改版容错）");
const weird = "<html><body><div id='Content'><p>" + "A".repeat(120) + "</p><p>" + "B".repeat(120) + "</p></div></body></html>";
t("没有分页标记时也能截出正文", API.csParas("cnd-china", weird).length === 2, API.csParas("cnd-china", weird).length);
t("完全陌生的结构退到全页抽 p", API.csParas("cnd-china", "<p>" + "C".repeat(80) + "</p>").length === 1);
t("空页面不抛异常，返回空数组", API.csParas("cnd-china", "").length === 0);
t("乱码/非 HTML 不抛异常", API.csParas("gt", "@@@@not html@@@@").length === 0);

p("");
p("结果: 通过 " + pass + " / 失败 " + fail);
fs.writeFileSync(path.join(D, "_verify_cn.log"), out.join("\n"), "utf8");
process.exit(fail === 0 ? 0 : 1);
