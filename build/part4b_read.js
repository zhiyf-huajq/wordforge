/* ===================== 词匠 WordForge · 文章精读视图 ===================== */
/* 视图分两层：
   vRead()        精读主页（发现 / 我的文章 两个页签），是导航里的一级视图
   artPageHTML()  精读台，是【跳转页】而不是一级视图 ——
                  这样从文章里点一个词查义、再返回时，文章还在原处，
                  跳转栈天然处理了「回来」这件事，不用自己维护状态机。 */

/* ---------- 19. 精读状态 ---------- */
var RTAB = "discover";        /* discover | mine */
var RSRC = "simplewiki";      /* 当前选中的文章源 */
var RQ = "";                  /* 检索关键词 */
var RRES = null;              /* 检索结果 */
var RNEWS = null;             /* 当日新闻稿列表（和检索结果分开，免得互相覆盖） */
var RFEED = null;             /* 每日推荐 */
var RBUSY = "";               /* 正在进行的动作名，用于按钮禁用与文案 */
var RMSG = null;              /* { kind:"bad"|"ok"|"info", text, hint } */
var RA = null;                /* 当前精读台的 { id, prof }，档位切换时复用，不重算 */
/* 中国英文媒体这一块有自己的状态：选中的源、拉到的列表、正在忙什么。
   和上面的检索状态分开，是因为两者是并列的两个入口 ——
   在「按主题找文章」里搜了词，不该把「拉最新列表」的结果冲掉，反之亦然。 */
var CSEL = "cnd-china";       /* 当前选中的中国源 */
var CLIST = null;             /* 拉到的文章列表 */
var CBUSY = "";               /* 正在进行的动作："list" | "grab" */
var CVIA = "";                /* 最近一次取文走的是中转的话，记下服务名（用于如实标注） */

/* 画像算一次要遍历全文并查每个词的档位，放渲染里反复算会明显卡。
   只缓存「当前打开的这一篇」—— 切文章或改进度时自然重算，不会读到过期数据。 */
function profOf(a) {
  if (RA && RA.id === a.id) return RA.prof;
  RA = { id: a.id, prof: artProfile(a) };
  return RA.prof;
}
function starStr(n) { var s = ""; for (var i = 1; i <= 5; i++) s += i <= n ? "★" : "☆"; return s; }

/* ---------- 20. 精读主页 ---------- */
function vRead() {
  var h = '<div class="study-wrap">';
  h += '<div class="card">' + rdTabsHTML() + rdNetBarHTML();
  if (RTAB === "discover") h += rdDiscoverHTML();
  else h += rdMineHTML();
  h += "</div>";
  /* 说明区：把「为什么这个功能要联网」「离线时还能做什么」讲清楚 */
  h += '<div class="card"><div class="secttl">关于精读</div>' +
    '<p class="muted" style="line-height:1.85;font-size:13px">' +
    "精读是<b>唯一需要联网</b>的模块：文章本来就在网上，得先把正文取回来。其余功能（背单词、复习、词库、统计）全程零网络请求，断网照常使用。<br>" +
    "取回来的文章会存进本地库，<b>之后断网也能反复精读</b> —— 联网只是「进货」的那一次。<br>" +
    "取文时只发出 GET 请求、不携带任何凭据、不发送来源页地址，也没有任何上传通道，你的学习数据不会离开这台设备。" +
    "</p>" +
    '<div class="rrow"><button class="btn ghost sm" id="rdTestAll">源可达性自测</button>' +
    '<span class="muted" style="font-size:12px">测一下你这台设备现在能连上哪几个源</span></div>' +
    "</div>";
  h += "</div>";
  return h;
}
function rdTabsHTML() {
  function b(id, name) { return '<button class="rtab' + (RTAB === id ? " on" : "") + '" data-rtab="' + id + '">' + name + "</button>"; }
  return '<div class="rtabs">' + b("discover", "发现文章") + b("mine", "我的文章 " + artAll().length) + "</div>";
}
function rdNetBarHTML() {
  var off = cfg().netOff;
  var on = NETST.on;
  var dot = off ? "off" : (on === false ? "off" : on ? "on" : "unk");
  var txt = off ? "联网已关闭" : (on === false ? "当前离线" : on ? "已联网" : "网络状态未知");
  var h = '<div class="rnet ' + dot + '"><i></i><b>' + txt + "</b>";
  /* 取不了文章的时候，不能只告诉用户「不行」—— 得在同一眼范围内给出另一条路。
     粘贴导入是完全离线的，所以在「我的文章」页；这里直接放一个切页按钮，
     免得用户自己在两个页签之间摸索。 */
  if (off) {
    h += '<span>到「设置 → 精读」打开联网开关才能取文（这是应用里唯一联网的模块）</span>' +
      '<button class="btn ghost sm" data-rtab="mine">不联网，直接粘贴导入 ›</button>';
  } else if (on === false) {
    h += '<span>现在取不了新文章；已经取回本地的仍可离线精读</span>' +
      '<button class="btn ghost sm" data-rtab="mine">改用粘贴导入 ›</button>';
  } else h += '<span>只发出 GET 请求，不上传任何数据</span>';
  h += "</div>";
  if (RMSG) h += '<div class="rmsg ' + RMSG.kind + '">' + esc(RMSG.text) + (RMSG.hint ? '<span>' + esc(RMSG.hint) + "</span>" : "") + "</div>";
  /* 自测结果。这里的文案由结果本身推导，不再写死「境外源打不开是常态」——
     那句是 2026-09 的一次性实测记录，写死在界面上会变成一句永远正确、也永远没用的话。
     现在改成按网管标记说话：哪个被认定不可达就点名哪个，其余正常显示。 */
  var r = NETST.results, ks = [];
  for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) ks.push(k);
  if (ks.length) {
    h += '<div class="rtest"><div class="secttl">源可达性' +
      (NETST.testing ? ' <span class="muted" style="font-weight:400">测试中…</span>' : "") + "</div>";
    for (var i = 0; i < ks.length; i++) {
      var x = r[ks[i]];
      var dn = hostDown(ks[i]);
      h += '<div class="rtline"><span class="rtok ' + (x.ok ? "y" : "n") + '">' + (x.ok ? "✓" : "✗") + "</span>" +
        "<b>" + esc(ks[i]) + "</b><span>" + esc(x.msg) + (x.ms ? " · " + x.ms + "ms" : "") +
        (dn && !x.ok ? ' · <b style="color:var(--bad)">已标记不可达，相关来源已收起</b>' : "") + "</span></div>";
    }
    h += '<p class="muted" style="font-size:12px;margin:6px 0 0">' +
      esc("打不开的源不是「被删掉了」，是暂时收起来 —— 它的代码还在。") +
      "换个网络（例如切到手机热点）再点一次自测，能通的话它自己就回来了。" +
      "完全离线的退路始终在：<b>我的文章 → 粘贴导入</b>，任何来源的文章都能贴进来精读。</p>";
    h += "</div>";
  }
  return h;
}
/* 中国英文媒体：单独一块，因为它是【拉最新列表】语义，和下面的【关键词检索】不是一回事。
   混进那个下拉框的话，用户会以为得先写个关键词才能用。 */
