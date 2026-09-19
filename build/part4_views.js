/* ---------- 15. 测试 ---------- */
var Q = null;
function vQuiz() {
  var c = cfg();
  var bm = bookMeta(DB.book) || { name: "未选择" };
  var h = '<div class="study-wrap">';
  h += '<div class="card"><div class="card-h"><h2>出题设置</h2><span class="hint">当前词书：' + esc(bm.name) + "</span></div>" +
    '<div class="grid g2">' +
    '<label class="fld"><span>题目数量</span><select id="qCount">' +
    [10, 20, 30, 50, 100].map(function (n) { return '<option value="' + n + '"' + (n === c.quizCount ? " selected" : "") + ">" + n + " 题</option>"; }).join("") +
    "</select></label>" +
    '<label class="fld"><span>题型</span><select id="qType">' +
    '<option value="mix">混合题型</option><option value="recog">看词选义</option><option value="recall">看义选词</option><option value="spell">拼写</option><option value="listen">听音辨词</option>' +
    "</select></label>" +
    '<label class="fld"><span>出题范围</span><select id="qScope">' +
    '<option value="all">整个词书随机</option><option value="seen">只考学过的词</option><option value="due">只考到期复习的词</option><option value="hard">只考错过的词</option>' +
    "</select></label>" +
    '<label class="fld"><span>计时</span><select id="qTime">' +
    '<option value="0">不限时</option><option value="8">每题 8 秒</option><option value="15">每题 15 秒</option></select></label>' +
    "</div>" +
    '<div class="setrow"><div class="setrow-t"><b>计入记忆曲线</b><span>测试结果同时更新单词的记忆持久度</span></div>' +
    '<label class="switch"><input type="checkbox" id="qAffect"' + (c.quizAffect !== false ? " checked" : "") + "><i></i></label></div>" +
    '<div class="row" style="margin-top:14px"><button class="btn primary lg" id="qStart"><svg><use href="#i-target"/></svg>开始测试</button></div>' +
    "</div>";
  if (DB.lastQuiz) h += quizReportHTML(DB.lastQuiz, false);
  h += "</div>";
  return h;
}
function quizMount() {
  var st = $("qStart");
  if (st) st.onclick = function () { startQuiz(); };
  var c = $("qCount"); if (c) c.onchange = function () { cfg().quizCount = Number(c.value); save(true); };
  var af = $("qAffect"); if (af) af.onchange = function () { cfg().quizAffect = af.checked; save(true); };
}
function startQuiz() {
  var c = cfg();
  var n = Number(($("qCount") || {}).value || c.quizCount);
  var type = ($("qType") || {}).value || "mix";
  var scope = ($("qScope") || {}).value || "all";
  var limit = Number(($("qTime") || {}).value || 0);
  var pool = bookWords(DB.book);
  /* 先把「没有中文释义」的词剔掉再选题：测试的题型里有一半要把释义当题干或选项，
     混进那 79 条（例：kilometer）就会出现一道没法做的题。
     代价是池子小 0.33%，任何范围都不会因此凑不满 4 个。 */
  pool = pool.filter(hasCnDef);
  if (scope === "seen") pool = pool.filter(function (r) { return DB.prog[r[F.W]]; });
  if (scope === "due") pool = pool.filter(function (r) { return isDue(DB.prog[r[F.W]]); });
  if (scope === "hard") pool = pool.filter(function (r) { var p = DB.prog[r[F.W]]; return p && p[N.NO] > 0; });
  if (pool.length < 4) { toast("可用词条太少（至少 4 个），换个范围试试", "bad"); return; }
  var picked = shuffle(pool.slice()).slice(0, Math.min(n, pool.length));
  var types = type === "mix" ? ["recog", "recall", "spell", "listen"] : [type];
  var qs = [];
  for (var i = 0; i < picked.length; i++) {
    /* 逐个挑一个「这个词 + 这台设备」真做得出来的题型，跟学习卡共用同一套 modeOK。
       测试中心原来没有这道关（学习卡的 pickMode 有），于是：设备没有英语语音时，
       测试里会冒出一道按了喇叭没声音、只能瞎猜的题；遇到只有英文释义的词，
       又会冒出一道「根据这句英文拼写」的题。一个都不行的词直接不出题。 */
    var m = null;
    for (var k = 0; k < types.length; k++) {
      var cand = types[(i + k) % types.length];
      if (modeOK(cand, picked[i])) { m = cand; break; }
    }
    if (m) qs.push({ r: picked[i], t: m });
  }
  if (!qs.length) { toast("这个范围里没有出得成的题，换个范围或题型试试", "bad"); return; }
  Q = { qs: qs, i: 0, ok: 0, no: 0, wrong: [], start: now(), limit: limit, answered: false, opts: null, picked: undefined, left: limit, timer: null };
  renderQuizQ();
}
function renderQuizQ() {
  var v = $("view");
  if (!Q) { go("quiz"); return; }
  if (Q.i >= Q.qs.length) { finishQuiz(); return; }
  var q = Q.qs[Q.i], r = q.r;
  var pool = bookWords(DB.book); if (pool.length < cfg().optCount) pool = WORDS;
  Q.answered = false; Q.opts = null; Q.picked = undefined;
  var h = '<div class="study-wrap">';
  h += '<div class="row tiny faint" style="margin-bottom:10px;gap:14px"><span>测试中</span>' +
    '<span>' + (Q.i + 1) + " / " + Q.qs.length + '</span><span class="sp"></span>' +
    (Q.limit ? '<span id="qTimer">' + Q.left + "s</span>" : "") +
    '<button class="btn ghost sm" id="qQuit">退出</button></div>';
  h += '<div class="wcard"><div class="wcard-top">' + modeTag(q.t) + '<span class="sp"></span>' +
    '<span class="tag ok">对 ' + Q.ok + '</span><span class="tag bad">错 ' + Q.no + "</span></div>";
  if (q.t === "recog") {
    Q.opts = makeOptions(r, pool, cfg().optCount, false);
    h += '<div class="w-word">' + esc(r[F.W]) + "</div>" + ipaHTML(r) + '<button class="btn sm" id="say" style="margin-top:12px"><svg><use href="#i-vol"/></svg>朗读</button>';
    h += optList(Q.opts);
  } else if (q.t === "recall") {
    Q.opts = makeOptions(r, pool, cfg().optCount, true);
    h += '<div class="w-block"><div class="bt">选择正确释义对应的单词</div>' + defHTML(r) + "</div>" + optList(Q.opts);
  } else if (q.t === "listen") {
    Q.opts = makeOptions(r, pool, cfg().optCount, true);
    h += '<div style="text-align:center;padding:14px 0 4px"><button class="spk" id="say" style="width:64px;height:64px;border-radius:50%"><svg style="width:28px;height:28px"><use href="#i-vol"/></svg></button>' +
      '<div class="tiny faint" style="margin-top:12px">点击重听</div></div>' + optList(Q.opts);
  } else {
    h += '<div class="w-block"><div class="bt">根据释义拼写</div>' + defHTML(r) + "</div>" +
      '<div class="spell-box"><input class="spell-input" id="qSpell" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + r[F.W].length + ' 个字母">' +
      '<div class="row" style="gap:8px;margin-top:12px"><button class="btn" id="say"><svg><use href="#i-vol"/></svg>听发音</button>' +
      '<button class="btn primary sp" id="qSpellOk">确认</button></div></div>';
  }
  h += '<div id="qExtra"></div></div>';
  h += '<div class="underbar"><span class="tiny faint" id="qHint">按 1-4 选择</span></div>';
  h += "</div>";
  v.innerHTML = h;
  bindCommon();
  bindQuiz();
  if (cfg().autoSpeak && q.t === "listen") setTimeout(function () { speak(r[F.W]); }, 150);
  startQTK();
}
function optList(opts) {
  var h = '<div class="opts">';
  for (var i = 0; i < opts.length; i++) h += '<button class="opt" data-qpick="' + i + '"><span class="k">' + (i + 1) + "</span><span>" + esc(opts[i].v) + "</span></button>";
  return h + "</div>";
}
function startQTK() {
  if (Q.timer) { clearInterval(Q.timer); Q.timer = null; }
  if (!Q.limit) return;
  Q.left = Q.limit;
  Q.timer = setInterval(function () {
    if (!Q || Q.answered) return;
    Q.left--;
    var el = $("qTimer");
    if (el) el.textContent = Q.left + "s";
    if (Q.left <= 0) { clearInterval(Q.timer); Q.timer = null; quizAnswer(null); }
  }, 1000);
}
function bindQuiz() {
  var say = $("say"); if (say) say.onclick = function () { speak(Q.qs[Q.i].r[F.W]); };
  document.querySelectorAll("[data-qpick]").forEach(function (b) {
    b.onclick = function () { if (Q.answered) return; Q.picked = Number(b.getAttribute("data-qpick")); quizAnswer(Q.picked); };
  });
  var si = $("qSpell");
  if (si) { si.focus(); si.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); quizSpell(); } }; }
  var so = $("qSpellOk"); if (so) so.onclick = quizSpell;
  var qq = $("qQuit"); if (qq) qq.onclick = function () { if (Q && Q.timer) clearInterval(Q.timer); Q = null; go("quiz"); };
}
function quizSpell() {
  if (!Q || Q.answered) return;
  var r = Q.qs[Q.i].r;
  var inp = $("qSpell");
  var val = (inp ? inp.value : "").trim().toLowerCase();
  var ok = val === String(r[F.W]).toLowerCase();
  if (inp) { inp.classList.add(ok ? "ok" : "no"); inp.disabled = true; }
  quizRecord(ok);
}
function quizAnswer(pick) {
  if (!Q || Q.answered) return;
  var q = Q.qs[Q.i];
  var ok = pick !== null && Q.opts && Q.opts[pick] && Q.opts[pick].ok;
  var host = $("qExtra");
  if (host) host.innerHTML = '<div class="w-sep"></div>' + defHTML(q.r) +
    (cfg().showEn && q.r[F.EN] ? '<div class="w-en">' + esc(q.r[F.EN]) + "</div>" : "") + exHTML(q.r) + phraseHTML(q.r) + formsHTML(q.r) + metaHTML(q.r) + mnemoHTML(q.r) +
    '<div class="row wrap" style="gap:6px;margin-top:14px">' + markBtns(q.r[F.W]) + "</div>";
  quizRecord(ok);
}
function quizRecord(ok) {
  var q = Q.qs[Q.i];
  Q.answered = true;
  if (Q.timer) { clearInterval(Q.timer); Q.timer = null; }
  document.querySelectorAll(".opt").forEach(function (b) {
    var i = Number(b.getAttribute("data-qpick"));
    if (Q.opts && Q.opts[i] && Q.opts[i].ok) b.classList.add("right");
    else if (i === Q.picked) b.classList.add("wrong");
    b.disabled = true;
  });
  if (ok) Q.ok++; else { Q.no++; Q.wrong.push(q.r[F.W]); }
  if (cfg().quizAffect !== false) grade(q.r[F.W], ok ? 2 : 0);
  save();
  var hint = $("qHint");
  if (hint) hint.innerHTML = (ok ? '<span style="color:var(--ok)">✓ 答对</span>' : '<span style="color:var(--bad)">✗ 答错，正确答案：' + esc(q.r[F.W]) + "</span>") + " · 点击「下一题」继续";
  bindCommon();
  var card = $("wcard");
  if (card && !$("qNext")) {
    var b = document.createElement("div");
    b.innerHTML = '<div class="row" style="margin-top:16px"><button class="btn primary sp" id="qNext">下一题（Enter）</button></div>';
    card.appendChild(b);
    $("qNext").onclick = function () { Q.i++; renderQuizQ(); };
  }
}
function finishQuiz() {
  if (Q.timer) clearInterval(Q.timer);
  var rep = { t: now(), total: Q.qs.length, ok: Q.ok, no: Q.no, wrong: Q.wrong.slice(), sec: Math.round((now() - Q.start) / 1000) };
  DB.lastQuiz = rep;
  DB.sessions.push({ t: now(), k: "quiz", n: rep.total, ok: rep.ok, no: rep.no, d: rep.sec });
  save(true);
  Q = null;
  go("quiz");
  toast("测试完成，正确率 " + Math.round((rep.ok / Math.max(1, rep.total)) * 100) + "%", rep.ok >= rep.no ? "ok" : "bad");
}
function quizReportHTML(rep, live) {
  var acc = Math.round((rep.ok / Math.max(1, rep.total)) * 100);
  var h = '<div class="card"><div class="card-h"><h2>' + (live ? "本次" : "上次") + '测试报告</h2><span class="hint">' + fmtDate(rep.t) + "</span></div>" +
    '<div class="grid g3 keep" style="margin-bottom:16px">' +
    statCard("正确率", acc, "%", "对 " + rep.ok + " / 错 " + rep.no) +
    statCard("题目数", rep.total, "题", "用时 " + Math.max(1, Math.round(rep.sec / 60)) + " 分钟") +
    statCard("错词", (rep.wrong || []).length, "词", "已自动进错题本") +
    "</div>";
  if (rep.wrong && rep.wrong.length) {
    h += '<div class="tiny faint b" style="margin-bottom:8px;letter-spacing:1px">错词回顾</div><div class="wlist">';
    for (var i = 0; i < rep.wrong.length && i < 40; i++) {
      var r = rec(rep.wrong[i]); if (!r) continue;
      h += '<div class="wrow"><div style="flex:1;min-width:0"><div class="wn">' + esc(r[F.W]) + '<span class="ipa">' + esc(r[F.US] || "") + "</span></div>" +
        '<div class="wt">' + esc(firstDef(r)) + '</div></div>' +
        '<button class="btn ghost sm" data-spk="' + esc(r[F.W]) + '"><svg><use href="#i-vol"/></svg></button></div>';
    }
    h += "</div>";
  }
  return h + "</div>";
}

