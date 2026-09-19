/* prep_confuse.js —— 形近词（易混词）分组生成  v1
 *
 * 为什么要有这个文件：
 *   「近义词辨析」是查表（受源语料封顶，只有 13–15% 覆盖率，做不动了）；
 *   「形近词辨析」是**计算** —— 只需要词表本身 + 一个距离函数，
 *   覆盖率和词库规模成正比，不受任何外部语料的天花板限制。
 *   这两件事经常被混为一谈，其实是两种完全不同的资源约束。
 *
 * 输出：build/data_confuse.json —— 一个「词组」数组：
 *   [["adapt","adopt","adept"], ["affect","effect"], ...]
 *   存成「组」而不是「每个词的伙伴列表」，是因为组内成员互相共享：
 *   4 个词一组只需写 4 次，写成逐词伙伴表要写 4×3=12 次，
 *   对 11 MB 的单文件产物来说这个差别不小。
 *
 * ── 算法 ────────────────────────────────────────────────────────
 * 1. 候选筛选用「删除邻域分桶」（SymSpell 的思路），不做 O(n²) 全量比对：
 *    两词的 Damerau-Levenshtein 距离若 ≤ 2，则它们必定共享一个
 *    「各自删掉不超过 2 个字符后可得到」的公共串。
 *    于是把每个词删 ≤2 字符的所有结果倒排成索引，同桶的才是候选对。
 *    24027 词 × 约 40 个删除形 ≈ 100 万条倒排项，秒级完成；
 *    而朴素两两比对是 2.9 亿对。
 * 2. 桶内**逐个真算距离**再确认。分桶只是「别漏」，判定必须回到精确值 ——
 *    分桶会把距离到 4 的对也放进同一个桶（各自删 2 个字符凑出公共串）。
 * 3. 成组用**贪心团**：新词必须和组内**每一个**已有成员都够近才允许加入。
 *    不做连通分量 —— A~B、B~C 但 A 与 C 差很远时，连通分量会把三个词塞进一组，
 *    用户会觉得「这组里有个词跟另外两个根本不搭」。
 *
 * ── 质量防护（宁可少、不可错）────────────────────────────────────
 *  · 长度 ≥ 4：三个字母以内的词互相「差一个字母」太普遍（cat/car/cap），
 *    这种组对备考没有信息量，反而把真正的难点淹掉。
 *  · 长度差 ≤ 1：挡住 road / broadcast 这类「一个词恰好是另一个的子串」。
 *  · 互不为词形变化：effect / effects 不是易混词，是同一个词。
 *    先查词形变化字段，再拿轻量词干还原兜底（两边还原后相同就丢掉）。
 *  · 互不为同义词：affect / influence 意思相近不该进「形近词」——
 *    那是近义词辨析该管的事，两处混用会让用户对不上号。
 *  · 首义不同：只比中文释义的**第一段**（分号/逗号/顿号切开取首个）。
 *    effect 首义「效果」、affect 首义「影响」，不同 → 保留；
 *    adapt 首义「使适应」、adopt 首义「采用」，不同 → 保留。
 *    若首义也完全一样，说明更像同义而非形近，丢掉。
 *
 * 用法：
 *   node _dev/prep_confuse.js          # 生成 build/data_confuse.json
 *   node _dev/prep_confuse.js --stat   # 只统计，不写文件
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STAT_ONLY = process.argv.indexOf("--stat") >= 0;

/* ---------- 1. 载入词表 ---------- */
/* 字段位序与 App 里的 F 常量一致 */
const F = { W: 0, US: 1, UK: 2, POS: 3, CN: 4, EN: 5, EX: 6, EXZ: 7, TG: 8, FM: 9, BNC: 10, FRQ: 11, SYN: 16 };

const words = JSON.parse(fs.readFileSync(path.join(ROOT, "build/data_words.json"), "utf8"));