function rdCNHTML() {
  var s = csOf(CSEL) || CSRC[0];
  var off = cfg().netOff || NETST.on === false;
  /* 只列出当前网络下能用的栏目。被判定不可达的收起来，但明确说出「收起了几个」——
     悄悄少几个按钮，用户会以为是应用坏了或者自己记错了。 */
  var ups = [], downs = [];
  for (var q = 0; q < CSRC.length; q++) (srcDown(CSRC[q]) ? downs : ups).push(CSRC[q]);
  if (!ups.length) ups = CSRC;                      /* 兜底：全不可用时不要交出一个空壳 */
  if (srcDown(s)) s = ups[0];
  var h = '<div class="secttl cnsec">中国英文媒体 <span class="cntag">大陆可达</span></div>';
  h += '<p class="muted" style="font-size:12px;margin:2px 0 8px">' +
    "这一组是实测在<b>中国大陆网络下连得上</b>的英文媒体。取回来的文章会存进本地库，之后断网也能反复精读。</p>";
  h += '<div class="cchips">';
  for (var i = 0; i < ups.length; i++) {
    h += '<button type="button" class="cchip' + (CSEL === ups[i].id ? " on" : "") +
      '" data-csr="' + ups[i].id + '">' + esc(ups[i].short) + "</button>";
  }
  h += "</div>";
  if (downs.length) {
    h += '<p class="muted" style="font-size:12px;margin:6px 0 0;color:var(--warn)">' +
      esc("已收起 " + downs.length + " 个当前连不上的栏目（" + downs.map(function (x) { return x.short; }).join("、") +
        "）。它们的代码还在，网络恢复后会自动重新出现；也可以点上面的「源可达性自测」立刻重判。") + "</p>";
  }
  h += '<p class="muted" style="font-size:12px;margin:7px 0 8px">' + esc(s.tag) + " · 许可 " + esc(s.lic) +
    (s.rec ? ' · <b class="rec">推荐</b>' : "") + "<br>" + esc(s.note) + "</p>";
  h += '<div class="rrow"><button class="btn sm" id="rdCNLoad"' + (off || CBUSY ? " disabled" : "") + ">" +
    (CBUSY === "list" ? "取列表中…" : "拉取最新文章") + "</button>" +
    '<span class="muted" style="font-size:12px">' + (off ? "要先打开联网开关" : "拉这个栏目的最新一批") + "</span></div>";
  if (CLIST && CLIST.length) {
    h += '<div class="rlist">';
    for (i = 0; i < CLIST.length; i++) {
      h += '<div class="ritem"><div class="rtop"><span class="rbadge">' + esc(s.src) + "</span>" +
        '<span class="rsrc">' + esc(CLIST[i].d || "") + "</span></div>" +
        "<b>" + esc(CLIST[i].title) + "</b>" +
        '<button class="btn ghost sm" data-cngrab="' + i + '"' + (CBUSY ? " disabled" : "") + ">" +
        (CBUSY === "grab" ? "取正文中…" : "取全文精读 ›") + "</button></div>";
    }
    h += "</div>";
  } else if (CLIST) h += '<p class="empty sm">这个栏目这次没取到文章，换个栏目试试</p>';
  return h;
}
/* 一个源被收起时的统一交代。
   为什么要专门写一条「不可用说明」而不是直接把那块删掉：
   用户昨天还能点、今天按钮没了，第一反应是「应用坏了」或者「我记错了」。
   说清楚三件事就能消掉这个疑惑 —— 是哪一块没了、为什么、怎么让它回来。 */
