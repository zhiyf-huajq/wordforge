// 分块并发下载: node dl_chunked.js <url> <out> [chunkMB=4] [concurrency=8]
const fs = require("fs");
const path = require("path");
const H = { "User-Agent": "Mozilla/5.0" };

const url = process.argv[2];
const out = process.argv[3];
const CHUNK = (Number(process.argv[4]) || 4) * 1048576;
const CONC = Number(process.argv[5]) || 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getRange(start, end, attempt = 0) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 120000);
    const r = await fetch(url, { headers: { ...H, Range: `bytes=${start}-${end}` }, signal: ctl.signal });
    clearTimeout(t);
    if (r.status !== 206 && r.status !== 200) throw new Error("HTTP " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    return buf;
  } catch (e) {
    if (attempt >= 6) throw e;
    await sleep(800 * (attempt + 1));
    return getRange(start, end, attempt + 1);
  }
}

(async () => {
  const t0 = Date.now();
  const probe = await fetch(url, { headers: { ...H, Range: "bytes=0-0" } });
  const total = Number((probe.headers.get("content-range") || "").split("/")[1]) || Number(probe.headers.get("content-length"));
  if (!total) throw new Error("无法获取文件大小");
  console.log(`总大小 ${(total / 1048576).toFixed(2)} MB, 分块 ${CHUNK / 1048576}MB x ${CONC} 并发`);

  const parts = [];
  for (let s = 0; s < total; s += CHUNK) parts.push([s, Math.min(s + CHUNK - 1, total - 1)]);
  const chunks = new Array(parts.length);
  let done = 0, next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= parts.length) return;
      const [s, e] = parts[i];
      chunks[i] = await getRange(s, e);
      done++;
      if (done % 2 === 0 || done === parts.length) {
        const got = chunks.reduce((a, c) => a + (c ? c.length : 0), 0);
        process.stdout.write(`  ${done}/${parts.length} 块  ${(got / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fd = fs.openSync(out, "w");
  for (const c of chunks) fs.writeSync(fd, c);
  fs.closeSync(fd);
  const size = fs.statSync(out).size;
  console.log(`DONE ${out} ${(size / 1048576).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s ${size === total ? "✓完整" : "✗大小不符"}`);
})().catch((e) => { console.log("FAIL " + e.message); process.exit(1); });