/* ---------- 16. 词库 ---------- */
var LIBQ = "";
function vLibrary() {
  var h = '<div class="study-wrap">';
  /* 搜索 */
  h += '<div class="card"><div class="row" style="gap:10px">' +
    '<input type="search" id="libSearch" placeholder="搜索单词或中文释义（支持前缀，如 aband / 放弃）" value="' + esc(LIBQ) + '">' +
    '<button class="btn primary nowrap" id="libDo">搜索</button>' +
    '<button class="btn nowrap" id="libNew">新建词书</button></div>';
  if (LIBQ) {
    var res = searchWords(LIBQ);
    h += '<div class="tiny faint" style="margin-top:12px">找到 ' + fmtNum(res.length) + " 条" + (res.length > 300 ? "（只显示前 300 条）" : "") + "</div>";
    h += '<div class="wlist" style="margin-top:6px">';
    for (var i = 0; i < res.length && i < 300; i++) h += libRow(res[i]);
    if (!res.length) h += '<div class="empty"><b>没找到匹配的单词</b>换个关键词，或导入自己的词表</div>';
    h += "</div>";
  }
  h += "</div>";

  /* 我的词书 */
  h += '<div class="card"><div class="card-h"><h2>我的词书</h2><span class="hint">收藏 / 错词 / 掌握</span></div>' +
    '<div class="grid g4 keep">' +
    mineCard("__fav", "生词本", "手动收藏", "accent") +
    mineCard("__hard", "错题本", "答错过的词", "bad") +
    mineCard("__mastered", "已掌握", "持久度达标", "ok") +
    mineCard("__new", "未学新词", "还没碰过", "warn") +
    "</div></div>";

  /* 内置词书 */
  var groups = {};
  for (var j = 0; j < BOOKS.length; j++) { var b = BOOKS[j]; (groups[b.cat || "词书"] = groups[b.cat || "词书"] || []).push(b); }
  h += '<div class="card"><div class="card-h"><h2>内置词书</h2><span class="hint">共 ' + BOOKS.length + " 本 · " + fmtNum(WORDS.length) + " 词</span></div>";
  for (var cat in groups) {
    if (!Object.prototype.hasOwnProperty.call(groups, cat)) continue;
    h += '<div class="tiny faint b" style="margin:10px 0 8px;letter-spacing:1px">' + esc(cat) + "</div><div class='grid g3 keep' style='gap:10px'>";
    groups[cat].forEach(function (b) { h += libBookCard(b); });
    h += "</div>";
  }
  h += "</div>";

  /* 自定义词书 */
  var cm = DB.custom || {};
  var keys = Object.keys(cm);
  h += '<div class="card"><div class="card-h"><h2>自定义词书</h2><span class="hint">可导入 / 导出</span></div>';
  if (!keys.length) {
    h += '<div class="empty"><svg><use href="#i-up"/></svg><b>还没有自定义词书</b>支持导入 JSON / CSV / TXT，也可以手动录入</div>';
  } else {
    h += '<div class="wlist">';
    keys.forEach(function (k) {
      var b = cm[k], s = statsOf("@" + k);
      h += '<div class="wrow"><div style="flex:1;min-width:0"><div class="wn">' + esc(b.name) + "</div>" +
        '<div class="wt">' + esc(b.desc || "自定义词书") + " · " + fmtNum((b.words || []).length) + " 词</div></div>" +
        '<button class="btn ghost sm" data-cb="use" data-id="' + esc(k) + '">选用</button>' +
        '<button class="btn ghost sm" data-cb="exp" data-id="' + esc(k) + '">导出</button>' +
        '<button class="btn ghost sm" data-cb="del" data-id="' + esc(k) + '">删除</button></div>';
    });
    h += "</div>";
  }
  h += '<div class="row wrap" style="gap:9px;margin-top:14px">' +
    '<button class="btn primary" id="libImport"><svg><use href="#i-up"/></svg>导入词表</button>' +
    '<button class="btn" id="libNew2"><svg><use href="#i-plus"/></svg>新建词书</button>' +
    '<button class="btn" id="libTpl"><svg><use href="#i-down"/></svg>下载导入模板</button>' +
    "</div>" +
    '<div class="tiny faint" style="margin-top:12px;line-height:1.8">' +
    "<b>CSV 格式</b>：<code>word,phonetic,meaning,example,example_cn</code>（首行表头可省略）<br>" +
    "<b>TXT 格式</b>：每行 <code>word 释义</code> 或 <code>word\\t释义</code><br>" +
    "<b>JSON 格式</b>：数组，每项 <code>{w,us,uk,pos,cn,ex,exz}</code> 或与模板同构的数组" +
    "</div></div>";
  h += "</div>";
  return h;
}
function libBookCard(b) {
  var s = statsOf(b.id);
  var pct = s.total ? Math.round((s.seen / s.total) * 100) : 0;
  var inc = b.inc || [];
  var incTxt = inc.map(function (x) { return "含《" + esc(x.name) + "》"; }).join(" ");
  return '<button class="bookcard' + (DB.book === b.id ? " cur" : "") + '" data-jump="book:' + esc(b.id) +
    '" title="点开查看这本词书包含的单词">' +
    '<div class="bt">' + esc(b.name) + "</div><div class=\"bd\">" + esc(b.desc || "") + "</div>" +
    (incTxt ? '<div class="bd binc">' + incTxt + " · 共 " + fmtNum(s.total) + " 词</div>" : "") +
    '<div class="pbar"><i style="width:' + pct + '%"></i></div>' +
    '<div class="meta"><span>' + fmtNum(s.total) + " 词</span><span>" + pct + "% 已学</span>" +
    (s.due ? '<span style="color:var(--warn)">待复习 ' + s.due + "</span>" : "") + "</div>" +
    '<div class="bmore">查看单词列表 ›</div></button>';
}
function mineCard(id, name, desc, cls) {
  var s = statsOf(id);
  return '<button class="bookcard" data-jump="book:' + esc(id) + '" title="点开查看这些单词">' +
    '<div class="bt"><span class="tag ' + cls + '">' + esc(name) + "</span></div>" +
    '<div class="bd">' + esc(desc) + '</div><div class="meta"><span>' + fmtNum(s.total) + " 词</span></div>" +
    '<div class="bmore">查看单词列表 ›</div></button>';
}
function libRow(r) {
  var w = r[F.W], p = DB.prog[w];
  return '<div class="wrow"><div style="flex:1;min-width:0"><div class="wn">' + esc(w) +
    '<span class="ipa">' + esc(r[F.US] || r[F.UK] || "") + "</span>" +
    (isFav(w) ? ' <span class="tag gold" style="font-size:10px">★</span>' : "") + "</div>" +
    '<div class="wt">' + esc(firstDef(r)) + "</div></div>" +
    (p ? '<span class="tag">' + strength(p) + "%</span>" : '<span class="tag">新</span>') +
    '<button class="btn ghost sm" data-spk="' + esc(w) + '"><svg><use href="#i-vol"/></svg></button>' +
    '<button class="btn ghost sm" data-mk="' + esc(w) + '" data-bit="1">' + (isFav(w) ? "★" : "☆") + "</button></div>";
}
function searchWords(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  var out = [];
  var isCn = /[\u4e00-\u9fa5]/.test(q);
  var all = WORDS.concat(customWordsFlat());
  for (var i = 0; i < all.length && out.length < 800; i++) {
    var r = all[i];
    if (isCn) { if (String(r[F.CN] || "").toLowerCase().indexOf(q) >= 0) out.push(r); }
    else if (String(r[F.W]).toLowerCase().indexOf(q) === 0) out.push(r);
  }
  if (!out.length && !isCn) {
    for (var j = 0; j < all.length && out.length < 200; j++) {
      if (String(all[j][F.W]).toLowerCase().indexOf(q) > 0) out.push(all[j]);
    }
  }
  out.sort(function (a, b) { return String(a[F.W]).length - String(b[F.W]).length; });
  return out;
}
function customWordsFlat() {
  var out = [];
  var cm = DB.custom || {};
  for (var k in cm) { if (!Object.prototype.hasOwnProperty.call(cm, k)) continue;
    var ws = cm[k].words || [];
    for (var i = 0; i < ws.length; i++) if (!IDX[ws[i][F.W]]) out.push(ws[i]);
  }
  return out;
}
function bindLibrary() {
  var s = $("libSearch");
  if (s) {
    s.oninput = function () { LIBQ = s.value; };
    s.onkeydown = function (e) { if (e.key === "Enter") { LIBQ = s.value; render(); } };
  }
  var d = $("libDo"); if (d) d.onclick = function () { var el = $("libSearch"); if (el) LIBQ = el.value; render(); };
  var n = $("libNew"); if (n) n.onclick = newBookDialog;
  var n2 = $("libNew2"); if (n2) n2.onclick = newBookDialog;
  var im = $("libImport"); if (im) im.onclick = importDialog;
  var tp = $("libTpl"); if (tp) tp.onclick = function () {
    download("词匠导入模板.csv", "\uFEFFword,phonetic,meaning,example,example_cn\nabandon,əˈbændən,放弃；抛弃,They had to abandon the car.,他们只好弃车。\n", "text/csv;charset=utf-8");
  };
  /* 词书卡片现在点开「词书详情页」（data-jump="book:xxx"，由 bindCommon 统一接管）：
     先看清单、再决定要不要学。切换当前词书的动作移到了详情页的「设为当前词书 / 学这本」。 */
  document.querySelectorAll("[data-cb]").forEach(function (b) {
    b.onclick = function () {
      var id = b.getAttribute("data-id"), act = b.getAttribute("data-cb");
      if (act === "use") { DB.book = "@" + id; TAGS = {}; BOWN = {}; save(true); render(); toast("已选用该词书", "ok"); }
      else if (act === "exp") {
        var cb = DB.custom[id];
        download(cb.name + ".json", JSON.stringify(cb, null, 1), "application/json");
      } else {
        openModal("删除词书？", "<p class='muted'>「" + esc(DB.custom[id].name) + "」将被删除，学习记录保留。此操作不可撤销。</p>",
          '<button class="btn" id="mNo">取消</button><button class="btn danger" id="mYes">删除</button>',
          function () {
            $("mNo").onclick = closeModal;
            $("mYes").onclick = function () {
              delete DB.custom[id];
              if (DB.book === "@" + id) DB.book = "cet4";
              save(true); closeModal(); render(); toast("已删除", "ok");
            };
          });
      }
    };
  });
}
function newBookDialog() {
  openModal("新建自定义词书",
    '<label class="fld"><span>词书名称</span><input type="text" id="nbName" placeholder="例如：我的外刊高频词"></label>' +
    '<label class="fld"><span>说明（可选）</span><input type="text" id="nbDesc" placeholder="从哪里来的、用途"></label>' +
    '<label class="fld"><span>粘贴词条（每行：单词 释义）</span><textarea id="nbBody" placeholder="ubiquitous 无处不在的&#10;resilient 有韧性的"></textarea>' +
    '<div class="desc">留空也可以，之后可再用「导入词表」补充</div></label>',
    '<button class="btn" id="mNo">取消</button><button class="btn primary" id="mOk">创建</button>',
    function () {
      $("mNo").onclick = closeModal;
      $("mOk").onclick = function () {
        var name = ($("nbName").value || "").trim();
        if (!name) { toast("请填写词书名称", "bad"); return; }
        var body = $("nbBody").value || "";
        var recs = body.trim() ? parsePlainLines(body) : [];
        var id = "c" + now().toString(36);
        DB.custom[id] = { name: name, desc: ($("nbDesc").value || "").trim(), words: recs, created: now() };
        refreshCustomIndex(); TAGS = {}; BOWN = {};
        save(true); closeModal(); DB.book = "@" + id; render();
        toast("已创建「" + name + "」，共 " + recs.length + " 词", "ok");
      };
    });
}
function importDialog() {
  openModal("导入词表",
    '<div class="tiny muted" style="margin-bottom:14px;line-height:1.9">支持三种格式，都会自动去重：<br>' +
    "<b>CSV</b> — 首行可为表头，列序任意：<code>word,phonetic,meaning,example,example_cn</code>，可再加 <code>pos,definition,forms,phrases,root,synonyms,antonyms,discrimination,mnemo</code><br>" +
    "<b>TXT</b> — 每行 <code>单词 释义</code>（空格或 Tab 分隔）<br>" +
    "<b>JSON</b> — <code>[{\"w\":\"abandon\",\"cn\":\"放弃\",\"us\":\"əˈbændən\"}]</code> 或与本 App 导出的词书同构</div>" +
    '<label class="fld"><span>词书名称（留空则用文件名）</span><input type="text" id="imName" placeholder="自动"></label>' +
    '<label class="fld"><span>直接粘贴内容</span><textarea id="imBody" placeholder="也可以先粘贴，再点导入"></textarea></label>',
    '<button class="btn" id="mNo">取消</button><button class="btn ok" id="mPick">选择文件</button><button class="btn primary" id="mOk">导入</button>',
    function () {
      $("mNo").onclick = closeModal;
      $("mPick").onclick = function () {
        pickFile(".json,.csv,.txt", function (text, fname) {
          doImport(text, fname);
        });
      };
      $("mOk").onclick = function () {
        var body = $("imBody").value || "";
        var nm = $("imName").value || "";
        var text = body;
        if (nm || body) { doImportExtra(text, nm); }
        else toast("请粘贴内容或选择文件", "bad");
      };
    });
}
function doImportExtra(text, nm) {
  var recs = parseImport(text, nm || "粘贴导入");
  if (!recs.length) { toast("没有解析到有效词条", "bad"); return; }
  var name = (nm || "粘贴导入").replace(/\.(json|csv|txt)$/i, "");
  var id = "c" + now().toString(36);
  DB.custom[id] = { name: name, desc: "导入于 " + fmtDate(now()), words: recs, created: now() };
  refreshCustomIndex(); TAGS = {}; BOWN = {};
  save(true); closeModal(); DB.book = "@" + id; render();
  toast("导入成功：" + recs.length + " 词", "ok");
}
function doImport(text, fname) {
  var recs = parseImport(text, fname);
  if (!recs.length) { toast("没有解析到有效词条，请检查格式", "bad"); return; }
  var name = fname.replace(/\.(json|csv|txt)$/i, "");
  var id = "c" + now().toString(36);
  DB.custom[id] = { name: name, desc: "导入于 " + fmtDate(now()), words: recs, created: now() };
  refreshCustomIndex(); TAGS = {}; BOWN = {};
  save(true); closeModal(); DB.book = "@" + id; render();
  toast("导入成功：" + recs.length + " 词", "ok");
}
function mkRec(o) {
  var a = mkBlank();
  a[F.W] = String(o.w || o.word || "").trim();
  a[F.US] = String(o.us || o.usphone || o.phonetic || "").replace(/^\/|\/$/g, "");
  a[F.UK] = String(o.uk || o.ukphone || "").replace(/^\/|\/$/g, "");
  a[F.POS] = String(o.pos || "");
  a[F.CN] = String(o.cn || o.meaning || o.trans || o.translation || "").trim();
  a[F.EN] = String(o.en || o.definition || "");
  a[F.EX] = String(o.ex || o.example || "");
  a[F.EXZ] = String(o.exz || o.example_cn || "");
  a[F.TG] = String(o.tg || o.tags || "");
  a[F.FM] = String(o.fm || o.forms || "");
  a[F.PH] = String(o.ph || o.phrases || "");
  a[F.RT] = String(o.rt || o.root || "");
  a[F.SYN] = String(o.syn || o.synonyms || "");
  a[F.ANT] = String(o.ant || o.antonyms || "");
  a[F.DIS] = String(o.dis || o.discrimination || o.nuance || "");
  a[F.MN] = String(o.mn || o.mnemo || o.mnemonic || o.memory || "");
  return a;
}
function parseImport(text, fname) {
  if (!text) return [];
  text = String(text).replace(/^\uFEFF/, "");
  var ext = (fname || "").toLowerCase();
  var trimmed = text.trim();
  var out = [];
  if (trimmed.charAt(0) === "[" || trimmed.charAt(0) === "{") {
    var j;
    try { j = JSON.parse(trimmed); } catch (e) { j = null; }
    if (j) {
      var arr = Array.isArray(j) ? j : (j.words || j.list || j.data || []);
      if (j.name && !Array.isArray(j.words) && !Array.isArray(j.list) && !Array.isArray(j.data) && (j.w || j.word)) arr = [j];
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        if (Array.isArray(it)) { out.push(normArr(it)); continue; }
        if (it && typeof it === "object") { out.push(mkRec(it)); continue; }
        if (typeof it === "string") { out.push(mkRec({ w: it })); }
      }
      return dedupe(out);
    }
  }
  // CSV 表头 -> 字段名（支持中英文表头，列序任意）
  var CSV_HEAD = {
    word: "w", "单词": "w", w: "w",
    phonetic: "us", usphone: "us", "音标": "us", "美音": "us",
    ukphone: "uk", "英音": "uk",
    meaning: "cn", trans: "cn", translation: "cn", "释义": "cn", "中文": "cn", "词义": "cn",
    example: "ex", "例句": "ex", ex: "ex",
    example_cn: "exz", exz: "exz", "例句翻译": "exz", "译文": "exz",
    pos: "pos", "词性": "pos",
    definition: "en", en: "en", "英文释义": "en",
    forms: "fm", fm: "fm", "词形": "fm", "词形变化": "fm",
    phrases: "ph", ph: "ph", "搭配": "ph", "常用搭配": "ph",
    root: "rt", rt: "rt", "词根": "rt", "词根词缀": "rt",
    synonyms: "syn", syn: "syn", "同义词": "syn",
    antonyms: "ant", ant: "ant", "反义词": "ant",
    discrimination: "dis", dis: "dis", "辨析": "dis", "近义词辨析": "dis",
    mnemo: "mn", mn: "mn", mnemonic: "mn", "巧记": "mn", "助记": "mn", "记忆法": "mn"
  };
  var lines = text.split(/\r?\n/);
  var headCols = null;
  for (var k = 0; k < lines.length; k++) {
    var line = lines[k].trim();
    if (!line || line.charAt(0) === "#") continue;
    // 表头行：至少两列能映射到已知字段，且必须含单词列
    if (line.indexOf(",") >= 0) {
      var hs = splitCSVLine(line), map = [], hits = 0;
      for (var hi = 0; hi < hs.length; hi++) {
        var mk = CSV_HEAD[hs[hi].trim().toLowerCase()] || "";
        map.push(mk);
        if (mk) hits++;
      }
      if (hits >= 2 && map.indexOf("w") >= 0) { headCols = map; continue; }
    }
    if (line.indexOf(",") >= 0 && (ext.indexOf("csv") >= 0 || line.split(",").length >= 3)) {
      var c = splitCSVLine(line);
      if (c.length >= 2) {
        if (headCols) {
          var rowO = {};
          for (var ci = 0; ci < c.length && ci < headCols.length; ci++) {
            if (headCols[ci] && c[ci]) rowO[headCols[ci]] = c[ci];
          }
          if (rowO.w) out.push(mkRec(rowO));
        } else {
          out.push(mkRec({
            w: c[0], us: c[1], cn: c[2] || "", ex: c[3] || "", exz: c[4] || "",
            pos: c[5] || "", en: c[6] || "", fm: c[7] || "", ph: c[8] || "",
            rt: c[9] || "", syn: c[10] || "", ant: c[11] || "", dis: c[12] || "", mn: c[13] || ""
          }));
        }
        continue;
      }
    }
    var m = line.match(/^([A-Za-z][A-Za-z'’\-. ]*?)\s*[\t;|]\s*(.+)$/) || line.match(/^([A-Za-z][A-Za-z'’\-. ]*?)\s+([\u4e00-\u9fa5].*)$/);
    if (m) out.push(mkRec({ w: m[1], cn: m[2] }));
    else if (/^[A-Za-z][A-Za-z'’\-]*$/.test(line)) out.push(mkRec({ w: line }));
  }
  return dedupe(out);
}
function splitCSVLine(line) {
  var res = [], cur = "", q = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { res.push(cur); cur = ""; }
    else cur += ch;
  }
  res.push(cur);
  return res.map(function (s) { return s.trim(); });
}
/* 20 个槽位，与 part3 的 F（NF=20）严格对应，顺序不可改：
     0 W, 1 US, 2 UK, 3 POS, 4 CN, 5 EN, 6 EX, 7 EXZ, 8 TG,
     9 FM, 10 BNC, 11 FRQ, 12 ST, 13 OX, 14 PH, 15 RT, 16 SYN, 17 ANT, 18 DIS, 19 MN */
