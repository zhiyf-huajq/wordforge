// 端到端实测：真实浏览器里，中国英文媒体链路到底能不能取到文章。
//
// 为什么非要有这一层：verify-cn.js 验的是「解析器对夹具有效」，
// 但真正决定成不成的还有两件事，夹具都测不到 ——
//   ① 源站对浏览器发出的跨域请求是否真的放行（夹具是 Python 抓的，不受同源策略约束）；
//   ② 中转服务在真实请求路径上是否真的把内容带回来了。
// 所以这一层用真实 Chrome 跑真实网络请求，断言「文章确实进了本地库，而且有正文」。
//
// 用法：node _dev/verify-cn-live.js [dist路径]
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2] : path.join(ROOT, "dist", "词匠-离线背单词.html");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BROWSER = fs.existsSync(CHROME) ? CHROME : EDGE;
/* 端口按进程号取，避开 check-mobile-view.js（也用进程号，但基数不同），
   免得两个脚本同时跑时抢同一个调试端口。 */
const PORT = 9700 + (process.pid % 200);
const PROFILE = path.join(ROOT, "_dev", "_cdp_probe_" + process.pid);
const LOGF = path.join(ROOT, "_dev", "_cnd_live.log");

fs.writeFileSync(LOGF, "");
function say(s) {
  const t = s + "\n";
  try { fs.appendFileSync(LOGF, t); } catch (e) { }
  process.stdout.write(t);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PROC = null, CDPX = null, PROBEF = null;
function cleanup() {
  try { if (CDPX) CDPX.close(); } catch (e) { }
  try { if (PROC) PROC.kill(); } catch (e) { }
  try { if (PROFILE) fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { }
  try { if (PROBEF) fs.rmSync(PROBEF, { force: true }); } catch (e) { }
}

function getJSON(url, ms) {
  return new Promise((res, rej) => {
    const req = http.get(url, (r) => {
      let d = "";
      r.on("data", (c) => d += c);
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on("error", rej);
    req.setTimeout(ms || 3000, () => req.destroy(new Error("http timeout")));
  });
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("WebSocket 握手超时")), 10000);
      this.ws.onopen = () => { clearTimeout(t); res(); };
      this.ws.onerror = () => { clearTimeout(t); rej(new Error("WebSocket 连接失败")); };
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    };
  }
  async send(method, params, ms) {
    await this.ready;
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error("CDP 超时: " + method)); }, ms || 20000);
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  /* run 把代码包进 try{}，所以求值表达式必须显式 return —— 漏了会拿到 undefined，
     表现是「明明执行了却取不到值」，很容易误判成功能没生效。 */
  async run(code, ms) {
    const r = await this.send("Runtime.evaluate", {
      expression: "(function(){try{" + code + "}catch(e){return 'ERR:'+e.message}})()",
      returnByValue: true,
    }, ms || 30000);
    return r && r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; say("  ✓ " + name); }
  else { fail++; say("  ✗ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
}
async function waitIdle(cdp, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await cdp.run('return String(window.__WFAPI.rdCNState().busy === "")');
    if (v === "true") return true;
    await sleep(350);
  }
  say("  (等待 " + label + " 超时 " + ms + "ms)");
  return false;
}