function rdDownNote(name, what) {
  return '<div class="rmsg info">' +
    esc("已收起「" + what + "」—— " + name + " 在当前网络下连不上。") +
    '<span>' + esc("功能没有删除：换一个网络（手机热点 / 换个运营商）后点上面的「源可达性自测」，通了它就自动回来。") +
    "现在要读文章的话，用下面的「中国英文媒体」，或者走「我的文章 → 粘贴导入」（完全离线、不挑来源）。</span></div>";
}
function rdDiscoverHTML() {
  var h = "";
  var disabled = cfg().netOff || NETST.on === false;
  /* 「今日可读」和「当日新闻稿」两块都挂在维基上。维基一旦被判定不可达，
     这两块的按钮点了就是白等 —— 与其让人等 12 秒超时，不如直接标明并用一条
     可用的替代路径替换它。注意【不删功能】：判定是可过期的，网络一变它们就回来。 */
  var wikiDown = hostDown("en.wikipedia.org");
  if (!wikiDown) {
    /* ---- 每日内容 ---- */
    h += '<div class="secttl">今日可读</div>';
    h += '<div class="rrow"><button class="btn sm" id="rdPull"' + (disabled || RBUSY === "feed" ? " disabled" : "") + ">" +
      (RBUSY === "feed" ? "取文中…" : "拉取今天的推荐") + "</button>" +
      '<span class="muted" style="font-size:12px">维基每日精选：今日特色条目 + 时事 + 历史上的今天</span></div>';
    if (RFEED && RFEED.length) {
      h += '<div class="rlist">';
      for (var i = 0; i < RFEED.length; i++) {
        var it = RFEED[i];
        h += '<div class="ritem"><div class="rtop"><span class="rbadge">' + esc(it.badge || "") + "</span>" +
          '<span class="rsrc">' + esc(it.src) + "</span></div>" +
          "<b>" + esc(it.title) + "</b>" +
          '<p class="rmuted">' + esc(String(it.text || "").slice(0, 150)) + "…</p>" +
          (it.host ? '<button class="btn ghost sm" data-grab="' + esc(it.host) + "|" + esc(it.title) + '">取全文精读 ›</button>' : "") +
          (!it.host && it.text ? '<button class="btn ghost sm" data-mkfeed="' + i + '">用这段精读 ›</button>' : "") +
          "</div>";
      }
      h += "</div>";
    } else if (RFEED) h += '<p class="empty sm">今天的推荐是空的</p>';
  } else {
    h += '<div class="secttl">今日可读</div>';
    h += rdDownNote("维基百科", "每日精选（特色条目 / 时事 / 历史上的今天）与当日的维基新闻稿");
  }
  /* ---- 中国英文媒体（大陆可达） ---- */
  h += rdCNHTML();
  /* ---- 主题检索 ---- */
  h += '<div class="secttl">按主题找文章</div>';
  /* 下拉框里只放当前网络下能用的源。原来一次性列 6 个、其中 5 个是维基家族，
     点下去全是超时 —— 那等于把「选择」做成了「依次踩雷」。
     注意这里【不是把源删掉】：被收起的源在自测通过后会重新出现在这个列表里。 */
  var upS = [], downS = [];
  for (i = 0; i < SRCS.length; i++) (srcDown(SRCS[i]) ? downS : upS).push(SRCS[i]);
  if (!upS.length) upS = SRCS;                       /* 兜底：全不可用时不交出空下拉框 */
  if (srcDown(srcOf(RSRC))) RSRC = upS[0].id;
  h += '<div class="rrow"><select id="rdSrc" class="rsel">';
  for (i = 0; i < upS.length; i++) {
    h += '<option value="' + upS[i].id + '"' + (RSRC === upS[i].id ? " selected" : "") + ">" + esc(upS[i].name) + "</option>";
  }
  h += "</select>" +
    '<input id="rdQ" class="rin" type="text" placeholder="比如 climate change / ancient Rome" value="' + esc(RQ) + '">' +
    '<button class="btn sm" id="rdSearch"' + (disabled || RBUSY === "search" ? " disabled" : "") + ">" + (RBUSY === "search" ? "搜索中…" : "搜索") + "</button></div>";
  if (downS.length) {
    h += '<p class="muted" style="font-size:12px;margin:6px 0 0;color:var(--warn)">' +
      esc("已收起 " + downS.length + " 个当前连不上的源（" + downS.map(function (x) { return x.name; }).join("、") +
        "）。代码都还在，网络恢复后会自动回到这个列表；也可以点上面的「源可达性自测」立刻重判。") + "</p>";
  }
  var s = srcOf(RSRC);
  if (s) {
    h += '<p class="muted" style="font-size:12px;margin:2px 0 0">' + esc(s.tag) + " · 许可 " + esc(s.lic);
    if (s.rec) h += ' · <b class="rec">推荐</b>';
    h += "<br>" + esc(s.note) + "</p>";
    if (s.id === "guardian" && !cfg().guardianKey) h += '<p class="rmsg bad" style="margin-top:6px">还没填卫报 API Key —— 到「设置 → 精读」里填一个（免费申请）</p>';
  }
  if (RRES && RRES.length) {
    if (RRES[0].__i !== undefined) {
      /* 卫报结果里已含正文，直接可精读 */
      h += '<div class="rlist">';
      for (i = 0; i < RRES.length; i++) {
        h += '<div class="ritem"><div class="rtop"><span class="rbadge">卫报</span><span class="rsrc">' + esc(RRES[i].d || "") + "</span></div>" +
          "<b>" + esc(RRES[i].title) + "</b>" +
          '<p class="rmuted">' + esc(String(RRES[i].text).slice(0, 150)) + "…</p>" +
          '<button class="btn ghost sm" data-mkgd="' + i + '">开始精读 ›</button></div>';
      }
      h += "</div>";
    } else {
      h += '<div class="rlist">';
      for (i = 0; i < RRES.length; i++) {
        h += '<div class="ritem"><b>' + esc(RRES[i].title) + "</b>" +
          '<p class="rmuted">' + esc(RRES[i].snip || "") + "</p>" +
          '<button class="btn ghost sm" data-grab="' + esc(s.host) + "|" + esc(RRES[i].title) + '">取全文精读 ›</button></div>';
      }
      h += "</div>";
    }
  } else if (RRES) h += '<p class="empty sm">没有搜到结果，换个关键词试试</p>';
  /* ---- 当日新闻稿 ---- */
  if (hostDown("en.wikinews.org")) {
    h += '<div class="secttl">当日新闻稿</div>' + rdDownNote("维基新闻", "当日新闻稿列表");
  } else {
    h += '<div class="secttl">当日新闻稿</div>';
    h += '<div class="rrow"><button class="btn ghost sm" id="rdNews"' + (disabled || RBUSY === "news" ? " disabled" : "") + ">" +
      (RBUSY === "news" ? "取稿中…" : "看看今天发了什么") + '</button><span class="muted" style="font-size:12px">维基新闻 · 每日更新</span></div>';
    if (RNEWS && RNEWS.length) {
      h += '<div class="rlist">';
      for (i = 0; i < RNEWS.length; i++) {
        h += '<div class="ritem"><b>' + esc(RNEWS[i].title) + "</b>" +
          '<button class="btn ghost sm" data-grab="en.wikinews.org|' + esc(RNEWS[i].title) + '">取全文精读 ›</button></div>';
      }
      h += "</div>";
    }
  }
  /* ---- 自定义 URL ---- */
  h += '<div class="secttl">从指定地址取文</div>';
  h += '<div class="rrow"><input id="rdUrl" class="rin" type="text" placeholder="https:// 开头的 JSON 接口地址"></div>' +
    '<p class="muted" style="font-size:12px;margin:4px 0 0">只接受白名单内的域名；返回的内容需是含正文的 JSON。' +
    "如果某个源能用别的办法取到纯文本，也可以走「我的文章 → 粘贴导入」，那条路不联网、也不挑来源。</p>";
  return h;
}
function rdMineHTML() {
  var list = artAll();
  var h = '<div class="secttl">我的文章 ' + list.length + "</div>";
  if (!list.length) {
    h += '<p class="empty sm">还没有文章。到「发现文章」拉一篇，或在下面粘贴一段文本导入。</p>';
  } else {
    h += '<div class="rlist">';
    for (var i = 0; i < list.length; i++) {
      var a = list[i], st = artStat(a);
      h += '<div class="ritem">' +
        '<div class="rtop"><span class="rbadge">' + esc(a.src) + "</span>" +
        '<span class="rsrc">' + esc(a.d) + (a.cut ? " · 节选" : "") + (a.via ? " · 经中转" : "") + "</span></div>" +
        "<b>" + esc(a.t) + "</b>" +
        '<p class="rmuted">' + st.n + " 词 · 生词约 " + st.nw + "（" + Math.round(st.uniq ? st.nw / st.uniq * 100 : 0) + "%）· 难度 " + starStr(st.star) +
        (a.rd && a.rd.done ? ' · <b class="ok">已读完</b>' : "") + "</p>" +
        '<div class="rrow"><button class="btn ghost sm" data-jump="art:' + esc(a.id) + '">开始精读 ›</button>' +
        '<button class="btn ghost sm" data-jump="artq:' + esc(a.id) + '">做练习</button>' +
        '<button class="btn ghost sm danger" data-artdel="' + esc(a.id) + '">删除</button></div>' +
        "</div>";
    }
    h += "</div>";
  }
  h += '<div class="secttl">导入文章</div>' +
    '<p class="muted" style="font-size:12px;margin:2px 0 6px">' +
    "这条通道<b>完全离线</b>：把你在任何网站、期刊、新闻客户端上读到的英文复制过来，粘进下面的框即可。" +
    "从网页复制时整段丢进来也行，多余的空格与换行会被自动整理。</p>" +
    '<textarea id="rdPaste" class="rta" placeholder="把英文文章正文粘贴到这里&#10;&#10;第一行如果写成 标题：xxx 会被当作标题，其余作为正文"></textarea>' +
    '<div class="rrow"><input id="rdPasteSrc" class="rin" type="text" placeholder="来源（可留空，例如 The Economist）">' +
    '<button class="btn sm" id="rdImport">导入并精读</button>' +
    '<button class="btn ghost sm" id="rdFile">从文件导入</button></div>';
  return h;
}