function mkBlank() {
  return ["", "", "", "", "", "", "", "", "", "", 0, 0, 0, 0, "", "", "", "", "", ""];
}
function normArr(a) {
  var o = mkBlank();
  for (var i = 0; i < a.length && i < NF; i++) o[i] = a[i];
  return o;
}
function parsePlainLines(text) { return parseImport(text, "paste.txt"); }
function dedupe(arr) {
  var seen = {}, out = [];
  for (var i = 0; i < arr.length; i++) {
    var w = String(arr[i][F.W] || "").trim();
    if (!w || !/^[A-Za-z]/.test(w)) continue;
    var k = w.toLowerCase();
    if (seen[k]) continue;
    seen[k] = 1;
    arr[i][F.W] = w;
    out.push(arr[i]);
  }
  return out;
}

/* ---------- 17. 统计 ---------- */
function vStats() {
  var g = globalStats();
  var l = DB.log[todayKey()] || { n: 0, r: 0 };
  var avg = g.seen ? Math.round(g.strength / g.seen) : 0;
  var est = 0;
  for (var w in DB.prog) {
    if (!Object.prototype.hasOwnProperty.call(DB.prog, w)) continue;
    var s = strength(DB.prog[w]);
    est += s >= 60 ? 1 : s >= 30 ? 0.6 : 0.25;
  }
  var h = '<div class="study-wrap">';
  h += '<div class="grid g4 keep" style="margin-bottom:16px">' +
    statCard("累计测评", fmtNum(Object.keys(DB.log).reduce(function (a, k) { return a + DB.log[k].n; }, 0)), "次", "今日 " + l.n + " 次") +
    statCard("已学单词", fmtNum(g.seen), "词", "词库 " + fmtNum(WORDS.length) + " 词") +
    statCard("已掌握", fmtNum(g.mastered), "词", "平均持久度 " + avg + "%") +
    statCard("预估词汇量", Math.round(est), "词", "按持久度加权") +
    "</div>";

  h += '<div class="card"><div class="card-h"><h2>打卡热力图</h2><span class="hint">近 26 周</span></div>' + heatHTML() +
    '<div class="row tiny faint" style="margin-top:12px;gap:6px;justify-content:flex-end">少<i style="width:12px;height:12px;border-radius:3px;background:var(--panel-3);display:inline-block"></i>' +
    '<i style="width:12px;height:12px;border-radius:3px;background:var(--accent);opacity:.3;display:inline-block"></i>' +
    '<i style="width:12px;height:12px;border-radius:3px;background:var(--accent);opacity:.52;display:inline-block"></i>' +
    '<i style="width:12px;height:12px;border-radius:3px;background:var(--accent);opacity:.76;display:inline-block"></i>' +
    '<i style="width:12px;height:12px;border-radius:3px;background:var(--accent);display:inline-block"></i>多</div></div>';

  h += '<div class="card"><div class="card-h"><h2>近 30 天学习量</h2></div>' + barsHTML(30) + "</div>";

  h += '<div class="card"><div class="card-h"><h2>掌握度分布</h2><span class="hint">按记忆持久度</span></div>' +
    '<div class="grid g2" style="align-items:center">' + ringHTML(g) + legendHTML(g) + "</div></div>";

  /* 持久度分布 */
  var buckets = [0, 0, 0, 0, 0];
  for (var w2 in DB.prog) {
    if (!Object.prototype.hasOwnProperty.call(DB.prog, w2)) continue;
    var b = Math.min(4, Math.floor(strength(DB.prog[w2]) / 20));
    buckets[b]++;
  }
  var mx = Math.max.apply(null, buckets.concat([1]));
  h += '<div class="card"><div class="card-h"><h2>记忆持久度分布</h2></div><div class="row" style="align-items:flex-end;gap:14px;height:150px;padding:0 6px">';
  var names = ["0-20%", "20-40%", "40-60%", "60-80%", "80-100%"];
  for (var i = 0; i < 5; i++) {
    h += '<div style="flex:1;text-align:center"><div style="height:' + (buckets[i] / mx * 110) + 'px;background:var(--accent);opacity:' + (0.35 + i * 0.16) + ';border-radius:5px 5px 0 0;min-height:3px"></div>' +
      '<div class="tiny" style="margin-top:6px">' + buckets[i] + '</div><div class="tiny faint">' + names[i] + "</div></div>";
  }
  h += "</div></div>";

  /* 各词书进度 */
  h += '<div class="card"><div class="card-h"><h2>词书进度</h2></div><table class="tbl"><thead><tr><th>词书</th><th class="num">总数</th><th class="num">已学</th><th class="num">已掌握</th><th class="num">待复习</th><th style="width:120px">进度</th></tr></thead><tbody>';
  var rows = [];
  for (var bi = 0; bi < BOOKS.length; bi++) {
    var s = statsOf(BOOKS[bi].id);
    if (s.seen > 0) rows.push([BOOKS[bi], s]);
  }
  rows.sort(function (a, b) { return b[1].seen - a[1].seen; });
  if (!rows.length) {
    h += '<tr><td colspan="6" class="faint" style="text-align:center;padding:26px">还没有学习记录</td></tr>';
  } else {
    rows.forEach(function (r) {
      var s = r[1], pct = s.total ? Math.round((s.seen / s.total) * 100) : 0;
      h += "<tr><td>" + esc(r[0].name) + '</td><td class="num">' + fmtNum(s.total) + '</td><td class="num">' + fmtNum(s.seen) +
        '</td><td class="num">' + fmtNum(s.mastered) + '</td><td class="num">' + fmtNum(s.due) + "</td>" +
        '<td><div class="pbar"><i style="width:' + pct + '%"></i></div></td></tr>';
    });
  }
  h += "</tbody></table></div>";

  /* 最近会话 */
  var ses = (DB.sessions || []).slice(-12).reverse();
  if (ses.length) {
    h += '<div class="card"><div class="card-h"><h2>最近学习记录</h2></div><table class="tbl"><thead><tr><th>时间</th><th>类型</th><th class="num">词数</th><th class="num">对</th><th class="num">错</th><th class="num">用时</th></tr></thead><tbody>';
    ses.forEach(function (x) {
      var kn = { auto: "学习", review: "复习", quiz: "测试", all: "自由" }[x.k] || x.k;
      h += "<tr><td>" + new Date(x.t).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) + "</td><td>" + esc(kn) +
        '</td><td class="num">' + x.n + '</td><td class="num">' + x.ok + '</td><td class="num">' + x.no + '</td><td class="num">' + Math.max(1, Math.round(x.d / 60)) + " 分</td></tr>";
    });
    h += "</tbody></table></div>";
  }
  h += "</div>";
  return h;
}
function heatHTML() {
  var weeks = 26;
  var base = startOfDay(now());
  var dow = (new Date(base).getDay() + 6) % 7;
  var start = base - (dow + (weeks - 1) * 7) * 86400000;
  var h = '<div style="overflow-x:auto;padding-bottom:4px"><div class="heat">';
  for (var i = 0; i < weeks * 7; i++) {
    var ts = start + i * 86400000;
    var k = dayKey(ts);
    var l = DB.log[k];
    var n = l ? l.n : 0;
    var cls = n === 0 ? "" : n < 10 ? "l1" : n < 30 ? "l2" : n < 70 ? "l3" : "l4";
    h += '<i class="' + cls + '" title="' + k + ": " + n + " 次" + (l ? "，错 " + l.r : "") + '"></i>';
  }
  return h + "</div></div>";
}
function ringHTML(g) {
  var tot = Math.max(1, g.seen);
  var segs = [
    [g.mastered, "var(--ok)"],
    [g.review, "var(--accent)"],
    [g.learn, "var(--warn)"]
  ];
  var R = 54, C = 2 * Math.PI * R, off = 0;
  var h = '<div class="ring" style="justify-self:center"><svg width="138" height="138" viewBox="0 0 138 138">';
  h += '<circle cx="69" cy="69" r="' + R + '" fill="none" stroke="var(--panel-3)" stroke-width="15"/>';
  segs.forEach(function (s) {
    if (!s[0]) return;
    var len = (s[0] / tot) * C;
    h += '<circle cx="69" cy="69" r="' + R + '" fill="none" stroke="' + s[1] + '" stroke-width="15" stroke-dasharray="' + len + " " + (C - len) + '" stroke-dashoffset="' + (-off) + '" stroke-linecap="butt"/>';
    off += len;
  });
  h += '</svg><div class="ctr"><b>' + fmtNum(g.seen) + "</b><span>已学单词</span></div></div>";
  return h;
}
function legendHTML(g) {
  return '<div class="legend">' +
    legendItem("var(--ok)", "已掌握", g.mastered, "间隔 ≥ " + cfg().masterDays + " 天") +
    legendItem("var(--accent)", "复习中", g.review, "间隔 1 天以上") +
    legendItem("var(--warn)", "学习中", g.learn, "还没形成长期记忆") +
    legendItem("var(--bad)", "错过的词", g.wrong, "答错至少一次") +
    legendItem("var(--text-faint)", "未开始", Math.max(0, WORDS.length - g.seen), "词库剩余") +
    "</div>";
}
function legendItem(color, name, n, sub) {
  return '<div class="li"><i class="dot2" style="background:' + color + '"></i><div><div>' + esc(name) + '</div><div class="tiny faint">' + esc(sub) + "</div></div><b>" + fmtNum(n) + "</b></div>";
}

/* ---------- 17b. 易混词（形近词辨析）----------
 * 这一页回答一个很具体的问题：「这两个词我老是记混，怎么办」。
 *
 * 为什么值得单开一页：四六级的客观题里，失分很大一块不是「没背过」，
 * 而是「背过但认错了」—— affect / effect、adapt / adopt、principal / principle
 * 这类只差一两个字母的词，孤立地背根本分不清，必须**放在一起对比**才记得住。
 * 而市面上按字母序排的词表恰好把它们拆得七零八落，这一页就是重新聚回来。
 *
 * 数据是构建期算好、随产物一起离线发布的（见 _dev/prep_confuse.js）：
 *   计算层负责广度（只差一两个字母、或相邻两字母换位，就算一组，覆盖六成以上的词），
 *   人工校对的经典对负责「最该出现的那批一定在」，两层互补、不互相替代。
 * 运行时零计算、零请求 —— 打开就有，飞行模式也有。
 */
var CFQ = ""; /* 页内搜索词 */
var CFSCOPE = "book"; /* book = 只看和当前词书相关的组；all = 全部词库 */
var CFLIMIT = 40; /* 惰性渲染：一次画多少组（17k 组全塞进 DOM 会明显卡） */

function cfRowHTML(w) {
  var r = rec(w);
  if (!r) return "";
  var us = String(r[F.US] || "");
  var cn = firstDef(r);
  return '<div class="cfw">' +
    '<button class="cfw-main" data-jump="word:' + esc(w) + '" title="查看词条 ' + esc(w) + '">' +
    '<span class="cfw-w">' + esc(w) + "</span>" +
    '<span class="cfw-p">' + esc(us ? "[" + us + "]" : "") + "</span>" +
    '<span class="cfw-c">' + esc(cn) + "</span>" +
    bookStateTag(w) +
    "</button>" +
    '<button class="btn ghost sm cfw-say" data-spk="' + esc(w) + '" aria-label="朗读 ' + esc(w) + '" title="朗读">' +
    '<svg><use href="#i-vol"/></svg></button>' +
    "</div>";
}
/* 命中筛选的组序号。
   scope 传参而不是直接读全局：页面上两个范围按钮都要显示各自的组数，
   那就得在同一帧里算两遍，读全局变量是算不出来的。 */
function cfFiltered(scope) {
  var q = CFQ.trim().toLowerCase();
  var m = null;
  if (scope === "book") {
    /* 当前词书的词做成一张表，避免每个组、每个词都去 splitPipe 一次标签 ——
       17k 组 × 4 词 = 六万多次字符串切分，放在每次重绘里是真会卡的。
       这张表只在本函数内建一次、用完即弃，所以不存在「切了词书缓存没失效」的问题。 */
    m = {};
    var pool = bookWords(DB.book);
    for (var i = 0; i < pool.length; i++) m[pool[i][F.W]] = 1;
  }
  var out = [];
  for (var k = 0; k < CONF.length; k++) {
    var g = CONF[k];
    if (!g || g.length < 2) continue;
    if (m) {
      var inb = 0;
      for (var j = 0; j < g.length; j++) if (m[g[j]]) inb++;
      /* 要求**至少两个**词在当前词书，而不是一个。
         只有一个词在书里的话，这一组对这本书的学习者就是
         「一个眼熟的词配三个没见过的词」—— 对比不起来，纯属噪音。 */
      if (inb < 2) continue;
    }
    if (q) {
      var hit = false;
      for (var t = 0; t < g.length; t++) {
        var r = rec(g[t]);
        if (!r) continue;
        if (g[t].indexOf(q) === 0 || String(r[F.CN] || "").toLowerCase().indexOf(q) >= 0) { hit = true; break; }
      }
      if (!hit) continue;
    }
    out.push(k);
  }
  return out;
}
function cfGroupHTML(gi) {
  var g = CONF[gi];
  var h = '<div class="cfg"><div class="cfg-h">' +
    '<span class="tag">' + g.length + " 词</span>" +
    '<span class="sp"></span>' +
    '<button class="btn primary sm" data-cfdrill="' + gi + '" title="把这一组当成一轮练习，干扰项优先从这组里取">' +
    '<svg><use href="#i-play"/></svg>练这组</button></div>';
  for (var i = 0; i < g.length; i++) h += cfRowHTML(g[i]);
  return h + "</div>";
}
function vConfuse() {
  var bm = bookMeta(DB.book) || { name: "未选择" };
  var allN = CONF.length;
  var bookN = cfFiltered("book").length;
  var ids = cfFiltered(CFSCOPE);
  var h = '<div class="study-wrap">';

  /* ---- 说明 + 范围 + 搜索 ---- */
  h += '<div class="card"><div class="card-h"><h2>易混词</h2><span class="hint">长得像 · 意思不同 · 放一起才分得清</span></div>' +
    '<div class="tiny faint">失分有一大块不是「没背过」，而是「背过但认错了」。' +
    "像 affect / effect、adapt / adopt、principal / principle 这种只差一两个字母的词，" +
    "孤立地背分不清，得放在一起对比。这一页把它们重新聚回来：" +
    "共 <b>" + fmtNum(allN) + "</b> 组、覆盖 <b>" + fmtNum(confCover()) + "</b> 个词，" +
    "全部离线预置 —— 打开就有，飞行模式也有。</div>" +
    '<div class="row wrap" style="gap:8px;margin-top:13px">' +
    '<button class="btn sm' + (CFSCOPE === "book" ? " primary" : "") + '" id="cfBook">《' + esc(bm.name) + "》相关 " + fmtNum(bookN) + "</button>" +
    '<button class="btn sm' + (CFSCOPE === "all" ? " primary" : "") + '" id="cfAll">全部词库 ' + fmtNum(allN) + "</button>" +
    "</div>" +
    '<div class="row" style="gap:8px;margin-top:12px">' +
    '<input type="search" id="cfq" placeholder="搜一个词看它跟谁容易混，也可以搜中文释义" value="' + esc(CFQ) + '">' +
    '<button class="btn nowrap" id="cfqClear">清空</button></div>' +
    "</div>";

  /* ---- 分组列表 ---- */
  h += '<div class="card"><div class="card-h"><h2>形近词组</h2><span class="hint">' +
    (CFQ.trim() ? "匹配 " : CFSCOPE === "book" ? "当前词书" : "全量") + " · 共 " + fmtNum(ids.length) + " 组</span></div>";
  if (!ids.length) {
    /* 搜的词本身有组、只是被「当前词书」筛掉了 —— 这是最容易让人以为「功能坏了」的情形，
       所以不只给一句空话，而是直接把出路（切到全部词库）说出来并做成一个按钮。 */
    var hint = confGroupsOf(CFQ.trim());
    h += '<div class="empty"><svg><use href="#i-x"/></svg><b>' +
      (CFQ.trim() ? "这个范围内没有匹配的易混词组" : "这本词书的词还没有可对比的形近词组") + "</b>" +
      (hint.length
        ? "「" + esc(CFQ.trim()) + "」在全部词库里有 " + hint.length + " 组，切到「全部词库」就能看到"
        : CFQ.trim() ? "换个词试试，或点「清空」看全部" : "") + "</div>";
    if (hint.length && CFSCOPE !== "all") {
      h += '<div class="row" style="justify-content:center;margin-top:12px">' +
        '<button class="btn primary" id="cfAll"><svg><use href="#i-confuse"/></svg>切到全部词库看这 ' + hint.length + " 组</button></div>";
    }
  } else {
    var show = Math.min(CFLIMIT, ids.length);
    h += '<div class="cfgs">';
    for (var i = 0; i < show; i++) h += cfGroupHTML(ids[i]);
    h += "</div>";
    if (ids.length > show) {
      h += '<div class="row" style="justify-content:center;margin-top:14px">' +
        '<button class="btn" id="cfMore">显示更多（已显示 ' + fmtNum(show) + " / " + fmtNum(ids.length) + "）</button></div>";
    } else {
      h += '<div class="tiny faint" style="text-align:center;margin-top:12px">已经到底了 · 共 ' + fmtNum(ids.length) + " 组</div>";
    }
  }
  h += "</div></div>";
  return h;
}
/* 重绘后把光标放回搜索框末尾（和词书页同款处理，否则每敲一个字就丢焦点） */
function cfFocus() {
  var n = $("cfq");
  if (!n) return;
  n.focus();
  try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) {}
}
function confMount() {
  var b1 = $("cfBook");
  if (b1) b1.onclick = function () { CFSCOPE = "book"; CFLIMIT = 40; render(); };
  var b2 = $("cfAll");
  if (b2) b2.onclick = function () { CFSCOPE = "all"; CFLIMIT = 40; render(); };
  var cl = $("cfqClear");
  if (cl) cl.onclick = function () { CFQ = ""; CFLIMIT = 40; render(); };
  var q = $("cfq");
  if (q) {
    var timer = null;
    q.oninput = function () {
      CFQ = q.value;
      CFLIMIT = 40;
      clearTimeout(timer);
      timer = setTimeout(function () { render(); cfFocus(); }, 220);
    };
    q.onkeydown = function (e) {
      e.stopPropagation();
      if (e.key === "Enter") { clearTimeout(timer); render(); cfFocus(); }
    };
    q.onchange = function () { clearTimeout(timer); render(); cfFocus(); };
  }
  var more = $("cfMore");
  if (more) more.onclick = function () {
    var v0 = $("view"), top = v0 ? v0.scrollTop : 0;
    CFLIMIT += 40;
    render();
    var v1 = $("view");
    if (v1) v1.scrollTop = top;
  };
  /* 「练这组」按钮带的是**组序号**不是词组本身：
     词组里可能含引号之类的字符，塞进 HTML 属性要转义，序号则永远是安全的数字。 */
  document.querySelectorAll("[data-cfdrill]").forEach(function (b) {
    b.onclick = function (e) {
      e.stopPropagation();
      var gi = Number(b.getAttribute("data-cfdrill"));
      var g = CONF[gi];
      if (!g) { toast("这一组找不到了", "bad"); return; }
      startDrill(g);
    };
  });
}