const MIN_LEN = 4; /* 见文件头「质量防护」 */
const MAX_DL = 2; /* Damerau-Levenshtein 阈值 */
const MAX_LENDIFF = 1;
const GROUP_MAX = 4; /* 一组最多几个词 —— 再多用户记不住，也就失去了「辨析」的意义 */
const WORD_MAX_GROUPS = 4; /* 一个词最多出现在几组里。
   形近词的关系不是「划分」而是「重叠」—— lose 既近 loose，也近 lone、lobe。
   值给到 4 是个折中：再小会把经典对挤出去，再大文件会成倍长，
   真正需要放宽的那批交给下面「强对补救」按考点词单独补，不靠这个全局值硬撑。 */
const RESCUE_CAP = 16; /* 补救组（两词组）不受 WORD_MAX_GROUPS 约束，用这个更宽的上限。
   理由：补救是瞄准考点词的定点补漏，量小、价值高，
   而全局放宽会顺带把冷僻词也一起放进来，性价比完全不同。
   值取 16 是实测的结果：crash 这类高频词的近邻特别多（clash / flash / trash /
   brush / crush …都在距离 1 之内），上限压到 12 时 clash / crash 这一对
   恰好排在队尾被砍掉；放到 16 就能兜住，而文件只涨了十几 KB。
   注意 pairs 是**按分数从优到劣**排过的，所以「前 16 个」天然就是这个词最该配的那批。 */
/* 什么算「考点词」。这里把最常用的几个基础词表（牛津 3000 / NCE / 中考）也算进来：
   它们本来就在 LVL_ORDER 里被当作「基础词汇」看待，latest / latter 这类词
   常常只挂着一个基础标签而没有 cet 标签，只认 cet* 会把它们漏掉。 */
const EXAM_TAGS = new Set([
  "zk", "zhongkao", "gk", "gaokao", "cet4", "cet6", "ky", "kaoyan", "toefl", "ielts", "gre",
  "nce1", "nce2", "verb1000", "noun1500", "adj500", "oxford3000",
]);
const BUCKET_CAP = 800; /* 过大的桶说明这个删除形太短、没有区分度，直接跳过 */

/* ---------- 2. 轻量词干还原（只用来挡词形变化，不求语言学正确） ---------- */
/* 只处理最常见的几条规则。目的很窄：判断「这两个词是不是同一个词的不同形态」。
   不追求还原正确，只追求「同一词的不同形态还原成同一个东西」。 */
const SUF = ["ations", "ation", "ings", "ing", "ies", "ied", "ests", "est", "ers", "er", "ed", "es", "s", "ly"];
function stem(w) {
  for (const s of SUF) {
    if (w.length - s.length >= 3 && w.endsWith(s)) {
      let b = w.slice(0, w.length - s.length);
      /* 双写辅音去掉一个（running → runn → run） */
      if (b.length >= 3 && b[b.length - 1] === b[b.length - 2] && !/[aeiou]/.test(b[b.length - 1])) b = b.slice(0, -1);
      /* i → y（happier → happi → happy） */
      if (b.endsWith("i")) b = b.slice(0, -1) + "y";
      /* 去掉不发音的结尾 e（making → mak → make 走不到这里，但 loving 这类可以） */
      return b;
    }
  }
  return w;
}

/* ---------- 3. 词形变化反查：拿到「某形态属于哪个原形」 ---------- */
/* ECDICT 的 exchange 字段形如 "p:did/d:done/i:doing/3:does/s:does"。
   这里只取「原形」这一侧：把每个形态映射回它所属的词条。 */
const FORM2LEMMA = new Map();
for (const r of words) {
  const w = String(r[F.W] || "").toLowerCase();
  const fm = String(r[F.FM] || "");
  if (!w || !fm) continue;
  fm.split("/").forEach((seg) => {
    const c = seg.indexOf(":");
    if (c < 0) return; /* forEach 的回调里只能 return，不能 continue */
    const form = seg.slice(c + 1).trim().toLowerCase();
    if (form && form !== w && !FORM2LEMMA.has(form)) FORM2LEMMA.set(form, w);
  });
}
const lemmaOf = (w) => FORM2LEMMA.get(w) || w;