/* ---------- 21. 精读主页事件 ---------- */
function readMount() {
  /* 精读台与练习页都是跳转页，而跳转不改 cur —— 所以这里主动接管它们的绑定 */
  var jt = JSTACK.length ? JSTACK[JSTACK.length - 1] : null;
  if (jt && jt.kind === "art") { rdBindArt(jt.art); return; }
  if (jt && jt.kind === "artq") { qzMount(jt.art); return; }
  var q = $("rdQ");
  if (q) {
    q.oninput = function () { RQ = q.value; };
    q.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); rdDoSearch(); } };
  }
  var sy = $("rdSrc");
  if (sy) sy.onchange = function () { RSRC = sy.value; RRES = null; RMSG = null; render(); };
  document.querySelectorAll("[data-rtab]").forEach(function (b) {
    b.onclick = function () { RTAB = b.getAttribute("data-rtab"); RMSG = null; render(); };
  });
  var t = $("rdTestAll");
  if (t) t.onclick = function () { rdSelfTest(); };
  var p = $("rdPull");
  if (p) p.onclick = function () { rdPullFeed(); };
  var s = $("rdSearch");
  if (s) s.onclick = function () { rdDoSearch(); };
  var n = $("rdNews");
  if (n) n.onclick = function () { rdPullNews(); };
  /* 中国英文媒体：换源 / 拉列表 / 取某篇正文 */
  document.querySelectorAll("[data-csr]").forEach(function (b) {
    b.onclick = function () {
      var v = b.getAttribute("data-csr");
      if (v === CSEL) return;
      CSEL = v; CLIST = null; RMSG = null;   /* 换源就清空上一次的列表，免得张冠李戴 */
      render();
    };
  });
  var cl = $("rdCNLoad");
  if (cl) cl.onclick = function () { rdCNPull(); };
  document.querySelectorAll("[data-cngrab]").forEach(function (b) {
    b.onclick = function () { rdCNGrab(Number(b.getAttribute("data-cngrab"))); };
  });
  var im = $("rdImport");
  if (im) im.onclick = function () { rdPasteImport(); };
  var fi = $("rdFile");
  if (fi) fi.onclick = function () { rdFileImport(); };
  /* 取全文：host|title 编码在一个属性里，避免额外状态 */
  document.querySelectorAll("[data-grab]").forEach(function (b) {
    b.onclick = function () {
      var v = b.getAttribute("data-grab").split("|");
      rdGrab(v[0], v[1]);
    };
  });
  document.querySelectorAll("[data-mkfeed]").forEach(function (b) {
    b.onclick = function () { rdMkFromFeed(Number(b.getAttribute("data-mkfeed"))); };
  });
  document.querySelectorAll("[data-mkgd]").forEach(function (b) {
    b.onclick = function () { rdMkFromGuardian(Number(b.getAttribute("data-mkgd"))); };
  });
  document.querySelectorAll("[data-artdel]").forEach(function (b) {
    b.onclick = function () {
      var id = b.getAttribute("data-artdel"), a = artGet(id);
      openModal("删除文章？", "<p class='muted'>「" + esc(a ? a.t : "") + "」将从本地文章库里移除。精读生词本不受影响。</p>",
        '<button class="btn" id="mNo">取消</button><button class="btn danger" id="mYes">删除</button>',
        function () {
          $("mNo").onclick = closeModal;
          $("mYes").onclick = function () { artDel(id); closeModal(); render(); toast("已删除", "ok"); };
        });
    };
  });
}
function rdSelfTest() {
  if (NETST.testing) return;
  /* 先把上一次的结果清掉再开跑：不清的话界面上会同时出现新旧两轮的数字，
     用户没法判断哪一行是刚才测的。NETST.results 由 netSelfTest 自己重置，
     这里只需要给出「正在测」的状态。 */
  NETST.results = {};
  netSelfTest(function () {
    render();
    var r = NETST.results, dn = 0, up = 0;
    for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) { if (r[k].ok) up++; else dn++; }
    toast("自测完成：" + up + " 个可达 · " + dn + " 个不可达" + (dn ? "（已收起的来源见列表）" : ""), dn ? "info" : "ok");
  });
  render();
}
function rdPullFeed() {
  if (RBUSY) return;
  RBUSY = "feed"; RMSG = null; render();
  getFeatured(function (err, list) {
    RBUSY = "";
    if (err) { RMSG = { kind: "bad", text: err.msg, hint: err.hint || "" }; render(); return; }
    RFEED = list;
    artToday();
    RMSG = { kind: "ok", text: "取到 " + list.length + " 条今日内容" };
    render();
  });
}
function rdDoSearch() {
  if (RBUSY) return;
  var q = (($("rdQ") && $("rdQ").value) || RQ || "").replace(/^\s+|\s+$/g, "");
  if (!q && RSRC !== "guardian") { RMSG = { kind: "bad", text: "先写一个关键词" }; render(); return; }
  RQ = q;
  RBUSY = "search"; RMSG = null; RRES = null; render();
  doSearch(RSRC, q, function (err, list) {
    RBUSY = "";
    if (err) { RMSG = { kind: "bad", text: err.msg, hint: err.hint || "" }; render(); return; }
    RRES = list; render();
  });
}
function rdPullNews() {
  if (RBUSY) return;
  RBUSY = "news"; RMSG = null; render();
  getNewsList(function (err, list) {
    RBUSY = "";
    if (err) { RMSG = { kind: "bad", text: err.msg }; render(); return; }
    RNEWS = list;
    render();
  });
}
/* 拉某个中国源的最新文章列表 */
function rdCNPull() {
  if (CBUSY) return;
  var s = csOf(CSEL);
  if (!s) return;
  CBUSY = "list"; RMSG = null; render();
  csLoad(CSEL, function (err, list, via) {
    CBUSY = "";
    if (err) { CLIST = null; RMSG = { kind: "bad", text: err.msg, hint: err.hint || "" }; render(); return; }
    CLIST = list;
    /* 走了中转就明说 —— 「经过第三方」这件事不该瞒着用户 */
    RMSG = { kind: "ok", text: "取到 " + list.length + " 篇" + (via ? "（经 " + via + " 中转）" : "（直连）") };
    render();
  });
}
/* 取某篇正文 → 落库 → 直接进精读台 */
function rdCNGrab(i) {
  if (CBUSY) return;
  var s = csOf(CSEL), it = CLIST && CLIST[i];
  if (!s || !it) return;
  CBUSY = "grab";
  RMSG = { kind: "info", text: "正在取《" + String(it.title).slice(0, 26) + "…》的正文…" };
  render();
  csGrab(CSEL, it.url, function (err, r) {
    CBUSY = "";
    if (err) { RMSG = { kind: "bad", text: err.msg, hint: err.hint || "" }; render(); return; }
    var a = artMk({ t: r.title, ps: r.ps, src: s.src, sid: s.id, url: it.url, lic: s.lic, d: r.d || it.d });
    /* 记下这篇是怎么取回来的：直连还是中转。文章库里会显示出来，
       方便用户判断「刚才那次为什么慢」。 */
    a.via = r.via || "";
    artSave(a);
    RMSG = null;
    jumpTo("art", a.id);
    toast("已加入文章库：" + a.t + (r.via ? "（经 " + r.via + " 中转）" : ""), "ok");
  });
}
/* 取某条目的全文并落库，成功后直接进精读台 */
function rdGrab(host, title) {
  if (RBUSY) return;
  RBUSY = "grab"; RMSG = { kind: "info", text: "正在取「" + title + "」的正文…" }; render();
  getExtract(host, title, function (err, r) {
    RBUSY = "";
    if (err) { RMSG = { kind: "bad", text: err.msg, hint: err.hint || "" }; render(); return; }
    var s = srcOf(RSRC);
    if (host === "en.wikinews.org") s = srcOf("wikinews");
    var a = artMk({
      t: r.title || title, text: r.text,
      src: s ? s.name : "维基百科", sid: s ? s.id : "wiki",
      url: "", lic: s ? s.lic : "CC BY-SA"
    });
    artSave(a);
    RMSG = null;
    jumpTo("art", a.id);
    toast("已加入文章库：" + a.t, "ok");
  });
}
function rdMkFromFeed(i) {
  var it = RFEED && RFEED[i];
  if (!it) return;
  var a = artMk({ t: it.title, text: it.text, src: it.src, sid: it.sid, lic: it.lic });
  artSave(a);
  jumpTo("art", a.id);
}
function rdMkFromGuardian(i) {
  var it = RRES && RRES[i];
  if (!it) return;
  var a = artMk({ t: it.title, text: it.text, src: it.src, sid: it.sid, url: it.url, lic: it.lic, d: it.d });
  artSave(a);
  jumpTo("art", a.id);
}
/* 粘贴导入：完全离线的一条路，也是唯一不挑来源的路 */
function rdPasteImport() {
  var el = $("rdPaste");
  var raw = (el && el.value) || "";
  if (raw.replace(/[\s\u3000]/g, "").length < 120) { toast("正文太短，至少复制一段完整的文章", "bad"); return; }
  var srcEl = $("rdPasteSrc");
  var src = (srcEl && srcEl.value || "").replace(/^\s+|\s+$/g, "");
  var title = "手动导入的文章", body = raw;
  /* 允许第一行写「标题：xxx」——用户从网页复制时往往连标题一起带过来 */
  var m = /^\s*(标题|title)\s*[:：]\s*(.+)$/im.exec(raw);
  if (m) {
    title = m[2].replace(/^\s+|\s+$/g, "");
    body = raw.replace(m[0], "");
  }
  /* 粘进来的是网页源码时，先把标签剥掉 —— 不然满篇都是尖括号 */
  body = stripHTMLLite(body);
  var a = artMk({ t: title, text: body, src: src || "手动导入", sid: "manual", lic: "仅个人学习使用" });
  artSave(a);
  RQ = ""; RMSG = null;
  jumpTo("art", a.id);
  toast("已导入：" + a.t, "ok");
}
/* 轻量剥离 HTML：只处理标签与常见实体，不追求完整解析 ——
   目的是让「从网页复制整页源码」这条路能用，不是做浏览器。 */