/* ---------- 17b. 词汇量测试（阶梯自适应 · 自评二选一 + 假词陷阱） ----------
 *
 * 为什么用自评而不是四选一：
 *   一次测试要横跨八个难度档。四选一每题只能问「这个词的哪条释义对」，
 *   而「认识这个词、却在四个近义释义里选错」会被判成不认识 —— 结果系统性偏低。
 *   自评走的是另一条路：让你自己判定认不认识，再用**假词**把「虚报」量出来扣掉。
 *   假词陷阱是这个设计成立的关键 —— 没有它，一个爱面子的人能测出两万词。
 *
 * 阶梯怎么走：
 *   从中间档起步，答对升一档、答错降一档。当你在相邻两档之间来回摆动，
 *   说明边界找到了 → 提前收工；否则一路问到 25 题上限。
 *   所以实际题数落在 18–25 之间，各人不同 —— 这比固定 20 题更省时间也更准。
 *
 * 三件事必须守住：
 *   ① 测试**绝不碰学习记录**：答错不扣分、不进复习队列、不写 DB.prog。
 *      否则用户会为了「别把进度弄脏」而在测试里撒谎，测出来的数就废了。
 *   ② 假词必须真的不在词库里 —— [23] 有断言盯着，哪天词库扩了撞上会当场红。
 *   ③ 结果只是**建议**。改不改词书、改不改每日量，都由用户自己按按钮决定。
 */
var VL_RUNG = [
  ["基础常用", "zhongkao"], ["高中", "gaokao"], ["四级", "cet4"], ["六级", "cet6"],
  ["考研", "kaoyan"], ["托福", "toefl"], ["雅思", "ielts"], ["GRE", "gre"]
];
var VL_N = VL_RUNG.length;
/* 每一档里最眼熟的那一段不拿来考：那是这一档的「地板」，谁都认识，
   问它问不出边界在哪。按 BNC 词频排名砍掉最靠前的 20%，
   剩下的题才真正在试探这一档的上沿。 */
var VL_SKIP_TOP = 0.2;
/* 假词陷阱。都用**拼写合法的捏造词**：关键不是「长得像生僻词」，
   而是「看着像英语、但词典里根本没有」。全部要在测试里验明不在词库（[23]）。 */
var VL_FAKE = ["abligate", "crendish", "floritous", "grondle", "hesitable", "intervane",
  "luminade", "plendish", "quorible", "scavant", "tremulent", "vandible"];
var VL_MIN_Q = 18, VL_MAX_Q = 25, VL_FAKE_N = 4;
/* 假词固定安插在第 3、8、13、18 题（1 基）。
   压在 18 题以内，是为了保证**哪怕测试提前收敛，四个假词也全都问过了** ——
   否则虚报率的分母忽大忽小，同一个人两次测出来的数会不一样。 */
var VL_FAKE_AT = [2, 7, 12, 17];
/* 起步档取中间。太低要爬很多级才到位，太高会让基础弱的用户一路挨打，
   中间起步两种人都能在 8 题左右收敛。 */
var VL_START = Math.floor(VL_N / 2);

var VL = null; /* 测试进行中的内存态。结果另存 DB.vl，便于统计页回看 */

/* 只考单个单词：词组（"a calculated crime"）没法凭词形自评；
   数字、连字符、缩写也不是「词汇量」意义上的词。 */
function vlWordOK(r) {
  if (!r) return false;
  var w = String(r[F.W] || "");
  return w.length >= 3 && /^[a-z]+$/.test(w);
}
/* 这个词**最早该被学会**的档位。按难度序取最小 ——
   ⚠ 必须按序而不是按标签判：序 0 上挂着八个标签（nce1 / verb1000 / zhongkao …），
   按标签写就会只认其中一个，另外七个标签的词**整批漏掉，而且不报错**。
   （精读的档位判定当初就是这么翻的：the 掉进「超纲」，满屏中文释义读不下去。） */
function vlOrder(r) {
  var t = wordTags(r), best = -1;
  for (var i = 0; i < t.length; i++) {
    var o = LVL_ORDER[t[i]];
    if (o !== undefined && o < VL_N && (best < 0 || o < best)) best = o;
  }
  return best;
}
var VLLAD = null;
function vlLadder() {
  if (VLLAD) return VLLAD;
  var b = [], i, k;
  for (i = 0; i < VL_N; i++) b.push([]);
  for (k = 0; k < WORDS.length; k++) {
    var r = WORDS[k];
    if (!vlWordOK(r)) continue;
    var o = vlOrder(r);
    if (o < 0) continue;
    b[o].push(r);
  }
  var out = [], cum = 0;
  for (i = 0; i < VL_N; i++) {
    var arr = b[i];
    /* 按 BNC 排名升序；没有排名的当「更冷僻」排到后面（不参与被砍的那一段） */
    arr.sort(function (x, y) {
      var a = Number(x[F.BNC]) || 1e9, c = Number(y[F.BNC]) || 1e9;
      return a - c;
    });
    var skip = Math.floor(arr.length * VL_SKIP_TOP);
    var pool = arr.slice(skip);
    if (!pool.length) pool = arr;
    /* cum 用**整档**词数，不是抽题池 —— 词汇量刻度算的是「这一档及以下一共多少词」，
       抽题池只是从里面挑来问的那一部分。两者混用会让估计值凭空少掉两成。 */
    cum += arr.length;
    out.push({ lv: i, name: VL_RUNG[i][0], book: VL_RUNG[i][1], pool: pool, size: arr.length, cum: cum });
  }
  VLLAD = out;
  return out;
}
function vlPick(lv) {
  var p = vlLadder()[lv].pool;
  for (var t = 0; t < 60; t++) {
    var w = p[Math.floor(Math.random() * p.length)];
    if (w && !VL.seen[w[F.W]]) { VL.seen[w[F.W]] = 1; return String(w[F.W]); }
  }
  /* 池子问完了（档内词少 + 运气差）：允许重复，不能返回空 ——
     返回空会让界面显示一个空白题干，用户完全不知道该干什么。 */
  var fb = p[Math.floor(Math.random() * p.length)];
  return fb ? String(fb[F.W]) : "the";
}
function vlFakeWord() {
  for (var t = 0; t < 40; t++) {
    var w = VL_FAKE[Math.floor(Math.random() * VL_FAKE.length)];
    if (!VL.fakeUsed[w]) { VL.fakeUsed[w] = 1; return w; }
  }
  return VL_FAKE[0];
}
function vlStart() {
  vlLadder();
  VL = {
    phase: "ask", cur: VL_START, hist: [], seen: {}, fakeUsed: {},
    fakeHit: 0, fakeN: 0, asked: 0, last: null, word: "", res: null
  };
  vlNext();
  render();
}
/* 收敛判定：最近 8 题里档位跨度 ≤ 1、且转向过至少 2 次 ——
   也就是「在相邻两档之间来回摆动」，那正是分界所在。 */
function vlConverged() {
  if (!VL || VL.hist.length < 8) return false;
  var last = VL.hist.slice(-8), mn = 99, mx = -1, turn = 0, i;
  for (i = 0; i < last.length; i++) {
    if (last[i].lv < mn) mn = last[i].lv;
    if (last[i].lv > mx) mx = last[i].lv;
    if (i >= 2) {
      var a = last[i - 1].lv - last[i - 2].lv, b = last[i].lv - last[i - 1].lv;
      if (a && b && (a > 0) !== (b > 0)) turn++;
    }
  }
  if (mx - mn <= 1 && turn >= 2) return true;
  /* 还有一种「静默收敛」：已经贴着最高档连对 5 题、或贴着最低档连错 5 题。
     这时候档位不再变化，上面那两个条件永远不成立，再问下去纯属浪费 ——
     用户会觉得「怎么一直问我会的词」，然后中途退出。 */
  var tail = VL.hist.slice(-5);
  var allOK = true, allNo = true;
  for (i = 0; i < tail.length; i++) { if (!tail[i].ok) allOK = false; if (tail[i].ok) allNo = false; }
  if (allOK && VL.cur >= VL_N - 1) return true;
  if (allNo && VL.cur <= 0) return true;
  return false;
}
function vlNext() {
  if (!VL) return;
  if (VL.fakeN < VL_FAKE_N && VL_FAKE_AT.indexOf(VL.asked) >= 0) {
    VL.word = vlFakeWord();
    VL.last = { fake: true, lv: -1 };
  } else {
    VL.word = vlPick(VL.cur);
    VL.last = { fake: false, lv: VL.cur };
  }
}
function vlAnswer(ok) {
  if (!VL || VL.phase !== "ask" || !VL.last) return;
  if (VL.last.fake) {
    /* 假词不回馈、不推进档位，只记账 —— 用户不该从界面上看出哪个是假词，
       否则陷阱就白设了。 */
    VL.fakeN++;
    if (ok) VL.fakeHit++;
  } else {
    VL.hist.push({ lv: VL.last.lv, ok: ok ? 1 : 0 });
    VL.cur = ok ? Math.min(VL.cur + 1, VL_N - 1) : Math.max(VL.cur - 1, 0);
  }
  VL.asked++;
  if (VL.asked >= VL_MAX_Q || (VL.asked >= VL_MIN_Q && vlConverged())) { vlFinish(); return; }
  vlNext();
  render();
}
function vlQuit() { VL = null; render(); }
function vlResult() {
  var lad = vlLadder(), h = VL.hist, i;
  /* 点估计取「答对过的最高档」，而不是最近几题的平均档。
     理由是语义清楚：你说你认识这一档的词，那就至少算到这一档；
     而在阶梯里这个值天然就落在「摆动区间」的上沿，不用再调参。 */
  var passed = -1;
  for (i = 0; i < h.length; i++) if (h[i].ok && h[i].lv > passed) passed = h[i].lv;
  /* ⚠ 一题都没答对时 passed 是 -1。这时候如果顺手把档位兜到 0，
     结果会报出「约 3,662 词」—— 而这个人连最低档的词都没认全，
     等于把「最低刻度」当成了「他的水平」，高估得非常离谱。
     所以这种情况单独标记出来，界面照实说「这是测试的下限，你可能更低」。 */
  var none = passed < 0;
  if (none) passed = 0;
  var rho = VL.fakeN ? VL.fakeHit / VL.fakeN : 0;
  /* 虚报校准的档位只有三格，是刻意做粗的：
     4 个假词能给出的分辨率本来就只有 1/4，再细分就是在假装精确。
     1 个假词点错不扣（可能是手滑或看错），2 个扣一档，3 个以上扣两档。 */
  var adj = rho >= 0.75 ? 2 : rho >= 0.5 ? 1 : 0;
  var lv = Math.max(0, passed - adj);
  var top = lv >= VL_N - 1;
  var loN = lv > 0 ? lad[lv - 1].cum : 0;
  return {
    lv: lv, passed: passed, adj: adj, rho: rho, fakeN: VL.fakeN, fakeHit: VL.fakeHit, none: none,
    name: lad[lv].name, book: lad[lv].book, est: lad[lv].cum,
    /* none 时下界写 0 而不是 1：这时候「最低刻度」不是用户的下界，
       只给一个上界（最高到 cum(1)）才是诚实的表达。 */
    lo: none ? 0 : loN + 1, hi: lad[Math.min(lv + 1, VL_N - 1)].cum, top: top, asked: VL.asked
  };
}
function vlFinish() {
  var r = vlResult();
  VL.phase = "done";
  VL.res = r;
  /* 只存结果，不存过程。过程里带着「哪些词答错了」，而这份测试的承诺是
     不碰学习记录 —— 存下来就有人拿它去恢复进度，承诺就破了。 */
  DB.vl = { at: now(), lv: r.lv, est: r.est, lo: r.lo, hi: r.hi, asked: r.asked, fakeN: r.fakeN, fakeHit: r.fakeHit };
  save(true);
  render();
  toast("测完了，你的词汇量约 " + fmtNum(r.est) + " 词", "ok");
}
/* 建议每日新词量：设了考试日期就按剩余天数倒推，没设就按 60 天过一遍估。
   夹进 newPerDay 的合法区间（1–500）—— 超出区间的建议值点「应用」会写不进去。 */
function vlDaily(book) {
  var bs = statsOf(book);
  var remain = Math.max(0, bs.total - bs.seen);
  var ep = examPlan();
  var days = ep && ep.days > 0 ? ep.days : 0;
  var need = remain > 0 ? Math.ceil(remain / (days > 0 ? days : 60)) : 0;
  if (!need) need = 20;
  var lim = numSpec("newPerDay");
  return { need: clamp(need, lim.min, lim.max), remain: remain, days: days, total: bs.total, seen: bs.seen };
}

