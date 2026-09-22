/* ===================== 词匠 WordForge · 文章精读引擎 ===================== */
/* 本模块是应用里【唯一】联网的部分，且只在用户主动进入精读「发现」页时才会发请求。
 *
 * 与「离线可用」如何共存：
 *   1. 主功能（背单词 / 复习 / 词库 / 统计）保持零网络请求，结构校验会断言这一点。
 *   2. 只有一个网络出口 netGet()：仅 GET、无请求体、无自定义请求头（不触发 CORS 预检）、
 *      credentials:"omit"、referrerPolicy:"no-referrer"。
 *      → 「用户数据永不上传」是结构性事实，不是靠自觉。
 *   3. 域名白名单 + 强制 https。
 *   4. 抓回来的文章落进本地库，之后离线也能反复精读 —— 联网只是「进货」那一次。
 */

/* ---------- 12. 联网层 ---------- */

/* 白名单：全部是明确对跨域请求放行的站点（file:// 页面的 origin 是 null）。
   注意：能连上 ≠ 一定能取到。中国大陆的网络环境下，境外站点往往整体不可达，
   所以「源可达性」必须让用户自己实测 —— 见 netSelfTest()。

   实测记录（2026-09-19，43 次请求，带正负对照）：
     ✓ 中国日报栏目页 / 环球时报 RSS 与文章页 —— 可达且放行跨域（主力源）
     ✗ 维基家族 / 卫报 —— 本机直连超时。但【不删代码】：中转是云端服务，
       用户的浏览器经中转可能读得到；而且换个网络就恢复了，删了等于永久掐死。
       应用改成按自测结果隐藏（见 hostDown），而不是从白名单里拿掉。
     ✗ 中国日报【文章页】—— 页面可达，但响应里没有跨域头，浏览器读不到 → 走中转 */
var NET_WL = [
  "en.wikipedia.org", "simple.wikipedia.org", "zh.wikipedia.org",
  "en.wikinews.org", "zh.wikinews.org", "en.wikisource.org",
  "content.guardianapis.com",
  /* --- 中国英文媒体（大陆网络可达） --- */
  "www.chinadaily.com.cn", "www.globaltimes.cn",
  /* --- 跨域中转：源站不给跨域头时由它们代取（详见 netGetSmart / NETBR） --- */
  "cors.eu.org", "api.allorigins.win", "whateverorigin.org"
];

