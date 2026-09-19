// 第三层验证：无头浏览器截图验收
// 思路：基于 dist 生成「自动切到指定视图」的临时变体 HTML，逐个截图，
//      先落 ASCII 文件名（避免 Windows 传参编码问题），再重命名为中文。
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist", "词匠-离线背单词.html");
const OUT = path.join(ROOT, "preview");
const TMP = path.join(ROOT, "_dev", "_shots");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BROWSER = fs.existsSync(CHROME) ? CHROME : EDGE;
console.log("浏览器:", BROWSER);

if (!fs.existsSync(DIST)) {
  console.error("! 找不到 dist 交付物");
  process.exit(1);
}
const base = fs.readFileSync(DIST, "utf8");
console.log("dist 大小:", (Buffer.byteLength(base) / 1048576).toFixed(2), "MB");

const click = (sel) => `(function(){var e=document.querySelector('${sel}');if(e)e.click();else console.log('MISS ${sel}');})()`;

// 直接把某个词的完整详情卡渲染进主视图（用于展示同义词/反义词/辨析/词根等扩充字段）
const detailShot = (word) =>
  "(function(){var A=window.__WFAPI;if(!A)return;" +
  "var w=A.words().find(function(x){return x[0]==='" + word + "';});if(!w)return;" +
  "document.getElementById('pgTitle').textContent='词条详情';" +
  "document.getElementById('pgSub').textContent='同义词 · 反义词 · 近义词辨析 · 词根词缀';" +
  "document.getElementById('view').innerHTML='<div class=\"study-wrap\"><div class=\"card\" style=\"max-width:740px;margin:0 auto;padding:30px\">'+A.wordDetailHTML(w,{})+'</div></div>';" +
  "})()";

/* 精读那几张图共用同一篇文章与同一段构造代码。
   写成常量而不是复制粘贴：这类注入代码里混了引号与换行，抄三遍迟早抄错一处。 */
const RDTXT = "Climate change is the long-term shift in global temperatures and weather patterns. "
  + "Scientists have observed it since the pre-industrial period. "
  + "The main cause is the burning of fossil fuels, which releases greenhouse gases into the atmosphere. "
  + "Rising temperatures have already led to more extreme weather events around the world.\\n\\n"
  + "Melting ice sheets are raising sea levels along many coastlines. "
  + "Many species are moving toward the poles to find cooler conditions. "
  + "Governments have promised to cut emissions in the coming decades. "
  + "Whether those promises will be kept remains an open question.";
const RDMK = "(function(){var A=window.__WFAPI;if(!A)return;"
  + "var a=A.artMk({t:'Climate change',src:'Simple English Wikipedia',lic:'CC BY-SA',text:'" + RDTXT + "'});"
  + "A.artSave(a);";
const RD_DESK = (assist) => RDMK + "A.getDB().cfg.readAssist=" + assist + ";A.go('read');A.jumpTo('art',a.id);})()";

/* 中国英文媒体那一条用的列表样本 —— 取自 2026-09-18 真实抓下来的中国日报栏目页
   （夹具 _cd_col.html，解析结果与 verify-cn.js 断言的是同一批）。
   截图不联网：列表直接注入。让截图的成败押在网络上是不必要的脆弱 ——
   网络那一段由 verify-cn-live.js 专门负责。 */
const CN_LIST = [
  { title: "Chinese farming model benefits Global South", d: "2026-09-18", url: "https://www.chinadaily.com.cn/a/202609/18/WS6aac955be4b06d4aa055eb95.html" },
  { title: "High-tech methods refine border checkpoint work", d: "2026-09-17", url: "https://www.chinadaily.com.cn/a/202609/17/WS6aab3b95e4b06d4aa055e785.html" },
  { title: "Post-disaster recovery underway in Hainan after torrential rainfall", d: "2026-09-16", url: "https://www.chinadaily.com.cn/a/202609/16/WS6aaa02a2e4b06d4aa055e532.html" },
  { title: "Rare sunset spectacle draws visitors to Zhaoqing's Xinghu Lake", d: "2026-09-15", url: "https://www.chinadaily.com.cn/a/202609/15/WS6aa8c494e4b06d4aa055e1af.html" },
  { title: "Minister stresses security cooperation", d: "2026-09-18", url: "https://www.chinadaily.com.cn/a/202609/18/WS6aac77fee4b06d4aa055ead3.html" }
];

