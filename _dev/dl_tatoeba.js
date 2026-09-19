const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const ROOT = path.join(__dirname, "..");

async function get(u, dest, redirects = 0) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 900000);
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

const jobs = [
  ["https://downloads.tatoeba.org/exports/per_language/cmn/cmn-eng_links.tsv.bz2", "raw/cmn-eng_links.tsv.bz2"],
  ["https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2", "raw/cmn_sentences.tsv.bz2"],
  ["https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2", "raw/eng_sentences.tsv.bz2"],
];

(async () => {
  for (const [u, rel] of jobs) {
    const dest = path.join(ROOT, rel);
    for (let i = 1; i <= 3; i++) {
      try {
        const n = await get(u, dest);
        console.log(`DONE ${rel} ${(n / 1048576).toFixed(2)} MB`);
        break;
      } catch (e) {
        console.log(`  retry ${i}/3 ${rel}: ${e.name} ${e.message}`);
        if (i === 3) console.log(`FAIL ${rel} ${e.message}`);
        else await new Promise((r) => setTimeout(r, 2000 * i));
      }
    }
  }
})();