function stripHTMLLite(s) {
  var t = String(s);
  /* 既没有标签、也没有实体引用，才原样返回。
     只判 `<` 是个坑：从网页复制纯文本段落时经常带 &amp; / &nbsp; 这类实体，
     那种情况下一个 `<` 都没有，会被提前 return 而跳过实体还原。 */
  if (t.indexOf("<") < 0 && t.indexOf("&") < 0) return t;
  t = t.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  /* 块级标签换成段落分隔，行内标签直接去掉 */
  t = t.replace(/<\/?(p|div|br|li|h[1-6]|tr|section|article|blockquote)[^>]*>/gi, "\n\n");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); });
  t = t.replace(/[ \t]+/g, " ");
  return t;
}
function rdFileImport() {
  pickFile(".txt,.md,.html,.htm,.json", function (txt, name) {
    var body = txt, title = name.replace(/\.[a-z]+$/i, "");
    /* JSON 里如果是文章包结构，按包处理 */
    var j = null;
    try { j = JSON.parse(txt); } catch (e) { j = null; }
    if (j && (j.ps || j.text)) {
      var a = artMk({ t: j.t || title, ps: j.ps, text: j.text, src: j.src || "文件导入", lic: j.lic || "仅个人学习使用", url: j.url });
      artSave(a);
      jumpTo("art", a.id);
      toast("已导入：" + a.t, "ok");
      return;
    }
    body = stripHTMLLite(body);
    if (body.replace(/\s/g, "").length < 120) { toast("文件里没有足够的正文", "bad"); return; }
    var a2 = artMk({ t: title, text: body, src: "文件导入", sid: "manual", lic: "仅个人学习使用" });
    artSave(a2);
    jumpTo("art", a2.id);
    toast("已导入：" + a2.t, "ok");
  });
}

/* ---------- 22. 精读台 ---------- */
/* 设计思路：辅助强度做成四档，由用户自己拨。
   阅读的难点往往不是「有不认识的字」，而是「不认识的字太多、一直被打断」——
   所以默认档是「只标出来、不解释」：让生词先成为一个可见的边界，
   真要看了再点开。这样通读才读得下去。 */
function assistName(n) {
  return ["纯读", "标生词", "显释义", "逐句精读"][clamp(n || 0, 0, 3)];
}
function artPageHTML(id) {
  var a = artGet(id), prof = profOf(a);
  var h = '<div class="study-wrap">';
  /* ---- 头部 ---- */
  h += '<div class="card"><div class="jhead">' +
    '<button class="btn ghost sm" id="jumpBack">‹ 返回</button>' +
    '<span class="jcrumb">文章精读</span><span class="sp"></span>' +
    '<button class="btn sm" data-jump="artq:' + esc(a.id) + '">读完做练习 ›</button>' +
    "</div>";
  h += '<h2 class="rtitle">' + esc(a.t) + "</h2>";
  h += '<div class="rmeta">' + esc(a.src) + " · " + esc(a.d) + " · " + esc(a.lic) +
    (a.url ? ' · <a class="rlink" href="' + esc(a.url) + '" target="_blank" rel="noreferrer noopener">原文地址</a>' : "") + "</div>";
  if (a.cut) h += '<p class="rmuted" style="font-size:12px">正文较长，这里收录了前面的约 ' + prof.total + " 词（按完整段落截断）。想看更多可以调高设置里的「单篇词数上限」。</p>";
  /* ---- 语言画像 ---- */
  h += rdProfBar(prof);
  /* ---- 辅助档位 ---- */
  h += '<div class="rrow rassist"><span class="rlab">阅读辅助</span>';
  for (var i = 0; i < 4; i++) {
    h += '<button class="ras' + (cfg().readAssist === i ? " on" : "") + '" data-assist="' + i + '">' + assistName(i) + "</button>";
  }
  h += '<span class="sp"></span>' +
    '<button class="btn ghost sm" id="rdRead">朗读全文</button>' +
    '<button class="btn ghost sm" id="rdStop">停止</button>' +
    "</div>";
  h += '<p class="rmuted rtip" style="font-size:12px;margin:4px 0 0">' + esc(assistTip(cfg().readAssist)) + "</p>";
  h += '<p class="rmuted" style="font-size:12px;margin:2px 0 0">点任意英文单词都能查释义（带词形还原，点 <b>studies</b> 也能查到 <b>study</b>）。</p>';
  h += "</div>";
  /* ---- 正文 ---- */
  h += '<div class="card" id="rdBody">' + rdBodyInner(a, prof) + "</div>";
  /* ---- 收尾动作 ---- */
  h += '<div class="card"><div class="rrow">' +
    '<button class="btn" id="rdDone">' + (a.rd && a.rd.done ? "重读完了" : "读完了") + "</button>" +
    '<button class="btn ghost" id="rdToLearn">把本篇 ' + prof.newN + ' 个生词加入「精读生词」</button>' +
    '<span class="sp"></span>' +
    '<button class="btn ghost sm" data-jump="artq:' + esc(a.id) + '">去做读后练习</button>' +
    "</div>" +
    '<p class="rmuted" style="font-size:12px;margin:6px 0 0">' +
    "读后练习是从这篇文章里自动出的题：拿文章原句挖空考生词、把生词和释义配对、把段落里的句子打乱还原。做错的词留在生词本里等复习。" +
    "</p></div>";
  h += "</div>";
  return h;
}
function assistTip(n) {
  return n === 0 ? "纯读档：生词不做任何标记，先试试不被打断地读完一遍。"
    : n === 1 ? "标生词：生词用虚线下划线标出，先别急着点，试着靠上下文猜一猜。"
      : n === 2 ? "显释义：生词后面直接跟中文，适合第一遍快速建立整体理解。"
        : "逐句精读：一句一行，长句多的时候读起来更清楚，也好逐句查。";
}
function rdProfBar(prof) {
  var h = '<div class="rprof">';
  h += '<div class="rpcol"><b>' + prof.total + "</b><span>总词数</span></div>";
  h += '<div class="rpcol"><b>' + prof.uniq + "</b><span>不重复</span></div>";
  h += '<div class="rpcol hot"><b>' + prof.newN + "</b><span>生词</span></div>";
  h += '<div class="rpcol"><b>' + Math.round(prof.ratio * 100) + "%</b><span>生词占比</span></div>";
  h += '<div class="rpcol"><b class="stars">' + starStr(prof.star) + "</b><span>难度</span></div>";
  h += "</div>";
  /* 分档明细：让「这篇文章为什么难」有据可查 */
  var parts = [], i;
  for (i = 0; i < LVLS.length; i++) {
    var n = prof.byLvl[LVLS[i][0]] || 0;
    if (n) parts.push(LVLS[i][1] + " " + n);
  }
  if (prof.byLvl["out"]) parts.push("超纲 " + prof.byLvl["out"]);
  h += '<p class="rlevels">按词表分层：' + esc(parts.join(" · ")) +
    '　<span class="muted">（生词 = ' + esc(lvlName(readNewFrom())) + "及以上、且还没学过的词；门槛可在设置里调整）</span></p>";
  return h;
}
/* 正文渲染：每个英文词包成可点的 span。
   「哪个词是生词」提前算好放画像里，不在渲染时现查 —— 一篇近千词，现查会明显卡。
   外层 .rbody 是行宽容器（max-width:62ch），排版规则见 CSS 里那一段注释。 */