// [ascii 名, 中文名, 注入代码, 视窗]
const SHOTS = [
  ["01_today", "01_今日总览", "", [1500, 1120]],
  ["02_study", "02_学习卡片", click("#btnQuick"), [1500, 1120]],
  ["03_library", "03_词库管理", click('[data-go="library"]'), [1500, 1120]],
  ["04_stats", "04_学习统计", click('[data-go="stats"]'), [1500, 1120]],
  ["05_settings", "05_设置面板", click('[data-go="settings"]'), [1500, 1120]],
  ["06_dark", "06_深色主题", click("#btnTheme"), [1500, 1120]],
  ["07_review", "07_复习队列", click('[data-go="review"]'), [1500, 1120]],
  ["08_quiz", "08_测试中心", click('[data-go="quiz"]'), [1500, 1120]],
  /* ⚠ 窄屏截图的宽度不能随便填。
     headless Chrome 的 --window-size 有 **512 DIP 最小宽度**：传 420 时页面仍按 512px 布局，
     只把右侧裁掉 —— 看起来像「布局溢出 / 有元素没了」，其实是伪影。
     之前这张填 420，底部菜单的第 5 个页签正好落在裁切线外，
     于是底栏在图上只剩 4 个，害我以为是布局坏了（探针实测 420px 视口下 5 个全在，right=415）。
     要真实手机宽度请走 CDP 设备模拟（见 check-mobile-view.js 的 --shoot），
     这里只做「不裁切的完整展示」，填 ≥520。 */
  ["09_mobile", "09_移动端视图", "", [520, 1000]],
  ["10_detail", "10_词条详情", detailShot("happy"), [1500, 1500]],
  ["11_dis", "11_近义词辨析", detailShot("difficult"), [1500, 1500]],
  // 单独把含「显示词性」的那张设置卡渲染出来，验证新增开关确实出现在面板里
  ["12_switches", "12_显示开关",
    click('[data-go="settings"]') +
    ";setTimeout(function(){var cards=document.querySelectorAll('#view .card');" +
    "for(var i=0;i<cards.length;i++){if(cards[i].textContent.indexOf('显示词性')<0)continue;" +
    "document.getElementById('pgTitle').textContent='设置 · 显示项';" +
    "document.getElementById('pgSub').textContent='每个字段都能单独开关';" +
    "var v=document.getElementById('view');v.innerHTML='';" +
    "var wrap=document.createElement('div');wrap.className='study-wrap';" +
    "var inner=document.createElement('div');inner.className='card';" +
    "inner.style.maxWidth='740px';inner.style.margin='0 auto';" +
    "inner.innerHTML=cards[i].innerHTML;wrap.appendChild(inner);v.appendChild(wrap);break;}},280)",
    [1500, 1120]],
  // 巧记栏目：挑一个「巧记 + 搭配 + 同义词 + 词频」都齐、且最常见（COCA 靠前）的真实词
  ["13_mnemo", "13_巧记栏目",
    "(function(){var A=window.__WFAPI;if(!A)return;" +
    "var list=A.words().filter(function(x){return x[19]&&x[14]&&x[16]&&x[10];});" +
    "list.sort(function(a,b){return (a[11]||a[10])-(b[11]||b[10]);});" +
    "var w=list[0]||A.words().find(function(x){return x[0]==='happy';});" +
    "document.getElementById('pgTitle').textContent=w[0];" +
    "document.getElementById('pgSub').textContent='巧记 · 放在卡片最后一栏';" +
    "document.getElementById('view').innerHTML='<div class=\"study-wrap\"><div class=\"card\" style=\"max-width:740px;margin:0 auto;padding:30px\">'+A.wordDetailHTML(w,{})+'</div></div>';" +
    "})()", [1500, 1800]],
  // 词形变化跳转页（点卡片上「词形变化」后落到的页面）
  ["14_forms", "14_词形变化页",
    "(function(){var A=window.__WFAPI;if(!A)return;" +
    "A.go('library');A.jumpTo('forms','predict');})()", [1500, 1350]],
  // 固定搭配跳转页（点卡片上「固定搭配」后落到的页面）
  ["15_colls", "15_固定搭配页",
    "(function(){var A=window.__WFAPI;if(!A)return;" +
    "A.go('library');A.jumpTo('colls','important');})()", [1500, 1350]],
  // 词书详情页：点词书卡片落到的页面（「六级含四级」的包含关系展示在这里）
  ["16_book", "16_词书详情页",
    "(function(){var A=window.__WFAPI;if(!A)return;" +
    "A.go('library');A.setBookQuery('');A.setBookScope('all');A.setBookLimit(22);A.jumpBook('cet6');})()",
    [1500, 1640]],
  // 同一页切到「仅本册新增」范围：只看六级在四级之外新增的词
  ["17_book_own", "17_词书_仅本册新增",
    "(function(){var A=window.__WFAPI;if(!A)return;" +
    "A.go('library');A.setBookQuery('');A.setBookScope('own');A.setBookLimit(18);A.jumpBook('cet6');})()",
    [1500, 1420]],
  // 词库页内置词书区：卡片上的「含《大学英语四级》」与「查看单词列表」
  ["18_books", "18_词库页词书卡片",
    click('[data-go="library"]') +
    ";setTimeout(function(){var v=document.getElementById('view');if(v)v.scrollTop=520;},400)",
    [1500, 1150]],
  // 设置面板的数值格式校验：故意提交两个非法值，留下红框 + 回滚后的原值
  ["19_numcheck", "19_设置数值校验",
    click('[data-go="settings"]') +
    ";setTimeout(function(){" +
    "function sub(k,v){var e=document.querySelector('input[data-num=\"'+k+'\"]');if(!e)return;e.focus();e.value=v;e.blur();}" +
    "sub('newPerDay','99999');" +                 /* 超出 1 – 500 → 拒绝并恢复原值 */
    "sub('easeStart','2.77');" +                  /* 不是 0.05 的整数倍 → 拒绝 */
    "sub('dailyGoal','300');" +                   /* 合法值 → 正常写入 */
    "document.getElementById('pgTitle').textContent='设置 · 数值格式校验';" +
    "document.getElementById('pgSub').textContent='只识别格式正确的数值，否则恢复设置前状态';" +
    "var v=document.getElementById('view');if(v)v.scrollTop=0;" +
    "},600)",
    [1500, 1700]],

  /* ---- 文章精读：本项目里唯一需要联网的模块 ---- */
  // 精读主页：联网状态条 + 「唯一联网」的说明 + 发现/我的文章两个页签
  ["20_read_home", "20_精读主页",
    "(function(){var A=window.__WFAPI;if(!A)return;A.RD_SET('discover');A.go('read');})()",
    [1500, 1150]],
  // 精读台 · 标生词档（默认档）：只画虚线下划线，不给中文，逼自己先猜
  ["21_read_desk", "21_精读台_标生词", RD_DESK(1), [1500, 1560]],
  // 精读台 · 显释义档：生词后面直接跟行内中文，通读全文最省力的一档
  ["22_read_cn", "22_精读台_显释义", RD_DESK(2), [1500, 1620]],
  // 精读台 · 逐句档：一句一行，长难句不再挤成一坨
  ["23_read_sent", "23_精读台_逐句精读", RD_DESK(3), [1500, 1800]],
  // 点词弹窗：不跳页、不打断阅读；词形还原后给出原形释义
  ["24_read_pop", "24_点词查义弹窗",
    RDMK + "A.getDB().cfg.readAssist=0;A.go('read');A.jumpTo('art',a.id);"
      + "var sp=null;document.querySelectorAll('#rdBody [data-word]').forEach(function(x){"
      + "if(!sp&&A.lookWord(x.getAttribute('data-word')))sp=x;});if(sp)sp.click();"
      /* 遮罩和弹窗都是靠 CSS transition 入场的，而无头截图用的虚拟时间不推进过渡动画，
         否则拍到的是 opacity:0 的初始态（一片空白，看着像弹窗坏了）。这里把终态钉死。 */
      + "var mk=document.getElementById('mask'),md=document.getElementById('modal');"
      + "if(mk){mk.style.transition='none';mk.style.opacity='1';}"
      + "if(md){md.style.transition='none';md.style.transform='none';}"
      + "})()",
    [1500, 1000]],
  // 读后练习：语境填空 / 词义配对 / 段落还原，三类题一次生成
  ["25_read_quiz", "25_读后练习",
    RDMK + "A.getDB().cfg.readQuizN=6;A.go('read');A.jumpTo('artq',a.id);})()",
    [1500, 1700]],
  // 离线通路：关掉联网后，「我的文章」页照样能粘贴导入
  ["26_read_offline", "26_离线粘贴导入",
    RDMK + "A.getDB().cfg.netOff=true;A.RD_SET('mine');A.go('read');})()",
    [1500, 1250]],

  /* ---- 手机底栏（窄屏才出现） ----
     底栏原先是 8 个图标挤在一行，360px 屏上每个只有 44px 宽、10px 字、还没有按压反馈，
     又挤又像坏的。现在收成「4 主 + 更多」，次要入口进底部抽屉。
     这两张专门拍它 —— 底栏只在 @media(max-width:900px) 里 display:flex，
     所以桌面宽度的截图永远拍不到，必须用窄视窗。 */
  // 底部抽屉：点「更多」扇出的次要入口（测试 / 词库 / 统计 / 设置）
  ["27_mtab_more", "27_手机底栏_更多抽屉",
    click('[data-go="__more"]') +
    /* 抽屉靠 CSS transition 入场；无头截图的虚拟时间不推进过渡，不钉死终态就会拍到半透明初始态 */
    ";setTimeout(function(){var mk=document.getElementById('mask'),md=document.getElementById('modal');" +
    "if(mk){mk.style.transition='none';mk.style.opacity='1';}" +
    "if(md){md.style.transition='none';md.style.transform='none';}},400)",
    [520, 1000]],
  // 手机上的学习卡：底部有「向右滑回上一条 / 向左滑跳下一条」的手势提示（.swipehint 只在窄屏显示）
  ["28_mobile_study", "28_手机学习卡_滑动提示",
    click("#btnQuick"),
    [520, 1120]],

  /* ---- 中国英文媒体源 ----
     原来那 6 个源全是境外站点（维基家族 + 卫报），大陆网络下实测全部超时 ——
     功能看着有、实际用不了。这一组是实测国内网络连得上的英文媒体：
     中国日报五栏目 + 环球时报，取文链路各不相同（详见 part3b_read.js 的 CSRC 注释）。 */
  ["29_cn_media", "29_中国英文媒体源",
    "(function(){var A=window.__WFAPI;if(!A)return;" +
    "A.RD_SET('discover');A.go('read');A.rdCNSel('cnd-china');" +
    "A.rdCNList(" + JSON.stringify(CN_LIST) + ");" +
    "A.go('read');" +
    /* 把区块滚到舒服的位置：它上面还压着「今日可读」一整块。
       不用 scrollIntoView —— 无头截图的虚拟时间不推进平滑滚动，会拍到滚了一半的样子。 */
    "setTimeout(function(){var cs=document.querySelector('.cchips'),v=document.getElementById('view');" +
    "if(cs&&v){var off=cs.getBoundingClientRect().top-v.getBoundingClientRect().top+v.scrollTop;v.scrollTop=Math.max(0,Math.round(off)-118);}},450);" +
    "})()",
    [520, 1250]],

  /* ---- 易混词（形近词组） ----
     数据是构建期算好、随产物一起发布的（17073 组 / 覆盖 15909 词），
     运行时零计算零请求 —— 这几张拍的就是「断网也打开就有」的那一页。 */
  ["30_confuse", "30_易混词_当前词书",
    "(function(){var A=window.__WFAPI;if(!A)return;" +
    "A.setCFQ('');A.setCFScope('book');A.go('confuse');})()",
    [1500, 1500]],
  // 搜一个词看它跟谁容易混 —— 这一档最容易让人以为「功能坏了」，所以要有出口
  ["31_confuse_search", "31_易混词_搜索",
    "(function(){var A=window.__WFAPI;if(!A)return;" +
    "A.setCFQ('abandon');A.setCFScope('all');A.go('confuse');})()",
    [1500, 1080]],
  // 「练这组」：把一组形近词当成一轮练习，干扰项优先从这组里取
  ["32_confuse_drill", "32_易混词_专练一轮",
    "(function(){var A=window.__WFAPI;if(!A)return;" +
    "A.setCFQ('');A.setCFScope('all');A.go('confuse');" +
    "var g=A.CONF.filter(function(x){return x.length===2;})[0];A.startDrill(g);})()",
    [1500, 1180]],

  /* ---- 词汇量测试（阶梯自适应 · 自评 + 假词陷阱） ---- */
  ["33_vocab_intro", "33_词汇量_介绍",
    "(function(){var A=window.__WFAPI;if(!A)return;A.setVL(null);A.go('vocab');})()",
    [1500, 1420]],
  // 答题页：只有进度、一个词、两个等宽按钮。字号最大的就是这一个词
  ["34_vocab_ask", "34_词汇量_答题",
    "(function(){var A=window.__WFAPI;if(!A)return;" +
    "A.setVL(null);A.go('vocab');A.vlStart();})()",
    [1500, 900]],
  // 结果页：走完整轮，且故意在 2 个假词上点「认识」—— 把「虚报已下调」那张卡也拍出来
  ["35_vocab_done", "35_词汇量_结果",
    "(function(){var A=window.__WFAPI;if(!A)return;" +
    "A.setVL(null);A.go('vocab');A.vlStart();" +
    "for(var i=0,n=0;i<60&&A.vlState().phase==='ask';i++){var s=A.vlState();" +
    "if(s.last&&s.last.fake){n++;A.vlAnswer(n<=2);}else A.vlAnswer(s.cur<=4);}" +
    "setTimeout(function(){var v=document.getElementById('view');if(v)v.scrollTop=0;},200);})()",
    [1500, 2000]],
];