/* ---------- 17c. 词汇量测试的界面 ---------- */
function vVocab() {
  if (VL && VL.phase === "ask") return vVocabAsk();
  if (VL && VL.phase === "done") return vVocabDone();
  return vVocabIntro();
}
function vVocabIntro() {
  var lad = vlLadder();
  var total = lad[VL_N - 1].cum;
  var last = DB.vl;
  var h = '<div class="study-wrap">';
  h += '<div class="card"><div class="card-h"><h2>词汇量测试</h2><span class="hint">' +
    VL_MIN_Q + "–" + VL_MAX_Q + " 题 · 只凭词形判断</span></div>" +
    '<div class="tiny faint">测试从中间难度起步，<b>答对升一档、答错降一档</b>。' +
    "当你在相邻两档之间来回摆动，就说明边界找到了，会自动收工 —— " +
    "所以题数不是固定的，认识得多就多问几档，一上来就吃力就早结束。" +
    "<br><br>题目只给你单词本身，你判断认不认识。<b>凭第一反应，不用纠结</b>：" +
    "这个词是不是在哪见过、大概什么意思，能想起来就算认识。" +
    "<br><br>为了校准「自我感觉良好」，中间会混进几个<b>看着像英语、其实字典里没有</b>的词。" +
    "在它们上面点「认识」会拉低最终估计 —— 所以别客气，不认识就点不认识。" +
    "<br><br>这件事完全不影响你的学习记录：答错不扣分、不进复习队列，" +
    "结果也不会写进任何一天的学习日志。</div>" +
    '<div class="row" style="margin-top:14px"><button class="btn primary" id="vlStart">' +
    '<svg><use href="#i-play"/></svg>开始测试</button>' +
    '<span class="tiny faint">题库共 ' + fmtNum(total) + " 词 · 覆盖八个难度档</span></div></div>";

  if (last && last.at) {
    var pct = Math.min(100, Math.round(last.est / (lad[VL_N - 1].cum || 1) * 100));
    h += '<div class="card"><div class="card-h"><h2>上次结果</h2><span class="hint">' +
      new Date(last.at).toLocaleDateString() + "</span></div>" +
      '<div class="grid g3 keep">' +
      statCard("估算词汇量", fmtNum(last.est), "词", "区间 " + fmtNum(last.lo) + "–" + fmtNum(last.hi)) +
      statCard("所在档位", (lad[last.lv] || {}).name || "-", "", "答对过的最难一档") +
      statCard("虚报", last.fakeHit + "/" + last.fakeN, "个", last.fakeHit >= 2 ? "估计值已下调" : "没发现问题") +
      "</div>" +
      '<div class="vlbar" title="相对于最高档"><i style="width:' + pct + '%"></i></div></div>';
  }
  h += "</div>";
  return h;
}
function vVocabAsk() {
  var h = '<div class="study-wrap">';
  var done = Math.min(VL.asked, VL_MIN_Q);
  var pct = Math.round(done / VL_MIN_Q * 100);
  h += '<div class="card"><div class="row" style="justify-content:space-between;align-items:center">' +
    '<span class="tag accent">第 ' + (VL.asked + 1) + " 题</span>" +
    '<span class="tiny faint">共 ' + VL_MIN_Q + "–" + VL_MAX_Q + " 题 · 已答 " + VL.asked + "</span>" +
    '<button class="btn ghost sm" id="vlQuit">退出</button></div>' +
    '<div class="vlbar" style="margin-top:10px"><i style="width:' + pct + '%"></i></div></div>';
  h += '<div class="card vlask">' +
    '<div class="tiny faint" style="text-align:center">你认识这个词吗</div>' +
    '<div class="vlword">' + esc(VL.word) + "</div>" +
    '<div class="vlbtns">' +
    '<button class="btn vlbtn yes" id="vlKnow">认识</button>' +
    '<button class="btn vlbtn no" id="vlDont">不认识</button>' +
    "</div>" +
    '<div class="tiny faint" style="text-align:center;margin-top:14px">' +
    esc("凭第一反应。不认识的词放心点 —— 不会影响你的学习记录。") + "</div></div>";
  h += "</div>";
  return h;
}
function vVocabDone() {
  var r = VL.res || vlResult();
  var lad = vlLadder();
  var h = '<div class="study-wrap">';
  h += '<div class="card vldone"><div class="card-h"><h2>测完了</h2><span class="hint">' +
    "一共问了 " + r.asked + " 题</span></div>" +
    '<div class="vlest"><b>' + fmtNum(r.est) + "</b><span>词</span></div>" +
    '<div class="tiny faint" style="text-align:center">' +
    "考虑到单次测试会有波动，你的真实水平大概在 <b>" + fmtNum(r.lo) + " – " + fmtNum(r.hi) + "</b> 之间" +
    (r.top ? "（已经是最高档，实际可能更高）" : "") + "</div>" +
    '<div class="vlbar" style="margin-top:14px"><i style="width:' +
    Math.round(r.lv / (VL_N - 1) * 100) + '%"></i></div>' +
    '<div class="tiny faint" style="text-align:center;margin-top:6px">' +
    "档位刻度 " + esc(lad.map(function (x) { return x.name; }).join(" → ")) + "</div>" +
    /* 一题都没答对：不装作用一个数字代表他的水平，直接说清这是测试的下限 */
    (r.none ? '<div class="tiny faint" style="margin-top:10px">你连最低档的词也没认全，' +
      "所以 " + fmtNum(r.est) + " 是这次测试的<b>下限刻度</b>，不是你的水平 —— 真实词汇量可能更低。" +
      "好消息是从这里起步涨得最快：先把《中考核心》和《高考 3500》过一遍，一个月就能看到明显变化。</div>" : "") +
    "</div>";

  /* 虚报提示：只在真的抓到虚报时出现，没抓到就不提 ——
     每次都提醒「注意诚实作答」会让老实人觉得自己被怀疑。 */
  if (r.fakeHit >= 1) {
    h += '<div class="card"><div class="card-h"><h2>关于那几个不存在的词</h2><span class="hint">' +
      r.fakeHit + " / " + r.fakeN + "</span></div>" +
      '<div class="tiny faint">' +
      (r.adj > 0
        ? "有 <b>" + r.fakeHit + "</b> 个并不存在的词你点了「认识」。这通常意味着把自己「好像在哪儿见过」当成了「认识」，" +
          "所以最终估计<b>已经下调了 " + r.adj + " 档</b>（按你答对过的最难一档算本来是《" + lad[r.passed].name + "》）。" +
          "这不是批评 —— 而是说明你的真实边界比感觉上低一点，从下面的档位开始补更划算。"
        : "有 1 个并不存在的词你点了「认识」。只出现一次就不扣你的分 —— 可能是手滑，也可能那个编出来的词恰好长得像你真认识的词。") +
      "</div></div>";
  }

  /* 建议 + 一键应用。用户的选择是「给建议、由我决定」——
     所以这里一个下拉 + 两个按钮，绝不自动改设置。 */
  var bookId = DB.vlPick && bookMeta(DB.vlPick) ? DB.vlPick : r.book;
  /* 如果设置里填了「考试目标词书」，默认选它：用户是奔着那场考试来的，
     让测试结果把他自己设的目标覆盖掉反而是添乱。但推荐档位照旧写在旁边，
     不藏起来 —— 该给的信息不能因为默认值换了就不说了。 */
  var examB = cfg().examBook && bookMeta(cfg().examBook) ? cfg().examBook : "";
  var examBName = examB ? (bookMeta(examB) || {}).name : "";
  if (!DB.vlPick && examB) bookId = examB;
  var dd = vlDaily(bookId);
  h += '<div class="card"><div class="card-h"><h2>从这里开始</h2><span class="hint">改不改由你决定</span></div>' +
    '<div class="setrow"><div class="setrow-t"><b>起点词书</b><span>测试推荐《' +
    /* ⚠ 这里必须用 r.name（= lad[r.lv].name），**不能写 lad[r.book].name**。
       vlResult() 的 `book` 是词书 id 字符串（"cet4"），`lv` 才是档位下标；
       把 id 当下标去查数组会得到 undefined，紧接着 .name 直接抛异常 ——
       整个结果页白屏。这类「同名不同刻度」的错在源码里读起来完全通顺
       （`lad[r.book]` 看着就像「按书取档」），只有真的走到这一步才炸。 */
    esc(r.name) + "》（你答对过的最难一档）" +
    (examB && examB !== r.book
      ? "；但你在设置里把考试目标设成了《" + esc(examBName) + "》，所以默认选了它"
      : "，从这一档开始正好把见过的补齐") + "</span></div>" +
    '<select id="vlBook">' +
    BOOKS.map(function (b) {
      return '<option value="' + esc(b.id) + '"' + (b.id === bookId ? " selected" : "") + ">" +
        esc(b.name) + "（" + fmtNum(b.n) + " 词）</option>";
    }).join("") + "</select></div>" +
    '<div class="setrow" id="vlApplyRow"><div class="setrow-t"><b>还剩多少</b><span id="vlRemainHint">' +
    esc(vlRemainText(dd)) + "</span></div>" +
    '<span class="tag accent">建议每天 ' + dd.need + " 词</span></div>" +
    '<div class="row wrap" style="gap:9px;margin-top:12px">' +
    '<button class="btn primary" id="vlApply">一键应用这两项</button>' +
    '<button class="btn" id="vlAgain">再测一次</button>' +
    '<span class="tiny faint" id="vlApplyMsg"></span></div></div>';
  h += "</div>";
  return h;
}
function vlRemainText(dd) {
  if (!dd.remain) return "这本词书你已经全部见过一遍了，接下来是复习巩固";
  return "这本词书共 " + fmtNum(dd.total) + " 词，已见 " + fmtNum(dd.seen) + " 词、还剩 " +
    fmtNum(dd.remain) + " 词" +
    (dd.days > 0 ? "；距考试 " + dd.days + " 天，摊到每天就是上面这个数"
      : "；按 60 天过一遍估的（在设置里填考试日期会更准）");
}
function vlMount() {
  var s = $("vlStart");
  if (s) s.onclick = function () { vlStart(); };
  var k = $("vlKnow");
  if (k) k.onclick = function () { vlAnswer(true); };
  var n = $("vlDont");
  if (n) n.onclick = function () { vlAnswer(false); };
  var q = $("vlQuit");
  if (q) q.onclick = function () { vlQuit(); };
  var ag = $("vlAgain");
  if (ag) ag.onclick = function () { VL = null; vlStart(); };
  var sel = $("vlBook");
  if (sel) sel.onchange = function () {
    /* 换词书只更新下面那行提示，不整页重绘 ——
       重绘会重建这个 select，正在展开的下拉会被关掉，手感很差。 */
    DB.vlPick = sel.value;
    var dd = vlDaily(sel.value);
    var hint = $("vlRemainHint");
    if (hint) hint.textContent = vlRemainText(dd);
    var tag = document.querySelector("#vlApplyRow .tag");
    if (tag) tag.textContent = "建议每天 " + dd.need + " 词";
    save(true);
  };
  var ap = $("vlApply");
  if (ap) ap.onclick = function () {
    var bid = ($("vlBook") || {}).value || r0Book();
    var dd = vlDaily(bid);
    if (!bookMeta(bid)) { toast("这本词书找不到了", "bad"); return; }
    DB.book = bid;
    TAGS = {}; BOWN = {}; /* 换词书要清掉标签缓存，否则详情页还按旧词书筛 */
    cfg().newPerDay = dd.need;
    save(true);
    var msg = $("vlApplyMsg");
    if (msg) msg.textContent = "已切到《" + (bookMeta(bid) || {}).name + "》，每日新词上限改为 " + dd.need + " 词";
    toast("已应用：" + (bookMeta(bid) || {}).name + " · 每天 " + dd.need + " 词", "ok");
  };
}
function r0Book() { return (VL && VL.res ? VL.res.book : (VL_RUNG[0][1])); }

/* ---------- 18. 设置 ---------- */
var THEMES = [["dawn", "晨雾"], ["paper", "纸墨"], ["forest", "林间"], ["sakura", "樱花"], ["midnight", "午夜"], ["ink", "墨黑"], ["ocean", "深海"]];
/* 题型清单。**这个数组的顺序就是界面上开关的排列顺序**，
   也刻意与 CFG_DEF.activeModes 的默认轮换顺序保持一致 ——
   否则设置页上从上到下看到的是「看词选义 / 看义选词 / 拼写 / 听音辨词…」，
   实际轮换却是「看词选义 / 看义选词 / 听音辨词 / 例句填空…」，
   用户按界面顺序去理解学习节奏就会对不上。 */
var MODES = [["recog", "看词选义"], ["recall", "看义选词"], ["listen", "听音辨词"], ["cloze", "例句填空"], ["spell", "拼写"], ["card", "卡片速记"]];
/* ---------- 数值输入的「单元格格式」规格表 ----------
   声明与校验同源：numRow / numField 从这里取 min / max / step，提交时也用它校验。
   kind    "int" 只收整数 / "dec" 收小数
   min/max 允许区间，越界一律不接受
   step    小数必须落在步长的整数倍上（0.05 即两位小数里 5 的倍数）
   hint    给用户看的合法格式说明，自动拼到设置项说明后面 */
var NUMS = {
  newPerDay: { label: "每日新词上限", kind: "int", min: 1, max: 500, hint: "1 – 500 的整数" },
  revPerDay: { label: "每日复习上限", kind: "int", min: 10, max: 2000, hint: "10 – 2000 的整数" },
  dailyGoal: { label: "每日打卡目标", kind: "int", min: 5, max: 1000, hint: "5 – 1000 的整数" },
  optCount: { label: "选择题选项数", kind: "int", min: 2, max: 6, hint: "2 – 6 的整数" },
  fontSize: { label: "界面字号", kind: "int", min: 12, max: 20, hint: "12 – 20 的整数" },
  rate: { label: "语速", kind: "dec", min: 0.5, max: 1.5, step: 0.05, hint: "0.50 – 1.50，两位小数" },
  "initSteps.2": { label: "首次-认识", kind: "int", min: 1, max: 1440, hint: "1 – 1440 分钟，整数" },
  "initSteps.3": { label: "首次-秒懂", kind: "int", min: 1, max: 2880, hint: "1 – 2880 分钟，整数" },
  "secondSteps.2": { label: "二次-认识", kind: "int", min: 10, max: 10080, hint: "10 – 10080 分钟，整数" },
  easeStart: { label: "难度系数起始", kind: "dec", min: 1.3, max: 3, step: 0.05, hint: "1.30 – 3.00，两位小数" },
  easeMin: { label: "难度系数下限", kind: "dec", min: 1.1, max: 2.5, step: 0.05, hint: "1.10 – 2.50，两位小数" },
  easeMax: { label: "难度系数上限", kind: "dec", min: 2.5, max: 5, step: 0.05, hint: "2.50 – 5.00，两位小数" },
  maxDays: { label: "最大间隔", kind: "int", min: 30, max: 3650, hint: "30 – 3650 天，整数" },
  masterDays: { label: "掌握判定", kind: "int", min: 7, max: 365, hint: "7 – 365 天，整数" },
  readMaxWords: { label: "单篇词数上限", kind: "int", min: 150, max: 3000, hint: "150 – 3000 的整数" },
  readQuizN: { label: "读后练习题量", kind: "int", min: 3, max: 12, hint: "3 – 12 的整数" }
};
function numSpec(key) { return NUMS[key] || { label: key, kind: "int", min: 0, max: Infinity, hint: "数字" }; }

/* 严格解析：只有格式正确且在区间内的数值才返回数字，其余一律 null（调用方回滚）
   注意 Number("") === 0，所以绝对不能只靠 isNaN 判断 —— 空值必须显式判为非法。 */
function parseNum(raw, spec) {
  if (raw === null || raw === undefined) return null;
  var s = String(raw)
    .replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })  /* 全角数字 → 半角 */
    .replace(/[．。]/g, ".").replace(/[，,]/g, ".")
    .replace(/[\s\u00a0]/g, "");
  if (!/^\+?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;      /* 只认纯数值：拒 12abc / 1e5 / --1 / 空串 */
  var n = Number(s);
  if (!isFinite(n)) return null;
  if (spec.kind === "int" && n % 1 !== 0) return null;        /* 整数格不接受小数 */
  if (spec.step) {
    var q = n / spec.step;
    if (Math.abs(q - Math.round(q)) > 1e-9) return null;      /* 不是步长整数倍 → 非法 */
    n = Number((Math.round(q) * spec.step).toFixed(6));
  }
  if (n < spec.min || n > spec.max) return null;              /* 越界同样不接受 */
  return n;
}
function fmtNumInput(v, spec) { return spec.kind === "dec" ? String(Number(Number(v).toFixed(4))) : String(v); }