function rdBodyInner(a, prof) {
  var assist = clamp(cfg().readAssist || 0, 0, 3);
  var h = '<div class="rbody">';
  for (var i = 0; i < a.ps.length; i++) {
    /* 逐句档需要一个额外的类：那个档位下段号要重新出现（窄屏也是），
       而且段首不能再缩进 —— 一句一行时缩进会把第一句挤成视觉上的第二层。 */
    h += '<div class="rpara' + (assist >= 3 ? " rsent-mode" : "") + '"><span class="rpnum">' + (i + 1) + "</span>";
    if (assist >= 3) {
      var ss = splitSents(a.ps[i]);
      for (var j = 0; j < ss.length; j++) h += '<p class="rsent">' + rdInline(ss[j], prof, assist) + "</p>";
    } else {
      h += '<p class="rtext">' + rdInline(a.ps[i], prof, assist) + "</p>";
    }
    h += "</div>";
  }
  return h + "</div>";
}
function rdInline(text, prof, assist) {
  var out = "", last = 0, m;
  var re = /[A-Za-z][A-Za-z'’\-]*/g;
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    var w = m[0];
    var key = w.toLowerCase().replace(/^['’\-]+|['’\-]+$/g, "");
    var nl = key ? prof.map[key] : null;
    var cls = "rw";
    if (nl && assist >= 1) cls += " rw-new";
    out += '<span class="' + cls + '" data-word="' + esc(key) + '">' + esc(w) + "</span>";
    if (assist >= 2 && nl && nl.r) {
      var cn = shortCN(nl.r);
      /* 双身份词要交代清楚：led 在这一句里是 lead 的过去式，写成「发光二极管」会把人带沟里，
         cooler 在同句里也常是 cool 的比较级而不是「便携式冷藏箱」。
         词库里有独立条目、而它同时又是别人的变形时，两个都提一句。 */
      if (nl.alt) cn = (cn ? cn + " " : "") + "（" + nl.alt[F.W] + " 的变形）";
      if (cn) out += '<i class="rcn">' + esc(cn) + "</i>";
    }
    last = m.index + w.length;
  }
  out += esc(text.slice(last));
  return out;
}
/* 点词查义：弹窗，不跳页 —— 精读最怕被打断，跳走再回来会丢掉阅读的连续性。
   想深挖的人点弹窗里的「完整词条」再跳过去。 */
function rdWordPop(key) {
  var lk = lookWord(key);
  if (!lk) { toast("词库里没有「" + key + "」，可能是专有名词", "info"); return; }
  var r = lk.r, w = r[F.W];
  var h = "";
  var us = r[F.US] || "", uk = r[F.UK] || "";
  if (us || uk) {
    h += '<div class="wpop-ph">' +
      (us ? '<span class="pp"><b>美</b>/' + esc(us) + "/</span>" : "") +
      (uk ? '<span class="pp"><b>英</b>/' + esc(uk) + "/</span>" : "") + "</div>";
  }
  if (lk.lem && lk.from) h += '<p class="wpop-lem">原文里的 <b>' + esc(lk.from) + "</b> 是这个词的变化形式</p>";
  /* 词库里另有一个同名条目（studies 那种「某词的复数」条目）时，一并交代清楚 ——
     否则用户会疑惑：我点的明明是 studies，怎么弹出来的是 study。 */
  if (lk.alt) {
    var acn = shortCN(lk.alt);
    h += '<p class="wpop-lem">原词形 <b>' + esc(lk.alt[F.W]) + "</b> 在词库里也有独立条目" +
      (acn ? "：" + esc(acn) : "") + "</p>";
  } else if (!lk.lem) {
    /* 反向情况：命中的是个独立词条，但它在别处同时是某个词的变形。
       led 最典型 —— 作名词是「发光二极管」，而在 "temperatures have led to ..." 里是 lead 的过去式。
       语境里是哪个只有读者能判断，所以两条都摆出来，不替用户下结论。 */
    var fr = formOf(lk.w);
    if (fr) {
      var fcn = shortCN(fr);
      h += '<p class="wpop-lem">也可能是 <b>' + esc(fr[F.W]) + "</b> 的变形" +
        (fcn ? "（" + esc(fcn.slice(0, 48)) + "）" : "") + "</p>";
    }
  }
  var cns = String(r[F.CN] || "").split("\n").filter(function (x) { return x.replace(/\s/g, "") !== ""; });
  if (cns.length) {
    h += '<div class="wpop-cn">';
    for (var i = 0; i < Math.min(cns.length, 4); i++) h += "<p>" + esc(cns[i]) + "</p>";
    h += "</div>";
  }
  if (r[F.EN]) h += '<p class="wpop-en">' + esc(r[F.EN]) + "</p>";
  var ex = String(r[F.EX] || "").split("\n").filter(function (x) { return x.replace(/\s/g, "") !== ""; });
  if (ex.length) {
    h += '<div class="wpop-ex"><div class="secttl2">例句</div>';
    for (i = 0; i < Math.min(ex.length, 2); i++) h += "<p>" + esc(ex[i]) + "</p>";
    h += "</div>";
  }
  h += '<div class="wpop-tags"><span class="rtag">' + esc(lvlName(lvlOf(r))) + "</span>" +
    '<span class="rtag gray">' + (DB.prog[w] ? "已学过" : "还没学过") + "</span></div>";
  openModal(w, h,
    '<button class="btn ghost" id="wpSpeak">朗读</button>' +
    '<button class="btn" id="wpAdd">加入精读生词</button>' +
    '<button class="btn ghost" id="wpFull">完整词条 ›</button>',
    function () {
      $("wpSpeak").onclick = function () { speak(w); };
      $("wpAdd").onclick = function () {
        var bk = readBook(), have = false, i2;
        for (i2 = 0; i2 < bk.words.length; i2++) if (bk.words[i2][F.W] === w) have = true;
        if (have) { toast("「" + w + "」已经在精读生词本里了", "info"); return; }
        bk.words.push(r);
        refreshCustomIndex(); TAGS = {}; BOWN = {}; save(true);
        toast("已加入「精读生词」", "ok");
      };
      $("wpFull").onclick = function () { closeModal(); jumpTo("detail", w); };
    });
}
/* 精读台的交互绑定。辅助档位走「就地换正文」，不整页重绘 —— 否则阅读位置会被顶回顶部。 */
function rdBindArt(id) {
  var a = artGet(id);
  if (!a) return;
  document.querySelectorAll("[data-assist]").forEach(function (b) {
    b.onclick = function () {
      var n = Number(b.getAttribute("data-assist"));
      cfg().readAssist = n; save(true);
      var body = $("rdBody");
      if (body) body.innerHTML = rdBodyInner(a, profOf(a));
      document.querySelectorAll("[data-assist]").forEach(function (x) {
        x.classList.toggle("on", Number(x.getAttribute("data-assist")) === n);
      });
      var tip = document.querySelector(".rtip");
      if (tip) tip.textContent = assistTip(n);
    };
  });
  /* 点词用事件委托：一篇近千个词，逐个绑监听没必要 */
  var body = $("rdBody");
  if (body) {
    body.onclick = function (e) {
      var t = e.target;
      while (t && t !== body && !(t.getAttribute && t.getAttribute("data-word"))) t = t.parentNode;
      if (t && t !== body && t.getAttribute("data-word")) rdWordPop(t.getAttribute("data-word"));
    };
  }
  var g = $("rdDone"); if (g) g.onclick = function () { rdFinish(id); };
  var tl = $("rdToLearn");
  if (tl) tl.onclick = function () {
    var n = artWordsToLearn(profOf(a));
    toast(n > 0 ? ("已加入 " + n + " 个到「精读生词」词书，到词库页可以选它来背") : "这些词都已在生词本里了", n > 0 ? "ok" : "info");
  };
  var sp = $("rdRead"); if (sp) sp.onclick = function () { rdSpeakAll(a); };
  var st = $("rdStop");
  if (st) st.onclick = function () {
    try { window.speechSynthesis.cancel(); } catch (e) { }
    toast("已停止朗读", "info");
  };
}
/* 分段朗读而不是整篇一次性灌进去：整篇一口气念完既没法停，也常被浏览器截断 */
var RSPK = { i: -1, on: false };
function rdSpeakAll(a) {
  if (!window.speechSynthesis) { toast("当前浏览器不支持语音朗读", "bad"); return; }
  try { window.speechSynthesis.cancel(); } catch (e) { }
  RSPK.i = 0; RSPK.on = true;
  var next = function () {
    if (!RSPK.on || RSPK.i >= a.ps.length) { RSPK.on = false; RSPK.i = -1; return; }
    var sent = a.ps[RSPK.i];
    RSPK.i++;
    try { speak(sent); } catch (e) { return; }
    /* 按字符数粗估这一句念完要多久，念完再接下句 */
    setTimeout(next, Math.max(1200, Math.min(20000, sent.length * 62)));
  };
  toast("开始朗读全文（可随时点停止）", "info");
  next();
}
function rdFinish(id) {
  var a = artGet(id);
  if (!a) return;
  a.rd = a.rd || {};
  a.rd.done = true; a.rd.ts = now();
  artSave(a);
  toast("已读完《" + a.t + "》 · 去做读后练习检验一下", "ok");
  render();
}

