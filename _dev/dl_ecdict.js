// 独立通道：只抢 ECDICT 数据源，多镜像并行探测，谁先通用谁
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const ROOT = path.join(__dirname, "..");
const H = { "User-Agent": "Mozilla/5.0" };

// 目标：拿到含 bnc/frq/collins/exchange/definition 的英汉词典数据
// 候选源按优先级排列（都是已验证可达的通道）
const CANDIDATES = [
  {
    name: "npmmirror/ecdict",
    url: "https://registry.npmmirror.com/ecdict/-/ecdict-0.0.4.tgz",
    dest: "raw/npm/ecdict.tgz",
  },
  {
    name: "npmmirror/cdict_query",
    url: "https://registry.npmmirror.com/cdict_query/-/cdict_query-1.0.0.tgz",
    dest: "raw/npm/cdict_query.tgz",
  },
  {
    name: "jsdelivr-npm/ecdict-meta",
    url: "https://fastly.jsdelivr.net/npm/ecdict@0.0.4/package.json",
    dest: "raw/npm/ecdict_pkg.json",
  },
  {
    name: "jsdelivr-npm/cdict_query-meta",
    url: "https://fastly.jsdelivr.net/npm/cdict_query@1.0.0/package.json",
    dest: "raw/npm/cdict_query_pkg.json",
  },
];

async function head(u) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(u, { headers: H, signal: ctl.signal });
    clearTimeout(t);
    return {
      status: r.status,
      len: r.headers.get("content-length"),
      type: r.headers.get("content-type"),
    };
  } catch (e) {
    clearTimeout(t);
    return { status: "ERR:" + e.message.slice(0, 40) };
  }
}

async function get(u, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 600000);
  const r = await fetch(u, { headers: H, signal: ctl.signal });
  clearTimeout(t);
  if (!r.ok) throw new Error("HTTP " + r.status);
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest));
  return fs.statSync(dest).size;
}

(async () => {
  console.log("=== 探测 === ");
  const probe = await Promise.all(
    CANDIDATES.map(async (c) => {
      const h = await head(c.url);
      console.log(
        `${c.name.padEnd(28)} ${String(h.status).padEnd(9)} ${
          h.len ? (h.len / 1048576).toFixed(2) + "MB" : "-"
        } ${h.type || ""}`
      );
      return { c, h };
    })
  );
  const live = probe.filter((p) => p.h.status === 200);
  console.log(`\n可达 ${live.length}/${CANDIDATES.length}`);

  for (const { c, h } of live) {
    const dest = path.join(ROOT, c.dest);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 200) {
      console.log(`SKIP ${c.dest}  (${(fs.statSync(dest).size / 1048576).toFixed(2)} MB)`);
      continue;
    }
    let done = false;
    for (let i = 1; i <= 4 && !done; i++) {
      try {
        const n = await get(c.url, dest);
        console.log(`OK   ${c.dest.padEnd(40)} ${(n / 1048576).toFixed(2)} MB`);
        done = true;
      } catch (e) {
        console.log(`  retry${i} ${c.name}: ${e.name} ${e.message.slice(0, 60)}`);
        await new Promise((r) => setTimeout(r, 1500 * i));
      }
    }
    if (!done) console.log(`FAIL ${c.dest}`);
  }
  console.log("\n=== 结束 ===");
})();