function vSettings() {
  var c = cfg();
  var h = '<div class="study-wrap">';

  h += '<div class="card"><div class="card-h"><h2>学习计划</h2><span class="hint">决定每天的量</span></div>' +
    numRow("每日新词上限", "newPerDay", "一天最多学多少个没见过的词") +
    numRow("每日复习上限", "revPerDay", "一天最多复习多少个到期词") +
    numRow("每日打卡目标", "dailyGoal", "达到这个测评次数就算打卡成功") +
    numRow("选择题选项数", "optCount", "看词选义 / 看义选词的干扰项数量") +
    '<div class="setrow"><div class="setrow-t"><b>学习顺序</b><span>学哪些词不变，先学哪个每轮重新排；「智能随机」让遗忘风险高的仍然更靠前</span></div><div class="seg">' +
    [["smart", "智能随机"], ["random", "完全随机"], ["order", "固定顺序"]].map(function (o) {
      return '<button data-order="' + o[0] + '"' + (c.queueOrder === o[0] ? ' class="on"' : "") + ">" + o[1] + "</button>";
    }).join("") + "</div></div>" +
    '<div class="setrow"><div class="setrow-t"><b>启用题型</b><span>学习时会轮换这些题型（按卡片顺序循环）</span></div></div>' +
    '<div class="row wrap" style="gap:8px;padding-bottom:6px">' +
    MODES.map(function (m) {
      var on = c.activeModes.indexOf(m[0]) >= 0;
      return '<button class="btn sm' + (on ? " primary" : "") + '" data-mode="' + m[0] + '">' + m[1] + "</button>";
    }).join("") + "</div>" +
    '<div class="tiny faint" style="padding-bottom:8px">' +
    esc("后两种题型有前置条件：听音辨词需要设备上有英语语音，例句填空需要该词条收了例句。") +
    "<br>" +
    esc("不满足时不会卡住 —— 这一张自动顺延到下一个能做的题型，并会告诉你跳过原因。") +
    "</div></div>";

  /* 考试倒计时：把「每天学多少」从拍脑袋变成倒推。
     日期输入用 type="text" 而不是 type="date" —— 后者在安卓 WebView 里表现不一致，
     而且中文环境下占位符会跟着系统语言变；text + 自己校验，行为完全可控。 */
  var epv = examPlan();
  h += '<div class="card"><div class="card-h"><h2>考试倒计时</h2><span class="hint">由截止日期倒推每天要学多少</span></div>' +
    '<div class="setrow"><div class="setrow-t"><b>考试日期</b><span id="setExamDateMsg">格式 YYYY-MM-DD，例如 2026-12-19；留空即关闭倒计时</span></div>' +
    '<input type="text" id="setExamDate" class="rin" style="width:150px;flex:0 0 auto" maxlength="10" autocomplete="off" spellcheck="false" placeholder="YYYY-MM-DD" value="' + esc(c.examDate || "") + '">' +
    "</div>" +
    '<div class="setrow"><div class="setrow-t"><b>目标词书</b><span>按这本词书算「还剩多少词」</span></div>' +
    '<select id="setExamBook">' +
    '<option value=""' + (!c.examBook ? " selected" : "") + ">跟随当前词书</option>" +
    BOOKS.map(function (b) {
      return '<option value="' + esc(b.id) + '"' + (c.examBook === b.id ? " selected" : "") + ">" + esc(b.name) + "</option>";
    }).join("") + "</select></div>" +
    '<div class="row wrap" style="gap:9px;margin-top:12px">' +
    '<button class="btn" id="setExamApply">把每日新词上限设为建议值</button>' +
    '<span class="tiny faint" id="setExamHint">' + esc(epv
      ? (epv.days > 0
        ? "距 " + epv.date + " 还有 " + epv.days + " 天，" + epv.name + " 剩 " + fmtNum(epv.remain) + " 词 → 建议每天 " + epv.need + " 词（当前 " + epv.cur + "）"
        : "考试日期已过，改一个将来的日期才会出现倒计时")
      : "还没设考试日期") + "</span></div></div>";

  h += '<div class="card"><div class="card-h"><h2>记忆算法</h2><span class="hint">进阶：改完对新测评生效</span></div>' +
    '<div class="grid g2">' +
    numField("首次-认识(分钟)", "initSteps.2", c.initSteps[2], "第一次答「认识」后隔多久再见") +
    numField("首次-秒懂(分钟)", "initSteps.3", c.initSteps[3], "第一次答「秒懂」后隔多久再见") +
    numField("二次-认识(分钟)", "secondSteps.2", c.secondSteps[2], "第二次答「认识」的间隔") +
    numField("难度系数起始", "easeStart", c.easeStart, "默认 2.5，越大间隔涨得越快") +
    numField("难度系数下限", "easeMin", c.easeMin, "低于此值不再下降") +
    numField("难度系数上限", "easeMax", c.easeMax, "高于此值不再上升") +
    numField("最大间隔(天)", "maxDays", c.maxDays, "间隔封顶，避免再也不复习") +
    numField("掌握判定(天)", "masterDays", c.masterDays, "间隔达到此天数即视为已掌握") +
    "</div>" +
    '<div class="row" style="margin-top:6px;gap:9px"><button class="btn" id="setAlgoReset">恢复算法默认值</button>' +
    '<span class="tiny faint">当前：错误 ' + c.gradeMul[0] + "x · 模糊 " + c.gradeMul[1] + "x · 认识 " + c.gradeMul[2] + "x · 秒懂 " + c.gradeMul[3] + "x</span></div></div>";

  h += '<div class="card"><div class="card-h"><h2>外观</h2></div>' +
    '<div class="setrow"><div class="setrow-t"><b>配色主题</b><span>浅色与深色主题都在这里</span></div></div>' +
    '<div class="row wrap" style="gap:8px;padding-bottom:10px">' +
    THEMES.map(function (t) {
      return '<button class="btn sm' + (c.theme === t[0] ? " primary" : "") + '" data-theme-pick="' + t[0] + '">' + t[1] + "</button>";
    }).join("") + "</div>" +
    '<div class="setrow"><div class="setrow-t"><b>深色模式</b><span>也可直接点右上角月亮按钮</span></div><label class="switch"><input type="checkbox" id="setDark"' + (c.mode === "dark" ? " checked" : "") + "><i></i></label></div>" +
    '<div class="setrow"><div class="setrow-t"><b>单词字体</b><span>卡片上大字的字体</span></div><div class="seg">' +
    [["sans", "无衬线"], ["serif", "衬线"], ["mono", "等宽"]].map(function (f) { return '<button data-font="' + f[0] + '"' + (c.wordFont === f[0] ? ' class="on"' : "") + ">" + f[1] + "</button>"; }).join("") + "</div></div>" +
    numRow("界面字号 (px)", "fontSize", "整体缩放") +
    "</div>";

  h += '<div class="card"><div class="card-h"><h2>卡片显示项</h2><span class="hint">不想要的关掉更清爽</span></div>' +
    swRow("显示音标", "showPhonetic", "美式 / 英式音标与发音按钮") +
    swRow("显示英文释义", "showEn", "来自权威词典的英文解释") +
    swRow("显示例句", "showEx", "带高亮的真实用例") +
    swRow("显示常用搭配", "showPh", "固定搭配与短语") +
    swRow("显示词形变化", "showForms", "过去式 / 复数 / 比较级") +
    swRow("显示词根词缀", "showRt", "帮助联想记忆") +
    swRow("显示巧记", "showMnemo", "拆词 · 同族词 · 词源 · 近反义联想（卡片最后一栏）") +
    swRow("显示词性", "showPos", "名词 / 动词 / 形容词等") +
    swRow("显示同义词", "showSyn", "WordNet 词网同义表达") +
    swRow("显示反义词", "showAnt", "对照记忆，强化边界") +
    swRow("显示近义词辨析", "showDis", "一组易混词之间的区别") +
    swRow("显示词频星级", "showFreq", "柯林斯星级 / BNC / COCA") +
    swRow("默认遮盖释义", "blurDef", "卡片模式先猜再看") +
    "</div>";

  h += '<div class="card"><div class="card-h"><h2>发音</h2></div>' +
    '<div class="setrow"><div class="setrow-t"><b>朗读口音</b><span>使用系统内置语音，完全离线</span></div><div class="seg">' +
    [["us", "美音"], ["uk", "英音"]].map(function (a) { return '<button data-accent="' + a[0] + '"' + (c.accent === a[0] ? ' class="on"' : "") + ">" + a[1] + "</button>"; }).join("") + "</div></div>" +
    '<div class="setrow"><div class="setrow-t"><b>自动朗读</b><span>卡片出现时自动读一遍</span></div><label class="switch"><input type="checkbox" id="setAuto"' + (c.autoSpeak ? " checked" : "") + "><i></i></label></div>" +
    numRow("语速", "rate", "0.95 接近正常语速") +
    '<div class="row" style="gap:9px"><button class="btn" id="setTestVoice">试听</button><span class="tiny faint">若没有声音，说明系统未安装英语语音包</span></div></div>';

  /* 精读是应用里唯一联网的模块，所以开关、门槛、以及「到底会不会发请求」都摆在这一节讲清楚 */
  h += '<div class="card"><div class="card-h"><h2>文章精读</h2><span class="hint">唯一联网的模块</span></div>' +
    '<div class="setrow"><div class="setrow-t"><b>允许联网取文</b><span>关掉后「发现」页一个请求都不发；已经取回本地的文章仍可离线精读</span></div>' +
    '<label class="switch"><input type="checkbox" id="setNet"' + (c.netOff ? "" : " checked") + "><i></i></label></div>" +
    '<div class="setrow"><div class="setrow-t"><b>生词门槛</b><span>低于这一档的常见词不在正文里标记，免得满篇都是下划线；门槛以上的词只要还没学过就标出来</span></div><div class="seg">' +
    /* 键名 = 词书 id = 全称，三者统一，少一层映射就少一个「对不上」的坑 */
    [["gaokao", "高考"], ["cet4", "四级"], ["cet6", "六级"], ["kaoyan", "考研"]].map(function (o) {
      return '<button data-rgate="' + o[0] + '"' + (c.readNewFrom === o[0] ? ' class="on"' : "") + ">" + o[1] + "</button>";
    }).join("") + "</div></div>" +
    '<div class="setrow"><div class="setrow-t"><b>默认辅助档位</b><span>打开一篇文章时先进入哪一档，阅读中随时可切</span></div><div class="seg">' +
    [0, 1, 2, 3].map(function (i) {
      return '<button data-rassist="' + i + '"' + (c.readAssist === i ? ' class="on"' : "") + ">" + assistName(i) + "</button>";
    }).join("") + "</div></div>" +
    numRow("单篇词数上限", "readMaxWords", "一篇文章最多收录多少个词，超出的按完整段落截断") +
    numRow("读后练习题量", "readQuizN", "每类练习最多出几题") +
    '<div class="setrow"><div class="setrow-t"><b>卫报 API Key</b><span>选填。到 open-platform.theguardian.com 免费申请一个，填了才能用卫报作为文章来源</span></div>' +
    '<input type="text" class="rin" id="setGdKey" style="width:190px;flex:0 0 auto" placeholder="留空则不用" value="' + esc(c.guardianKey || "") + '"></div>' +
    /* 为什么需要中转：能不能读到一个网页，和「这个网页通不通」是两件事。
       中国日报的栏目页放行跨域、文章页不放行 —— 页面明明能打开，浏览器却读不到内容。
       开着这个，直连失败时会再借一个公共中转服务把内容取回来。
       只传一个公开文章的地址，不含任何学习数据；关掉就退回纯直连。 */
    '<div class="setrow"><div class="setrow-t"><b>中转取文</b><span>有些源（如中国日报正文）能打开、但不允许浏览器直读，开着它才能取回。只传文章地址，不含任何学习数据；关掉则退回纯直连</span></div>' +
    '<label class="switch"><input type="checkbox" id="setBridge"' + (c.noBridge ? "" : " checked") + "><i></i></label></div>" +
    '<div class="row wrap" style="gap:9px">' +
    '<button class="btn" id="setNetTest">测一下现在能连上哪些源</button>' +
    '<button class="btn ghost" id="setNetGo">去精读页</button>' +
    '<span class="tiny faint">取文只走 GET，不带凭据、不发送来源页，也没有任何上传通道</span>' +
    "</div></div>";

  h += '<div class="card"><div class="card-h"><h2>数据</h2><span class="hint">全部存在本机，不联网</span></div>' +
    '<div class="grid g3 keep" style="margin-bottom:12px">' +
    statCard("学习记录", fmtNum(Object.keys(DB.prog).length), "词", "有测评记录") +
    statCard("打卡天数", fmtNum(Object.keys(DB.log).length), "天", "累计") +
    statCard("存储占用", bytes(JSON.stringify(DB).length), "", storageOK ? "localStorage 正常" : "写入异常！") +
    "</div>" +
    '<div class="row wrap" style="gap:9px">' +
    '<button class="btn primary" id="setExport"><svg><use href="#i-down"/></svg>导出全部数据</button>' +
    '<button class="btn" id="setImport"><svg><use href="#i-up"/></svg>导入备份</button>' +
    '<button class="btn" id="setExportCsv"><svg><use href="#i-down"/></svg>导出学习记录 CSV</button>' +
    "</div>" +
    '<div class="row wrap" style="gap:9px;margin-top:10px">' +
    '<button class="btn danger" id="setResetProg">清空学习进度</button>' +
    '<button class="btn danger" id="setFactory">恢复出厂设置</button>' +
    "</div>" +
    '<div class="tiny faint" style="margin-top:12px;line-height:1.8">导出文件包含全部学习进度、自定义词书与设置，换电脑时导入即可无缝接续。</div>' +
    "</div>";

  h += '<div class="card"><div class="card-h"><h2>快捷键</h2></div>' +
    '<table class="tbl"><tbody>' +
    [["1 / 2 / 3 / 4", "评价：忘记 / 模糊 / 认识 / 秒懂"], ["空格", "揭晓释义（卡片模式）"], ["Enter", "确认 / 下一张"], ["↑ / ↓", "同一个词内滚动"],
    ["S", "慢速朗读当前单词"], ["F", "收藏 / 取消收藏当前单词"], ["Esc", "关闭弹窗 / 跳转页返回 / 结束本轮"]].map(function (k) {
      return "<tr><td style='width:130px'><span class='tag mono'>" + esc(k[0]) + "</span></td><td class='muted'>" + esc(k[1]) + "</td></tr>";
    }).join("") + "</tbody></table></div>";

  h += '<div class="card"><div class="card-h"><h2>关于</h2></div>' +
    '<div class="tiny muted" style="line-height:1.9">' +
    "<b>词匠 WordForge</b> · 单文件离线背单词应用<br>" +
    "收录 " + fmtNum(WORDS.length) + " 个词条 / " + BOOKS.length + " 本内置词书 / " + ROOTS.length + " 条词根词缀。<br>" +
    "词条数据来自开源词库 <b>ECDICT</b>（MIT）与 <b>qwerty-learner</b> 词书（GPL-3.0），例句与释义版权归原作者所有。<br>" +
    "四六级词表按公开的四六级考纲词表补全（四级 4,958 词 / 六级 6,975 词，六级已含四级全部），<b>六级词书 = 四级全部 + 六级新增</b>，可一键只看新增词。<br>" +
    "巧记覆盖 " + fmtNum(WORDS.filter(function (x) { return x[F.MN]; }).length) + " 个词条，拆词 / 同族 / 词源全部由 <b>ECDICT 官方词根库</b>（MIT）与词表内部共现推导，不含任何臆造内容。<br>" +
    /* 这段承诺必须与事实一致：精读模块确实会联网，所以不能再写「不联网」。
       写清楚「唯一联网的是精读、可以一键关掉、关掉后一个请求都不发」，比含糊其辞更可信。 */
    "背单词的数据全部保存在你自己浏览器的 localStorage 里，不上传、可随时导出带走。<br>" +
    "唯一的联网模块是<b>文章精读</b> —— 它只从白名单内的公开站点（维基媒体、维基文库、卫报开放平台）取文章，" +
    "请求只发 GET、不带凭据、不发来源页，也没有任何上传通道；在「设置 → 文章精读」里可以一键关闭，" +
    "<b>关掉之后整个应用一个请求都不会发</b>。" +
    "</div></div>";

  h += "</div>";
  return h;
}
/* 输入框本体：约束（区间 / 步长 / 整数或小数）全部来自 NUMS，界面与校验永远同源。
   用 type="text" + inputmode 而不是 type="number"：number 会把全角数字「１２０」和中文
   逗号直接吞掉（value 变空串），用户看不到任何反馈；text 则能接住再规范化，并给出提示。 */