/* ---------- 23. 读后练习 ---------- */
/* 三类题全部从文章本身生成，不依赖任何外部题库：
   填空考「回到上下文还认不认得」，配对考「认得出意思」，排序考「读懂语篇逻辑」。
   这三件事恰好是一篇文章读完最该留下的东西。 */
var RQZ = null;                 /* 当前练习状态，跟着文章 id 走 */
var RQZ_OPEN = null;            /* 记录已完成配对，用于局部重绘 */

function qzMakeMatch(pairs) {
  var i, left = [], right = [];
  for (i = 0; i < pairs.length; i++) left.push({ w: pairs[i].w, cn: pairs[i].cn, ph: pairs[i].ph || "", done: false, no: 0 });
  var sh = shuffle(pairs.slice());
  for (i = 0; i < sh.length; i++) right.push({ w: sh[i].w, cn: sh[i].cn, done: false, no: 0 });
  return { left: left, right: right, sel: -1, ok: 0, bad: 0 };
}
function qzMakeOrder(o) {
  return { o: o, cur: o.order.slice(), checked: null, ok: false };
}
function qzBuild(id) {
  var a = artGet(id), prof = profOf(a);
  var ex = mkExercises(a, prof);
  var st = { aid: id, prof: prof, built: now(), cloze: [], match: qzMakeMatch(ex.match), order: [], qok: 0, qbad: 0 };
  for (var i = 0; i < ex.cloze.length; i++) st.cloze.push({ c: ex.cloze[i], ok: 0, val: "" });
  for (i = 0; i < ex.order.length; i++) st.order.push(qzMakeOrder(ex.order[i]));
  return st;
}
function qzState(id) {
  if (!RQZ || RQZ.aid !== id) { RQZ = qzBuild(id); RQZ_OPEN = {}; }
  return RQZ;
}
function qzTotal(st) {
  return st.cloze.length + st.match.left.length + st.order.length;
}
function qzDone(st) {
  var n = 0;
  for (var i = 0; i < st.cloze.length; i++) if (st.cloze[i].ok === 1) n++;
  n += st.match.ok;
  for (i = 0; i < st.order.length; i++) if (st.order[i].ok) n++;
  return n;
}
function artQuizHTML(id) {
  var a = artGet(id);
  if (!a) return '<div class="study-wrap"><div class="card"><div class="empty"><b>找不到这篇文章</b></div></div></div>';
  var st = qzState(id);
  var h = '<div class="study-wrap">';
  h += '<div class="card"><div class="jhead">' +
    '<button class="btn ghost sm" id="jumpBack">‹ 返回</button>' +
    '<span class="jcrumb">读后练习</span><span class="sp"></span>' +
    '<button class="btn ghost sm" id="qzReset">换一批题</button>' +
    '<button class="btn ghost sm" data-jump="art:' + esc(a.id) + '">回到文章</button>' +
    "</div>";
  h += '<h2 class="rtitle">' + esc(a.t) + "</h2>";
  h += '<div class="rmeta">' + esc(a.src) + " · " + esc(a.d) + "</div>";
  h += '<div class="rprof small"><div class="rpcol"><b>' + qzTotal(st) + "</b><span>题量</span></div>" +
    '<div class="rpcol"><b class="qzp" id="qzDone">' + qzDone(st) + "</b><span>已答对</span></div>" +
    '<div class="rpcol"><b class="qzb" id="qzBad">' + st.qbad + "</b><span>待巩固</span></div></div>";
  h += '<p class="rmuted" style="font-size:12px;margin:4px 0 0">题目全部由这篇文章自动生成。答错的词建议回到文章里再读一遍那句话 —— 语境记词比单背词表牢得多。</p>';
  h += "</div>";
  /* ---- 一、遮词填空 ---- */
  h += '<div class="card"><div class="secttl">一 · 语境填空<span class="muted">　用文章原句挖空，考的是回到上下文还认不认得</span></div>';
  if (!st.cloze.length) h += '<p class="empty sm">这篇没有适合出填空的生词（可能都太专有，或词库覆盖不足）</p>';
  for (var i = 0; i < st.cloze.length; i++) {
    var q = st.cloze[i];
    h += '<div class="qzc" data-qzc="' + i + '">' +
      '<p class="qzsen">' + esc(q.c.blank) + "</p>" +
      '<div class="qzrow">' +
      '<input class="qzin" data-qi="' + i + '" type="text" autocomplete="off" spellcheck="false" placeholder="填出这个词">' +
      '<button class="btn sm" data-qzsub="' + i + '">检查</button>' +
      '<span class="qzfb" data-qzfb="' + i + '">' + (q.ok === 1 ? "✓ 正确" : q.ok === 2 ? "✗ 答案：" + esc(q.c.w) : "") + "</span>" +
      "</div>" +
      '<p class="qzhint">首字母 ' + esc(String(q.c.w).charAt(0).toUpperCase()) + " · 共 " + String(q.c.w).length + " 个字母 · " + esc(q.c.cn) + "</p>" +
      "</div>";
  }
  h += "</div>";
  /* ---- 二、词义配对 ---- */
  h += '<div class="card"><div class="secttl">二 · 词义配对<span class="muted">　先点左边的词，再点右边它的意思</span></div>';
  if (!st.match.left.length) h += '<p class="empty sm">这篇没有可用于配对的生词</p>';
  else {
    h += '<div class="qzm"><div class="qzml">';
    for (i = 0; i < st.match.left.length; i++) {
      var L = st.match.left[i];
      h += '<button class="qmlb' + (L.done ? " done" : "") + (st.match.sel === i ? " sel" : "") + '" data-ml="' + i + '">' +
        '<b>' + esc(L.w) + "</b>" + (L.ph ? '<i>/' + esc(L.ph) + "/</i>" : "") +
        (L.done ? '<span class="qno">' + L.no + "</span>" : "") + "</button>";
    }
    h += '</div><div class="qzmr">';
    for (i = 0; i < st.match.right.length; i++) {
      var R = st.match.right[i];
      h += '<button class="qmrb' + (R.done ? " done" : "") + '" data-mr="' + i + '">' + esc(R.cn) +
        (R.done ? '<span class="qno">' + R.no + "</span>" : "") + "</button>";
    }
    h += "</div></div>";
  }
  h += "</div>";
  /* ---- 三、句子排序 ---- */
  h += '<div class="card"><div class="secttl">三 · 段落还原<span class="muted">　把打乱的句子排回原文顺序，靠连接词和指代判断</span></div>';
  if (!st.order.length) h += '<p class="empty sm">这篇没有长度合适的段落（需要 4–6 句）</p>';
  for (i = 0; i < st.order.length; i++) {
    h += '<div class="qzo" id="qzo' + i + '">' + qzOrderInner(i) + "</div>";
  }
  h += "</div>";
  h += "</div>";
  return h;
}
function qzOrderInner(i) {
  var st = RQZ, o = st.order[i], h = "";
  h += '<div class="qzohead"><b>第 ' + (i + 1) + " 段</b>（" + o.cur.length + " 句）" +
    '<span class="sp"></span><button class="btn ghost sm" data-ocheck="' + i + '">检查顺序</button></div>';
  for (var k = 0; k < o.cur.length; k++) {
    var si = o.cur[k];
    var mark = o.checked === null ? "" : (si === k ? " good" : " bad");
    h += '<div class="qzsent' + mark + '">' +
      '<span class="qzn">' + (k + 1) + "</span>" +
      '<span class="qztx">' + esc(o.o.sents[si]) + "</span>" +
      '<span class="qzud">' +
      '<button class="qsbtn" data-ou="' + i + '" data-ok="' + k + '" title="上移">▲</button>' +
      '<button class="qsbtn" data-od="' + i + '" data-ok="' + k + '" title="下移">▼</button>' +
      "</span></div>";
  }
  if (o.checked !== null) {
    h += '<p class="qzfb ' + (o.ok ? "y" : "n") + '" style="display:block;margin:6px 0 0">' +
      (o.ok ? "✓ 顺序完全正确" : "✗ 还有句子没归位（绿色是对的，红色是错的）") + "</p>";
  }
  return h;
}