/* ---------- 4. 候选词（只让「值得辨析」的词参与） ---------- */
const isAlphaWord = (w) => /^[a-z]+$/.test(w) && w.length >= MIN_LEN;
const pick = [];
for (const r of words) {
  const w = String(r[F.W] || "").toLowerCase();
  if (!isAlphaWord(w)) continue;
  pick.push({
    w: w,
    i: pick.length,
    len: w.length,
    cn: String(r[F.CN] || ""),
    pos: String(r[F.POS] || ""),
    frq: Number(r[F.FRQ] || r[F.BNC] || 999999) || 999999,
    syn: String(r[F.SYN] || "").toLowerCase(),
    tg: String(r[F.TG] || ""),
    /* 是不是考点词（中考以上的任何一档）。补救阶段只照顾这批 ——
       冷僻词之间形近对用户的备考没有价值，没必要为它们撑大文件。 */
    exam: String(r[F.TG] || "")
      .toLowerCase()
      .split("|")
      .some((t) => EXAM_TAGS.has(t.trim())),
  });
}
const SUB = new Map(); /* word → record */
pick.forEach((x) => SUB.set(x.w, x));
/* 词频查表：组的排序一律按「组长词的词频」，无论是计算出来的还是人工兜底的 ——
   界面是从上往下读的，最常用的那批必须排在最前面。 */
const FRQW = new Map(pick.map((x) => [x.w, x.frq]));

/* ---------- 5. Damerau-Levenshtein（含相邻换位） ---------- */
/* 必须含换位：form / from、casual / causal 这类「两个字母调了个位置」，
   恰恰是最典型、最该被抓出来的形近词；纯 Levenshtein 会把它们算成距离 2，
   虽然也能过阈值，但真正的换位对（trail/trial）算成 2 会让排序变差。
   阈值小（≤2），用整行 O(la×lb) 的动态规划完全够快。 */
function dl(a, b) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > MAX_DL) return MAX_DL + 1;
  const INF = MAX_DL + 1;
  /* 三行滚动：prev2 / prev / cur */
  let prev2 = new Array(lb + 1).fill(INF);
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[lb];
}
/* 注：这里**故意不做**「整行最小值超阈值就提前收工」的剪枝。
   直觉上行的最小值是单调不减的，但在带相邻换位的距离里这一步没有把握 ——
   一旦中途退出，结果是「漏掉真该成组的对」，而漏掉是看不出来的（没有报错、
   覆盖率只是低一点），比慢一点糟糕得多。串长 ≤ 11，全量算也不贵。

/* 分桶用：删掉 ≤2 个字符的所有结果（含自身） */
function bucketKeys(w) {
  const out = new Set();
  out.add(w);
  const lv1 = [];
  for (let i = 0; i < w.length; i++) {
    const t = w.slice(0, i) + w.slice(i + 1);
    out.add(t);
    lv1.push(t);
  }
  for (const s of lv1) {
    for (let i = 0; i < s.length; i++) out.add(s.slice(0, i) + s.slice(i + 1));
  }
  return out;
}

/* ---------- 6. 倒排分桶 → 确认距离 → 打分 ---------- */
const BUCKET = new Map();
pick.forEach((x) => {
  bucketKeys(x.w).forEach((k) => {
    /* 长度 < 2 的删除形没有区分度。MIN_LEN = 4 时最短的删除形正好是 2
       （4 字母词删掉 2 个），所以 2 必须留着 —— 把 4 字母的形近对
       （form / from 这类）漏掉，恰好会漏掉最典型的一批。 */
    if (k.length < 2) return;
    let arr = BUCKET.get(k);
    if (!arr) { arr = []; BUCKET.set(k, arr); }
    if (arr.length <= BUCKET_CAP) arr.push(x.i);
  });
});

