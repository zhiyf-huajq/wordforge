const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const ROOT = path.join(__dirname, "..");
const BASE = "https://raw.githubusercontent.com/RealKai42/qwerty-learner/master/public/dicts/";
const CDN = "https://cdn.jsdelivr.net/gh/RealKai42/qwerty-learner@master/public/dicts/";

const BOOKS = [
  "CET4_T.json", "CET6_T.json", "KaoYan_2024.json", "IELTS_3_T.json", "TOEFL_3_T.json", "GRE_3_T.json",
  "Oxford5000.json", "Oxford3000.json", "coca20000.json", "Top2000words.json",
  "GaoKao_3500.json", "ZhongKaoHeXin.json", "BEC_3_T.json", "BEC_2_T.json",
  "word_roots1.json", "suffix_word.json", "Top1000VerbWords.json", "Top1500NounWords.json",
  "Top500AdjectiveWords.json", "4000_Essential_English_Words-meaning.json",
  "nce-new-1.json", "nce-new-2.json", "nce-new-3.json", "nce-new-4.json",
  "Longman_Communication_3000.json", "Macmillan7000.json", "voa.json",
];

async function get(u, dest, redirects = 0) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 180000);
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctl.signal });
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
  fs.mkdirSync(path.join(ROOT, "raw", "qwerty"), { recursive: true });
  let ok = 0, fail = [];
  for (const b of BOOKS) {
    const dest = path.join(ROOT, "raw", "qwerty", b);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 500) { console.log(`SKIP ${b}`); ok++; continue; }
    let done = false;
    for (const base of [BASE, CDN]) {
      for (let i = 1; i <= 3 && !done; i++) {
        try {
          const n = await get(base + b, dest);
          console.log(`OK   ${b.padEnd(46)} ${(n / 1024).toFixed(0)} KB`);
          ok++; done = true;
        } catch (e) {
          await new Promise((r) => setTimeout(r, 1200 * i));
        }
      }
      if (done) break;
    }
    if (!done) { console.log(`FAIL ${b}`); fail.push(b); }
  }
  console.log(`\n汇总: 成功 ${ok}/${BOOKS.length}, 失败 ${fail.length}${fail.length ? " -> " + fail.join(",") : ""}`);
})();