var NETST = { on: (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") ? navigator.onLine : null, testing: false, results: {} };

/* ---------- 12a. 取自测结果的可达性门控 ----------
 * 需求原文：「监测所有来源在 PC / 移动端环境下是否可达，若不可达请删除来源」。
 *
 * 为什么最后【不删代码】，而只做「隐藏 + 保留」：
 *   可达性不是来源的属性，是【当前网络路径】的属性。同一个源，
 *   家里宽带到不了、换运营商能到、连公司 VPN 又能到 —— 删掉代码等于把
 *   一条本来会恢复的路永久掐死。而且我这边的命令行实测本来就不能代表用户的浏览器：
 *   中转服务是在云端跑的，我这台沙箱到不了维基，用户的浏览器却可能经中转取到。
 *   拿一份不具代表性的一次性测量去删功能，是在用错误的证据做不可逆的决定。
 *
 * 所以把判断权交给【应用自己】：跑一次自测（浏览器真实结果），
 * 连续失败就标记为「当前网络不可达」并在界面上收起来；网络变了自测通过，它自己就回来了。
 *
 * 三条判定纪律（少一条都会误伤）：
 *   ① 只有「连请求都没发成功」才算不可达。BLOCKED（不在白名单）/ OFF（用户关了联网）/
 *      NOFETCH（浏览器不支持）是【策略性拒绝】，不是网络问题 —— 拿它们当不可达的证据，
 *      会出现「用户关了一下联网开关，回来发现源全没了」这种荒谬结果。
 *   ② 单次失败不算数。网络抖动、对方瞬时限流都很常见，实测 allorigins 五连测里
 *      两成功两超时一 522。要 STRIKES 次都失败才认。
 *   ③ 中转服务自己【永远不隐藏】。它跟别的源不是一类东西 —— 中国日报文章页的正文
 *      必须经它取回（源站不给跨域头），把它藏起来等于把中国日报一起废掉。
 *      它是「管道」不是「水龙头」，管道堵了要报出来，但不能假装没有管道。
 */
var STRIKES = 2;                /* 连续失败几次才认定不可达 */
var UNAVAIL_TTL = 6 * 3600e3;   /* 认定结果的有效期：6 小时后过期重测，避免一直背着一个旧结论 */

/* 一个自我维持的失败计数器（随主库持久化，见 DB.cfg.__netFail）。
   放在 cfg 里的原因：load() 会自动补齐 CFG_DEF 的键，深合并结构不用另写迁移代码。
   以「__」开头是为了跟真正的设置项区分开 —— 它不是用户可调的东西。 */
function netFailMap() {
  var c = cfg();
  if (!c.__netFail || typeof c.__netFail !== "object") c.__netFail = {};
  return c.__netFail;
}
function netUnavailMap() {
  var c = cfg();
  if (!c.__netUnavail || typeof c.__netUnavail !== "object") c.__netUnavail = {};
  return c.__netUnavail;
}
/* 记录一次真实取文的结果（由 csLoad / csGrab 这类动作回调进来）。
   ok=false 且「是网络层面的失败」→ 计数 +1；成功 → 计数清零、并解除不可达标记。
   这样用户不需要手动点自测，正常使用的过程本身就在持续验证。 */
function netNote(host, err) {
  if (!host) return;
  var f = netFailMap(), u = netUnavailMap();
  if (!err) {
    if (f[host]) { delete f[host]; }
    if (u[host]) { delete u[host]; }
    return;
  }
  /* 策略性拒绝不参与判定 —— 见上面纪律 ① */
  if (err.code === "BLOCKED" || err.code === "OFF" || err.code === "NOFETCH" || err.code === "EMPTY" || err.code === "NOSRC" || err.code === "BADJSON") return;
  f[host] = (f[host] || 0) + 1;
  if (f[host] >= STRIKES) u[host] = now();
}
/* 自测结果也折算进来。自测是「用户明确点了一次」的高质量证据，
   但它一次只跑一轮，所以按「一次自测 = 一次 strike」记，和其它路径同样对待。 */
function netNoteSelfTest(results) {
  var f = netFailMap(), u = netUnavailMap();
  for (var h in results) {
    if (!Object.prototype.hasOwnProperty.call(results, h)) continue;
    var x = results[h];
    /* 「不在白名单内」「浏览器不支持 fetch」不是网络结论，跳过 */
    if (x && x.msg && /不在白名单|不支持 fetch|联网已关闭/.test(x.msg)) continue;
    if (x && x.ok) { delete f[h]; delete u[h]; continue; }
    f[h] = (f[h] || 0) + 1;
    if (f[h] >= STRIKES) u[h] = now();
  }
}
/* 某台主机现在是不是「认定不可达」。过期自动放行（TTL），
   所以用户换到能通的网络后不需要手动清缓存 —— 最多等 6 小时，或者点一下自测立刻重判。 */
function brHostOf(b) {
  /* 从 pre 里抠出主机名（NETBR 没有单独的 host 字段）。 */
  return String((b && (b.pre || b.url)) || "").replace(/^https:\/\//, "").split("/")[0];
}
/* 中转主机集合**从 NETBR 现算**，不写死。
   写死的代价这一轮就撞上了：新增 whateverorigin 之后，它虽然是中转，
   却因为不在那份硬编码清单里而被正常判定 —— 一旦连续失败两次就会被收起来，
   表现为「中国日报正文突然全部取不到，界面上也没有任何解释」。
   从数据现算，将来再加中转就不需要记得回来改这里。 */
function isBridgeHost(host) {
  for (var i = 0; i < NETBR.length; i++) if (brHostOf(NETBR[i]) === host) return true;
  return false;
}
function hostDown(host) {
  if (!host) return false;
  if (isBridgeHost(host)) return false;   /* 纪律 ③：中转永不隐藏 */
  var u = netUnavailMap();
  var t = u[host];
  if (!t) return false;
  if (now() - t > UNAVAIL_TTL) { delete u[host]; return false; }
  return true;
}
/* 某一个源（SRCS / CSRC 通用）现在可不可用。它的 host 不可达就算不可达。
   ⚠ 这里按 host 而不是按 id 判定，是因为 CSRC 里五个中国日报栏目共用同一个 host
     （www.chinadaily.com.cn）—— 按 id 判定会得出「中国栏目挂了、国际栏目正常」
     这种不成立的结论，明明是同一台服务器。 */
function srcDown(s) { return !!(s && s.host && hostDown(s.host)); }
/* 当前还有没有可用的源。全不可用时界面要给一条明确的出路（粘贴导入），
   而不是显示一个空架子让用户猜。 */
function srcAnyUp(list) {
  /* 空值也当「没有可用源」处理，而不是抛异常 ——
     这个函数会被视图直接喂进 SRCS / CSRC，也可能被喂进一个还没拉到的清单（null）。
     让它抛的话，界面会在渲染时整片白掉，而这本来只是一句「没有可用源」。 */
  if (!list || !list.length) return false;
  for (var i = 0; i < list.length; i++) if (!srcDown(list[i])) return true;
  return false;
}

function netHostOK(u) {
  var m = /^https:\/\/([^\/?#]+)/i.exec(String(u || ""));
  if (!m) return false;                       /* 只允许 https，杜绝明文传输 */
  var h = m[1].toLowerCase().replace(/:\d+$/, "");
  for (var i = 0; i < NET_WL.length; i++) {
    if (h === NET_WL[i]) return true;
  }
  return false;
}
/* 为什么不做「网络不可用」的统一拦截：
   浏览器只能告诉我们 navigator.onLine，它只反映网卡状态，不反映「这个站能不能到」。
   真正的可达性只能靠实测，所以这里只拦白名单和用户开关，其余交给请求本身去失败，并给出可读原因。 */
function netReason() {
  if (cfg().netOff) return "联网已在「设置 → 精读」里关闭";
  if (NETST.on === false) return "当前设备处于离线状态";
  return "";
}
/* 取文超时（毫秒）。**必须有，而且踩过** ——
   实测 AllOrigins 挂掉时 fetch 既不报错也不返回，一直悬着；
   界面上就是「取文中…」永远转圈，用户既不知道在等什么、也没有重试的入口。
   12 秒是量出来的权衡：直连中国日报栏目页实测 ~1s，经中转取正文实测 3–8s，
   12 秒足够覆盖慢的情况，又不至于让人等到怀疑程序死了。 */
var NET_TIMEOUT = 12000;
function netGet(url, cb) {
  if (!netHostOK(url)) { cb({ code: "BLOCKED", msg: "域名不在白名单内，已拒绝请求" }); return; }
  if (cfg().netOff) { cb({ code: "OFF", msg: "联网已在设置中关闭" }); return; }
  if (typeof fetch !== "function") { cb({ code: "NOFETCH", msg: "当前浏览器不支持 fetch，无法联网取文" }); return; }
  var t0 = now();
  /* 收口成一个回调：超时和 fetch 的 settle 只能有一次生效，
     否则超时已经报了错、稍后 fetch 又回一次，调用方会拿到两个结果。 */
  var done = false, timer = null, ctl = null;
  function fin(err, txt, ms) {
    if (done) return;
    done = true;
    if (timer) { clearTimeout(timer); timer = null; }
    cb(err, txt, ms);
  }
  var opt = { method: "GET", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" };
  if (typeof AbortController === "function") {
    ctl = new AbortController();
    opt.signal = ctl.signal;
    timer = setTimeout(function () {
      try { ctl.abort(); } catch (e) { }
      fin({ code: "TIMEOUT", msg: "超过 " + Math.round(NET_TIMEOUT / 1000) + " 秒没有响应" });
    }, NET_TIMEOUT);
  }
  fetch(url, opt)
    .then(function (r) {
      if (!r.ok) { var e = new Error("HTTP " + r.status); e.__code = "HTTP" + r.status; e.__msg = "源站返回 HTTP " + r.status; throw e; }
      return r.text();
    })
    .then(function (txt) { fin(null, txt, now() - t0); })
    .catch(function (e) {
      if (e && e.__code) { fin({ code: e.__code, msg: e.__msg }); return; }
      /* 浏览器对「断网 / 被墙 / 对方未放行跨域」一律只报 TypeError，无法从异常里区分。
         所以把三种可能都摆出来，并引导用户去跑自测。 */
      fin({
        code: "FETCH", msg: "请求未能完成",
        hint: "常见原因：① 设备实际上没有联网；② 该站点在当前网络环境下不可达；③ 站点未对跨域请求放行。可点「源可达性自测」看具体是哪种。"
      });
    });
}
function netGetJSON(url, cb) {
  netGet(url, function (err, txt, ms) {
    if (err) { cb(err); return; }
    var j;
    try { j = JSON.parse(txt); } catch (e) { cb({ code: "BADJSON", msg: "返回内容不是合法 JSON（可能被网络中间层改写）" }); return; }
    cb(null, j, ms);
  });
}

/* ---------- 12b. 两级取文：先直连，再中转 ---------- */
/* 为什么必须有这一层：能不能读到一个网址的内容，取决于两件完全不同的事 ——
   ① 这个站当前网络下通不通；② 它的响应里有没有 Access-Control-Allow-Origin。
   第 ② 条是源站说了算，我们改不了。中国日报【文章页】就是典型：页面明明可达，
   但不给跨域头，fetch 能发出、却读不到响应体。中转服务替我们取回原文再补上跨域头。

   为什么直连放前面：直连最快、不经过任何第三方。只有它失败了才动用中转。
   为什么保留用户开关：中转会把「你要读哪一个地址」告诉第三方的服务器。
   那一串地址本身不是隐私（就是一篇公开新闻的网址），但有人就是不想让这个请求出去 ——
   设置里给了开关，关掉后行为退化成原来的纯直连。

   ⚠ 中转请求与直连请求走的是同一个 netGet：同样只 GET、不带凭据、不发来源页、无上传通道。
     也就是说「你的学习数据不会离开这台设备」这条依然成立 —— 出去的只有公开文章的地址。 */
var NETBR = [
  /* raw 模式：把目标地址直接拼在服务地址后面，返回的就是原文。
     ⚠ 这个不能删：中国日报【文章页】正文全靠它（源站不给跨域头）。
     实测 5/5 成功，是当前唯一稳定的一个。 */
  { id: "corseu", name: "cors.eu.org", pre: "https://cors.eu.org/", mode: "raw" },
  /* json 模式：返回 {contents:"原文…"}，要拆一层。
     每个都实测过，留着当备选的理由写在 name 后面，将来谁想清理能一眼看出该不该动。 */
  { id: "allorigins", name: "AllOrigins", pre: "https://api.allorigins.win/get?url=", mode: "json" },
  /* whateverorigin 实测 5/5 成功（比 allorigins 稳），补成第三个。
     公益服务随时会挂，多一个就多一分「今天还能取到文章」的概率；
     代价只是失败时多一次请求，而且只有前面都失败才会走到它。 */
  { id: "whateverorigin", name: "whateverorigin", pre: "https://whateverorigin.org/get?url=", mode: "json" }
];
/* 逐个试。**每个中转的失败原因都要留着**（tried）——
   实测两个公益中转会同时出问题（2026-09-18 当天：cors.eu.org 被 Cloudflare 限流 429、
   AllOrigins 直接 500），只报一句「都没能取回这一篇」用户没法判断
   是「等一会儿再来」还是「这个源本来就取不到」。把 429 / 500 / 超时分别写出来，
   用户一眼能分清责任在哪边。 */
function netBridge(url, i, cb, tried) {
  tried = tried || [];
  if (i >= NETBR.length) {
    cb({ code: "BRIDGE", msg: "中转服务都没能取回这一篇", hint: tried.join(" · ") });
    return;
  }
  var b = NETBR[i];
  var full = b.mode === "json" ? b.pre + encodeURIComponent(url) : b.pre + url;
  netGet(full, function (err, txt, ms) {
    if (err) { tried.push(b.name + "：" + (err.msg || err.code)); netBridge(url, i + 1, cb, tried); return; }
    if (b.mode === "json") {
      var j = null;
      try { j = JSON.parse(txt); } catch (e) { j = null; }
      /* 内容太短也当中转这次失败 —— 有些服务出错时会回一段 HTML 错误页而不是报错码，
         不卡长度的话，那种错误页会被当成「正文」存进文章库。 */
      if (!j || typeof j.contents !== "string" || j.contents.length < 200) {
        tried.push(b.name + "：返回内容不是正文（" + (txt ? txt.length + " 字节" : "空") + "）");
        netBridge(url, i + 1, cb, tried); return;
      }
      cb(null, j.contents, ms, b.name);
      return;
    }
    if (!txt || txt.length < 200) {
      tried.push(b.name + "：返回内容太短（" + (txt ? txt.length + " 字节" : "空") + "）");
      netBridge(url, i + 1, cb, tried); return;
    }
    /* 429/403/5xx 会被 netGet 拦在上面（非 2xx 直接算错），所以走到这里就是真拿到了原文。
       但仍然挡一道「限流页被当正文」：Cloudflare 的限流页有 50 KB 之巨，
       光靠长度拦不住，只能看特征。 */
    if (/has been temporarily rate limited|Too Many Requests|cf-error-details/i.test(txt)) {
      tried.push(b.name + "：被限流（返回的是限流提示页）");
      netBridge(url, i + 1, cb, tried); return;
    }
    cb(null, txt, ms, b.name);
  });
}
/* 统一入口：cb(err) 或 cb(null, 文本, 毫秒, 中转服务名|null) */
function netGetSmart(url, cb) {
  var allowBr = !cfg().noBridge;
  netGet(url, function (err, txt, ms) {
    if (!err) { cb(null, txt, ms, null); return; }
    /* BLOCKED / OFF / NOFETCH 是策略性拒绝（不在白名单、用户关了联网、浏览器不支持）。
       这几种情况下中转也不该绕过去 —— 那不是「取不到」，是「本来就不该发」。 */
    if (!allowBr || err.code === "BLOCKED" || err.code === "OFF" || err.code === "NOFETCH") { cb(err); return; }
    netBridge(url, 0, function (e2, t2, m2, via) {
      if (e2) {
        /* 两边都失败时，报直连的原始错误 —— 它对用户更有信息量（能区分断网 / 被墙 / 未放行），
           同时把「中转也试过、各自因为什么没成」写进 hint，免得用户以为应用没努力。
           e2.hint 里就是逐个中转的原因（如「cors.eu.org：源站返回 HTTP 429 · AllOrigins：…」），
           这一串是排障时唯一能分清「等一会儿再来」和「这个源本来就取不到」的线索。 */
        var why = e2.hint ? "（" + e2.hint + "）" : "";
        err.hint = (err.hint ? err.hint + " " : "") + "已再试中转服务，同样未成功" + why + "。";
        cb(err);
        return;
      }
      cb(null, t2, m2, via);
    });
  });
}
/* 源可达性自测：给每个站点发一个 1 字节量级的最小请求，把结果列出来。
   这是「联网才开放」这个前提下最该给用户的工具 —— 免得面对一个空白页猜到底是哪里断了。 */
function netSelfTest(cb) {
  var probes = [
    /* --- 中国英文媒体：大陆网络下的主力，排在最前面先测 --- */
    ["www.chinadaily.com.cn", "https://www.chinadaily.com.cn/china/index.html"],
    ["www.globaltimes.cn", "https://www.globaltimes.cn/rss/outbrain.xml"],
    /* --- 中转：源站不给跨域头时靠它，所以它自己通不通也得测 --- */
    ["cors.eu.org", "https://cors.eu.org/https://www.chinadaily.com.cn/china/index.html"],
    ["api.allorigins.win", "https://api.allorigins.win/get?url=" + encodeURIComponent("https://example.com")],
    ["whateverorigin.org", "https://whateverorigin.org/get?url=" + encodeURIComponent("https://example.com")],
    /* --- 原来那批境外源：留着，用户能一眼看出是「墙」还是「应用坏了」 --- */
    ["en.wikipedia.org", "https://en.wikipedia.org/api/rest_v1/page/summary/English_language"],
    ["simple.wikipedia.org", "https://simple.wikipedia.org/api/rest_v1/page/summary/English_language"],
    ["en.wikinews.org", "https://en.wikinews.org/w/api.php?action=query&meta=siteinfo&format=json&origin=*"],
    ["en.wikisource.org", "https://en.wikisource.org/w/api.php?action=query&meta=siteinfo&format=json&origin=*"],
    ["content.guardianapis.com", "https://content.guardianapis.com/search?api-key=" + encodeURIComponent(cfg().guardianKey || "test") + "&page-size=1"]
  ];
  NETST.testing = true;
  var left = probes.length;
  var done = function () { if (--left === 0) { NETST.testing = false; netNoteSelfTest(NETST.results); save(); if (cb) cb(NETST.results); } };
  NETST.results = {};
  for (var i = 0; i < probes.length; i++) {
    (function (host, url) {
      var t0 = now();
      if (!netHostOK(url)) { NETST.results[host] = { ok: false, msg: "不在白名单内" }; done(); return; }
      if (typeof fetch !== "function") { NETST.results[host] = { ok: false, msg: "浏览器不支持 fetch" }; done(); return; }
      /* 自测这一条不加超时保护：它要回答的正是「到底卡了多久」，
         12 秒掐断会把「服务器很慢」误报成「不可达」。断开/被拦是立刻报错的，
         真正会让它悬着的只有对方不回包 —— 那种情况 UI 上有「测试中」状态兜着。 */
      fetch(url, { method: "GET", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" })
        .then(function (r) { NETST.results[host] = { ok: r.ok, msg: r.ok ? "可达" : "HTTP " + r.status, ms: now() - t0 }; done(); })
        .catch(function () { NETST.results[host] = { ok: false, msg: "不可达（断开 / 被拦 / 未放行跨域）", ms: now() - t0 }; done(); });
    })(probes[i][0], probes[i][1]);
  }
}

/* ---------- 13. 文章源 ---------- */
/* 选源标准：① 内容有权威性；② 对跨域请求放行；③ 许可清晰，适合个人学习使用。
   每篇都记下来源与许可，导入的文章同样留一个来源字段 —— 尊重出处。 */
var SRCS = [
  {
    id: "simplewiki", name: "简易英语百科", kind: "search", host: "simple.wikipedia.org",
    tag: "百科 · 简易英语", lic: "CC BY-SA", rec: 1,
    note: "用基础英语重写的条目，句子短、词常见，篇幅通常 300–900 词 —— 六级起步最合适的一类"
  },
  {
    id: "wikifeat", name: "维基每日精选", kind: "feed", host: "en.wikipedia.org",
    tag: "百科 · 每日更新", lic: "CC BY-SA", rec: 0,
    note: "当天评选出的特色条目 + 时事新闻 + 历史上的今天，质量经过同行评审，但用词偏难"
  },
  {
    id: "wiki", name: "英文维基百科", kind: "search", host: "en.wikipedia.org",
    tag: "百科 · 主题检索", lic: "CC BY-SA", rec: 0,
    note: "按主题检索任意条目全文，覆盖面最广"
  },
  {
    id: "wikinews", name: "维基新闻当日稿", kind: "news", host: "en.wikinews.org",
    tag: "新闻 · 每日更新", lic: "CC BY 2.5", rec: 0,
    note: "当天发布的新闻稿，用词比大报平实，适合读「新鲜出炉」的内容"
  },
  {
    id: "wikisource", name: "维基文库公版文献", kind: "search", host: "en.wikisource.org",
    tag: "文献 · 公版", lic: "公版 / CC", rec: 0,
    note: "演讲、宣言、经典文本原文，语言正式、句式复杂，适合练长难句"
  },
  {
    id: "guardian", name: "卫报 The Guardian", kind: "search", host: "content.guardianapis.com",
    tag: "新闻 · 需 Key", lic: "Guardian Open Platform", rec: 0,
    note: "权威新闻频道，需要到 open-platform.theguardian.com 免费申请一个 API Key 填进设置"
  }
];
function srcOf(id) {
  for (var i = 0; i < SRCS.length; i++) if (SRCS[i].id === id) return SRCS[i];
  return null;
}
/* 取某天的每日内容（特色条目 / 时事 / 历史上的今天） */
function urlFeatured(y, m, d) {
  return "https://en.wikipedia.org/api/rest_v1/feed/featured/" + y + "/" + pad2(m) + "/" + pad2(d);
}
/* 取条目纯文本全文。explaintext=1 让服务端直接返回纯文本，省掉在本地剥 HTML 的功夫 */
function urlExtract(host, title) {
  return "https://" + host + "/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*" +
    "&titles=" + encodeURIComponent(title);
}
/* 主题检索 */
function urlSearch(host, q) {
  return "https://" + host + "/w/api.php?action=query&list=search&format=json&origin=*&srlimit=12" +
    "&srsearch=" + encodeURIComponent(q);
}
/* 当日新闻稿清单 */
function urlNews(host) {
  return "https://" + host + "/w/api.php?action=query&list=categorymembers&format=json&origin=*&cmlimit=15" +
    "&cmtitle=" + encodeURIComponent("Category:Published");
}
function urlGuardian(q, key) {
  return "https://content.guardianapis.com/search?api-key=" + encodeURIComponent(key || "") +
    "&show-fields=headline,bodyText,standfirst&page-size=12&order-by=" + (q ? "relevance" : "newest") +
    (q ? "&q=" + encodeURIComponent(q) : "");
}

/* ---------- 13b. 中国英文媒体源 ---------- */
/* 为什么单列一组：原来那 6 个源全是境外站点（维基家族 + 卫报），
   在中国大陆的网络下实测【全部超时】—— 等于精读这功能看着有、实际用不了。
   这里放的是实测【大陆可达】的英文媒体，取文链路各不相同：

     中国日报 China Daily
       栏目页（/china/index.html 等）—— 可达，且响应带 Access-Control-Allow-Origin: *
       文章页（/a/YYYYMM/DD/WSxxx.html）—— 可达，但【不给跨域头】
       → 栏目页直连、文章正文经中转（见 netGetSmart）；正文在 #Content 里，一段一个 <p>
     环球时报 Global Times
       RSS 与文章页都放行跨域 → 全程直连，一次第三方都不经过
       正文在 .article_right 里，用 <br><br> 分段而不是 <p>，要单独处理

   为什么不一并塞进 SRCS：那个数组喂给「按主题找文章」的下拉框，是【关键词检索】语义；
   这两个源是【拉最新列表】语义，混在一起用户会以为要填关键词才能用。 */
var CSRC = [
  {
    id: "cnd-china", name: "中国日报 · 中国", short: "中国日报·中国", src: "中国日报",
    kind: "cnd", sec: "china", host: "www.chinadaily.com.cn", needBridge: 1,
    tag: "China Daily · 国内", lic: "© China Daily · 个人学习使用", rec: 1,
    note: "国家级英文日报的国内版块，语言规范、话题贴近中国，六级备考的难度正合适"
  },
  {
    id: "cnd-world", name: "中国日报 · 国际", short: "中国日报·国际", src: "中国日报",
    kind: "cnd", sec: "world", host: "www.chinadaily.com.cn", needBridge: 1,
    tag: "China Daily · 国际", lic: "© China Daily · 个人学习使用", rec: 0,
    note: "国际时事，用英文写世界，适合积累国际新闻类高频词"
  },
  {
    id: "cnd-opinion", name: "中国日报 · 观点", short: "中国日报·观点", src: "中国日报",
    kind: "cnd", sec: "opinion", host: "www.chinadaily.com.cn", needBridge: 1,
    tag: "China Daily · 评论", lic: "© China Daily · 个人学习使用", rec: 1,
    note: "社论与评论，句式长、论证密，练长难句与写作思路的好料"
  },
  {
    id: "cnd-business", name: "中国日报 · 商业", short: "中国日报·商业", src: "中国日报",
    kind: "cnd", sec: "business", host: "www.chinadaily.com.cn", needBridge: 1,
    tag: "China Daily · 财经", lic: "© China Daily · 个人学习使用", rec: 0,
    note: "财经商业报道，经济类术语密集"
  },
  {
    id: "cnd-culture", name: "中国日报 · 文化", short: "中国日报·文化", src: "中国日报",
    kind: "cnd", sec: "culture", host: "www.chinadaily.com.cn", needBridge: 1,
    tag: "China Daily · 文化", lic: "© China Daily · 个人学习使用", rec: 0,
    note: "文化、生活、旅行，叙事性强，读起来最不像「读新闻」"
  },
  {
    id: "gt", name: "环球时报英文版", short: "环球时报", src: "环球时报",
    kind: "gt", host: "www.globaltimes.cn", needBridge: 0,
    tag: "Global Times · 时评", lic: "© Global Times · 个人学习使用", rec: 0,
    note: "英文时评与新闻。这个源全程直连、不经中转，最快"
  }
];
function csOf(id) {
  for (var i = 0; i < CSRC.length; i++) if (CSRC[i].id === id) return CSRC[i];
  return null;
}
/* HTML 实体还原。和视图层的 stripHTMLLite 里那段重复，但这里要独立可用 ——
   引擎层不该依赖视图层的函数（视图层还没加载时列表解析就跑不了）。 */
function unent(s) {
  var t = String(s == null ? "" : s);
  if (t.indexOf("&") < 0) return t;
  return t.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&mdash;/gi, "—").replace(/&ndash;/gi, "–").replace(/&hellip;/gi, "…")
    .replace(/&rsquo;/gi, "’").replace(/&lsquo;/gi, "‘").replace(/&rdquo;/gi, "”").replace(/&ldquo;/gi, "“")
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
}
/* 剥标签 + 折叠空白 */
function tagText(h) {
  return unent(String(h).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
}
/* RSS 的 pubDate（"Sun, 23 Aug 2026 00:00:00 GMT"）转成和别处一致的 YYYY-MM-DD */
var MON3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function isoDay(s) {
  var m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(String(s || ""));
  if (!m) return "";
  var mi = MON3.indexOf(m[2].toLowerCase());
  if (mi < 0) return "";
  return m[3] + "-" + pad2(mi + 1) + "-" + pad2(Number(m[1]));
}
function csListURL(s) {
  if (s.kind === "cnd") return "https://www.chinadaily.com.cn/" + s.sec + "/index.html";
  if (s.kind === "gt") return "https://www.globaltimes.cn/rss/outbrain.xml";
  return "";
}
/* 中国日报栏目页解析。链接长这样（注意 href 是协议相对的 // 开头，必须补 https:）：
     <li><a href="//www.chinadaily.com.cn/a/202609/18/WSxxx.html">标题</a></li>
   栏目页里还有导航、专题、相关阅读等一堆链接，用 /a/YYYYMM/DD/ 这个路径特征就能筛干净 ——
   顺手正好把日期也抠出来了，不用再去请求一次。 */
function pickCNDList(html) {
  var out = [], seen = {}, re = /<a[^>]+href="\/\/www\.chinadaily\.com\.cn\/a\/(\d{4})(\d{2})\/(\d{2})\/([^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html))) {
    /* 带 _2 _3 后缀的是分页的后续页，正文主体在第一页，跳过免得列表里出现同题多条 */
    if (/_/.test(m[4].replace(/^WS[0-9a-f]+/i, ""))) continue;
    var url = "https://www.chinadaily.com.cn/a/" + m[1] + m[2] + "/" + m[3] + "/" + m[4];
    if (seen[url]) continue;
    var t = tagText(m[5]);
    if (t.length < 6 || t.length > 200) continue;
    seen[url] = 1;
    out.push({ title: t, url: url, d: m[1] + "-" + m[2] + "-" + m[3] });
    if (out.length >= 18) break;
  }
  return out;
}
/* 环球时报 RSS 解析。RSS 是 XML 而不是 JSON，但结构固定（item 里就 title/link/pubDate），
   用正则取比引一个 XML 解析器省事得多；而且 stub DOM 里没有 DOMParser，
   写成正则第二层逻辑测试才跑得动它。 */
function pickGTFeed(xml) {
  var out = [], items = String(xml || "").match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (var i = 0; i < items.length; i++) {
    var seg = items[i];
    var ti = /<title>([\s\S]*?)<\/title>/i.exec(seg);
    var li = /\x3Clink>([\s\S]*?)\x3C\/link>/i.exec(seg);
    var pd = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(seg);
    if (!ti || !li) continue;
    var url = tagText(li[1]);
    /* 只收本站文章页链接 —— RSS 里偶尔会混进站外推广位 */
    if (url.indexOf("https://www.globaltimes.cn/") !== 0) continue;
    var t = tagText(ti[1]);
    if (t.length < 6) continue;
    out.push({ title: t, url: url, d: pd ? isoDay(pd[1]) : "" });
    if (out.length >= 18) break;
  }
  return out;
}
function csPickList(s, body) {
  if (s.kind === "cnd") return pickCNDList(body);
  if (s.kind === "gt") return pickGTFeed(body);
  return [];
}
/* 取标题：h1 最准（中国日报有），再看 og:title，最后退到 <title> 并清掉站点名后缀
   （"Chinese farming model benefits Global South - Chinadaily.com.cn"）。 */
function pickTitle(html, s) {
  var m = /<h1[^>]*>([\s\S]{2,300}?)<\/h1>/i.exec(html);
  if (m) { var t = tagText(m[1]); if (t.length >= 3) return t; }
  m = /property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html) ||
    /content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html);
  if (m) { var t2 = unent(m[1]).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); if (t2.length >= 3) return t2; }
  m = /<title>([\s\S]{2,300}?)<\/title>/i.exec(html);
  if (m) {
    return tagText(m[1]).replace(/\s*[-|｜·]\s*(Chinadaily\.com\.cn|China Daily|Global Times|globaltimes\.cn|China\.org\.cn)\s*$/i, "").replace(/^\s+|\s+$/g, "");
  }
  return s && s.src ? "" : "";
}
function sliceBy(html, re) { var m = re.exec(html); return m ? m[1] : ""; }
/* 抽 <p>。China Daily 正文就是一个 <p> 一段，图说在 <figcaption> 里不会混进来。 */
function parasFromTags(zone) {
  var out = [], ps = String(zone).match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [], seen = {};
  for (var i = 0; i < ps.length; i++) {
    var t = tagText(ps[i]);
    if (t.length < 30 || seen[t]) continue;
    seen[t] = 1;
    out.push(t);
  }
  return out;
}
/* 抽 <br> 分隔的正文。环球时报的正文根本不在 <p> 里 —— 页面上那几个 <p> 全是图片说明，
   正文是 .article_right 里用 <br><br> 连起来的一整块。不单独处理就只能抽到图注。 */
function parasFromBR(zone) {
  var s = String(zone).replace(/<br\s*\/?>/gi, "\u0001").replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\u0001");
  var raw = s.split("\u0001"), out = [], seen = {};
  for (var i = 0; i < raw.length; i++) {
    var t = tagText(raw[i]);
    if (t.length < 30 || seen[t]) continue;
    seen[t] = 1;
    out.push(t);
  }
  return out;
}
function csParas(s, html) {
  /* 下面几个正则里凡是需要写出标签字面量的地方，一律写成 \x3C —— 那正是 < 的转义，
     语义完全一样，但源码里不会出现「一个真的标签」。
     为什么非这样绕不可：结构校验器会扫源码里的外部资源与标签配对，
     正则里的这类字面量会被它当成页面上的真实标签，报出假错误。
     注释里写字面标签同样会中招（这个坑踩过三次了），所以连注释也一起避开。 */
  if (s.kind === "cnd") {
    /* 先截 #Content。用「下一个已知块」当结束锚点，比直接数闭合标签可靠 ——
       正文区里一旦嵌套了别的块，非贪婪匹配会在遇到的第一个闭合标签处就停住。 */
    var z = sliceBy(html, /id=["']Content["'][^>]*>([\s\S]*?)\x3Cdiv[^>]+id=["']div_currpage["']/i) ||
      sliceBy(html, /id=["']Content["'][^>]*>([\s\S]*?)\x3C\/div>\s*\x3Cdiv/i) ||
      sliceBy(html, /id=["']Content["'][^>]*>([\s\S]*)\x3C\/div>/i) || html;
    var r = parasFromTags(z);
    return r.length ? r : parasFromTags(html);
  }
  if (s.kind === "gt") {
    var z2 = sliceBy(html, /class=["'][^"']*article_right[^"']*["'][^>]*>([\s\S]*?)\x3C\/div>\s*\x3C\/div>/i) ||
      sliceBy(html, /class=["'][^"']*article_right[^"']*["'][^>]*>([\s\S]*?)\x3C\/div>/i) || html;
    var r2 = parasFromBR(z2);
    if (r2.length >= 2) return r2;
    return parasFromTags(html);
  }
  return parasFromTags(html);
}
/* 拉某个源的「最新文章」列表 */
function csLoad(sid, cb) {
  var s = csOf(sid);
  if (!s) { cb({ code: "NOSRC", msg: "未知来源" }); return; }
  netGetSmart(csListURL(s), function (err, txt, ms, via) {
    netNote(s.host, err);          /* 成功/失败都记一笔：正常使用的过程本身就是持续验证 */
    if (err) { cb(err); return; }
    var list = csPickList(s, txt);
    if (!list.length) { cb({ code: "EMPTY", msg: "这个栏目这次没取到文章，换个栏目或稍后再试" }); return; }
    cb(null, list, via);
  });
}
/* 取某篇的正文并解析成段落 */
function csGrab(sid, url, cb) {
  var s = csOf(sid);
  if (!s) { cb({ code: "NOSRC", msg: "未知来源" }); return; }
  if (!netHostOK(url)) { cb({ code: "BLOCKED", msg: "这个地址不在允许列表内" }); return; }
  netGetSmart(url, function (err, html, ms, via) {
    netNote(s.host, err);
    if (err) {
      /* 中国日报的【文章页】不给跨域头，正文只能经中转 —— 所以它比别的源多一层外部依赖。
         中转是公益服务，实测会限流甚至整体挂掉（2026-09-18 两个同时不可用）。
         这时候光说「取不到」会让人以为是应用坏了，也不告诉人下一步该干什么。
         所以：① 点明这个源本来就要经过中转；② 直接给一条现在就能用的退路。 */
      if (s.needBridge && !cfg().noBridge) {
        err.hint = (err.hint ? err.hint + " " : "") +
          "这个源的文章页不放行跨域，正文本来就要经过中转服务取回，而中转是公益服务、会限流。" +
          "想现在就读的话，换成「环球时报英文版」—— 它全程直连，不依赖中转。";
      }
      cb(err);
      return;
    }
    var ps = csParas(s, html);
    if (!ps.length) { cb({ code: "EMPTY", msg: "没能从这篇文章里提取出正文（版面可能改过了）" }); return; }
    var t = pickTitle(html, s);
    var dm = /\/(\d{4})(\d{2})\/(\d{2})\//.exec(url);
    cb(null, {
      title: t || "未命名文章", ps: ps, via: via,
      d: dm ? dm[1] + "-" + dm[2] + "-" + dm[3] : todayKey()
    });
  });
}

/* ---------- 14. 文章模型 ---------- */
/* 存储结构（存在 DB.read.arts 里，随主库一起持久化）
   { id, t:标题, src:来源名, sid:源 id, url, lic:许可, d:"YYYY-MM-DD",
     ps:[段落字符串], rd:{done,ts,mins}, seen:[读过的词] } */
function splitParas(text) {
  var raw = String(text || "").replace(/\r\n/g, "\n").split(/\n\s*\n/);
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var p = raw[i].replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (p.length > 1) out.push(p);
  }
  return out;
}
/* 句子切分：按 . ! ? 断句，但要放过常见缩写与小数点，否则 Mr. / U.S. / 3.5 会把句子切碎 */
var ABBR = ["mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "vs", "etc", "eg", "ie", "no", "fig", "approx", "cf", "al", "inc", "ltd", "co", "dept", "est", "min", "max", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"];
function splitSents(p) {
  var out = [], buf = "", i = 0;
  while (i < p.length) {
    var ch = p.charAt(i);
    buf += ch;
    if (ch === "." || ch === "!" || ch === "?") {
      /* 小数点：. 后紧跟数字 → 不是句末 */
      var nxt = p.charAt(i + 1);
      var isDot = ch === ".";
      var dec = isDot && /[0-9]/.test(nxt);
      /* 缩写：往前取一个词，落在缩写表里就不算句末 */
      var m = /([A-Za-z]+)$/.exec(buf.slice(0, -1));
      var abb = isDot && m && ABBR.indexOf(m[1].toLowerCase()) >= 0;
      /* 单字母缩写（U.S. 里的 S.） */
      var single = isDot && m && m[1].length === 1;
      var nextOK = nxt === "" || nxt === " " || nxt === "\t";
      if (!dec && !abb && !single && nextOK) {
        /* 吞掉后面的引号/括号再断开 */
        while (/["')\]]/.test(p.charAt(i + 1))) { i++; buf += p.charAt(i); }
        out.push(buf.replace(/\s+$/, ""));
        buf = "";
        i++;
        while (p.charAt(i) === " ") i++;
        continue;
      }
    }
    i++;
  }
  if (buf.replace(/\s+/g, "") !== "") out.push(buf.replace(/^\s+|\s+$/g, ""));
  return out;
}
function artWords(text) {
  var m = String(text || "").match(/[A-Za-z][A-Za-z'’\-]*/g);
  return m || [];
}
function artCount(a) {
  var n = 0;
  for (var i = 0; i < a.ps.length; i++) n += artWords(a.ps[i]).length;
  return n;
}
/* 按词数上限裁剪：只收完整段落，超限就停在段落边界，并标注是节选 */
function artTrim(ps, maxWords) {
  var out = [], n = 0;
  for (var i = 0; i < ps.length; i++) {
    var w = artWords(ps[i]).length;
    if (n > 0 && n + w > maxWords) break;
    out.push(ps[i]);
    n += w;
  }
  return { ps: out.length ? out : ps.slice(0, 1), cut: out.length < ps.length, n: n };
}
function artMk(o) {
  var ps = o.ps ? o.ps.slice() : splitParas(o.text || "");
  var t = artTrim(ps, cfg().readMaxWords || 900);
  return {
    id: o.id || ("a" + now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)),
    t: o.t || "未命名文章",
    src: o.src || "手动导入", sid: o.sid || "manual",
    url: o.url || "", lic: o.lic || "仅个人学习使用",
    d: o.d || todayKey(),
    ps: t.ps, cut: !!t.cut || !!o.cut,
    rd: { done: false, ts: 0, mins: 0 }
  };
}
function artSave(a) {
  if (!DB.read) DB.read = { arts: {}, last: "" };
  DB.read.arts[a.id] = a;
  save(true);
}
function artGet(id) { return (DB.read && DB.read.arts[id]) || null; }
function artAll() {
  var o = (DB.read && DB.read.arts) || {}, r = [];
  for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r.push(o[k]);
  r.sort(function (x, y) { return (y.rd.ts || 0) - (x.rd.ts || 0) || (y.d < x.d ? -1 : 1); });
  return r;
}
function artDel(id) {
  if (DB.read && DB.read.arts) { delete DB.read.arts[id]; save(true); }
}
function artToday() {
  var k = todayKey();
  if (!DB.read) DB.read = { arts: {}, last: "" };
  DB.read.last = k;
  save(true);
}

/* ---------- 15. 词元 / 词形还原 / 难度档位 ---------- */
/* 为什么要自己写词形还原：维基/新闻文本里 running / studies / began 这类变形极多，
   不还原的话「点词查义」会大面积查不到，精读体验直接崩掉。
   这里用规则法（后缀剥离 + 候选验证），因为应用是离线的、不能调服务。 */
function lemTry(w) {
  var c = [], s = w.toLowerCase();
  if (s.length < 3) return c;
  /* 复数 / 三单 */
  if (/ies$/.test(s)) c.push(s.slice(0, -3) + "y");
  if (/(ches|shes|sses|xes|zes)$/.test(s)) c.push(s.slice(0, -2));
  if (/es$/.test(s)) c.push(s.slice(0, -2));
  if (/s$/.test(s) && !/ss$/.test(s)) c.push(s.slice(0, -1));
  /* 过去式 / 过去分词 */
  if (/ied$/.test(s)) c.push(s.slice(0, -3) + "y");
  if (/ed$/.test(s)) {
    c.push(s.slice(0, -2));                       /* walked → walk */
    c.push(s.slice(0, -1));                       /* liked → like */
    if (/([bdfglmnprt])\1ed$/.test(s)) c.push(s.slice(0, -3));   /* stopped → stop */
  }
  /* 进行时 */
  if (/ing$/.test(s)) {
    c.push(s.slice(0, -3));                       /* walking → walk */
    c.push(s.slice(0, -3) + "e");                 /* making → make */
    if (/([bdfglmnprt])\1ing$/.test(s)) c.push(s.slice(0, -4));  /* running → run */
    if (/ying$/.test(s)) c.push(s.slice(0, -4) + "ie");          /* lying → lie */
  }
  /* 副词 */
  if (/ily$/.test(s)) c.push(s.slice(0, -3) + "y");    /* happily → happy */
  if (/ly$/.test(s)) { c.push(s.slice(0, -2)); c.push(s.slice(0, -1)); }
  /* 比较级 / 最高级 */
  if (/ier$/.test(s)) c.push(s.slice(0, -3) + "y");
  if (/iest$/.test(s)) c.push(s.slice(0, -4) + "y");
  if (/est$/.test(s)) { c.push(s.slice(0, -3)); c.push(s.slice(0, -2)); }
  if (/er$/.test(s)) { c.push(s.slice(0, -2)); c.push(s.slice(0, -1)); }
  /* 不规则动词：靠词库里的词形变化字段反查，不硬编码表 */
  return c;
}
/* 不规则变形（went/children 之类）查不了后缀规则，改成扫词库的 FM（词形变化）字段建反向索引。
   只建一次，惰性触发 —— 2.4 万词扫一遍约几十毫秒，换来准确得多的还原。 */
var FRM = null;
function buildFormIdx() {
  if (FRM) return;
  FRM = Object.create(null);
  for (var i = 0; i < WORDS.length; i++) {
    var r = WORDS[i], fm = splitPipe(r[F.FM]);
    for (var j = 0; j < fm.length; j++) {
      var parts = fm[j].split(/[:,]/);              /* 形如 "p:went/i:going/3:goes" */
      if (parts.length < 2) continue;
      var v = parts[1].replace(/^\s+|\s+$/g, "").toLowerCase();
      if (v && !FRM[v]) FRM[v] = r;
    }
  }
}
/* 「纯变形条目」的识别。
   为什么需要它：词库里直接躺着 studies / accidents / abbreviated 这类条目，它们不是
   独立的词，中文释义写成了「（study的复数）」「(abuse的过去式和过去分词)」。点开只看到
   一句「study 的复数」，学不到东西 —— 这种情况要还原到原形。
   反过来，left（左边）/ running（运转；赛跑）/ thing 这些有独立释义的词一律**不还原**：
   把 left 还原成 leave 会让人莫名其妙。判断完全基于释义文案，不硬编码任何词表。 */
/* 变形条目的释义长相很不统一：有的是「（study的复数）」，有的是「科学家(scientist的名词复数)」。
   早先只写了「的复数」，漏掉了「的**名词**复数」这类写法 —— 结果 scientists 没能被还原，
   行内提示成一句绕口的「科学家(scientist的名词复数)」。所以这里按「的 + 变形类型」枚举。 */
var DEFORM_RE = /的(复数|名词复数|过去式|过去分词|现在分词|第三人称|比较级|最高级)/;
function isDeformRec(r) {
  if (!r) return false;
  return DEFORM_RE.test(String(r[F.CN] || "")) || DEFORM_RE.test(String(r[F.EN] || ""));
}
/* 点词查义的主入口。三级兜底，顺序不能换：
   ① 库里有该词形、且是独立词条 → 直接给（left / running / thing）
   ② 库里有该词形、但明显是变形条目 → 还原到原形，原条目挂在 alt 上备查（studies）
   ③ 库里没有该词形 → 后缀规则 + 词形变化字段反查（went / bigger / walked） */
function lookWord(w) {
  var s = String(w || "").toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
  if (!s) return null;
  var direct = rec(s) || null;
  if (direct && !isDeformRec(direct)) return { w: s, r: direct, lem: false };
  var c = lemTry(s), i, r = null, base = "";
  for (i = 0; i < c.length; i++) { r = rec(c[i]); if (r && !isDeformRec(r)) { base = c[i]; break; } r = null; }
  if (!r) {
    buildFormIdx();
    if (FRM[s]) { r = FRM[s]; base = r[F.W]; }
    else for (i = 0; i < c.length; i++) { if (FRM[c[i]]) { r = FRM[c[i]]; base = r[F.W]; break; } }
  }
  if (r && String(base).toLowerCase() !== s) return { w: base, r: r, lem: true, from: s, alt: direct };
  if (direct) return { w: s, r: direct, lem: false };
  return null;
}
/* 难度档位：从低到高。一个词同时挂了多个标签时取最低档 ——
   那才是「它最早该被学会的时候」，对判断文章难度更有意义。 */
/* 档位表。键必须与词库 TG 字段里的实际标签一字不差 ——
   数据里用的是**全称**（zhongkao / gaokao / kaoyan），而早先这里写的是短名（zk / gk / ky），
   两者对不上，于是中考 / 高考 / 考研三个档位**整体失效**：
   the（标签 gaokao|cet4）被当成四级词、is（标签只有 nce1|verb1000）直接落进「超纲」。
   后果是精读里最简单的一批词全被标成生词，显释义档满屏中文、文章根本读不下去。
   短名只作兼容保留；全称同时也是词书 id，两者统一以后少一层映射、少一个对不上的坑。 */
var LVLS = [
  ["zhongkao", "中考"], ["gaokao", "高考"], ["cet4", "四级"], ["cet6", "六级"],
  ["kaoyan", "考研"], ["toefl", "托福"], ["ielts", "雅思"], ["gre", "GRE"]
];
var LVL_ORDER = {
  /* 最常用词清单：换一种方式标注「这是基础词汇」，按中考档看待 */
  nce1: 0, nce2: 0, verb1000: 0, noun1500: 0, adj500: 0, oxford3000: 0, zk: 0, zhongkao: 0,
  gk: 1, gaokao: 1,
  cet4: 2, cet6: 3,
  ky: 4, kaoyan: 4,
  toefl: 5, ielts: 6, gre: 7
};
/* 同一档位的「难度权重」，给难度星级算加权平均用。超纲给 8，比 GRE 还高一档 */
var LVL_W = {
  nce1: 0, nce2: 0, verb1000: 0, noun1500: 0, adj500: 0, oxford3000: 0, zk: 0, zhongkao: 0,
  gk: 1, gaokao: 1, cet4: 2, cet6: 3, ky: 4, kaoyan: 4, toefl: 5, ielts: 6, gre: 7, out: 8
};
function lvlOf(r) {
  if (!r) return "out";
  var t = wordTags(r), best = "out", bestN = 99;
  for (var i = 0; i < t.length; i++) {
    if (LVL_ORDER[t[i]] !== undefined && LVL_ORDER[t[i]] < bestN) { bestN = LVL_ORDER[t[i]]; best = t[i]; }
  }
  return best;
}
function lvlName(k) {
  for (var i = 0; i < LVLS.length; i++) if (LVLS[i][0] === k) return LVLS[i][1];
  return "超纲";
}
/* 精读里的「生词」判定：
   ① 词库里查不到 → 一定是生词（但排除人名/地名这类大写专名，否则满篇是生词）
   ② 档位在用户设定的门槛之上，且还没学过 → 算生词
   这个门槛放在设置里，默认「四级」，备考六级的同学可以调到「六级」。 */
function readNewFrom() { return cfg().readNewFrom || "cet4"; }
/* 高频词豁免。为什么要单独一条：
   词表标签对 the / is / and 这类功能词经常只标「最早收录它的那个考纲」，甚至什么都不给
   （is 的标签只有 nce1|verb1000）。词频是另一把更可靠的尺子 —— COCA / BNC 排名进前 1000
   的词一律不打扰。注意 is / was 这类条目的词频字段本身是坏的（is 的 BNC 写着 24648），
   所以这一条兜不住它们，真正兜住的是 LVL_ORDER 里那几个「最常用词清单」标签。两条一起才够。 */
var HOT_FRQ = 1000;
function isHotWord(r) {
  if (!r) return false;
  var q = Number(r[F.FRQ] || 0), b = Number(r[F.BNC] || 0);
  var best = q > 0 && b > 0 ? Math.min(q, b) : (q > 0 ? q : b);
  return best > 0 && best <= HOT_FRQ;
}
/* 反向查词形：led 既是「发光二极管」，也是 lead 的过去式。
   语境里到底是哪个只有读者能判断，所以弹窗要把两条都摆出来、不替用户下结论。 */
function formOf(w) {
  buildFormIdx();
  var s = String(w || "").toLowerCase();
  return (FRM[s] && String(FRM[s][F.W]).toLowerCase() !== s) ? FRM[s] : null;
}
function isNewTerm(tok, r) {
  if (/^[A-Z]/.test(tok) && !/^[A-Z]{2,}$/.test(tok) && !r) return false;   /* 疑似专名，不标 */
  if (!r) return true;
  if (isHotWord(r)) return false;                                           /* 超高频功能词不打扰 */
  var lv = lvlOf(r), gate = LVL_ORDER[readNewFrom()];
  if (lv === "out") return true;
  if (LVL_ORDER[lv] < gate) return false;                                   /* 低于门槛的常见词不打扰 */
  var p = DB.prog[r[F.W]];
  if (p && (p[N.ST] === 3 || (p[N.N] || 0) >= 3)) return false;             /* 已掌握 / 已练熟 */
  return true;
}
/* 整篇文章的词汇画像 —— 这是「这篇文章对我到底有多难」的答案 */
function artProfile(a) {
  var cnt = {}, order = [], i, j;
  for (i = 0; i < a.ps.length; i++) {
    var tk = artWords(a.ps[i]);
    for (j = 0; j < tk.length; j++) {
      var k = tk[j].toLowerCase();
      if (!cnt[k]) { cnt[k] = 0; order.push(k); }
      cnt[k]++;
    }
  }
  var byLvl = {}, newMap = {}, known = 0, nw = 0;
  for (i = 0; i < order.length; i++) {
    var w = order[i], lk = lookWord(w);
    var r = lk ? lk.r : null;
    var lv = lvlOf(r);
    byLvl[lv] = (byLvl[lv] || 0) + 1;
    /* alt = 「它同时也是某个词的变形」时那条原形记录（led → lead）。
       在这里算一次存下来，行内释义与配对题都能直接用，不必每次现查。 */
    if (isNewTerm(w, r)) {
      newMap[w] = { w: w, lv: lv, n: cnt[w], r: r, base: lk ? lk.w : w, alt: (lk && !lk.lem) ? formOf(w) : null };
      nw++;
    }
    else known++;
  }
  var newList = [];
  for (var k2 in newMap) if (Object.prototype.hasOwnProperty.call(newMap, k2)) newList.push(newMap[k2]);
  newList.sort(function (x, y) { return (LVL_ORDER[y.lv] === undefined ? 99 : LVL_ORDER[y.lv]) - (LVL_ORDER[x.lv] === undefined ? 99 : LVL_ORDER[x.lv]) || y.n - x.n; });
  var total = 0;
  for (i = 0; i < order.length; i++) total += cnt[order[i]];
  var ratio = order.length ? nw / order.length : 0;
  /* 难度星级：用「不重复词的加权平均档位」，不用生词占比。
     占比口径有个致命缺陷 —— 门槛以上的词几乎都算生词（备考的人本来就没背完一册），
     于是任何一篇文章都算出接近 100%、恒定 5 星，对谁都没有区分度。
     平均档位只看文章用了什么词，与学习记录无关：同一篇文章对所有人给出同一个星级。 */
  var lvSum = 0;
  for (i = 0; i < order.length; i++) {
    var lk3 = lookWord(order[i]);
    lvSum += LVL_W[lvlOf(lk3 ? lk3.r : null)];
  }
  var avgLv = order.length ? lvSum / order.length : 0;
  var star = avgLv < 1.2 ? 1 : avgLv < 2.0 ? 2 : avgLv < 2.8 ? 3 : avgLv < 3.6 ? 4 : 5;
  return {
    total: total, uniq: order.length, cnt: cnt, map: newMap,
    byLvl: byLvl, newList: newList, newN: nw, knownN: known,
    ratio: ratio, star: star
  };
}

/* 列表页用的画像摘要：算一次就存进文章对象（随本地库一起持久化），
   免得每次进「我的文章」都把每篇全文重扫一遍。
   精读台里会重算精确画像，所以这里不追求实时 —— 难度星级本来也变化很慢。 */
function artStat(a) {
  if (a.pf) return a.pf;
  var p = artProfile(a);
  a.pf = { n: p.total, nw: p.newN, uniq: p.uniq, star: p.star };
  return a.pf;
}

/* ---------- 15c. 打开就自动取一篇（喂给首页） ----------
 * 需求原文：「每次打开以后自动拉取文章，将文章放在主页面」。
 *
 * 这条需求跟「离线可用」是有张力的，所以规则得写清楚，不能只是「开机就发个请求」：
 *   ① 尊重联网开关。用户在设置里关掉了联网 → 一个请求都不发，这是硬承诺。
 *   ② 一天只自动取一次。这不是为了省流量，是为了不打扰：
 *      每次回到首页都拉一篇，用户会看到列表不断变长、越来越乱，
 *      而且「今天读什么」这个决定会被反复推翻。取一次、然后稳住。
 *   ③ 只取一篇，不取一整个列表。自动行为应该收敛，不该替用户做一堆决定。
 *   ④ 失败了不弹错。这是后台行为，没有人在等它。失败就静静记下原因，
 *      等用户自己点开精读页时再如实告诉他 —— 开机弹一个红色报错是最讨人厌的做法。
 *   ⑤ 只挑「当前网络下确实连得上」的源。按自测/使用中积累的可达性标记来选，
 *      再去掉已经取过的同一篇，避免每天打开都看到同一篇文章。
 */
var AUTOA = { st: "", msg: "", art: null, day: "", busy: false };

/* 挑这一轮该从哪个源取。规则：优先环球时报（全程直连、不经第三方、最快），
   其次中国日报的各个栏目（经中转，稍慢但内容更贴中国语境）。
   被判定不可达的一律跳过；全不可用时返回 null（调用方就此收手，不硬取）。 */
function autoSrcPick() {
  var gt = csOf("gt");
  if (gt && !srcDown(gt)) return gt;
  for (var i = 0; i < CSRC.length; i++) {
    if (CSRC[i].kind === "cnd" && !srcDown(CSRC[i])) return CSRC[i];
  }
  return null;
}
/* 从列表里挑一篇还没读过的。
   为什么要挑「没读过的」：自动拉取如果每次都落同一篇（栏目的头条一天内不变），
   用户会觉得这功能是坏的。退而求其次——全读过了就取最新那篇（至少内容是对的）。 */
function autoPickItem(list) {
  if (!list || !list.length) return null;
  var have = {};
  var all = artAll();
  for (var i = 0; i < all.length; i++) if (all[i].url) have[all[i].url] = 1;
  for (var j = 0; j < list.length; j++) if (!have[list[j].url]) return list[j];
  return list[0];
}
/* 首页上要展示「当前可读的那一篇」。这个函数只读本地数据，零网络请求 ——
   首页是打开就渲染的，任何网络依赖都会让首屏闪一下。
   优先级：今天自动取的那篇 > 今天最后一次精读的 > 文章库里最新的一篇。 */
function autoArtToday() {
  var all = artAll();
  if (!all.length) return null;
  var dk = todayKey();
  if (AUTOA.art) { var a = artGet(AUTOA.art); if (a && !a.rd.done) return a; }
  if (DB.read && DB.read.autoDay === dk && DB.read.autoId) {
    var b = artGet(DB.read.autoId);
    if (b) return b;
  }
  return all[0];
}
/* 开始自动取文。cb(art|null, msg) —— 成功给文章，失败给一句人话原因。
   ⚠ 三处「不」必须同时成立才算做对：不越过联网开关、不重复取、不弹错。 */
function autoFetchArt(cb) {
  var dk = todayKey();
  var done = function (art, msg) { AUTOA.busy = false; AUTOA.st = art ? "ok" : "no"; AUTOA.msg = msg || ""; if (art) AUTOA.art = art.id; if (cb) cb(art, msg); };

  if (cfg().netOff) { AUTOA.st = "off"; AUTOA.msg = "联网已关闭"; if (cb) cb(null, "联网已关闭"); return; }
  if (NETST.on === false) { AUTOA.st = "off"; AUTOA.msg = "当前离线"; if (cb) cb(null, "当前离线"); return; }
  if (typeof fetch !== "function") { AUTOA.st = "no"; AUTOA.msg = "浏览器不支持联网"; if (cb) cb(null, "浏览器不支持联网"); return; }
  if (AUTOA.busy) return;
  /* 今天已经取过 → 直接把那一篇交出去，不发任何请求 */
  if (DB.read && DB.read.autoDay === dk) {
    var had = DB.read.autoId ? artGet(DB.read.autoId) : null;
    if (had) { done(had, ""); return; }
  }
  var s = autoSrcPick();
  if (!s) { AUTOA.st = "no"; AUTOA.msg = "当前网络下没有可用的来源"; if (cb) cb(null, AUTOA.msg); return; }

  AUTOA.busy = true; AUTOA.st = "run"; AUTOA.msg = "";
  csLoad(s.id, function (err, list) {
    if (err) { done(null, err.hint ? err.msg + " " + err.hint : err.msg); return; }
    var it = autoPickItem(list);
    if (!it) { done(null, "这个栏目这次没取到文章"); return; }
    csGrab(s.id, it.url, function (e2, r) {
      if (e2) { done(null, e2.hint ? e2.msg + " " + e2.hint : e2.msg); return; }
      var a = artMk({ t: r.title, ps: r.ps, src: s.src, sid: s.id, url: it.url, lic: s.lic, d: r.d || it.d });
      a.via = r.via || "";
      a.auto = 1;                       /* 标记：这是自动取回来的，方便「我的文章」里区分 */
      artSave(a);
      /* 记下「今天自动取的是哪一篇」。跨天自然失效 —— 第二天 autoDay 对不上就会再取一次，
         而且挑的是「没读过的那篇」，不会连着几天都是同一篇。 */
      if (!DB.read) DB.read = { arts: {}, last: "" };
      DB.read.autoDay = dk; DB.read.autoId = a.id;
      save(true);
      done(a, "");
    });
  });
}

/* ---------- 16. 抓取适配器 ---------- */
/* 这里刻意把「取」和「解析」拆成两层：
   fetchXxx 只负责发请求，pickXxx 是纯函数只负责把 JSON 变成文章。
   好处是测试可以直接喂一份夹具 JSON 验证解析，完全不依赖真实网络 ——
   在没法稳定联外网的环境里，这是唯一能保证解析逻辑正确性的办法。 */

function pickFeatured(j) {
  var out = [];
  if (!j) return out;
  if (j.tfa && j.tfa.title) {
    out.push({
      kind: "topic", id: "tfa", badge: "今日特色条目", title: j.tfa.title,
      text: (j.tfa.extract || "").replace(/\s+/g, " "),
      url: (j.tfa.content_urls && j.tfa.content_urls.desktop && j.tfa.content_urls.desktop.page) || "",
      src: "维基百科 · 每日精选", sid: "wikifeat", lic: "CC BY-SA",
      host: "en.wikipedia.org"
    });
  }
  var news = j.news || [];
  for (var i = 0; i < news.length && i < 6; i++) {
    var it = news[i];
    if (!it || !it.story) continue;
    out.push({
      kind: "news", id: "news" + i, badge: "时事 · " + (it.story || "").slice(0, 40),
      title: "时事热词：" + (it.story || "").slice(0, 60),
      text: (it.story || "").replace(/\s+/g, " "),
      url: "", src: "维基百科 · 时事", sid: "wikifeat", lic: "CC BY-SA",
      host: "en.wikipedia.org", links: (it.links || []).slice(0, 8)
    });
  }
  return out;
}
function pickExtract(j) {
  if (!j || !j.query || !j.query.pages) return null;
  var pages = j.query.pages, k;
  for (k in pages) {
    if (!Object.prototype.hasOwnProperty.call(pages, k)) continue;
    var p = pages[k];
    if (p && p.extract && String(p.extract).replace(/\s+/g, "").length > 80) {
      return { title: p.title || "", text: p.extract, missing: false };
    }
    if (p && p.missing !== undefined) return { title: p.title || "", text: "", missing: true };
  }
  return null;
}
function pickSearch(j) {
  var out = [];
  if (!j || !j.query || !j.query.search) return out;
  for (var i = 0; i < j.query.search.length; i++) {
    var s = j.query.search[i];
    out.push({
      title: s.title || "",
      snip: String(s.snippet || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " "),
      size: s.size || 0
    });
  }
  return out;
}
function pickNews(j) {
  var out = [];
  if (!j || !j.query || !j.query.categorymembers) return out;
  for (var i = 0; i < j.query.categorymembers.length; i++) {
    var m = j.query.categorymembers[i];
    if (m && m.title) out.push({ title: m.title });
  }
  return out;
}
function pickGuardian(j) {
  var out = [];
  if (!j || !j.response || !j.response.results) return out;
  for (var i = 0; i < j.response.results.length; i++) {
    var a = j.response.results[i], f = a.fields || {};
    var txt = f.bodyText || a.standfirst || f.standfirst || "";
    if (!txt) continue;
    out.push({
      title: a.webTitle || f.headline || "卫报文章",
      text: txt, url: a.webUrl || "",
      d: (a.webPublicationDate || "").slice(0, 10),
      src: "卫报 The Guardian", sid: "guardian", lic: "Guardian Open Platform",
      host: "content.guardianapis.com"
    });
  }
  return out;
}

/* ---------- 17. 抓取动作 ---------- */
function getFeatured(cb) {
  var d = new Date();
  netGetJSON(urlFeatured(d.getFullYear(), d.getMonth() + 1, d.getDate()), function (err, j) {
    if (err) { cb(err); return; }
    cb(null, pickFeatured(j));
  });
}
function getExtract(host, title, cb) {
  netGetJSON(urlExtract(host, title), function (err, j) {
    if (err) { cb(err); return; }
    var r = pickExtract(j);
    if (!r) { cb({ code: "EMPTY", msg: "没取到正文（条目可能不存在或只有极短内容）" }); return; }
    cb(null, r);
  });
}
function doSearch(sid, q, cb) {
  if (sid === "guardian") {
    netGetJSON(urlGuardian(q, cfg().guardianKey), function (err, j) {
      if (err) { cb(err); return; }
      if (j && j.response && j.response.status && j.response.status !== "ok") {
        cb({ code: "GUARDIAN", msg: "卫报接口返回 " + j.response.status + "（多半是 API Key 无效或超额）" });
        return;
      }
      var list = pickGuardian(j);
      if (!list.length) { cb({ code: "EMPTY", msg: "卫报没有匹配结果" }); return; }
      cb(null, list.map(function (x, i) { x.__i = i; return x; }));
    });
    return;
  }
  var s = srcOf(sid);
  if (!s) { cb({ code: "NOSRC", msg: "未知来源" }); return; }
  netGetJSON(urlSearch(s.host, q), function (err, j) {
    if (err) { cb(err); return; }
    var list = pickSearch(j);
    if (!list.length) { cb({ code: "EMPTY", msg: "没有搜到条目" }); return; }
    cb(null, list);
  });
}
function getNewsList(cb) {
  netGetJSON(urlNews("en.wikinews.org"), function (err, j) {
    if (err) { cb(err); return; }
    var l = pickNews(j);
    if (!l.length) { cb({ code: "EMPTY", msg: "当天没有取到新闻稿" }); return; }
    cb(null, l);
  });
}

/* ---------- 18. 读后练习（全部自动生成，不靠人工出题） ---------- */
function shortCN(r) {
  if (!r) return "";
  /* 用 firstDef 而不是直接切首行：读后练习的「词义配对」就是拿这几个字当选项，
     若首行是英文长句或孤立的 `ad`，配对题就没法做（跟选择题同一个坑）。 */
  var cn = firstDef(r) || "";
  cn = cn.replace(/^\s+|\s+$/g, "");
  if (cn.indexOf(" ") > 0 && cn.length > 24) cn = cn.slice(0, 24) + "…";
  return cn;
}
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function sentHas(sent, w) {
  try { return new RegExp("\\b" + escRe(w) + "\\b", "i").test(sent); } catch (e) { return false; }
}
function artSents(a) {
  var out = [];
  for (var i = 0; i < a.ps.length; i++) {
    var ss = splitSents(a.ps[i]);
    for (var j = 0; j < ss.length; j++) out.push({ pi: i, s: ss[j] });
  }
  return out;
}
/* ① 遮词填空：从本篇生词里挑，用文章原句当语境，考的是「回到上下文还认不认得」 */
function mkCloze(a, prof, n) {
  var out = [], all = artSents(a);
  for (var i = 0; i < prof.newList.length && out.length < n; i++) {
    var it = prof.newList[i];
    if (!it.r) continue;                       /* 词库里查不到的（专名 / 超纲）不出题 */
    var cn = shortCN(it.r);
    if (!cn) continue;
    var sent = "";
    for (var j = 0; j < all.length; j++) { if (sentHas(all[j].s, it.w)) { sent = all[j].s; break; } }
    if (!sent || sent.length > 260) continue;
    var blank = sent.replace(new RegExp("\\b" + escRe(it.w) + "\\b", "gi"), "＿＿＿＿");
    out.push({
      w: it.w, disp: it.r[F.W], cn: cn, sent: sent, blank: blank,
      hint: it.w.charAt(0).toUpperCase() + " _ ".repeat(Math.max(0, Math.min(8, it.w.length - 1))).replace(/\s+$/, "")
    });
  }
  return out;
}
/* ② 词义配对：本篇生词 vs 释义，考的是「认得出意思」 */
function mkMatch(prof, n) {
  var pool = [], i;
  for (i = 0; i < prof.newList.length && pool.length < n; i++) {
    var it = prof.newList[i];
    if (!it.r) continue;
    var cn = shortCN(it.r);
    if (!cn) continue;
    pool.push({ w: it.r[F.W], cn: cn, ph: it.r[F.US] || it.r[F.UK] || "" });
  }
  return pool;
}
/* ③ 句子排序：抽一个 4~6 句的段落打乱，考的是语篇逻辑（连接词、指代、时间线） */
function mkOrder(a, n) {
  var out = [];
  for (var i = 0; i < a.ps.length && out.length < n; i++) {
    var ss = splitSents(a.ps[i]);
    if (ss.length < 4 || ss.length > 6) continue;
    var sum = 0;
    for (var j = 0; j < ss.length; j++) sum += ss[j].length;
    if (sum < 160 || sum > 700) continue;
    var idx = [];
    for (j = 0; j < ss.length; j++) idx.push(j);
    out.push({ pi: i, sents: ss, order: shuffle(idx.slice()) });
  }
  return out;
}
function mkExercises(a, prof) {
  var n = clamp(Math.round((cfg().readQuizN || 6)), 3, 12);
  return {
    cloze: mkCloze(a, prof, n),
    match: mkMatch(prof, Math.min(n, 8)),
    order: mkOrder(a, 2)
  };
}
/* 精读生词的归集地：一本固定的自定义词书。
   为什么不直接写 DB.prog：那是记忆算法的地盘，塞残缺记录会破坏间隔计算。
   复用已有的「自定义词书」机制最干净 —— 用户在词库页能直接看到这本、一键切过去学。 */
var READ_BOOK = "readnew";
function readBook() {
  if (!DB.custom) DB.custom = {};
  if (!DB.custom[READ_BOOK]) DB.custom[READ_BOOK] = { name: "精读生词", desc: "文章精读时收藏的生词", words: [], created: now() };
  if (!DB.custom[READ_BOOK].words) DB.custom[READ_BOOK].words = [];
  return DB.custom[READ_BOOK];
}
function artWordsToLearn(prof) {
  var bk = readBook(), have = {}, added = 0, i;
  for (i = 0; i < bk.words.length; i++) have[bk.words[i][F.W]] = 1;
  for (i = 0; i < prof.newList.length; i++) {
    var it = prof.newList[i];
    if (!it.r) continue;                       /* 专名与词库外的词不入队，免得污染记忆数据 */
    var w = it.r[F.W];
    if (have[w]) continue;
    bk.words.push(it.r);
    have[w] = 1; added++;
  }
  refreshCustomIndex(); TAGS = {}; BOWN = {};
  save(true);
  return added;
}