/* ---- 练习交互 ---- */
function qzMount(id) {
  var st = qzState(id);
  document.querySelectorAll("[data-qzsub]").forEach(function (b) {
    b.onclick = function () { qzSubmit(Number(b.getAttribute("data-qzsub"))); };
  });
  document.querySelectorAll("[data-qi]").forEach(function (el) {
    el.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); qzSubmit(Number(el.getAttribute("data-qi"))); } };
  });
  document.querySelectorAll("[data-ml]").forEach(function (b) {
    b.onclick = function () {
      var i = Number(b.getAttribute("data-ml"));
      if (st.match.left[i].done) return;
      st.match.sel = i;
      qzPaintMatch();
    };
  });
  document.querySelectorAll("[data-mr]").forEach(function (b) {
    b.onclick = function () { qzPair(Number(b.getAttribute("data-mr"))); };
  });
  document.querySelectorAll("[data-ou]").forEach(function (b) {
    b.onclick = function () { qzMove(Number(b.getAttribute("data-ou")), Number(b.getAttribute("data-ok")), -1); };
  });
  document.querySelectorAll("[data-od]").forEach(function (b) {
    b.onclick = function () { qzMove(Number(b.getAttribute("data-od")), Number(b.getAttribute("data-ok")), 1); };
  });
  document.querySelectorAll("[data-ocheck]").forEach(function (b) {
    b.onclick = function () { qzCheckOrder(Number(b.getAttribute("data-ocheck"))); };
  });
  var r = $("qzReset");
  if (r) r.onclick = function () { RQZ = null; RQZ_OPEN = {}; render(); toast("已换一批题", "ok"); };
}
function qzRefreshCount() {
  if (!RQZ) return;
  var d = $("qzDone"), b = $("qzBad");
  if (d) d.textContent = qzDone(RQZ);
  if (b) b.textContent = RQZ.qbad;
}
function qzSubmit(i) {
  var st = RQZ, q = st.cloze[i];
  if (!q) return;
  var el = document.querySelector('[data-qi="' + i + '"]');
  var val = ((el && el.value) || "").replace(/^\s+|\s+$/g, "");
  if (!val) return;
  var ok = val.toLowerCase().replace(/[^a-z']/g, "") === String(q.c.w).toLowerCase();
  if (q.ok === 0 && !ok) st.qbad++;
  q.ok = ok ? 1 : 2; q.val = val;
  var fb = document.querySelector('[data-qzfb="' + i + '"]');
  if (fb) {
    fb.className = "qzfb " + (ok ? "y" : "n");
    fb.textContent = ok ? "✓ 正确" : "✗ 答案：" + q.c.w;
  }
  if (el) el.classList.toggle("bad", !ok);
  qzRefreshCount();
}
/* 配对：选中左项后点右项判定。
   答错不清空选择，只闪一下红 —— 让用户能马上换一个再试，而不用重新点左边的词。 */
function qzPair(ri) {
  var st = RQZ, m = st.match;
  if (st.match.sel < 0) { toast("先点左边的一个词", "info"); return; }
  var li = m.sel, L = m.left[li], R = m.right[ri];
  if (!L || !R || R.done) return;
  var ok = L.w === R.w;
  if (ok) {
    L.done = R.done = true;
    L.no = R.no = ++m.ok;
    m.sel = -1;
    qzPaintMatch();
    qzRefreshCount();
  } else {
    m.bad++;
    var rb = document.querySelector('[data-mr="' + ri + '"]');
    if (rb) { rb.classList.add("wrong"); setTimeout(function () { rb.classList.remove("wrong"); }, 700); }
  }
}
function qzPaintMatch() {
  var st = RQZ, m = st.match, i;
  for (i = 0; i < m.left.length; i++) {
    var lb = document.querySelector('[data-ml="' + i + '"]');
    if (!lb) continue;
    lb.classList.toggle("sel", m.sel === i);
    lb.classList.toggle("done", !!m.left[i].done);
    var sp = lb.querySelector(".qno");
    if (m.left[i].done) {
      if (!sp) { sp = document.createElement("span"); sp.className = "qno"; lb.appendChild(sp); }
      sp.textContent = m.left[i].no;
    } else if (sp) lb.removeChild(sp);
  }
  for (i = 0; i < m.right.length; i++) {
    var rb = document.querySelector('[data-mr="' + i + '"]');
    if (!rb) continue;
    rb.classList.toggle("done", !!m.right[i].done);
    var sp2 = rb.querySelector(".qno");
    if (m.right[i].done) {
      if (!sp2) { sp2 = document.createElement("span"); sp2.className = "qno"; rb.appendChild(sp2); }
      sp2.textContent = m.right[i].no;
    } else if (sp2) rb.removeChild(sp2);
  }
}
/* 句子排序：上移/下移后只重绘这一个段落块，避免整页重绘把别处的输入框清空 */
function qzMove(oi, k, dir) {
  var st = RQZ, o = st.order[oi];
  if (!o) return;
  var k2 = k + dir;
  if (k2 < 0 || k2 >= o.cur.length) return;
  var t = o.cur[k]; o.cur[k] = o.cur[k2]; o.cur[k2] = t;
  o.checked = null;
  var box = $("qzo" + oi);
  if (box) box.innerHTML = qzOrderInner(oi);
  qzMount(o && RQZ ? RQZ.aid : "");
}
function qzCheckOrder(oi) {
  var st = RQZ, o = st.order[oi];
  if (!o) return;
  var all = true;
  for (var k = 0; k < o.cur.length; k++) if (o.cur[k] !== k) all = false;
  if (all && !o.ok) st.qok++;
  o.checked = now(); o.ok = all;
  var box = $("qzo" + oi);
  if (box) box.innerHTML = qzOrderInner(oi);
  qzMount(st.aid);
  qzRefreshCount();
}