function numInput(key, v, narrow) {
  var sp = numSpec(key);
  return '<input type="text" class="numin" data-num="' + esc(key) + '" value="' + esc(fmtNumInput(v, sp)) + '"' +
    ' inputmode="' + (sp.kind === "dec" ? "decimal" : "numeric") + '"' +
    ' maxlength="9" autocomplete="off" spellcheck="false"' +
    (narrow ? ' style="width:104px"' : "") +
    ' title="' + esc(sp.label + "：只接受 " + (sp.hint || "数字")) + '">';
}
function numRow(label, key, desc) {
  var sp = numSpec(key);
  return '<div class="setrow"><div class="setrow-t"><b>' + esc(label) + "</b><span>" + esc(desc) +
    (sp.hint ? "（" + esc(sp.hint) + "）" : "") + "</span></div>" + numInput(key, cfg()[key], true) + "</div>";
}
function numField(label, key, v, desc) {
  var sp = numSpec(key);
  return '<label class="fld"><span>' + esc(label) + "</span>" + numInput(key, v, false) +
    '<div class="desc">' + esc(desc) + (sp.hint ? "（" + esc(sp.hint) + "）" : "") + "</div></label>";
}
function swRow(label, key, desc) {
  return '<div class="setrow"><div class="setrow-t"><b>' + esc(label) + "</b><span>" + esc(desc) + "</span></div>" +
    '<label class="switch"><input type="checkbox" data-sw="' + key + '"' + (cfg()[key] ? " checked" : "") + "><i></i></label></div>";
}
/* 数值输入绑定。
   三条铁律，缺一条就会变成「输不进去 / 光标乱跳」：
     1. 输入过程中（oninput）只清错误态，绝不写配置、绝不重绘；
     2. 提交只在失焦 / 回车时发生，提交后**不再 render()** —— 整页 innerHTML 重建会把
        输入框连同焦点一起销毁，activeElement 掉回 body，用户表现为「光标跑到卡片标题上」；
     3. 格式不合法就回滚到「设置前的值」，并标红 + 说明合法区间，不写进配置。 */
function bindNumInputs() {
  document.querySelectorAll("input[data-num]").forEach(function (el) {
    var key = el.getAttribute("data-num"), sp = numSpec(key);
    el.__last = el.value;                                   /* 设置前状态，回滚用 */
    el.oninput = function () { el.classList.remove("bad", "ok"); clearBad(el); };
    el.onwheel = function (e) { e.preventDefault(); };      /* 防止滚动页面时被滚轮改掉数值 */
    el.onkeydown = function (e) {
      if (e.key === "Enter") { e.preventDefault(); el.blur(); }                       /* 回车即提交 */
      else if (e.key === "Escape") { el.value = el.__last; el.classList.remove("bad", "ok"); clearBad(el); el.blur(); }
    };
    el.onblur = function () { commitNum(el, key, sp); };
  });
}
/* 每个数值框旁边的说明元素（numRow 在 .setrow-t span，numField 在 .desc）——
   校验失败时把说明临时替换成红色错误文案，比一闪而过的 toast 更容易看见。 */
