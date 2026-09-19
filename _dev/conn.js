const H = { "User-Agent": "Mozilla/5.0" };
async function t(name, url) {
  const t0 = Date.now();
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { headers: H, signal: ctl.signal }); clearTimeout(tm);
    const b = await r.text();
    return `OK  ${r.status} ${name.padEnd(34)} ${(b.length / 1024).toFixed(0)}KB ${Date.now() - t0}ms`;
  } catch (e) { return `FAIL    ${name.padEnd(34)} ${Date.now() - t0}ms ${e.name}`; }
}
(async () => {
  const urls = [
    ["raw / qwerty 小文件", "https://raw.githubusercontent.com/RealKai42/qwerty-learner/master/public/dicts/suffix_word.json"],
    ["raw / ECDICT 小文件", "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.mini.csv"],
    ["api.github.com", "https://api.github.com/repos/RealKai42/qwerty-learner"],
    ["cdn.jsdelivr.net", "https://cdn.jsdelivr.net/gh/RealKai42/qwerty-learner@master/public/dicts/suffix_word.json"],
    ["github.com 首页", "https://github.com/"],
    ["downloads.tatoeba.org", "https://downloads.tatoeba.org/exports/per_language/cmn/cmn-eng_links.tsv.bz2"],
    ["百度", "https://www.baidu.com/"],
    ["gitee", "https://gitee.com/"],
    ["hub.fastgit", "https://hub.fastgit.xyz/"],
    ["ghproxy.net", "https://ghproxy.net/"],
  ];
  for (const [n, u] of urls) console.log(await t(n, u));
})();