const seen = new Set();
const pairs = [];
for (const arr of BUCKET.values()) {
  if (arr.length < 2 || arr.length > BUCKET_CAP) continue;
  for (let p = 0; p < arr.length; p++) {
    for (let q = p + 1; q < arr.length; q++) {
      const ia = arr[p], ib = arr[q];
      const key = ia < ib ? ia + "," + ib : ib + "," + ia;
      if (seen.has(key)) continue;
      seen.add(key);
      const A = pick[ia], B = pick[ib];
      if (Math.abs(A.len - B.len) > MAX_LENDIFF) continue;
      const d = dl(A.w, B.w);
      if (d < 1 || d > MAX_DL) continue; /* d === 0 不可能（词表已去重），防御而已 */
      /* —— 词形变化：同一个词的不同形态不算易混 —— */
      if (lemmaOf(A.w) === lemmaOf(B.w)) continue;
      if (lemmaOf(A.w) === B.w || lemmaOf(B.w) === A.w) continue;
      /* 词干兜底必须**收窄**：只有「短的恰好是长的前缀」才算同一词的派生。
         早先的写法是「词干相同就丢」，结果把 later / latter 一起误杀 ——
         两者的词干都被剥成 lat，但它们谁都不是谁的前缀，是货真价实的一对易混词。
         收窄之后：adapt / adapted（前缀关系）照样挡住，later / latter 保留。 */
      if (stem(A.w) === stem(B.w)) {
        const short = A.len <= B.len ? A.w : B.w;
        const long = A.len <= B.len ? B.w : A.w;
        if (long.startsWith(short)) continue;
      }
      /* —— 同义词不算形近词（那是近义词辨析的活）—— */
      if (A.syn && ("," + A.syn.replace(/\|/g, ",") + ",").indexOf("," + B.w + ",") >= 0) continue;
      if (B.syn && ("," + B.syn.replace(/\|/g, ",") + ",").indexOf("," + A.w + ",") >= 0) continue;
      /* —— 释义完全相同的丢掉，但只丢「整条释义一字不差」的 ——
         早先的写法是「**首义**不同才留」，把 affect / effect 直接误杀了：
         affect 首义「影响」、effect 首义也是「影响」（effect 的 效果/作用 排在后面），
         而这一对恰恰是英语里最经典的形近词，误杀它就是这条规则写错了。
         正确的判据是「它们是不是同一个意思的两种拼法」——
         所以比的是**整条释义**：完全一致才算重复（center / centre、color / colour
         这种拼写变体会被挡掉），只要有一个义项不同就保留。
         这类词在 dl ≤ 2 的范围里本就是稀有情况，放宽不会让噪音涌进来。 */
      const ca = normCN(A.cn), cb = normCN(B.cn);
      if (!ca || !cb || ca === cb) continue;
      /* 首义相同不丢，只在打分里轻罚：留给排序用，不做硬门槛 */
      const sameFirstSense = firstSense(A.cn) === firstSense(B.cn) ? 1 : 0;
      /* —— 打分：越小越该被收进来 —— */
      const posOverlap = A.pos && B.pos && A.pos === B.pos ? 0 : 4;
      const sameHead = A.w[0] === B.w[0] ? 0 : 1;
      const freqGap = Math.abs(Math.log10(A.frq + 10) - Math.log10(B.frq + 10)) > 2 ? 2 : 0;
      const score = d * 10 + (A.len === B.len ? 0 : 2) + posOverlap + sameHead + freqGap + sameFirstSense;
      pairs.push({ a: ia, b: ib, s: score, d: d });
    }
  }
}

/* 整条释义归一化：去掉词性标记、空白与标点，只留中文与字母数字。
   用来判「这两条释义是不是同一个意思的两种写法」。 */