const results = [];
for (const [ascii, cn, code, [w, h]] of SHOTS) {
  const inject = code
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){try{${code}}catch(e){}},500);});</script>`
    : "";
  const html = base.replace("</body>", inject + "</body>");
  const vp = path.join(TMP, "_v_" + ascii + ".html");
  fs.writeFileSync(vp, html, "utf8");

  const png = path.join(TMP, ascii + ".png");
  const url = "file:///" + vp.replace(/\\/g, "/");
  try {
    execFileSync(
      BROWSER,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--allow-file-access-from-files",
        "--force-device-scale-factor=1",
        "--virtual-time-budget=6000",
        "--window-size=" + w + "," + h,
        "--screenshot=" + png,
        url,
      ],
      { stdio: "ignore", timeout: 90000 }
    );
    if (fs.existsSync(png)) {
      const sz = fs.statSync(png).size;
      const dest = path.join(OUT, cn + ".png");
      fs.copyFileSync(png, dest);
      results.push([cn, (sz / 1024).toFixed(0) + " KB", "✓"]);
      console.log(`  ✓ ${cn.padEnd(14)} ${(sz / 1024).toFixed(0)} KB`);
    } else {
      results.push([cn, "-", "✗ 无输出"]);
      console.log(`  ✗ ${cn} 未生成`);
    }
  } catch (e) {
    results.push([cn, "-", "✗ " + String(e.message).slice(0, 40)]);
    console.log(`  ✗ ${cn} ${String(e.message).slice(0, 80)}`);
  }
}

// 清理临时 HTML（保留 png 便于复查）
for (const f of fs.readdirSync(TMP)) if (f.endsWith(".html")) fs.unlinkSync(path.join(TMP, f));

console.log("\n=== 截图汇总 ===");
results.forEach((r) => console.log(`  ${r[2].padEnd(4)} ${r[0].padEnd(16)} ${r[1]}`));
const ok = results.filter((r) => r[2] === "✓").length;
console.log(`\n成功 ${ok}/${results.length}  →  ${OUT}`);