(async () => {
  if (!fs.existsSync(DIST)) { say("! 找不到交付物: " + DIST); process.exit(1); }
  say("端到端实测：中国英文媒体取文（真实浏览器 + 真实网络）");
  say("浏览器: " + path.basename(BROWSER));
  say("");

  let busy = null;
  try { busy = await getJSON("http://127.0.0.1:" + PORT + "/json/version", 1200); } catch (e) { }
  if (busy) { say("! 调试端口 " + PORT + " 被占用"); cleanup(); process.exit(1); }

  fs.rmSync(PROFILE, { recursive: true, force: true });
  PROC = spawn(BROWSER, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--allow-file-access-from-files", "--remote-debugging-port=" + PORT,
    "--remote-allow-origins=*", "--user-data-dir=" + PROFILE, "about:blank",
  ], { stdio: "ignore" });

  let list = null;
  for (let i = 0; i < 60; i++) {
    try { list = await getJSON("http://127.0.0.1:" + PORT + "/json/list", 2500); if (list && list.length) break; } catch (e) { }
    await sleep(250);
  }
  const target = (list || []).find((x) => x.type === "page");
  if (!target) { say("! 连不上 Chrome"); cleanup(); process.exit(1); }

  const cdp = new CDP(target.webSocketDebuggerUrl);
  CDPX = cdp;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const PROBE = path.join(ROOT, "_dev", "_cnd_probe_" + process.pid + ".html");
  PROBEF = PROBE;
  fs.copyFileSync(DIST, PROBE);
  await cdp.send("Page.navigate", { url: "file:///" + PROBE.replace(/\\/g, "/") });

  let ready = false;
  for (let i = 0; i < 70; i++) {
    await sleep(400);
    if ((await cdp.run('return String(!!(window.__WFAPI && window.__WFAPI.go))')) === "true") { ready = true; break; }
  }
  if (!ready) { say("! 页面没能就绪"); cleanup(); process.exit(1); }
  say("页面就绪");
  say("");

  const A = "window.__WFAPI";
  /* 界面上的错误提示（失败时用来归因：是中转挂了还是应用坏了） */
  let lastHint = "";

  /* ---------- 1. 中国日报：栏目页列表（直连） ---------- */
  say("[1] 中国日报 · 栏目页列表");
  await cdp.run('var A = window.__WFAPI; A.go("read"); A.rdCNSel("cnd-china"); A.rdCNPull(); return "go";');
  await waitIdle(cdp, 45000, "列表");
  let st = await cdp.run('var s=window.__WFAPI.rdCNState(); return JSON.stringify({n:s.list?s.list.length:-1, busy:s.busy, first:s.list&&s.list[0]?s.list[0].title:"", d:s.list&&s.list[0]?s.list[0].d:""});');
  let o = null;
  try { o = JSON.parse(st); } catch (e) { o = { n: -1, raw: String(st).slice(0, 160) }; }
  say("      状态: " + JSON.stringify(o).slice(0, 220));
  t("真实浏览器里取到了中国日报栏目列表", o && o.n >= 5, o && o.n);
  t("列表里第一条是正常的新闻标题（不是导航或乱码）",
    !!(o && o.first && o.first.length >= 12 && o.first.length <= 200), o && o.first);
  t("第一条带日期", !!(o && /^\d{4}-\d{2}-\d{2}$/.test(o.d)), o && o.d);

  /* ---------- 2. 中国日报：文章正文（走中转，因为源站不给跨域头） ---------- */
  say("");
  say("[2] 中国日报 · 文章正文（源站不放行跨域 → 应经中转取回）");
  const before = await cdp.run('return String(window.__WFAPI.artAll().length)');
  await cdp.run('window.__WFAPI.rdCNGrab(0); return "grab";');
  await waitIdle(cdp, 90000, "正文");
  let art = await cdp.run('var a=window.__WFAPI.artAll().filter(function(x){return x.src==="中国日报";})[0]; if(!a) return "none"; return JSON.stringify({t:a.t, n:a.ps.length, via:a.via||"", src:a.src, p0:(a.ps[0]||"").slice(0,120), long:Math.max.apply(null,a.ps.map(function(x){return x.length}))});');
  let a1 = null;
  try { a1 = JSON.parse(art); } catch (e) { a1 = { t: "解析失败", raw: String(art).slice(0, 200) }; }
  say("      文章: " + JSON.stringify(a1).slice(0, 300));
  /* 失败时把界面上的那条提示原样打出来。
     只报「文章: 解析失败」等于什么也没说 —— 分不清是「中转限流了，等一会儿再来」
     还是「这个源本来就取不到」，而这两种情况要做的事完全不同。
     提示里现在带着逐个中转的失败原因（429 / 500 / 超时 / 返回的不是正文）。 */
  if (!(a1 && a1.t && a1.t !== "none" && a1.t !== "解析失败")) {
    const msg = await cdp.run('var m=window.__WFAPI.rdMsg(); return m?JSON.stringify(m):"none";');
    say("      界面提示: " + String(msg).slice(0, 400));
    try { lastHint = JSON.parse(msg).hint || JSON.parse(msg).text || ""; } catch (e) { lastHint = String(msg); }
  }
  t("文章确实落进了本地库", a1 && a1.t && a1.t !== "none" && a1.t !== "解析失败");
  t("正文有 >= 5 个段落", !!(a1 && a1.n >= 5), a1 && a1.n);
  t("正文里有长段落（不是只抓到标题/图说）", !!(a1 && a1.long > 200), a1 && a1.long);
  t("来源标成中国日报", !!(a1 && a1.src === "中国日报"), a1 && a1.src);
  t("如实标注了经中转取回（源站不放行跨域，这是唯一可行的路）", !!(a1 && a1.via), a1 && a1.via);

  /* ---------- 3. 环球时报：全程直连 ---------- */
  say("");
  say("[3] 环球时报 · RSS 列表 + 文章正文（应全程直连，不经中转）");
  await cdp.run('window.__WFAPI.rdCNSel("gt"); window.__WFAPI.rdCNPull(); return "go";');
  await waitIdle(cdp, 45000, "GT 列表");
  let st2 = await cdp.run('var s=window.__WFAPI.rdCNState(); return JSON.stringify({n:s.list?s.list.length:-1,first:s.list&&s.list[0]?s.list[0].title:""});');
  let o2 = null;
  try { o2 = JSON.parse(st2); } catch (e) { o2 = { n: -1 }; }
  say("      状态: " + JSON.stringify(o2).slice(0, 200));
  t("真实浏览器里取到了环球时报列表", o2 && o2.n >= 5, o2 && o2.n);

  const n0 = await cdp.run('return String(window.__WFAPI.artAll().length)');
  await cdp.run('window.__WFAPI.rdCNGrab(0); return "grab";');
  await waitIdle(cdp, 90000, "GT 正文");
  /* 按来源挑，别按 artAll()[0] 挑 —— 那个排序键是 rd.ts（阅读时间），
     刚取回来的文章还没读过、ts 都是 0，排序会退化成按日期排，
     于是「最新取回的」未必排在第一位，断言会盯错对象。 */
  let art2 = await cdp.run('var a=window.__WFAPI.artAll().filter(function(x){return x.src==="环球时报";})[0]; if(!a) return "none"; return JSON.stringify({t:a.t, n:a.ps.length, via:a.via||"", src:a.src, long:Math.max.apply(null,a.ps.map(function(x){return x.length}))});');
  let a2 = null;
  try { a2 = JSON.parse(art2); } catch (e) { a2 = { t: "解析失败" }; }
  say("      文章: " + JSON.stringify(a2).slice(0, 300));
  t("环球时报文章也进了库", !!(a2 && a2.t && a2.t !== "none" && a2.t !== "解析失败"));
  t("正文有 >= 2 个段落", !!(a2 && a2.n >= 2), a2 && a2.n);
  t("来源标成环球时报", !!(a2 && a2.src === "环球时报"), a2 && a2.src);
  t("这个源是直连取回的（不需要中转）", !!(a2 && !a2.via), a2 && a2.via);

  /* ---------- 4. 关掉中转 → 中国日报正文应当取不到并给出可读原因 ---------- */
  say("");
  say("[4] 关掉中转开关后的行为（证明中转确实在起作用）");
  await cdp.run('window.__WFAPI.getDB(); var c=window.__WFAPI.getDB().cfg; c.noBridge=true; return "off";');
  await cdp.run('window.__WFAPI.rdCNSel("cnd-china"); window.__WFAPI.rdCNPull(); return "go";');
  await waitIdle(cdp, 45000, "直连列表");
  const listDirect = await cdp.run('var s=window.__WFAPI.rdCNState(); return String(s.list?s.list.length:-1)');
  say("      直连（关中转）栏目页列表条数: " + listDirect);
  t("栏目页直连本来就能用（它放行跨域），关掉中转不受影响",
    Number(listDirect) >= 5, listDirect);
  const nBefore = await cdp.run('return String(window.__WFAPI.artAll().length)');
  await cdp.run('window.__WFAPI.rdCNGrab(0); return "grab";');
  await waitIdle(cdp, 60000, "关中转取正文");
  const nAfter = await cdp.run('return String(window.__WFAPI.artAll().length)');
  t("关掉中转后，不放行跨域的文章页确实取不到（不会静默入库一篇空文章）",
    Number(nAfter) === Number(nBefore), { before: nBefore, after: nAfter });
  await cdp.run('var c=window.__WFAPI.getDB().cfg; c.noBridge=false; return "on";');

  say("");
  say("结果: 通过 " + pass + " / 失败 " + fail);
  /* ---- 归因：把「外部依赖挂了」和「应用坏了」分开说清 ----
     中国日报正文这条路**天然要经过第三方公益中转**，而公益中转会限流甚至整体挂掉
     （2026-09-18 实测两个同时不可用）。这时候退出码仍然是失败（决不能放宽断言），
     但日志里必须写明失败在哪一侧 —— 否则下次看到红，还得重新查一遍才知道该修代码还是等一会儿。
     判据：① 直连的两条路（中国日报列表、环球时报正文）都通过；
           ② 界面提示里带着中转的失败原因（429 / 500 / 超时）。
     两条同时成立 = 应用侧正常，挂的是中转。 */
  const directOK = !!(o && o.n >= 5) && !!(a2 && a2.t && a2.t !== "解析失败");
  const bridgeDown = /中转服务都没能取回|cors\.eu\.org|AllOrigins/.test(String(lastHint || ""));
  if (fail > 0 && directOK && bridgeDown) {
    say("");
    say("⚠ 归因：失败集中在「中国日报正文经中转」这一条路上，而两条**直连**路径");
    say("  （中国日报栏目列表、环球时报 RSS + 正文）都通过了 ——");
    say("  说明应用侧与网络都正常，挂的是第三方公益中转服务：");
    say("  " + String(lastHint).slice(0, 240));
    say("  这一层不因此判绿（中转真的不可用时，用户确实读不到中国日报的正文，");
    say("  那是真实的可用性下降，不该被测试糊过去）。");
  }
  cleanup();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  say("! 脚本异常: " + (e && e.message));
  cleanup();
  process.exit(1);
});
