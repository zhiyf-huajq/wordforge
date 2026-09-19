// 第六层验证：手机视口下的布局溢出诊断（CDP 设备模拟）
//
// 为什么必须走 CDP：headless Chrome 的窗口有 512 DIP 最小宽度，
//   传 --window-size=390 时页面仍按 512px 布局、只截 390px 宽 ——
//   右侧被裁掉，看起来像「布局溢出了」，其实是伪影。
//   只有 Emulation.setDeviceMetricsOverride({mobile:true}) 才会真正按窄屏布局。
//
// 用法：node _dev/check-mobile-view.js [dist路径] [--shoot]
//
// 血泪教训（都在这份脚本里堵住了）：
//   · http.get 必须设超时 —— 端口被占但无人响应时，不设超时会让整个脚本永久挂起，
//     而且表现是「一行日志都没有」，极难定位。
//   · CDP 的每个命令也要设超时，WebSocket 握手同理。
//   · 交付物名带中文时，直接拼进 file:// 会让导航落到 chrome-error（CDP 不做百分号编码），
//     必须先拷一份 ASCII 名的副本。
//   · returnByValue 回来的是真布尔，别拿它跟字符串 "true" 比。
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2] : path.join(ROOT, "dist", "词匠-离线背单词.html");
const SHOOT = process.argv.indexOf("--shoot") >= 0;
/* --focus：跳过 57 次布局诊断，只跑交互段。
   每切换一个场景都要重新加载 11.5MB 的单文件产物，57 次就是好几分钟；
   改一行交互代码却要等 8 分钟才能看到结果，迭代成本太高。
   布局那部分本身很少出错，日常改交互用这个开关，交付前再跑全量。 */
const FOCUS = process.argv.indexOf("--focus") >= 0;
/* --scene=设置,统计  --width=360：只跑指定的场景 / 宽度。
   全量跑一次要 6–8 分钟（57 次 11.5MB 页面加载），而改一处版式时
   真正需要复看的往往只有一两个场景、一档宽度。没有这个开关的话，
   每改一行 CSS 都要等一整个循环，实际结果是「懒得验」。 */
const SCENE_F = (function () {
  const a = process.argv.filter((x) => x.indexOf("--scene=") === 0)[0];
  return a ? a.slice(8).split(",").filter(Boolean) : null;
})();
const WIDTH_F = (function () {
  const a = process.argv.filter((x) => x.indexOf("--width=") === 0)[0];
  return a ? a.slice(8).split(",").map(Number).filter(Boolean) : null;
})();
const SHOTDIR = path.join(ROOT, "preview");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BROWSER = fs.existsSync(CHROME) ? CHROME : EDGE;
/* 端口与用户目录都按进程号取，不要写死。
   写死的教训：上一轮脚本被中途 kill 掉时，它拉起来的 Chrome 还活着，
   仍然占着 9372 与 _cdp_profile。下一次跑的时候新 Chrome 会因为「同一个用户目录
   已有实例」而把请求转交过去然后自己退出，脚本则卡在轮询调试端口上 ——
   症状是「一行日志都没有，一直挂着」，和端口被占那种情况长得一模一样，极难定位。
   按 pid 命名既避开残留实例，也允许两个人同时跑。 */
const PORT = 9300 + (process.pid % 500);
const PROFILE = path.join(ROOT, "_dev", "_cdp_profile_" + process.pid);
const LOGF = path.join(ROOT, "_dev", "mobile.log");

/* 同步写日志：管道重定向会缓冲，进程被中途杀掉时缓冲就丢了 —— 排查卡死时最需要日志 */
fs.writeFileSync(LOGF, "");
function say(s) {
  const t = s + "\n";
  try { fs.appendFileSync(LOGF, t); } catch (e) { }
  process.stdout.write(t);
}

