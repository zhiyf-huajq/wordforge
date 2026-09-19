// 通过 fastly.jsdelivr + npmmirror 下载全部数据源
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const ROOT = path.join(__dirname, "..");
const H = { "User-Agent": "Mozilla/5.0" };
const F = "https://fastly.jsdelivr.net/gh/";
const N = "https://registry.npmmirror.com/";

const JOBS = [
  [F + "RealKai42/qwerty-learner@master/public/dicts/4000_Essential_English_Words-sentence.json", "raw/qwerty/4000_Essential_English_Words-sentence.json"],
  [F + "RealKai42/qwerty-learner@master/public/dicts/CET6_T.json", "raw/qwerty/CET6_T.json"],
  [F + "RealKai42/qwerty-learner@master/public/dicts/IELTSVocabularyBible.json", "raw/qwerty/IELTSVocabularyBible.json"],
  [F + "kajweb/dict@master/book/1521164635506_CET4_2.zip", "raw/baicizhan/CET4_2.zip"],
  [F + "kajweb/dict@master/book/1521164633851_CET6_3.zip", "raw/baicizhan/CET6_3.zip"],
  [F + "kajweb/dict@master/book/1521164669833_KaoYan_1.zip", "raw/baicizhan/KaoYan_1.zip"],
  [F + "kajweb/dict@master/book/1521164657744_IELTS_2.zip", "raw/baicizhan/IELTS_2.zip"],
  [F + "kajweb/dict@master/book/1521164640451_TOEFL_2.zip", "raw/baicizhan/TOEFL_2.zip"],
  [F + "kajweb/dict@master/book/1521164637271_GRE_2.zip", "raw/baicizhan/GRE_2.zip"],
  [N + "cdict_query/-/cdict_query-1.0.0.tgz", "raw/npm/cdict_query.tgz"],
  [N + "ecdict/-/ecdict-0.0.4.tgz", "raw/npm/ecdict.tgz"],
];

async function get(u, dest, redirects = 0) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 300000);
  const r = await fetch(u, { headers: H, signal: ctl.signal });
  clearTimeout(t);
  if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get("location")) {
    if (redirects > 6) throw new Error("redirect loop");
    return get(new URL(r.headers.get("location"), u).href, dest, redirects + 1);
  }
  if (!r.ok) throw new Error("HTTP " + r.status);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
  return fs.statSync(dest).size;
}

(async () => {
  let ok = 0; const fail = [];
  for (const [u, rel] of JOBS) {
    const dest = path.join(ROOT, rel);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 200) { console.log(`SKIP ${rel}`); ok++; continue; }
    let done = false;
    for (let i = 1; i <= 5 && !done; i++) {
      try {
        const n = await get(u, dest);
        console.log(`OK   ${rel.padEnd(56)} ${(n / 1048576).toFixed(2)} MB`);
        ok++; done = true;
      } catch (e) {
        if (i === 5) { console.log(`FAIL ${rel}  ${e.name}: ${e.message}`); fail.push(rel); }
        else await new Promise(r => setTimeout(r, 1200 * i));
      }
    }
  }
  console.log(`\n汇总: 成功 ${ok}/${JOBS.length}` + (fail.length ? "  失败: " + fail.join(", ") : ""));
})();