function normCN(cn) {
  if (!cn) return "";
  return String(cn)
    .replace(/\b(n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr)\.\s*/gi, "")
    .replace(/[\s；;，,、。.·|/\\()（）\[\]【】"'’“”]/g, "")
    .trim();
}

/* 首义：分号 / 逗号 / 顿号切开取第一个非空段，再去掉词性标记与空白 */
function firstSense(cn) {
  if (!cn) return "";
  const seg = String(cn).split(/[；;，,、]/)[0] || "";
  return seg
    .replace(/^(n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int|aux|abbr)\.\s*/i, "")
    .replace(/\s+/g, "")
    .trim();
}

/* 排序必须完全确定：同一份输入跑两次要得到同一份输出，
   否则「改动前后 diff 一下」就没法做了。 */
pairs.sort((x, y) => x.s - y.s || x.a - y.a || x.b - y.b);

/* ---------- 7. 贪心团成组 ---------- */
const groups = []; /* 每组：{ list: [词索引], lead: 首次加入的词频 } */
const inGroup = new Map(); /* 词索引 → 它所在的组序号数组 */
const membersOf = (gi) => groups[gi].list;

function closeEnough(ia, ib) {
  const A = pick[ia], B = pick[ib];
  if (Math.abs(A.len - B.len) > MAX_LENDIFF) return false;
  return dl(A.w, B.w) <= MAX_DL;
}

for (const p of pairs) {
  const ga = inGroup.get(p.a) || [];
  const gb = inGroup.get(p.b) || [];
  if (ga.some((g) => gb.indexOf(g) >= 0)) continue; /* 已经同组 */

  let placed = -1;
  let addWhich = -1; /* 0 = 把 A 加进去（说明 B 已在组里），1 = 把 B 加进去 */
  /* 优先并到已有的组里（A 所在的组能容下 B） */
  for (const g of ga) {
    if (groups[g].list.length >= GROUP_MAX) continue;
    if (groups[g].list.every((m) => closeEnough(m, p.b))) { placed = g; addWhich = 1; break; }
  }
  if (placed < 0) {
    for (const g of gb) {
      if (groups[g].list.length >= GROUP_MAX) continue;
      if (groups[g].list.every((m) => closeEnough(m, p.a))) { placed = g; addWhich = 0; break; }
    }
  }
  if (placed >= 0) {
    const added = addWhich === 1 ? p.b : p.a;
    groups[placed].list.push(added);
    if (!inGroup.has(added)) inGroup.set(added, []);
    inGroup.get(added).push(placed);
    continue;
  }
  /* 开新组 */
  if (ga.length >= WORD_MAX_GROUPS || gb.length >= WORD_MAX_GROUPS) continue;
  const gi = groups.length;
  groups.push({ list: [p.a, p.b] });
  [p.a, p.b].forEach((x) => {
    if (!inGroup.has(x)) inGroup.set(x, []);
    inGroup.get(x).push(gi);
  });
}

/* ---------- 8. 强对补救 ----------
 * 上面那趟是「贪心团」：一个词一旦被前几组占满，后面更该配的对就挤不进去了 ——
 * lose 排在 long / lone / lore 那组里，最经典的 loose / lose 反而不在一起。
 *
 * 补救只挑两种：**两边都是考点词**、且**距离 ≤ 1**。这两个条件一起卡，
 * 出来的就是「备考真正会被扣分的那批」，量小、价值高，
 * 所以这里允许它们突破 WORD_MAX_GROUPS，用更宽的 RESCUE_CAP。
 * 反过来，若把全局上限一放了之，冷僻词也会跟着涌进来，文件成倍长而收益几乎为零。
 */
function coGrouped(p, q) {
  const gp = inGroup.get(p) || [], gq = inGroup.get(q) || [];
  return gp.some((g) => gq.indexOf(g) >= 0);
}
let rescued = 0;
for (const p of pairs) {
  if (p.d !== 1) continue;
  if (!pick[p.a].exam || !pick[p.b].exam) continue;
  if (coGrouped(p.a, p.b)) continue;
  if ((inGroup.get(p.a) || []).length >= RESCUE_CAP) continue;
  if ((inGroup.get(p.b) || []).length >= RESCUE_CAP) continue;
  const gi = groups.length;
  groups.push({ list: [p.a, p.b] });
  [p.a, p.b].forEach((x) => {
    if (!inGroup.has(x)) inGroup.set(x, []);
    inGroup.get(x).push(gi);
  });
  rescued++;
}

/* ---------- 9. 输出 ---------- */
/* 组内按「词频高→低，同频按字母」排序：最该先认的那个词排头。
   组的顺序按组长词的词频 —— 界面从上往下就是从常用到冷门。 */
const FRQ = (w) => (FRQW.has(w) ? FRQW.get(w) : 999999);
const out0 = groups
  .filter((g) => g.list.length >= 2)
  .map((g) => {
    const ws = g.list.slice().sort((x, y) => pick[x].frq - pick[y].frq || (pick[x].w < pick[y].w ? -1 : 1));
    return { frq: pick[ws[0]].frq, ws: ws.map((i) => pick[i].w) };
  })
  .sort((x, y) => x.frq - y.frq || (x.ws[0] < y.ws[0] ? -1 : 1))
  .map((x) => x.ws);

/* ---------- 9b. 组间去重 ----------
 * 贪心团会产出大量「只差一个成员」的近似组，比如
 *   ["flash","slash","clash","plash"] 和 ["flash","slash","clash","splash"]
 * —— 两个都在界面上出现，用户会看到同一件事被说两遍。
 *
 * 丢弃规则只有两条，都很保守：
 *   ① 子集：G 的成员全在已保留的 H 里 → G 没带来任何新词
 *   ② 同尺寸近重复：|G| = |H| ≥ 3 且只差一个成员 → 几乎是同一组
 * ② 必须限定 |G| ≥ 3：两词组之间共享一个词是**常态**（bush 既配 brush 也配
 * bust），按「差一个成员」去砍会把 brush / bush 这种正经的对着砍掉 ——
 * 早先就是这么写、这么错的，砍掉了 4700 组的同时也误伤了一批两词组。
 * 之所以不敢用「重合几个就丢」那种宽松规则：cash / clash 这种两词组
 * 和某个四词组只重合一个成员，但它传达的是**另一条**信息，丢了就真丢了。
 * 处理顺序先大后小 —— 大组信息多，优先保留。 */
const keptPairs = [];
const keptByWord = new Map();
let deduped = 0;
{
  const order = out0.map((g, i) => ({ g: g, i: i })).sort((x, y) => y.g.length - x.g.length || x.i - y.i);
  for (const it of order) {
    const g = it.g;
    let redundant = false;
    for (let k = 0; k < g.length && !redundant; k++) {
      const cands = keptByWord.get(g[k]) || [];
      for (const h of cands) {
        let inter = 0;
        for (const w of g) if (h.indexOf(w) >= 0) inter++;
        if (inter === g.length || (g.length >= 3 && g.length === h.length && inter === g.length - 1)) { redundant = true; break; }
      }
    }
    if (redundant) { deduped++; continue; }
    keptPairs.push(g);
    for (const w of g) {
      if (!keptByWord.has(w)) keptByWord.set(w, []);
      keptByWord.get(w).push(g);
    }
  }
}
/* 去重后回到「按组长词词频」的顺序 */
const out = keptPairs.sort((ga, gb) => FRQ(ga[0]) - FRQ(gb[0]) || (ga[0] < gb[0] ? -1 : 1));

/* ---------- 10. 人工校对的经典对兜底 ----------
 * 计算层负责广度（覆盖六成以上的词），但它是**先到先得**的贪心团：
 * 一个词的近邻一多，最经典的那一对反而可能被挤到不同的组里
 * （loss / loose 就是被 long / lone / lore 挤掉的）。
 * 这一层用人工校对的经典对把「最该出现的那批」钉死。
 *
 * 严格性：逐词核对必须真实存在于词表里，缺一个就整组丢掉并打印出来 ——
 * 宁可少一组，也不能把拼错的词写进产物。重复的组（和计算层完全同词集）也丢掉。
 */
let curated = [];
const curatedSrc = path.join(ROOT, "raw/prep/confuse_curated.json");
if (fs.existsSync(curatedSrc)) {
  const raw = JSON.parse(fs.readFileSync(curatedSrc, "utf8"));
  const have = new Set(pick.map((x) => x.w));
  const key = (ws) => ws.slice().sort().join("\u0000");
  const existing = new Set(out.map((g) => key(g)));
  let dropped = 0;
  for (const g of raw.groups || []) {
    const ws = g.map((w) => String(w).toLowerCase()).filter(Boolean);
    const missing = ws.filter((w) => !have.has(w));
    if (missing.length) { dropped++; console.log("  ⚠ 词表里没有，整组丢弃：" + ws.join(", ") + "（缺 " + missing.join(", ") + "）"); continue; }
    if (ws.length < 2 || new Set(ws).size !== ws.length) { dropped++; continue; }
    if (existing.has(key(ws))) { continue; } /* 计算层已经产出同一组，不重复 */
    existing.add(key(ws));
    curated.push(ws);
  }
  console.log("  人工兜底组 " + curated.length + " 组（丢弃 " + dropped + " 组）");
}
const all = out.concat(curated);
/* 两层合起来再按「组长词的词频」排一次：人工兜底那批也必须回到它该在的位置，
   不能因为「后加的」就全堆到文件末尾 —— 界面是从上往下读的。 */
all.sort((ga, gb) => FRQ(ga[0]) - FRQ(gb[0]) || (ga[0] < gb[0] ? -1 : 1));

const totalMentions2 = all.reduce((n, g) => n + g.length, 0);
const cover2 = new Set();
all.forEach((g) => g.forEach((w) => cover2.add(w)));

console.log("形近词组生成");
console.log("  参与筛选的词      " + pick.length);
console.log("  确认距离 ≤2 的对  " + pairs.length + "（其中距离 1 的 " + pairs.filter((p) => p.d === 1).length + " 对）");
console.log("  计算成组          " + out0.length + " → 去重后 " + out.length + "（砍掉 " + deduped + " 组近似重复；强对补救补了 " + rescued + " 组）");
console.log("  合计成组          " + all.length);
console.log("  被覆盖的词数      " + cover2.size + "（占词表的 " + ((cover2.size / words.length) * 100).toFixed(1) + "%）");
console.log("  组内词次合计      " + totalMentions2);
const sizeDist = {};
all.forEach((g) => { sizeDist[g.length] = (sizeDist[g.length] || 0) + 1; });
console.log("  组大小分布        " + Object.keys(sizeDist).sort().map((k) => k + " 词 " + sizeDist[k] + " 组").join(" · "));

const json = JSON.stringify(all);
console.log("  JSON 体积         " + (json.length / 1024).toFixed(1) + " KB");

/* 抽样人工核对：下面这些是英语教学里公认的经典形近/易混对。
   看不出来就说明哪一层出了问题 —— 这比「覆盖率 66%」这种数字靠谱得多，
   因为覆盖率可以靠放宽阈值刷上去，但刷出来的多半是噪音。 */
const PROBE = [
  ["adapt", "adopt"], ["affect", "effect"], ["form", "from"], ["quite", "quiet"],
  ["desert", "dessert"], ["principal", "principle"], ["later", "latter"], ["loose", "lose"],
  ["personal", "personnel"], ["conscious", "conscience"], ["stationary", "stationery"],
  ["compliment", "complement"], ["except", "expect"], ["accept", "except"],
  ["through", "thorough"], ["though", "through"], ["weather", "whether"],
  ["contract", "contrast"], ["content", "context"], ["contact", "contract"],
  ["attribute", "contribute"], ["distribute", "attribute"], ["expand", "expend"],
  ["intimate", "imitate"], ["investigate", "integrate"], ["resolve", "revolve"],
  ["board", "broad"], ["border", "board"], ["casual", "causal"], ["trial", "trail"],
  ["diary", "dairy"], ["chicken", "kitchen"], ["sensible", "sensitive"],
  ["economic", "economical"], ["historic", "historical"], ["industrial", "industrious"],
  ["respectable", "respectful"], ["imply", "infer"], ["precede", "proceed"],
  ["source", "sauce"], ["vacation", "vocation"], ["aboard", "abroad"],
  ["altitude", "attitude"], ["assure", "ensure"], ["amend", "emend"],
  ["brush", "bush"], ["clash", "crash"], ["cure", "curve"], ["mission", "omission"],
];
const bothIn = (pool, a, b) => !!pool.find((g) => g.indexOf(a) >= 0 && g.indexOf(b) >= 0);
let hitAll = 0, hitCalc = 0;
const misses = [];
PROBE.forEach(([a, b]) => {
  const okAll = bothIn(all, a, b), okCalc = bothIn(out, a, b);
  if (okAll) hitAll++;
  if (okCalc) hitCalc++;
  if (!okAll) misses.push(a + " / " + b);
});
console.log("  —— 经典易混对自检 ——");
console.log("    最终命中 " + hitAll + " / " + PROBE.length + "（其中计算层自己抓到 " + hitCalc + " 对）");
if (misses.length) console.log("    仍未命中：" + misses.join("、"));

if (!STAT_ONLY) {
  const p = path.join(ROOT, "build", "data_confuse.json");
  fs.writeFileSync(p, json, "utf8");
  console.log("  已写入 " + p);
}

/* ---------- 11. 单对排查（--why=a,b） ----------
 * 「某两个词为什么没被配到一起」是维护这个脚本时最常问的问题，
 * 而从头翻一遍流水线找原因非常费时。这个开关把每一道闸门的结果直接打出来：
 * 哪一步卡住的，一眼就能看到。加这个不是为了好看，是因为真的会用。 */
const whyArg = process.argv.find((a) => a.indexOf("--why=") === 0);
if (whyArg) {
  const [a, b] = whyArg.slice(6).split(",").map((s) => s.trim().toLowerCase());
  const A = SUB.get(a), B = SUB.get(b);
  console.log("");
  console.log("排查 " + a + " / " + b);
  const step = (name, ok, extra) => console.log("  " + (ok ? "过" : "卡") + "  " + name + (extra !== undefined ? "  " + extra : ""));
  step("两个词都在候选集里", !!A && !!B, !A ? a + " 不在" : !B ? b + " 不在" : "长度 " + A.len + " / " + B.len);
  if (A && B) {
    step("长度差 ≤ " + MAX_LENDIFF, Math.abs(A.len - B.len) <= MAX_LENDIFF);
    const d = dl(a, b);
    step("距离 ≤ " + MAX_DL, d >= 1 && d <= MAX_DL, "实际距离 " + d);
    step("不是同一个词的词形变化", !(lemmaOf(a) === lemmaOf(b) || lemmaOf(a) === b || lemmaOf(b) === a), "原形 " + lemmaOf(a) + " / " + lemmaOf(b));
    const st = stem(a) === stem(b) ? (Math.max(a.length, b.length) && (a.length <= b.length ? b : a).startsWith(a.length <= b.length ? a : b)) : false;
    step("不是「短词 + 后缀」派生", !st, "词干 " + stem(a) + " / " + stem(b));
    step("不互为同义词", !(A.syn.indexOf(b) >= 0 || B.syn.indexOf(a) >= 0));
    step("整条释义不完全一致", normCN(A.cn) !== normCN(B.cn));
    step("两个都是考点词（补救阶段的条件）", A.exam && B.exam, "exam " + A.exam + " / " + B.exam);
    const pa = pairs.find((x) => (pick[x.a].w === a && pick[x.b].w === b) || (pick[x.a].w === b && pick[x.b].w === a));
    step("配对表里有这一对", !!pa, pa ? "距离 " + pa.d + " 分数 " + pa.s : "");
    step("已同组", coGrouped(A.i, B.i));
    console.log("  " + a + " 所在组：" + JSON.stringify(all.filter((g) => g.indexOf(a) >= 0)));
    console.log("  " + b + " 所在组：" + JSON.stringify(all.filter((g) => g.indexOf(b) >= 0)));
  }
}