if (!fs.existsSync(DIST)) { say("! 找不到交付物：" + DIST); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 统一收尾：不管怎么退出（正常 / 报错 / 提前 return），都要把 Chrome 关掉、
   把临时配置目录删掉。否则残留的实例会占着端口和用户目录，
   让下一次运行卡在轮询阶段 —— 那个症状极难往「上上次没退干净」上想。 */
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
      this.pending.set(id, {
        res: (v) => { clearTimeout(t); res(v); },
        rej: (e) => { clearTimeout(t); rej(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  /** code 是语句块，可含 return —— 必须支持多语句，否则「切视图 + 点档位」这种组合做不了 */
  async run(code) {
    const r = await this.send("Runtime.evaluate", {
      expression: "(function(){try{" + code + "}catch(e){return 'ERR:'+e.message}})()",
      returnByValue: true,
    }, 30000);
    return r && r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

/* 溢出诊断：遍历所有可见元素，找出右边界越过视口宽度的那些。
   两条判据，缺一条就会误报：
     ① 元素落在**可横向滚动的祖先**里（例如 26 周热力图外面套的那层 overflow-x:auto）——
        那是刻意的局部滚动区，用户滑得到、页面本身也不横滚，不算布局缺陷，单独计数。
     ② 其余才算真溢出，并把祖先链（tag.cls:宽度@左偏移）打出来 ——
        光知道「谁溢出」不够，得知道「它爹为什么装不下它」。 */
const DIAG = `(function(){
  var W = document.documentElement.clientWidth, bad = [], inScroll = 0;
  var all = document.querySelectorAll('body *');
  function name(p){ return p.tagName.toLowerCase() + (p.id ? '#' + p.id : (p.className ? '.' + String(p.className).split(' ')[0] : '')); }
  function scrollable(el){
    var p = el.parentElement;
    while (p && p !== document.documentElement) {
      var ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  }
  for (var i = 0; i < all.length; i++) {
    var el = all[i], r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > W + 0.5) {
      if (scrollable(el)) { inScroll++; continue; }
      bad.push({ el: el, tag: el.tagName.toLowerCase(), id: el.id || '',
        cls: String(el.className || '').slice(0, 34),
        w: Math.round(r.width), over: Math.round(r.right - W) });
    }
  }
  bad.sort(function(a,b){ return b.over - a.over; });
  var top = bad.slice(0,5).map(function(t){
    var ch = [], p = t.el;
    for (var k = 0; k < 5 && p; k++) {
      var rr = p.getBoundingClientRect();
      ch.push(name(p) + ':' + Math.round(rr.width) + '@' + Math.round(rr.left));
      p = p.parentElement;
    }
    return { tag:t.tag, id:t.id, cls:t.cls, w:t.w, over:t.over, chain: ch.join(' < ') };
  });
  return JSON.stringify({ w: W, sw: document.documentElement.scrollWidth, n: bad.length, inScroll: inScroll, top: top });
})()`;

const TAGS = ["today", "library", "stats", "settings", "read", "study", "art"];
const WIDTHS = [360, 390, 412];

/* ===== 「文字被挤成竖条」诊断 =====
   这是**溢出诊断的镜像盲区**，必须单独量一次。
   溢出诊断找的是「有没有东西超出视口」；而下面这个 bug 恰恰相反 ——
   没有任何元素超出视口，文档宽度一点没变，`scrollWidth === clientWidth` 完美成立，
   但左边的说明文字被压到只剩 1 个字宽，四字标题「起点词书」竖着排成四行。
   起因是 `<select>` 的自动最小尺寸 = 它最宽那个 `<option>` 的宽度：
   选项里有「大学英语六级（6,975 词）」时下拉撑到 430px 且**拒绝收缩**，
   把同一行里 flex:1 的说明块啃到 0。
   → 结构层、逻辑层、手机视口层（只看溢出）**全部零报错**，只有截图看得见。
   判据：说明块宽度 / 所在行宽度 < 0.34 且文本长度 ≥ 10 字。
   实测坏掉的两行比值是 0.06 / 0.08，正常行都在 0.6 以上，中间留了很宽的余量。 */
const SQUEEZE = `(function(){
  var bad = [], rows = document.querySelectorAll('.setrow');
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i], t = row.querySelector('.setrow-t');
    if (!t) continue;
    var rr = row.getBoundingClientRect(), tr = t.getBoundingClientRect();
    var txt = String(t.textContent || '').replace(/\\s+/g, '');
    if (txt.length < 10) continue;
    var ratio = rr.width ? tr.width / rr.width : 1;
    if (ratio < 0.34) bad.push({ cls: String(t.className || ''), w: Math.round(tr.width),
      row: Math.round(rr.width), ratio: Math.round(ratio * 100) / 100, txt: txt.slice(0, 16) });
  }
  return JSON.stringify({ n: bad.length, top: bad.slice(0, 4) });
})()`;

const SCENES = [
  ["today", "今日总览", `A.go("today");return "ok";`],
  ["study", "学习卡片", `try{A.startSession("new");}catch(e){}A.go("study");return "ok";`],
  ["review", "复习队列", `A.go("review");return "ok";`],
  ["quiz", "测试中心", `A.go("quiz");return "ok";`],
  ["library", "词库", `A.go("library");return "ok";`],
  ["bookpage", "词书详情页", `A.jumpBook("cet6");return "ok";`],
  ["worddetail", "词条详情", `A.jumpWord("abandon");return "ok";`],
  ["forms", "词形变化页", `A.jumpTo("forms","happy","");return "ok";`],
  ["colls", "固定搭配页", `A.jumpTo("colls","happy","");return "ok";`],
  ["stats", "统计", `A.go("stats");return "ok";`],
  ["settings", "设置", `A.go("settings");return "ok";`],
  ["read", "精读主页", `A.go("read");return "ok";`],
  ["art", "精读台·显释义", `A.jumpTo("art",__ARTID,"");var b=document.querySelector('[data-assist="2"]');if(b)b.click();return "ok";`],
  ["artq", "读后练习", `A.jumpTo("artq",__ARTID,"");return "ok";`],
  /* 易混词页：一屏几十组，是「长列表 + 逐行三段文字」最容易在窄屏挤爆的地方 */
  ["confuse", "易混词", `A.go("confuse");return "ok";`],
  ["confusesearch", "易混词·搜索结果", `A.go("confuse");A.setCFQ("a");return "ok";`],
  /* 词汇量测试三态各占一屏，字号最大（.vlword 用 clamp 到 52px），必须单独量 */
  ["vocab", "词汇量·介绍", `A.go("vocab");return "ok";`],
  ["vocabask", "词汇量·答题", `A.go("vocab");A.vlStart();return "ok";`],
  ["vocabdone", "词汇量·结果", `A.go("vocab");A.vlStart();
     for(var i=0;i<60&&A.vlState().phase==="ask";i++){var s=A.vlState();A.vlAnswer(s.last&&s.last.fake?false:(s.cur<=4));}
     return "ok";`],
];

/* 造一篇够长的文章 —— 精读台和练习页是内容最满的地方，最容易溢出。
   ① 模板字符串不能以换行开头：拼成 "return " + SETUP 时换行会触发 ASI，变成裸 return;
   ② API 要挂到 window.A 上 —— 场景代码是独立求值的，拿不到这里的局部变量。 */
const SETUP = `(function(){
  var A = window.__WFAPI;
  var TXT = "Climate change is the long-term shift in global temperatures and weather patterns. "
    + "Scientists have observed this shift since the pre-industrial period, and the evidence is now overwhelming. "
    + "The main cause is the burning of fossil fuels, which releases greenhouse gases into the atmosphere. "
    + "Rising temperatures have already led to more extreme weather events around the world.\\n\\n"
    + "Melting ice sheets are raising sea levels along many densely populated coastlines. "
    + "Many species are moving toward the poles in search of cooler conditions. "
    + "Governments have promised to cut emissions substantially in the coming decades. "
    + "Whether those promises will actually be kept remains an open and urgent question.";
  var art = A.artMk({ t: "Mobile layout probe article", text: TXT, src: "验证来源", lic: "CC BY-SA" });
  A.artSave(art);
  window.A = A;
  window.__ARTID = art.id;
  return "ok";
})()`;

(async () => {
  say("手机视口溢出诊断: " + path.basename(DIST));
  say("浏览器 " + path.basename(BROWSER) + " · 视口 " + WIDTHS.join(" / ") + " · 场景 " + SCENES.length + " 个");
  say("");

  /* 先确认端口没被占：被占时直接说清楚，别让脚本挂在轮询里报一句含糊的话。
     这类「看着像卡死」的问题，九成是上次没退干净的浏览器实例。 */
  let busy = null;
  try { busy = await getJSON("http://127.0.0.1:" + PORT + "/json/version", 1200); } catch (e) { }
  if (busy) {
    say("! 调试端口 " + PORT + " 已被另一个浏览器实例占用（多半是上次没退干净的 headless Chrome）");
    say("  处理：关掉残留的无头 Chrome 后重跑。本次端口按进程号取（" + process.pid + "），正常不该冲突。");
    cleanup();
    process.exit(1);
  }

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
  const target = (list || []).find((t) => t.type === "page");
  if (!target) {
    say("! 连不上 Chrome（" + PORT + " 端口没有可用的页面目标）");
    cleanup();
    process.exit(1);
  }
  say("已连上调试端口，页面目标数 " + list.length);

  const cdp = new CDP(target.webSocketDebuggerUrl);
  CDPX = cdp;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 1400, deviceScaleFactor: 2, mobile: true,
  });

  /* 交付物名带中文，直接塞进 file:// 会让导航落到 chrome-error（CDP 不做百分号编码）。
     拷一份 ASCII 名的副本再加载，顺带避免同名文件被缓存。名字也带 pid，
     免得两次运行同时存在时互相覆盖。 */
  const PROBE = path.join(ROOT, "_dev", "_mobile_probe_" + process.pid + ".html");
  PROBEF = PROBE;
  fs.copyFileSync(DIST, PROBE);
  await cdp.send("Page.navigate", { url: "file:///" + PROBE.replace(/\\/g, "/") });

  /* 11 MB 的单文件，解析要点时间；轮询到 API 就绪为止 */
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    const r = await cdp.run('return String(!!(window.__WFAPI && window.__WFAPI.go))');
    if (r === "true") { ready = true; break; }
  }
  if (!ready) {
    const info = await cdp.run('return JSON.stringify({href:String(location.href).slice(-30),rs:document.readyState,api:typeof window.__WFAPI})');
    say("! 页面没能在预期时间内就绪: " + info);
    cleanup();
    process.exit(1);
  }
  say("页面就绪，开始逐场景诊断");
  say("");

  const s = await cdp.run("return " + SETUP);
  if (s !== "ok") say("  (造文章返回 " + s + ")");

  let bad = 0, total = 0;
  if (FOCUS) say("（--focus：跳过布局诊断，只跑交互段）");
  const WS = FOCUS ? [] : (WIDTH_F || WIDTHS);
  const SET = SCENE_F ? SCENES.filter((x) => SCENE_F.indexOf(x[0]) >= 0) : SCENES;
  if (SCENE_F) {
    const hit = SET.map((x) => x[0]);
    const miss = SCENE_F.filter((k) => hit.indexOf(k) < 0);
    if (miss.length) say("! --scene 里有对不上的名字：" + miss.join(",") + "（可选：" + SCENES.map((x) => x[0]).join(",") + "）");
    say("（--scene 只跑 " + hit.join(",") + "；--width " + (WIDTH_F || WIDTHS).join(",") + "）");
  }
  for (const w of WS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: w, height: 1400, deviceScaleFactor: 2, mobile: true,
    });
    await sleep(200);
    for (const [key, label, code] of SET) {
      const r = await cdp.run(code);
      if (r !== "ok") { say("  ! " + w + "px " + label + " 切换失败: " + r); bad++; total++; continue; }
      await sleep(170);
      const raw = await cdp.run("return " + DIAG);
      let d = null;
      try { d = JSON.parse(raw); } catch (e) { }
      total++;
      if (!d) { say("  ! " + w + "px " + label + " 诊断失败: " + raw); bad++; continue; }
      const hscroll = d.sw > d.w + 1;
      /* 溢出诊断查「超出去」，这条查「被挤扁」—— 两个方向都要量，缺一个就是盲区 */
      const sqRaw = await cdp.run("return " + SQUEEZE);
      let sq = null;
      try { sq = JSON.parse(sqRaw); } catch (e) { }
      const squeezed = sq && sq.n > 0;
      const over = d.n > 0 || hscroll || squeezed;
      if (over) bad++;
      say("  " + (over ? "✗" : "✓") + " " + String(w).padStart(3) + "px " + label.padEnd(13)
        + (over ? " 溢出 " + d.n + " 处" + (hscroll ? " [横向滚动 " + d.sw + ">" + d.w + "]" : "") : "")
        + (squeezed ? " [文字被挤成竖条 " + sq.n + " 处]" : "")
        + (d.inScroll ? "  ▸局部横滑区 " + d.inScroll + " 个（设计如此）" : ""));
      if (squeezed) sq.top.forEach((t) => {
        say("        · " + t.cls + " 宽 " + t.w + " / 行 " + t.row + "（占 " + t.ratio + "）：" + t.txt + "…");
      });
      if (over) d.top.slice(0, 3).forEach((t) => {
        say("        · <" + t.tag + (t.id ? "#" + t.id : "") + (t.cls ? "." + t.cls.split(" ")[0] : "")
          + "> 超 " + t.over + "px (宽 " + t.w + ")");
        if (t.chain) say("          祖先链: " + t.chain);
      });
      if (SHOOT && w === 390 && TAGS.indexOf(key) >= 0) {
        const png = await cdp.send("Page.captureScreenshot", { format: "png" }, 30000);
        fs.mkdirSync(SHOTDIR, { recursive: true });
        fs.writeFileSync(path.join(SHOTDIR, "apk_" + key + "_390.png"), Buffer.from(png.data, "base64"));
      }
    }
  }

  /* ================= 交互实测 =================
     这一节是补上来的。原来第六层只诊断「布局有没有溢出」，不看「点了有没有反应」——
     结果底部菜单 8 个按钮因为少绑了点击、点哪儿都没反应，六层照样全绿。
     教训：布局测试抓不住交互缺陷。这里改成用**真实鼠标事件**驱动：
       ① 先做命中测试（elementFromPoint 落在按钮里），专治「按钮被浮层盖住点不动」
       ② 再真的按下去、松开，看视图真的切了没有
       ③ 滑动用真实拖动（mousedown → 多次 mouseMoved → mouseup）复现手势 */
  const iBad = [];
  let iTotal = 0;
  const ic = (name, ok, extra) => {
    iTotal++;
    if (!ok) iBad.push(name);
    say("  " + (ok ? "✓" : "✗") + " " + name + (!ok && extra ? "  → " + extra : ""));
  };

  async function clickAt(x, y) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await sleep(24);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 1, clickCount: 1 });
  }
  /* 滑动必须走 CDP 的**触摸**事件，不能用鼠标拖动代替。
     试过鼠标：横向拖动会顺带划出文字选区，应用判定「用户在选字」而放弃接管 ——
     测出来是「手势没生效」，实际是测试路径不对。
     触摸事件也顺带让 Emulation 打开触屏模式（页面才认为自己有触摸能力）。 */
  async function dragBy(x1, y, x2) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y }] });
    const N = 7;
    for (let k = 1; k <= N; k++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove", touchPoints: [{ x: Math.round(x1 + (x2 - x1) * k / N), y }],
      });
      await sleep(14);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  /* 命中测试 + 真实点击：返回 ok=false 时说明点不到（被遮挡 / 找不到） */
  async function realClick(sel) {
    const raw = await cdp.run("return JSON.stringify((function(){" +
      "var b=document.querySelector(" + JSON.stringify(sel) + ");" +
      "if(!b) return {err:'找不到元素'};" +
      "var r=b.getBoundingClientRect();" +
      "var x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2);" +
      "if(y<0||y>innerHeight) return {err:'不在可视区 y='+y};" +
      "var hit=document.elementFromPoint(x,y);" +
      "var inside=!!(hit&&(hit===b||b.contains(hit)));" +
      "return {x:x,y:y,inside:inside,hit:hit?(hit.tagName.toLowerCase()+(hit.id?'#'+hit.id:(hit.className?'.'+String(hit.className).split(' ')[0]:''))):'null'};" +
      "})())");
    let d = null; try { d = JSON.parse(raw); } catch (e) { }
    if (!d) return { ok: false, why: String(raw) };
    if (d.err) return { ok: false, why: d.err };
    if (!d.inside) return { ok: false, why: "点被 " + d.hit + " 挡住" };
    await clickAt(d.x, d.y);
    return { ok: true };
  }
  const view = () => cdp.run("return String(window.__WFAPI.curView())");
  /* 把元素滚进可视区。
     realClick 会在「元素不在视口内」时直接判失败（那是对的 —— 用户点不到就是点不到），
     所以凡是目标可能落在首屏之外的位置，都要先滚过去再点。

     ⚠ 必须先把 scroll-behavior 临时改成 auto。
     `#view` 上写着 `scroll-behavior:smooth`，而无头浏览器的虚拟时间**不推进平滑滚动的动画** ——
     scrollIntoView 只滚了一小段就停住，元素恰好停在固定底栏底下，
     于是 realClick 报「点被 button 挡住」，读起来完全像一个布局 bug。
     实测差了 79px（滚到 732 而不是滚到底的 653），而 `#view` 底部留白 88px、底栏 64px、
     净空 24px —— 只要滚到底就不会被挡。所以这是脚手架的坑，不是页面的坑。
     改 auto 之后是瞬时定位，做完再还原，不影响页面本身。 */
  async function scrollToSel(sel) {
    await cdp.run("(function(){var b=document.querySelector(" + JSON.stringify(sel) + ");" +
      "if(!b)return 'noel';" +
      "var v=document.getElementById('view');" +
      "if(v)v.style.scrollBehavior='auto';" +
      "b.scrollIntoView({block:'center',behavior:'auto'});" +
      "if(v)v.style.scrollBehavior='';" +
      "return 'ok';})()");
    await sleep(120);
  }
  /* 取 JSON 值一律走这个：解析失败时把原文打出来再返回 null。
     直接 JSON.parse 的话，页面里一句异常就会让整个脚本崩掉、后面的断言集体消失 ——
     查问题时最怕这个（看起来像「脚本没跑」，其实是被一行错误带走了）。 */
  async function jrun(expr, label) {
    const raw = await cdp.run(expr);
    if (raw === undefined || raw === null) { say("  ! " + label + " 取值为空"); return null; }
    try { return JSON.parse(raw); } catch (e) { say("  ! " + label + " 取值失败: " + String(raw).slice(0, 180)); return null; }
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await sleep(260);
  say("");
  say("[交互] 底部导航（360px / 真实鼠标点击 + 命中测试）");

  /* 1. 页签数量与尺寸：360px 下每个 ≥44×44 CSS px 才算「点得准」 */
  const tabs = (await jrun("return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('#mtab button')," +
    "function(b){var r=b.getBoundingClientRect();return {go:b.getAttribute('data-go'),w:Math.round(r.width),h:Math.round(r.height)};}))", "底栏页签")) || [];
  ic("底栏渲染出 5 个页签（原 8 个挤成一团）", tabs.length === 5, tabs.length + " 个：" + tabs.map((x) => x.go).join(","));
  ic("页签顺序 = 今日/学习/复习/精读/更多", tabs.map((x) => x.go).join(",") === "today,study,review,read,__more",
    tabs.map((x) => x.go).join(","));
  const minW = Math.min.apply(null, tabs.map((x) => x.w));
  const minH = Math.min.apply(null, tabs.map((x) => x.h));
  ic("每个页签可点区域 ≥44×44px（最小触摸目标）", minW >= 44 && minH >= 44, "最小 " + minW + "×" + minH);

  /* 2. 逐个真实点击，看视图真的切了没有 —— 这一段就是当初全绿的漏洞 */
  for (const v of ["today", "study", "review", "read"]) {
    const c = await realClick('#mtab button[data-go="' + v + '"]');
    if (!c.ok) { ic("点底栏「" + v + "」", false, c.why); continue; }
    await sleep(200);
    const cur = await view();
    ic("点底栏「" + v + "」真的切了视图", cur === v, "当前 " + cur);
  }

  /* 3. 「更多」抽屉 */
  const cm = await realClick('#mtab button[data-go="__more"]');
  if (!cm.ok) {
    ic("点「更多」", false, cm.why);
  } else {
    await sleep(220);
    const sheet = (await jrun("return JSON.stringify((function(){" +
      "var on=!!document.querySelector('#mask.on .msheet');" +
      "var bs=document.querySelectorAll('#modal .msheet button[data-go]');" +
      "return {on:on," +
      "items:Array.prototype.map.call(bs,function(b){return b.getAttribute('data-go');})," +
      "h:Array.prototype.map.call(bs,function(b){return Math.round(b.getBoundingClientRect().height);})};" +
      "})())", "抽屉内容")) || {};
    ic("点「更多」扇出底部抽屉", sheet.on === true);
    /* ⚠ 期望值从产物里读，不在测试里手抄。
       这里原来写死 "quiz,library,stats,settings"（4 项），
       加了「易混词」「词汇量」之后立刻对不上 —— 而手抄清单最麻烦的是
       **它只能断言自己抄的那一份**：抽屉里到底装了什么、够不够，
       抄的那份并不知道。改成跟 mtabs 的次要项逐一比对。 */
    const planS = (await jrun("return JSON.stringify(window.__WFAPI.mtabPlan().s)", "底栏次要项")) || [];
    const wantS = planS.join(",");
    ic("抽屉里装的正是「更多」的次要入口（第 " + planS.length + " 项）",
      (sheet.items || []).join(",") === wantS, (sheet.items || []).join(",") + " vs " + wantS);
    ic("抽屉里的每一项都够高够点（≥38px，纵向列表也不能挤）",
      (sheet.h || []).length > 0 && Math.min.apply(null, sheet.h) >= 38,
      (sheet.h || []).join("/"));
    /* 6 项之后抽屉变高了，必须确认没有项目掉到屏幕外 ——
       掉出去的那一项在真机上就是「看得见摸不着」，而截图和溢出诊断都看不出来
       （它在固定定位的浮层里，不产生文档滚动条）。 */
    const fit = (await jrun("return JSON.stringify((function(){" +
      "var bs=document.querySelectorAll('#modal .msheet button[data-go]');" +
      "var out=[],vh=innerHeight;" +
      "for(var i=0;i<bs.length;i++){var r=bs[i].getBoundingClientRect();" +
      "if(r.top<0||r.bottom>vh+0.5)out.push(bs[i].getAttribute('data-go')+'@'+Math.round(r.bottom));}" +
      "return {out:out,vh:vh};})())", "抽屉是否排出屏幕")) || {};
    ic("抽屉全部项目都落在视口内（掉出屏幕就是看得见摸不着）",
      (fit.out || []).length === 0, (fit.out || []).join(",") || "全部在视口内（视口高 " + fit.vh + "）");

    /* 关闭按钮那颗 × 曾经以约 83px 渲染、从 30px 的按钮里溢出去，还探到弹窗右缘外。
       根因是 .modal-h .x svg 忘了写 width/height —— 带 viewBox 的 <svg> 在 CSS 里
       width/height 都是 auto 时**不会**「撑满父容器」，而是按自己的固有尺寸推导。
       这里直接量真实 rect：图标不得超出按钮，按钮也不得超出弹窗。 */
    const xb = (await jrun("return JSON.stringify((function(){" +
      "var b=document.querySelector('#modal .modal-h .x');if(!b)return {err:'没有关闭按钮'};" +
      "var s=b.querySelector('svg');var br=b.getBoundingClientRect();" +
      "var sr=s?s.getBoundingClientRect():null;" +
      "var mr=document.getElementById('modal').getBoundingClientRect();" +
      "return {bw:Math.round(br.width),bh:Math.round(br.height)," +
      "sw:sr?Math.round(sr.width):0,sh:sr?Math.round(sr.height):0," +
      "brRight:Math.round(br.right),mRight:Math.round(mr.right)};" +
      "})())", "关闭按钮尺寸")) || {};
    ic("弹窗关闭按钮的图标不溢出（曾以 ~83px 渲染、探出按钮外）",
      xb.sw > 0 && xb.sw <= xb.bw + 0.5 && xb.sh <= xb.bh + 0.5,
      "图标 " + xb.sw + "×" + xb.sh + " / 按钮 " + xb.bw + "×" + xb.bh);
    ic("关闭按钮整体落在弹窗内", xb.brRight <= xb.mRight + 0.5, "按钮右缘 " + xb.brRight + " vs 弹窗右缘 " + xb.mRight);
    const cs = await realClick('#modal .msheet button[data-go="settings"]');
    await sleep(220);
    const cur2 = await view();
    const closed = await cdp.run("return String(!document.querySelector('#mask.on'))");
    ic("抽屉里点「设置」能进去", cur2 === "settings", "当前 " + cur2);
    ic("选完自动收起抽屉", closed === "true");
  }

  /* 4. 中国英文媒体区块（精读页）
     这一块只在真实浏览器里点得出来问题：芯片是按钮，绑没绑上、有没有被别的层盖住、
     窄屏下会不会挤成一条缝，桩 DOM 全都看不见。
     ⚠ 这一层【不点「拉取最新文章」】—— 那会发真实网络请求，让第六层变成「看网络脸色」的层。
     真联网那部分由 verify-cn-live.js 单独负责。这里只验「点得到、点得动」。 */
  say("");
  say("[交互] 中国英文媒体源（精读页 / 真实点击 + 命中测试）");
  await cdp.run("(function(){var A=window.__WFAPI;A.go('read');return 'ok';})()");
  await sleep(300);
  const chips = (await jrun("return JSON.stringify(Array.prototype.map.call(document.querySelectorAll('[data-csr]')," +
    "function(b){var r=b.getBoundingClientRect();return {id:b.getAttribute('data-csr'),w:Math.round(r.width),h:Math.round(r.height)};}))", "中国源芯片")) || [];
  ic("中国源渲染出 6 个芯片（中国日报五栏目 + 环球时报）", chips.length === 6, chips.length + " 个");
  const chipH = chips.length ? Math.min.apply(null, chips.map((x) => x.h)) : 0;
  ic("每个芯片都有可点高度（≥28px，不要挤成一条缝）", chipH >= 28, "最小高度 " + chipH);
  const selBefore = await jrun("return JSON.stringify(window.__WFAPI.rdCNState().sel)", "默认选中源");
  ic("默认选中中国日报 · 中国", selBefore === "cnd-china", selBefore);
  const curl = await realClick('[data-csr="cnd-world"]');
  await sleep(240);
  const selAfter = await jrun("return JSON.stringify(window.__WFAPI.rdCNState().sel)", "切换后选中源");
  ic("点一下芯片就能换源", curl.ok && selAfter === "cnd-world", (curl.why || "") + " → " + selAfter);
  /* 取高亮态用 .cchip.on 而不是属性选择器 —— 属性值里带引号时，
     转义要过两层（JS 字符串 → CSS 选择器），写错一点就静默匹配不到，
     症状是「明明换了源却查不到高亮」。找类名简单且不会错。 */
  const onChip = await jrun("return JSON.stringify((document.querySelector('.cchip.on')||{}).textContent||'')", "芯片选中态");
  ic("选中的芯片有 .on 高亮", String(onChip).indexOf("国际") >= 0, onChip);
  /* 拉取按钮：只验它存在、没被浮层盖住、尺寸够点，不真点 */
  const btn = (await jrun("return JSON.stringify((function(){" +
    "var b=document.getElementById('rdCNLoad');if(!b)return {err:'没有拉取按钮'};" +
    "var r=b.getBoundingClientRect();" +
    "var hit=document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+r.height/2));" +
    "return {w:Math.round(r.width),h:Math.round(r.height),covered:!(hit&&(hit===b||b.contains(hit)))};" +
    "})())", "拉取按钮")) || {};
  ic("「拉取最新文章」按钮在且没被盖住", !btn.err && btn.covered === false, JSON.stringify(btn));
  ic("按钮尺寸够点（高 ≥26px）", !btn.err && btn.h >= 26, btn.h);
  const tag = await cdp.run("return String(!!document.querySelector('.cntag'))");
  ic("有「大陆可达」标识（和上面那批境外源区分开）", tag === "true");

  /* 5. 学习卡左右滑动（真实触摸滑动） */
  say("");
  say("[交互] 学习卡左右滑动（真实触摸事件）");
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await cdp.run("(function(){var A=window.__WFAPI;A.getDB().cfg.activeModes=['card'];A.go('today');return 'ok';})()");
  await cdp.run("(function(){var A=window.__WFAPI;A.startSession('new');return 'ok';})()");
  await sleep(260);

  /* 每次拖动前重新取一次卡片位置：翻词后卡片是重绘过的 */
  async function cardPoint() {
    return jrun("return JSON.stringify((function(){" +
      "var c=document.getElementById('wcard');if(!c) return {err:'没有学习卡片'};" +
      "c.scrollIntoView({block:'center'});" +
      "var r=c.getBoundingClientRect();" +
      "var y=Math.round(Math.max(70,Math.min(innerHeight-110,r.top+Math.min(70,r.height/2))));" +
      "var hit=document.elementFromPoint(Math.round(r.left+r.width/2),y);" +
      "return {y:y,left:Math.round(r.left),right:Math.round(r.right),hit:hit?hit.tagName:'null'};" +
      "})())", "卡片位置");
  }
  /* ⚠ run() 会把代码包进 try{} 里，所以求值表达式必须显式 return ——
     写成裸的 (function(){...})() 也能跑（副作用生效），但取不到值，
     症状是 JSON.parse(undefined)，很容易误判成「手势没生效」。 */
  const sess = () => jrun("return (function(){var A=window.__WFAPI,s=A.session();" +
    "return JSON.stringify(s?{i:s.i,w:s.queue[s.i],len:s.queue.length,steps:(s.steps||[]).length}:null);})()", "会话状态");
  /* 「页面还在不在」必须单独断言。
     踩过：拖动从贴近屏幕左缘的位置起手 → 触发浏览器/系统的**边缘返回手势** →
     整页被导航走 → 之后所有取值都报 undefined。
     当时的表现是「手势没生效」，方向完全指错。 */
  const alive = () => cdp.run("return (typeof window.__WFAPI) + ' @ ' + String(location.href).slice(-28)");
  const needAlive = async (label) => {
    const a = await alive();
    if (String(a).indexOf("object") !== 0) {
      ic(label + "：页面仍在", false, "页面被带走了 → " + a);
      return false;
    }
    return true;
  };

  const p0 = await cardPoint();
  if (!p0 || p0.err) {
    ic("学习卡就位", false, p0 ? p0.err : "取不到卡片");
  } else {
    ic("学习卡就位且落点不在输入框里", p0.hit !== "INPUT" && p0.hit !== "TEXTAREA", "落点 " + p0.hit);
    /* 起手点取卡片宽度的 20% / 80%，不要贴着屏幕左右边缘 ——
       真机上贴着边缘起手会被系统的「边缘返回手势」抢走，
       无头浏览器里同样（实测整页被导航掉）。真实用户也是横跨卡片中段滑。 */
    const cw = p0.right - p0.left;
    const xL = Math.round(p0.left + cw * 0.2);
    const xR = Math.round(p0.left + cw * 0.8);
    const a = await sess();
    if (!a) {
      ic("取到会话状态", false, "会话为空");
    } else {
      await dragBy(xR, p0.y, xL);            /* 从右向左滑 */
      await sleep(260);
      if (await needAlive("向左滑后")) {
        const b = await sess();
        if (b) {
          ic("从右向左滑 → 跳到下一条", b.i === a.i + 1, "下标 " + a.i + " → " + b.i);
          ic("下一条确实是另一个词", b.w !== a.w, a.w + " → " + b.w);
        }

        await dragBy(xL, p0.y, xR);          /* 从左向右滑 */
        await sleep(260);
        if (await needAlive("向右滑后")) {
          const c3 = await sess();
          if (c3) ic("从左向右滑 → 回到上一条", c3.i === a.i && c3.w === a.w, "下标 " + (b ? b.i : "?") + " → " + c3.i + " · " + c3.w);

          /* 最关键的一条：滑回去必须把已写入的记录整份撤销，否则重复计数 */
          const logBefore = await cdp.run("return JSON.stringify(window.__WFAPI.getDB().log)");
          await cdp.run("(function(){var A=window.__WFAPI;A.session().pending=2;A.commitAndNext();return 'ok';})()");
          await sleep(220);
          const logAfter = await cdp.run("return JSON.stringify(window.__WFAPI.getDB().log)");
          ic("评价后今日学习量确实变了（对照组）", logAfter !== logBefore);
          const p1 = await cardPoint();
          if (!p1 || p1.err) {
            ic("评价后学习卡还在", false, p1 ? p1.err : "取不到卡片");
          } else {
            await dragBy(xL, p1.y, xR);
            await sleep(300);
            if (await needAlive("撤销滑动后")) {
              const logBack = await cdp.run("return JSON.stringify(window.__WFAPI.getDB().log)");
              ic("滑回上一条后，今日学习量整份还原（不重复计数）", logBack === logBefore,
                String(logBack).slice(0, 70) + "  vs  " + String(logBefore).slice(0, 70));
            }
          }
        }
      }
    }
  }

  /* 6. 易混词页：搜索框、范围切换、练这组
     这一页在桩 DOM 里只能验「函数有没有绑」，验不了「点上去到底有没有反应」——
     而这一层的意义正在于此。 */
  say("");
  say("[交互] 易混词（搜索 / 范围切换 / 练这组）");
  /* ⚠ 必须显式把题型定成「看义选词」再开专练，两个原因：
     ① 上一段滑动测试把 activeModes 改成了 ['card']，不复位的话专练也是卡片态，
        页面里根本没有 .opt，断言会对着 0 个元素空转；
     ② 「看词选义」的选项是**中文释义**，拿英文词去比对是比不中的 ——
        要验「同组那个词出现在选项里」，就得用「看义选词」（选项就是词形）。 */
  await cdp.run("(function(){var A=window.__WFAPI;" +
    "A.getDB().cfg.activeModes=['recall'];A.setCFQ('');A.setCFScope('book');A.go('confuse');return 'ok';})()");
  await sleep(280);
  const cfi = (await jrun("return JSON.stringify((function(){" +
    "var q=document.getElementById('cfq');" +
    "var g=document.querySelectorAll('.cfg').length;" +
    "var d=document.querySelectorAll('[data-cfdrill]').length;" +
    "var r=q?q.getBoundingClientRect():null;" +
    "return {q:!!q,qh:r?Math.round(r.height):0,g:g,d:d};})())", "易混词页")) || {};
  ic("易混词页有搜索框且够高可点（≥30px）", cfi.q && cfi.qh >= 30, "高 " + cfi.qh);
  ic("默认渲染出若干个形近词组", cfi.g > 0, cfi.g + " 组");
  ic("每组都有「练这组」按钮", cfi.d > 0 && cfi.d <= cfi.g, cfi.d + " 个按钮 / " + cfi.g + " 组");

  /* 真实点击「练这组」→ 必须真开出一轮专练，而不是什么都没发生 */
  await scrollToSel("[data-cfdrill]");
  const drill = await realClick("[data-cfdrill]");
  await sleep(300);
  const drillSt = (await jrun("return JSON.stringify((function(){var s=window.__WFAPI.session();" +
    "return s?{kind:s.kind,n:s.queue.length,word:s.queue[s.i]}:null;})())", "专练会话")) || {};
  ic("点「练这组」真的开出一轮专练", drill.ok && drillSt.kind === "drill",
    (drill.why || "") + " → " + JSON.stringify(drillSt));
  ic("专练队列就是这一组的词（2–4 个）", drillSt.n >= 2 && drillSt.n <= 4, drillSt.n + " 个");
  /* 这一条是本轮实测才揪出来的：2 词组补进词书词后整池打乱，
     同组那个词大概率进不了选项，专练就退化成一道普通选择题。 */
  /* ⚠ 表达式必须以 return 开头：cdp.run 会把代码包进 try{} 里，
     写成裸的 (function(){...})() 只有副作用、取不到值 ——
     拿回 null 之后 (om.rest||[]).length===0 又恰好成立，
     于是这条断言会**空转着显示通过**。第一版就是这么假绿的。
     ⚠ 而且 JSON.stringify **只能有一层**：外层已经有了，IIFE 里再 stringify 一次
     就变成双层编码，jrun 解出来是个字符串、不是对象，om.hit 恒为 undefined ——
     症状是「明明 hit 里有 3 个词，断言却判失败」。 */
  const om = (await jrun("return JSON.stringify((function(){var A=window.__WFAPI,s=A.session();" +
    "var cur=s.queue[s.i];var rest=s.queue.filter(function(w){return w!==cur;});" +
    "var opts=document.querySelectorAll('#view .opt');" +
    "var txt=Array.prototype.map.call(opts,function(o){return o.textContent;}).join(' ').toLowerCase();" +
    "var hit=rest.filter(function(w){return txt.indexOf(w)>=0;});" +
    "return {cur:cur,rest:rest,hit:hit,n:opts.length};})())", "选项里的同组词")) || {};
  ic("专练的选项里出现了同组的另一个词（否则「对比」就没了）",
    (om.hit || []).length > 0, JSON.stringify(om));

  /* 搜索：真实往输入框里打字，看列表是否真的筛了。
     ⚠ 关键词必须从产物里挑（找一组里最长的那个词），不能顺手写个 "abandon" ——
     它有可能压根不在任何形近词组里，那样筛出 0 组是**正确行为**，
     而断言会误判成「搜索没接上」。第一版就踩了这个。 */
  const probeWord = (await jrun("return JSON.stringify((function(){var A=window.__WFAPI;" +
    "var best='';for(var i=0;i<A.CONF.length;i++){for(var j=0;j<A.CONF[i].length;j++){" +
    "var w=A.CONF[i][j];if(w.length>best.length)best=w;}}return best;})())", "搜索探针词"));
  await cdp.run("(function(){var A=window.__WFAPI;A.setCFQ('');A.setCFScope('all');A.go('confuse');return 'ok';})()");
  await sleep(250);
  const gAll = await jrun("return JSON.stringify(document.querySelectorAll('.cfg').length)", "全量组数");
  await cdp.run("(function(){var A=window.__WFAPI;A.setCFQ(" + JSON.stringify(probeWord) +
    ");A.setCFScope('all');A.go('confuse');return 'ok';})()");
  await sleep(250);
  const gQ = await jrun("return JSON.stringify(document.querySelectorAll('.cfg').length)", "搜索后组数");
  ic("搜索会真的筛掉不相关的组（用「" + probeWord + "」这种长词做探针）",
    Number(gQ) > 0 && Number(gQ) < Number(gAll), gAll + " → " + gQ + " 组");

  /* 范围切换按钮要点得动 */
  await scrollToSel("#cfBook");
  const sc = await realClick("#cfBook");
  await sleep(240);
  const scopeNow = await jrun("return JSON.stringify(window.__WFAPI.getCFScope())", "范围");
  ic("点「本词书相关」能切范围", sc.ok && scopeNow === "book", (sc.why || "") + " → " + scopeNow);

  /* 7. 词汇量测试：两个按钮、退出、一键应用
     这一页的按钮是「一宽一窄会暗示答案」的那类，所以除了可点，还要量等宽。 */
  say("");
  say("[交互] 词汇量测试（认识 / 不认识 / 一键应用）");
  await cdp.run("(function(){var A=window.__WFAPI;A.setVL(null);A.go('vocab');return 'ok';})()");
  await sleep(260);
  await scrollToSel("#vlStart");
  const vstart = await realClick("#vlStart");
  await sleep(280);
  const vask = (await jrun("return JSON.stringify((function(){" +
    "var k=document.getElementById('vlKnow'),n=document.getElementById('vlDont');" +
    "if(!k||!n)return {err:'缺按钮'};" +
    "var kr=k.getBoundingClientRect(),nr=n.getBoundingClientRect();" +
    "var hit=document.elementFromPoint(Math.round(kr.left+kr.width/2),Math.round(kr.top+kr.height/2));" +
    "return {kw:Math.round(kr.width),nw:Math.round(nr.width),kh:Math.round(kr.height)," +
    "covered:!(hit&&(hit===k||k.contains(hit)))};})())", "答题页按钮")) || {};
  ic("点「开始测试」真的进入答题态", vstart.ok && !vask.err, (vstart.why || "") + " " + JSON.stringify(vask));
  ic("「认识 / 不认识」两个按钮等宽（一宽一窄会暗示哪个「更该点」）",
    Math.abs((vask.kw || 0) - (vask.nw || 0)) <= 1, vask.kw + " vs " + vask.nw);
  ic("两个按钮都够高（≥48px，这是主要操作）", (vask.kh || 0) >= 48, vask.kh);
  ic("「认识」按钮没被别的层盖住", vask.covered === false, String(vask.covered));

  const before = await jrun("return JSON.stringify(window.__WFAPI.vlState().asked)", "已答题数");
  await scrollToSel("#vlKnow");
  const vk = await realClick("#vlKnow");
  await sleep(260);
  const after = await jrun("return JSON.stringify(window.__WFAPI.vlState().asked)", "已答题数");
  ic("点「认识」真的记了一题（不是点了没反应）", vk.ok && Number(after) === Number(before) + 1,
    before + " → " + after);
  const wordChanged = await jrun("return JSON.stringify(window.__WFAPI.vlState().word)", "当前词");
  ic("点完自动换到下一个词", !!wordChanged, wordChanged);

  /* 一键应用：真点按钮，看设置有没有真的被改 */
  await cdp.run("(function(){var A=window.__WFAPI;" +
    "A.getDB().book='zhongkao';A.getDB().cfg.newPerDay=3;" +
    "A.vlStart();for(var i=0;i<60&&A.vlState().phase==='ask';i++){var s=A.vlState();" +
    "A.vlAnswer(s.last&&s.last.fake?false:(s.cur<=3));}return 'ok';})()");
  await sleep(300);
  await scrollToSel("#vlApply");
  /* 先把「按钮在哪、有没有被盖住」量出来再点。之前失败时只报了「词书没变」，
     方向完全指不出来 —— 是没找到、不在视口、被遮挡，还是处理函数抛异常？
     这三种原因的修法完全不同。 */
  const apDiag = (await jrun("return JSON.stringify((function(){" +
    "var b=document.getElementById('vlApply');" +
    "if(!b)return {err:'没有按钮'};" +
    "var r=b.getBoundingClientRect();" +
    "var x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);" +
    "var hit=document.elementFromPoint(x,y);" +
    "return {x:x,y:y,w:Math.round(r.width),h:Math.round(r.height),vh:innerHeight," +
    "hit:hit?(hit.tagName.toLowerCase()+(hit.id?'#'+hit.id:'')+'.'+String(hit.className||'').split(' ')[0]):'null'," +
    "bookSel:(document.getElementById('vlBook')||{}).value," +
    "phase:(A.vlState()||{}).phase};})())", "应用按钮诊断")) || {};
  ic("「一键应用」按钮测得出来（存在 / 在视口内 / 没被遮挡）",
    !apDiag.err && apDiag.y > 0 && apDiag.y < apDiag.vh, JSON.stringify(apDiag));
  const applied = await realClick("#vlApply");
  await sleep(280);
  const ap = (await jrun("return JSON.stringify((function(){var A=window.__WFAPI,d=A.getDB();" +
    "return {book:d.book,n:d.cfg.newPerDay};})())", "应用后的设置")) || {};
  ic("点「一键应用」真的改了词书", applied.ok && ap.book !== "zhongkao",
    "zhongkao → " + ap.book + "｜点击：" + (applied.why || "成功") + "｜" + JSON.stringify(apDiag));
  ic("点「一键应用」真的改了每日新词上限", ap.n !== 3, "3 → " + ap.n);

  say("");
  say("=".repeat(58));
  say("共 " + total + " 次布局诊断（" + WS.length + " 档宽度 × " + SET.length + " 个场景）");
  say("共 " + iTotal + " 项交互断言");
  bad += iBad.length; total += iTotal;
  if (iBad.length) say("交互失败项：" + iBad.join(" / "));
  say(bad === 0 ? "结果: 零溢出 · 交互全绿（全绿）" : "结果: " + bad + " 项不通过");
  say("=".repeat(58));

  cleanup();
  process.exit(bad ? 1 : 0);
})().catch((e) => { say("ERR " + (e && e.message)); cleanup(); process.exit(1); });
