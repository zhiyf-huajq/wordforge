// 镜像可用性 + Range 支持 + 速度测试
const H = { "User-Agent": "Mozilla/5.0" };
const P = "skywind3000/ECDICT/master/ecdict.csv";
const CAND = [
  ["raw.githubusercontent", `https://raw.githubusercontent.com/${P}`],
  ["jsdelivr-cdn", `https://cdn.jsdelivr.net/gh/${P}`],
  ["ghproxy.net", `https://ghproxy.net/https://raw.githubusercontent.com/${P}`],
  ["gh-proxy.com", `https://gh-proxy.com/https://raw.githubusercontent.com/${P}`],
  ["ghfast.top", `https://ghfast.top/https://raw.githubusercontent.com/${P}`],
  ["raw.gitmirror", `https://raw.gitmirror.com/${P}`],
  ["moeyy", `https://github.moeyy.xyz/https://raw.githubusercontent.com/${P}`],
  ["hub.gitmirror", `https://hub.gitmirror.com/https://raw.githubusercontent.com/${P}`],
  ["kkgithub", `https://raw.kkgithub.com/${P}`],
  ["gh-proxy.net", `https://gh-proxy.net/https://raw.githubusercontent.com/${P}`],
];

(async () => {
  const res = [];
  for (const [name, url] of CAND) {
    const t0 = Date.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(url, { headers: { ...H, Range: "bytes=0-2047" }, signal: ctl.signal });
      clearTimeout(timer);
      const cr = r.headers.get("content-range");
      const total = cr ? Number(cr.split("/")[1]) : 0;
      const buf = Buffer.from(await r.arrayBuffer());
      const dt = Date.now() - t0;
      const line = `${r.status === 206 || r.ok ? "OK  " : "ERR "} ${String(r.status).padEnd(4)} ${name.padEnd(22)} range=${cr || "无"} total=${total ? (total / 1048576).toFixed(1) + "MB" : "?"} ${dt}ms ${(buf.length / 1024 / (dt / 1000)).toFixed(0)}KB/s`;
      res.push({ name, url, ok: r.ok || r.status === 206, range: !!cr, total, dt });
      console.log(line);
    } catch (e) {
      console.log(`FAIL ---  ${name.padEnd(22)} ${Date.now() - t0}ms ${e.name}`);
      res.push({ name, url, ok: false });
    }
  }
  const good = res.filter((r) => r.ok && r.range && r.total > 1048576);
  console.log("\n可用且支持 Range 的镜像:", good.map((g) => g.name).join(", ") || "(无)");
  require("fs").writeFileSync(__dirname + "/mirror.txt", JSON.stringify(good, null, 1), "utf8");
})();