function descOf(el) {
  var p = el.parentNode;
  if (!p || !p.querySelector) return null;
  return p.querySelector(".desc") || p.querySelector(".setrow-t span");
}
function markBad(el, sp) {
  el.classList.add("bad");
  var d = descOf(el);
  if (!d) return;
  if (d._wfOrig === undefined) d._wfOrig = d.textContent;
  d.textContent = "⚠ 只接受 " + (sp.hint || "数字") + "，已恢复原值";
  d.classList.add("warn");
}
function clearBad(el) {
  var d = descOf(el);
  if (d && d._wfOrig !== undefined) { d.textContent = d._wfOrig; d._wfOrig = undefined; d.classList.remove("warn"); }
}
function commitNum(el, key, sp) {
  var v = parseNum(el.value, sp);
  if (v === null) {                                         /* 格式错 / 越界 → 恢复设置前状态 */
    el.value = el.__last;
    markBad(el, sp);
    toast("「" + sp.label + "」只接受 " + (sp.hint || "数字") + "，已恢复原值", "bad");
    return;
  }
  clearBad(el);
  var s = fmtNumInput(v, sp);
  el.value = s; el.__last = s;
  var path = key.split(".");
  if (path.length === 2) cfg()[path[0]][Number(path[1])] = v;
  else cfg()[path[0]] = v;
  save(true);
  if (key === "fontSize") applyTheme();                     /* 字号要立刻可见 */
  el.classList.add("ok");
  setTimeout(function () { el.classList.remove("ok"); }, 700);
}
/* 「恢复算法默认值」后把输入框就地回填，同样不重绘 */
function syncNumInputs() {
  document.querySelectorAll("input[data-num]").forEach(function (el) {
    var path = el.getAttribute("data-num").split(".");
    var v = path.length === 2 ? cfg()[path[0]][Number(path[1])] : cfg()[path[0]];
    el.value = fmtNumInput(v, numSpec(el.getAttribute("data-num")));
    el.__last = el.value;
    el.classList.remove("bad", "ok");
    clearBad(el);
  });
}
/* 分段按钮 / 色板按钮的统一就地高亮，避免整页重绘 */
function pickInGroup(sel, attr, val, cls) {
  document.querySelectorAll(sel).forEach(function (b) {
    b.classList.toggle(cls, b.getAttribute(attr) === val);
  });
}
function bindSettings() {
  bindNumInputs();
  document.querySelectorAll("[data-sw]").forEach(function (el) {
    el.onchange = function () { cfg()[el.getAttribute("data-sw")] = el.checked; save(true); };
  });
  /* 以下按钮全部改成「就地切换高亮」，不再 render()：
     设置页整页重绘会把正在编辑的输入框连同焦点一起销毁。 */
  document.querySelectorAll("[data-mode]").forEach(function (b) {
    b.onclick = function () {
      var m = b.getAttribute("data-mode"), c = cfg();
      var i = c.activeModes.indexOf(m);
      if (i >= 0) { if (c.activeModes.length <= 1) { toast("至少保留一种题型", "bad"); return; } c.activeModes.splice(i, 1); }
      else c.activeModes.push(m);
      b.classList.toggle("primary", c.activeModes.indexOf(m) >= 0);
      save(true);
    };
  });
  document.querySelectorAll("[data-theme-pick]").forEach(function (b) {
    b.onclick = function () {
      cfg().theme = b.getAttribute("data-theme-pick");
      applyTheme(); pickInGroup("[data-theme-pick]", "data-theme-pick", cfg().theme, "primary"); save(true);
    };
  });
  document.querySelectorAll("[data-font]").forEach(function (b) {
    b.onclick = function () {
      cfg().wordFont = b.getAttribute("data-font");
      applyTheme(); pickInGroup("[data-font]", "data-font", cfg().wordFont, "on"); save(true);
    };
  });
  document.querySelectorAll("[data-accent]").forEach(function (b) {
    b.onclick = function () {
      cfg().accent = b.getAttribute("data-accent");
      pickInGroup("[data-accent]", "data-accent", cfg().accent, "on"); save(true);
    };
  });
  document.querySelectorAll("[data-order]").forEach(function (b) {
    b.onclick = function () {
      cfg().queueOrder = b.getAttribute("data-order");
      PQ = null;                    /* 换策略立刻重新洗牌 */
      pickInGroup("[data-order]", "data-order", cfg().queueOrder, "on");
      save(true);
      toast("学习顺序：" + orderName(cfg().queueOrder), "ok");
    };
  });
  /* 精读设置：门槛与档位都是「就地切换 + 存储」，跟上面一样不重绘整页 */
  document.querySelectorAll("[data-rgate]").forEach(function (b) {
    b.onclick = function () {
      cfg().readNewFrom = b.getAttribute("data-rgate");
      pickInGroup("[data-rgate]", "data-rgate", cfg().readNewFrom, "on");
      RA = null;                    /* 门槛变了，已经算好的画像作废 */
      save(true);
      toast("生词门槛：读到 " + lvlName(cfg().readNewFrom) + " 及以上算生词", "ok");
    };
  });
  document.querySelectorAll("[data-rassist]").forEach(function (b) {
    b.onclick = function () {
      cfg().readAssist = Number(b.getAttribute("data-rassist"));
      pickInGroup("[data-rassist]", "data-rassist", String(cfg().readAssist), "on");
      save(true);
      toast("默认辅助档位：" + assistName(cfg().readAssist), "ok");
    };
  });
  var nt = $("setNet");
  if (nt) nt.onchange = function () {
    cfg().netOff = !nt.checked; save(true);
    toast(nt.checked ? "已允许联网取文" : "已关闭联网 —— 精读「发现」页不会再发任何请求", nt.checked ? "ok" : "info");
  };
  var gk = $("setGdKey");
  if (gk) gk.onblur = function () { cfg().guardianKey = (gk.value || "").replace(/^\s+|\s+$/g, ""); save(true); };
  var br = $("setBridge");
  if (br) br.onchange = function () {
    cfg().noBridge = !br.checked; save(true);
    toast(br.checked ? "已允许中转取文" : "已关闭中转 —— 只走直连，部分源（如中国日报正文）会取不到", br.checked ? "ok" : "info");
  };
  var ntt = $("setNetTest");
  if (ntt) ntt.onclick = function () {
    ntt.textContent = "测试中…"; ntt.disabled = true;
    netSelfTest(function (res) {
      ntt.textContent = "测一下现在能连上哪些源"; ntt.disabled = false;
      var ok = 0, tot = 0, k;
      for (k in res) if (Object.prototype.hasOwnProperty.call(res, k)) { tot++; if (res[k].ok) ok++; }
      toast(ok + " / " + tot + " 个源可达（明细在精读页顶部）", ok > 0 ? "ok" : "bad");
    });
  };
  var ng = $("setNetGo"); if (ng) ng.onclick = function () { go("read"); };
  var dk = $("setDark"); if (dk) dk.onchange = function () { cfg().mode = dk.checked ? "dark" : "light"; applyTheme(); save(true); };

  /* 考试倒计时。日期校验沿用数值输入那套纪律：
       · 输入过程中只清错误态，不写配置；
       · 提交只发生在失焦 / 回车；
       · 格式不合法就回滚原值 + 标红 + 在说明里写清合法格式。
     ⚠ 提交后**故意不调 render()**：整页重绘会把这些输入框和按钮全部销毁重建，
       而「点『设为建议值』按钮」这个动作会先触发日期框 blur —— 一 render，
       mousedown 已经发生、mouseup 却落在新元素上，点击就永远不会到达按钮。
       所以只就地刷新提示文字，页面重绘留给下次导航。 */
  var refreshExamHint = function () {
    var el = $("setExamHint");
    if (!el) return;
    var p = examPlan();
    el.textContent = p
      ? (p.days > 0
        ? "距 " + p.date + " 还有 " + p.days + " 天，" + p.name + " 剩 " + fmtNum(p.remain) + " 词 → 建议每天 " + p.need + " 词（当前 " + p.cur + "）"
        : "考试日期已过，改一个将来的日期才会出现倒计时")
      : "还没设考试日期";
  };
  var ed = $("setExamDate");
  if (ed) {
    var edBase = "格式 YYYY-MM-DD，例如 2026-12-19；留空即关闭倒计时";
    var edMsg = function (txt, bad) {
      var m = $("setExamDateMsg");
      if (m) { m.textContent = txt; m.className = bad ? "badtxt" : ""; }
      ed.classList.remove("bad", "ok");
      if (bad) ed.classList.add("bad");
    };
    ed.__last = ed.value;
    ed.oninput = function () { ed.classList.remove("bad", "ok"); };
    ed.onwheel = function (e) { e.preventDefault(); };
    ed.onkeydown = function (e) {
      if (e.key === "Enter") { e.preventDefault(); ed.blur(); }
      else if (e.key === "Escape") { ed.value = ed.__last; edMsg(edBase, false); ed.blur(); }
    };
    ed.onblur = function () {
      var v = String(ed.value || "").replace(/^\s+|\s+$/g, "");
      /* 空串是合法值（= 关闭倒计时），不能当成格式错误拦下来 */
      if (v === "") { cfg().examDate = ""; ed.__last = ""; edMsg(edBase, false); save(true); refreshExamHint(); return; }
      if (!isoDateOK(v)) {
        ed.value = ed.__last;
        edMsg("⚠ 只接受真实存在的 YYYY-MM-DD 日期，已恢复原值（当前 " + (ed.__last || "未设置") + "）", true);
        return;
      }
      cfg().examDate = v; ed.__last = v; edMsg(edBase, false); save(true); refreshExamHint();
    };
  }
  var eb = $("setExamBook");
  if (eb) eb.onchange = function () {
    cfg().examBook = eb.value || "";
    save(true); refreshExamHint();
    toast(eb.value ? "目标词书已切换" : "目标词书：跟随当前词书", "ok");
  };
  var ea = $("setExamApply");
  if (ea) ea.onclick = function () {
    var p = examPlan();
    if (!p) { toast("先填一个考试日期", "bad"); return; }
    if (p.days <= 0) { toast("考试日期已过，改一个将来的日期", "bad"); return; }
    if (p.remain === 0) { toast("这本词书已经学完了，不需要调", "info"); return; }
    /* 上限必须跟 NUMS 的约束一致（1–500），否则会写进一个设置页自己都拒绝的值 */
    var lim = numSpec("newPerDay");
    var val = clamp(p.need, lim.min, lim.max);
    cfg().newPerDay = val;
    save(true);
    var inp = document.querySelector('input[data-num="newPerDay"]');
    if (inp) { inp.value = String(val); inp.__last = String(val); inp.classList.add("ok"); }
    refreshExamHint();
    toast(val === p.need
      ? "每日新词上限已设为 " + val + " 词 —— 按 " + p.days + " 天倒推"
      : "建议值 " + p.need + " 超过上限，已取最大值 " + val + " 词（这本词书在考前学不完）",
      val === p.need ? "ok" : "info");
  };
  var au = $("setAuto"); if (au) au.onchange = function () { cfg().autoSpeak = au.checked; save(true); };
  var tv = $("setTestVoice"); if (tv) tv.onclick = function () { speak("vocabulary"); };
  var ar = $("setAlgoReset"); if (ar) ar.onclick = function () {
    var c = cfg();
    ["initSteps", "secondSteps", "easeDelta", "gradeMul"].forEach(function (k) { c[k] = CFG_DEF[k].slice(); });
    ["easeStart", "easeMin", "easeMax", "maxDays", "masterDays"].forEach(function (k) { c[k] = CFG_DEF[k]; });
    save(true); syncNumInputs(); toast("算法参数已恢复默认", "ok");
  };
  var ex = $("setExport"); if (ex) ex.onclick = function () {
    download("词匠备份-" + todayKey() + ".json", JSON.stringify({ app: "wordforge", v: 1, exported: now(), data: DB }, null, 1));
    toast("已导出备份文件", "ok");
  };
  var im = $("setImport"); if (im) im.onclick = function () {
    pickFile(".json", function (text) {
      try {
        var j = JSON.parse(text);
        var d = j && j.data ? j.data : j;
        if (!d || !d.cfg) throw new Error("不是词匠备份文件");
        DB = d;
        var b = blankDB();
        for (var k in b) if (!(k in DB)) DB[k] = b[k];
        for (var ck in CFG_DEF) if (!(ck in DB.cfg)) DB.cfg[ck] = CFG_DEF[ck];
        buildIndex(); TAGS = {}; BOWN = {}; applyTheme(); save(true); render();
        toast("导入成功", "ok");
      } catch (e) { toast("导入失败：" + e.message, "bad"); }
    });
  };
  var ec = $("setExportCsv"); if (ec) ec.onclick = function () {
    var rows = ["word,cn,strength,interval_days,reps,correct,wrong,status,due"];
    for (var w in DB.prog) {
      if (!Object.prototype.hasOwnProperty.call(DB.prog, w)) continue;
      var p = DB.prog[w], r = rec(w);
      rows.push([w, '"' + String(r ? firstDef(r) : "").replace(/"/g, "'") + '"', strength(p), (p[N.I] / 1440).toFixed(1), p[N.REPS], p[N.OK], p[N.NO], p[N.ST], fmtDate(p[N.DUE])].join(","));
    }
    download("词匠学习记录-" + todayKey() + ".csv", "\uFEFF" + rows.join("\n"), "text/csv;charset=utf-8");
    toast("已导出学习记录", "ok");
  };
  var rp = $("setResetProg"); if (rp) rp.onclick = function () {
    openModal("清空学习进度？", "<p class='muted'>所有单词的记忆曲线、答题记录、打卡热力图都会归零。<b>自定义词书会保留。</b>此操作不可撤销。</p>",
      '<button class="btn" id="mNo">取消</button><button class="btn danger" id="mYes">确认清空</button>',
      function () {
        $("mNo").onclick = closeModal;
        $("mYes").onclick = function () { DB.prog = {}; DB.log = {}; DB.wlog = {}; DB.mk = {}; DB.sessions = []; TAGS = {}; BOWN = {}; save(true); closeModal(); render(); toast("学习进度已清空", "ok"); };
      });
  };
  var ff = $("setFactory"); if (ff) ff.onclick = function () {
    openModal("恢复出厂设置？", "<p class='muted'>会删除<b>全部</b>数据，包括学习进度和自定义词书。建议先导出备份。</p>",
      '<button class="btn" id="mNo">取消</button><button class="btn danger" id="mYes">全部删除</button>',
      function () {
        $("mNo").onclick = closeModal;
        $("mYes").onclick = function () { DB = blankDB(); buildIndex(); TAGS = {}; BOWN = {}; applyTheme(); save(true); closeModal(); go("today"); toast("已恢复出厂设置", "ok"); };
      });
  };
}

/* ---------- 19. 键盘 ---------- */
function onKey(e) {
  var tag = (e.target && e.target.tagName) || "";
  var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (e.key === "Escape") {
    if ($("mask").classList.contains("on")) { closeModal(); return; }
    if (JSTACK.length) { jumpBack(); return; }
    if (S) { S = null; go("today"); return; }
  }
  if (typing) return;
  /* 跳转页里只认 Esc（返回），不要顺手把 1-4 / 空格 打到背后的学习会话上 */
  if (JSTACK.length) return;
  if (Q && Q.qs && Q.i < Q.qs.length) {
    if (e.key === "Enter") { e.preventDefault(); if (Q.answered) { Q.i++; renderQuizQ(); } return; }
    if (/^[1-9]$/.test(e.key) && !Q.answered && Q.opts) { var i2 = Number(e.key) - 1; if (i2 < Q.opts.length) { Q.picked = i2; quizAnswer(i2); } }
    return;
  }
  if (!S || S.i >= S.queue.length) return;
  var r = curWord();
  if (!r) return;
  if (/^[1-4]$/.test(e.key)) { S.pending = Number(e.key) - 1; if (S.answered) { refreshGradeHost(); document.querySelectorAll(".gbtn").forEach(function (b) { b.style.borderColor = Number(b.getAttribute("data-g")) === S.pending ? "currentColor" : ""; }); } return; }
  if (e.key === " " || e.key === "Spacebar") {
    e.preventDefault();
    if (!S.answered) { S.revealed = true; S.answered = true; S.pending = null; renderSession(); }
    else commitAndNext();
    return;
  }
  if (e.key === "Enter") { e.preventDefault(); if (S.answered) commitAndNext(); return; }
  if (e.key === "s" || e.key === "S") { speak(r[F.W]); return; }
  if (e.key === "f" || e.key === "F") { toggleMark(r[F.W], 1); TAGS = {}; BOWN = {}; toast(isFav(r[F.W]) ? "已收藏" : "已取消收藏", "ok"); renderSession(); return; }
}

/* ---------- 20. 启动 ---------- */
function init() {
  DB = load();
  buildIndex();
  applyTheme();
  if (!DB.book || !bookMeta(DB.book)) DB.book = BOOKS.length ? BOOKS[0].id : "__all";
  document.querySelectorAll(".nav").forEach(function (b) { b.onclick = function () { go(b.getAttribute("data-go")); }; });
  buildMtab();   /* 手机底栏：必须在 go() 之前建好，否则第一次同步高亮时还没有按钮可同步 */
  bindSwipe();   /* 学习卡左右滑动翻词（手势一节） */
  document.addEventListener("keydown", onKey);
  try { loadVoices(); if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices; } catch (e) {}
  window.addEventListener("resize", function () { updateChrome(); });
  var lib = document.querySelector('.nav[data-go="library"]');
  go("today");
  var origRender = render;
  render = function () {
    origRender();
    if (cur === "library") bindLibrary();
    if (cur === "settings") bindSettings();
    if (cur === "stats") bindCommon();
  };
  render();
  if (!WORDS.length) toast("词库为空，请检查数据文件", "bad");

  /* ---- 返回键钩子（给 Android 原生壳用） ----
     这个应用是纯 JS 状态路由：没有 location.hash、没有 history.pushState，
     视图切换全在内存里（JSTACK 栈 + cur）。后果是 WebView 的 canGoBack() 永远为 false，
     系统返回键会「直接退出应用」—— 正在看词条详情、正在精读，一按就没了。
     所以「退一层」必须由应用自己实现：原生壳在 onKeyDown 里调 __wfBack()，
     返回 true = 应用内已消化这次返回（别退出），false = 已经是最外层（可以退出）。
     浏览器里它只是挂着不调用，没有任何副作用。 */
  window.__wfBack = function () {
    try {
      var mask = $("mask");
      if (mask && mask.classList.contains("on")) { closeModal(); return true; }
      if (JSTACK.length) { jumpBack(); return true; }
      if (cur !== "today") { go("today"); return true; }
    } catch (e) { }
    return false;
  };

  /* ---- 落盘钩子（给 Android 原生壳用） ----
     保存本身带 350ms 防抖，正常使用没问题；但切后台时系统可能在防抖到点之前就把进程回收掉，
     最后几次评价就留在内存里没了。原生壳在 onPause 里先调这个催一次同步保存，再暂停 WebView。 */
  window.__wfFlushSave = function () { try { save(true); } catch (e) { } };
}
window.__WFAPI = {
  init: init,
  /* 顶层视图清单。**导出的目的是让验证脚本从源码推导，而不是自己手抄一份。**
     手抄清单最麻烦的地方不是「忘了同步」，是**它只能断言自己抄的那一份** ——
     新加的视图到底有没有接进底栏、点得到点不到，手抄的那份压根不知道，
     而且它会一直绿着。（本轮加「易混词」时就是这么红的：断言里写死 8 个视图。） */
  VIEWS: VIEWS,
  parseImport: parseImport,
  parsePlainLines: parsePlainLines,
  mkRec: mkRec,
  normArr: normArr,
  dedupe: dedupe,
  splitCSVLine: splitCSVLine,
  wordDetailHTML: wordDetailHTML,
  wordDetailInner: wordDetailInner,
  mnemoHTML: mnemoHTML,
  formList: formList,
  rootHint: function (w) { return rootHint(w); },
  /* 跳转页 */
  jumpTo: function (k, w, c) { return jumpTo(k, w, c); },
  jumpBack: jumpBack,
  jumpStack: function () { return JSTACK.slice(); },
  jumpViewHTML: function () { return jumpViewHTML(); },
  formsPageHTML: formsPageHTML,
  collsPageHTML: collsPageHTML,
  detailPageHTML: detailPageHTML,
  /* 队列随机化 */
  buildQueue: function (k) { return buildQueue(k); },
  previewQueue: function (k) { return previewQueue(k); },
  applyOrder: applyOrder,
  orderName: orderName,
  resetPreview: function () { PQ = null; },
  setQueueOrder: function (m) { cfg().queueOrder = m; PQ = null; },
  mkBlank: mkBlank,
  /* 设置面板：数值格式校验 */
  NUMS: NUMS,
  numSpec: function (k) { return numSpec(k); },
  /* 倒计时的两个纯函数也导出去：验证脚本要能「自己算一遍期望值再跟界面写进去的比」，
     而不是把界面写进去的值再读回来跟自己比（那种断言永远绿）。 */
  examPlan: function () { return examPlan(); },
  isoDateOK: function (s) { return isoDateOK(s); },
  parseNum: function (raw, k) { return parseNum(raw, numSpec(k)); },
  vSettings: vSettings,
  bindSettings: bindSettings,
  syncNumInputs: syncNumInputs,
  nextInterval: nextInterval,
  stOf: stOf,
  strength: strength,
  retention: retention,
  grade: grade,
  makeOptions: function (r, pool, n, useWord, prefer) { return makeOptions(r, pool, n, useWord, prefer); },
  firstDef: function (r) { return firstDef(r); },
  hasCnDef: function (r) { return hasCnDef(r); },
  preferWords: function () { return preferWords(); },
  searchWords: searchWords,
  blankDB: blankDB,
  esc: esc,
  getDB: function () { return DB; },
  setDB: function (d) { DB = d; buildIndex(); TAGS = {}; BOWN = {}; },
  setBook: function (b) { DB.book = b; TAGS = {}; BOWN = {}; },
  words: function () { return WORDS; },
  /* 取文出口也导出去，让人能「自己造一个永不返回的 fetch，看它会不会兜住」——
     超时这件事光看源码证明不了，必须真跑一次（见 _dev/test-logic.js [24]）。 */
  netGet: function (u, cb) { return netGet(u, cb); },
  netBridge: function (u, cb) { return netBridge(u, 0, cb); },
  setNetTimeout: function (ms) { NET_TIMEOUT = ms; },
  netTimeout: function () { return NET_TIMEOUT; },
  NETBR: NETBR,
  books: function () { return BOOKS; },
  roots: function () { return ROOTS; },
  bookWords: function (id) { return bookWords(id); },
  bookOwnWords: function (id) { return bookOwnWords(id); },
  bookPageHTML: bookPageHTML,
  setBookScope: function (s) { BSCOPE = s; },
  setBookQuery: function (q) { BQ = q; },
  setBookLimit: function (n) { BLIMIT = n; },
  jumpBook: function (id) { return jumpTo("book", id, ""); },
  jumpWord: function (w) { return jumpTo("detail", w, ""); },
  jumpView: function () { return jumpViewHTML(); },
  jumpStack: function () { return JSTACK.slice(); },
  jumpBack: function () { return jumpBack(); },
  resetJump: function () { JSTACK = []; JFROM = "today"; JSES = false; },
  go: function (v) { return go(v); },
  startSession: function (k) { return startSession(k); },
  curView: function () { return cur; },
  session: function () { return S; },
  /* ---- 底栏与手势：给测试直接驱动用 ----
     stub DOM 里 addEventListener 是空实现，点击和滑动没法靠派发事件测；
     所以把入口函数暴露出来按「行为」断言（真的开一轮会话、真的评价、真的撤销），
     而不是只对源码做字符串匹配 —— 字符串匹配抓不住「绑没绑上」这类问题。 */
  prevWord: function () { return prevWord(); },
  nextWord: function () { return nextWord(); },
  commitAndNext: function () { return commitAndNext(); },
  mtabPlan: function () {
    return {
      p: MTAB_PRIMARY.map(function (x) { return x[0]; }),
      s: MTAB_SECOND.map(function (x) { return x[0]; })
    };
  },
  mtabActive: function (v) { return mtabActive(v); },
  swipeReady: function () { return swipeReady(); },
  swipeBlocked: function (n) { return swipeBlocked(n); },
  F: F, N: N, ST: ST, CFG_DEF: CFG_DEF,
  /* ---- 题型轮换与前置条件（不依赖 DOM，可直接驱动断言）----
     curMode 是「按卡片序号该轮到哪个」，pickMode 是「实际渲染的那个」——
     两者在设备/词条不满足前置条件时会分叉，这正是最该测的边界。 */
  curMode: function () { return curMode(); },
  pickMode: function () { return pickMode(); },
  modeOK: function (m, r) { return modeOK(m, r); },
  ttsReady: function () { return ttsReady(); },
  MODES: MODES,
  /* ---- 易混词（形近词组）----
     CONF 是纯数据、confGroupsOf 是纯查询，可以直接喂词断言；
     cfFiltered 带 scope 参数，测「当前词书 / 全部词库」两条路都不漏。 */
  CONF: CONF, confCover: confCover, confGroupsOf: confGroupsOf, confInBook: confInBook,
  cfFiltered: cfFiltered, cfGroupHTML: cfGroupHTML, cfRowHTML: cfRowHTML,
  vConfuse: vConfuse, confMount: confMount, startDrill: startDrill,
  /* 词汇量测试 */
  vVocab: vVocab, vlMount: vlMount, vlStart: vlStart, vlAnswer: vlAnswer, vlQuit: vlQuit,
  vlLadder: vlLadder, vlOrder: vlOrder, vlWordOK: vlWordOK, vlConverged: vlConverged,
  vlResult: vlResult, vlDaily: vlDaily, vlRemainText: vlRemainText,
  VL_FAKE: VL_FAKE, VL_RUNG: VL_RUNG, VL_N: VL_N, VL_MIN_Q: VL_MIN_Q, VL_MAX_Q: VL_MAX_Q,
  VL_FAKE_N: VL_FAKE_N, VL_FAKE_AT: VL_FAKE_AT, VL_START: VL_START,
  vlState: function () { return VL; },
  setVL: function (v) { VL = v; },
  /* 重绘：验证脚本要能「改完状态再画一遍」，靠 go() 绕一圈会带上视图副作用 */
  render: function () { render(); },
  setCFQ: function (v) { CFQ = v; CFLIMIT = 40; },
  getCFQ: function () { return CFQ; },
  setCFScope: function (v) { CFSCOPE = v; CFLIMIT = 40; },
  getCFScope: function () { return CFSCOPE; },
  setCFLimit: function (n) { CFLIMIT = n; },
  /* ---- 考试倒计时（纯算术，无副作用，可直接喂日期测）---- */
  examPlan: examPlan, isoDateOK: isoDateOK,
  setCfg: function (k, v) { cfg()[k] = v; },
  statsOf: statsOf, bookMeta: bookMeta, streak: streak,
  /* ---- 文章精读（引擎）---- */
  artMk: artMk, artSave: artSave, artGet: artGet, artAll: artAll, artDel: artDel,
  artProfile: artProfile, artStat: artStat, artCount: artCount, artTrim: artTrim,
  splitParas: splitParas, splitSents: splitSents, artWords: artWords, artSents: artSents,
  lookWord: lookWord, lemTry: lemTry, lvlOf: lvlOf, lvlName: lvlName, isNewTerm: isNewTerm,
  isHotWord: isHotWord, formOf: formOf, LVL_ORDER: LVL_ORDER, LVL_W: LVL_W,
  buildFormIdx: function () { buildFormIdx(); return FRM; },
  /* ---- 文章精读（抓取解析：纯函数，测试直接喂夹具 JSON）---- */
  pickFeatured: pickFeatured, pickExtract: pickExtract, pickSearch: pickSearch,
  pickNews: pickNews, pickGuardian: pickGuardian,
  netHostOK: netHostOK, netGet: netGet, netGetJSON: netGetJSON, netSelfTest: netSelfTest,
  SRC_LIST: SRCS, LVL_LIST: LVLS, NET_WL: NET_WL,
  stripHTMLLite: stripHTMLLite, urlFeatured: urlFeatured, urlExtract: urlExtract, urlSearch: urlSearch, urlNews: urlNews, urlGuardian: urlGuardian,
  /* ---- 中国英文媒体源（大陆可达）----
     解析函数都是纯函数，测试直接喂真实抓下来的 HTML / RSS 夹具，
     断言「这一段真实页面能不能被解析出正文」——比对着源码做字符串匹配有意义得多。 */
  CSRC: CSRC,
  csOf: function (id) { return csOf(id); },
  csListURL: function (id) { var s = csOf(id); return s ? csListURL(s) : ""; },
  csPickList: function (id, body) { var s = csOf(id); return s ? csPickList(s, body) : []; },
  csParas: function (id, html) { var s = csOf(id); return s ? csParas(s, html) : []; },
  pickTitle: function (html, id) { return pickTitle(html, csOf(id)); },
  pickCNDList: pickCNDList, pickGTFeed: pickGTFeed,
  unent: unent, tagText: tagText, isoDay: isoDay,
  netGetSmart: function (u, cb) { return netGetSmart(u, cb); },
  NETBR: NETBR,
  /* ---- 中国英文媒体（视图）---- */
  rdCNHTML: rdCNHTML, rdCNPull: rdCNPull, rdCNGrab: rdCNGrab,
  rdCNState: function () { return { sel: CSEL, list: CLIST, busy: CBUSY }; },
  /* 界面上的那条错误提示也导出去 —— 端到端脚本失败时要能说出「为什么」，
     而不是只报一句「文章: none」。它带着 msg + hint（逐个中转的失败原因）。 */
  rdMsg: function () { return RMSG; },
  rdCNSel: function (v) { CSEL = v; CLIST = null; },
  /* 直接塞一份列表进去（纯粹的 setter，和 RD_SET / setBookScope 同一性质）。
     用途：截图与布局诊断要在【不发网络请求】的前提下渲染出「有列表」的样子 ——
     让截图去联网，等于把截图层的成败押在网络上，那种脆弱是不必要的。 */
  rdCNList: function (v) { CLIST = v || null; },
  /* ---- 文章精读（视图与练习）---- */
  vRead: vRead, artPageHTML: artPageHTML, artQuizHTML: artQuizHTML,
  mkCloze: mkCloze, mkMatch: mkMatch, mkOrder: mkOrder, mkExercises: mkExercises,
  readBook: readBook, artWordsToLearn: artWordsToLearn, assistName: assistName,
  qzBuild: qzBuild, qzSubmit: qzSubmit, qzPair: qzPair, qzMove: qzMove, qzCheckOrder: qzCheckOrder,
  qzDone: qzDone, qzTotal: qzTotal,
  netState: function () { return NETST; },
  readStat: function () { return RA; },
  RD_TAB: function () { return RTAB; }, RD_SET: function (t) { RTAB = t; }
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
})();
