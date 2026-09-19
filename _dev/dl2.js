// 断点续传分块下载: node dl2.js <outFile> <chunkMB> <conc> <url1,url2,...>
const fs = require("fs");
const path = require("path");
const H = { "User-Agent": "Mozilla/5.0", "Accept-Encoding": "identity" };

const out = process.argv[2];
const CHUNK = (Number(process.argv[3]) || 4) * 1048576;
const CONC = Number(process.argv[4]) || 4;
const URLS = (process.argv[5] || "").split(",").filter(Boolean);
const PARTDIR = out + ".parts";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryFetch(url, start, end, attempt) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 90000);
  try {
    const r = await fetch(url, { headers: { ...H, Range: `bytes=${start}-${end}` }, signal: ctl.signal });
    if (r.status !== 206 && r.status !== 200) throw new Error("HTTP " + r.status);
    return Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

async function getRange(start, end) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const u of URLS) {
      try {
        const b = await tryFetch(u, start, end, attempt);
        if (b.length !== end - start + 1) throw new Error(`长度不符 ${b.length}`);
        return b;
      } catch (e) {
        lastErr = e;
        await sleep(500 + attempt * 900);
      }
    }
  }
  throw lastErr;
}

(async () => {
  const t0 = Date.now();
  fs.mkdirSync(PARTDIR, { recursive: true });
  // 探测总大小
  let total = 0, probeErr;
  for (const u of URLS) {
    for (let k = 0; k < 3; k++) {
      try {
        const r = await fetch(u, { headers: { ...H, Range: "bytes=0-0" } });
        const t = Number((r.headers.get("content-range") || "").split("/")[1]);
        if (t) { total = t; break; }
      } catch (e) { probeErr = e; await sleep(1500); }
    }
    if (total) break;
  }
  if (!total) { console.log("FAIL 无法探测大小: " + (probeErr && probeErr.message)); process.exit(1); }

  const n = Math.ceil(total / CHUNK);
  console.log(`目标 ${(total / 1048576).toFixed(2)} MB → ${n} 块 x ${CONC} 并发`);

  let next = 0, done = 0, resumed = 0, failed = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= n) return;
      const s = i * CHUNK, e = Math.min(s + CHUNK - 1, total - 1);
      const pf = path.join(PARTDIR, `p${String(i).padStart(5, "0")}`);
      if (fs.existsSync(pf) && fs.statSync(pf).size === e - s + 1) { done++; resumed++; continue; }
      try {
        const b = await getRange(s, e);
        fs.writeFileSync(pf, b);
        done++;
        if (done % 4 === 0 || done === n) process.stdout.write(`  ${done}/${n} 块 (续传 ${resumed})\n`);
      } catch (err) {
        failed++;
        console.log(`  ✗ 块 ${i} 失败: ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  const parts = fs.readdirSync(PARTDIR).filter((f) => f.startsWith("p")).sort();
  let got = 0;
  for (const f of parts) got += fs.statSync(path.join(PARTDIR, f)).size;
  if (got !== total || failed) {
    console.log(`未完成: ${(got / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB, 失败块 ${failed}。重跑本命令可续传。`);
    process.exit(2);
  }
  const fd = fs.openSync(out, "w");
  for (const f of parts) fs.writeSync(fd, fs.readFileSync(path.join(PARTDIR, f)));
  fs.closeSync(fd);
  fs.rmSync(PARTDIR, { recursive: true, force: true });
  console.log(`DONE ${out} ${(fs.statSync(out).size / 1048576).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})().catch((e) => { console.log("FAIL " + e.message); process.exit(1); });
