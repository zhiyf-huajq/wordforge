// 通用下载器: node dl.js <url> <outPath>
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");

const url = process.argv[2];
const out = process.argv[3];

async function once(u, dest, redirects = 0) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 600000);
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctl.signal });
  clearTimeout(timer);
  if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get("location")) {
    if (redirects > 6) throw new Error("too many redirects");
    return once(new URL(r.headers.get("location"), u).href, dest, redirects + 1);
  }
  if (!r.ok) throw new Error("HTTP " + r.status);
  const total = Number(r.headers.get("content-length") || 0);
  let got = 0;
  let last = Date.now();
  const body = Readable.fromWeb(r.body);
  body.on("data", (c) => {
    got += c.length;
    if (Date.now() - last > 4000) {
      last = Date.now();
      process.stdout.write(`  ${path.basename(dest)} ${(got / 1048576).toFixed(1)}MB` + (total ? `/${(total / 1048576).toFixed(1)}MB (${((got / total) * 100).toFixed(0)}%)` : "") + "\n");
    }
  });
  await pipeline(body, fs.createWriteStream(dest));
  return got;
}

(async () => {
  const t0 = Date.now();
  for (let i = 1; i <= 4; i++) {
    try {
      const n = await once(url, out);
      console.log(`DONE ${out} ${(n / 1048576).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return;
    } catch (e) {
      console.log(`  retry ${i}/4 : ${e.name} ${e.message}`);
      if (i === 4) { console.log(`FAIL ${out} ${e.message}`); process.exit(1); }
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
})();
