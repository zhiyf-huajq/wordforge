# 词匠 WordForge

> 一个**完全离线**的背单词应用。整个程序就是一个 HTML 文件，双击浏览器打开就能用；也可以装成安卓 App。

![今日总览](preview/01_今日总览.png)

**24,027** 个词条 · **24** 本词书 · **17,073** 组易混词 · **10** 个功能视图 · **0** 个外部依赖

---

## 这是什么

市面上的背单词软件大多需要注册、联网、买会员。这个小工具反过来做：

- **一个文件**。没有安装包、没有后端、没有账号。双击 `词匠-离线背单词.html` 就能开始。
- **数据全在本地**。24,027 个词条的释义、音标、例句、词形变化、同反义词、词根、巧记都打包在文件里，断网照常用。
- **学习记录存在浏览器里**。不上传、不注册。想换设备就把浏览器数据导出带走。
- **可高度自定义**。每日新词量、复习曲线、题型、主题、显示字段都能改。

唯一需要联网的是「文章精读」—— 它要去权威媒体取当天文章。这个模块可以一键关掉，关掉之后整个应用就是纯离线的。

## 怎么用

### 电脑上（最简单）

下载 [`dist/词匠-离线背单词.html`](dist/词匠-离线背单词.html) ，双击，完成。

> 11.6 MB 的单文件，用 Chrome / Edge / Firefox 打开都可以。

### 手机上

下载 [`词匠.apk`](词匠.apk) 传到手机安装。安卓 7.0 以上。

<p>
<img src="preview/apk_today_390.png" width="180" alt="手机端今日">
<img src="preview/apk_study_390.png" width="180" alt="手机端学习">
<img src="preview/apk_read_390.png" width="180" alt="手机端精读">
<img src="preview/apk_settings_390.png" width="180" alt="手机端设置">
</p>

## 功能

| 视图 | 做什么 |
|---|---|
| **今日** | 今天该学多少、还剩多少、连续打卡、按考试日期倒推每日量 |
| **学习** | 学习卡 + 选择题混排。看词选义 / 看义选词 / 拼写 / 听音辨词，答错自动加练 |
| **复习** | 按 SM-2 改良后的记忆曲线排到期词，只复习「今天该忘的」 |
| **测试** | 自选题量、范围（全部 / 学过 / 到期 / 错题）、题型、限时 |
| **精读** | 从 China Daily / 环球时报等取文章，四档精读（译文 / 生词 / 逐句 / 点词查义）+ 自动生成读后练习 |
| **易混词** | 17,073 组形近词（`have / hale / hate` 这种）。可以「练这组」，干扰项优先从组内取 |
| **词汇量** | 8 档阶梯自适应自测，带 4 个假词陷阱校准虚报 |
| **词库** | 24 本词书 + 词书详情页 + 自定义词书导入 |
| **统计** | 掌握度分布、记忆强度、每日曲线、CSV 导出 |
| **设置** | 看到的所有数字几乎都能改 |

### 界面预览

<table>
<tr>
<td width="50%"><img src="preview/02_学习卡片.png" alt="学习卡片"><br><sub>学习卡 · 一屏一个词，答错自动加练</sub></td>
<td width="50%"><img src="preview/16_词书详情页.png" alt="词书详情"><br><sub>词书详情 · 逐词预览，可切「仅本册新增」</sub></td>
</tr>
<tr>
<td><img src="preview/20_精读主页.png" alt="精读主页"><br><sub>文章精读 · 从权威媒体取当天文章</sub></td>
<td><img src="preview/23_精读台_逐句精读.png" alt="逐句精读"><br><sub>逐句精读 · 四档精度，点词即查</sub></td>
</tr>
<tr>
<td><img src="preview/30_易混词_当前词书.png" alt="易混词"><br><sub>易混词 · 17,073 组形近词辨析</sub></td>
<td><img src="preview/32_易混词_专练一轮.png" alt="易混词专练"><br><sub>「练这组」· 干扰项优先从同组取</sub></td>
</tr>
<tr>
<td><img src="preview/33_词汇量_介绍.png" alt="词汇量测试"><br><sub>词汇量测试 · 8 档阶梯自适应</sub></td>
<td><img src="preview/35_词汇量_结果.png" alt="词汇量结果"><br><sub>结果页 · 带假词陷阱校准虚报</sub></td>
</tr>
<tr>
<td><img src="preview/11_近义词辨析.png" alt="近义词辨析"><br><sub>词条详情 · 近义词辨析 / 词根 / 巧记</sub></td>
<td><img src="preview/04_学习统计.png" alt="学习统计"><br><sub>统计 · 掌握度分布与每日曲线</sub></td>
</tr>
<tr>
<td><img src="preview/05_设置面板.png" alt="设置"><br><sub>设置 · 看到的所有数字几乎都能改</sub></td>
<td><img src="preview/06_深色主题.png" alt="深色主题"><br><sub>7 套主题，深浅色都调过对比度</sub></td>
</tr>
</table>

手机端（安卓 App 实机截图）：

<p>
<img src="preview/apk_library_390.png" width="170" alt="手机端词库">
<img src="preview/apk_stats_390.png" width="170" alt="手机端统计">
<img src="preview/apk_art_390.png" width="170" alt="手机端精读导入">
</p>

## 四六级词书的质量

目标是「备考六级」，所以四级和六级两本词书单独做过完整度和质量核对：

| | 词条数 | 释义 | 词性 | 美式音标 | 例句 | 同义词 |
|---|---|---|---|---|---|---|
| 大学英语四级 | 4,958 | 100% | 100% | 99.9% | 94% | 82% |
| 大学英语六级 | 6,975 | 100% | 100% | 99.9% | 98% | 83% |

六级词书包含四级词汇（词书之间有包含关系，可以只看「本册新增」）。

## 数据规模

| 项目 | 数量 |
|---|---|
| 词条 | 24,027 |
| 词书 | 24（四六级 / 考研 / 雅思 / 托福 / GRE / BEC / 高考 / 中考 / 牛津 / 朗文 / COCA …） |
| 词根词缀 | 927 |
| 易混词组 | 17,073（覆盖 15,909 个词） |
| 词条字段 | 20（音标 / 词性 / 释义 / 英文释义 / 例句 / 例句翻译 / 词书标签 / 词频 / 词形变化 / 牛津标注 / 词组 / 词根 / 同义 / 反义 / 辨析 / 巧记 …） |

## 验收状态

改完代码不是「看着没问题」就算完。这个项目有八层验证，每层跑出可复现的数字：

| 层 | 手段 | 结果 |
|---|---|---|
| 结构 | 静态扫描：标签配对、网络调用白名单、外部资源、数据质量 | **0 错误 / 0 警告** |
| 逻辑 | 无头浏览器跑 663 条断言（算法 / 路由 / 出题 / 边界） | **663 / 663** |
| 设置面板 | 真实 Chrome：输入校验、焦点、非法值回滚、版式体检 | **66 / 66** |
| 精读模块 | 真实 Chrome：档位切换、点词弹窗、离线导入、联网开关 | **42 / 42** |
| 网页解析 | 用抓下来的真实网页 / RSS 夹具离线跑解析器 | **41 / 41** |
| 截图 | 自动截 35 张界面图，人工核对版式 | **35 / 35** |
| 手机窄屏 | 3 种宽度 × 19 个场景：溢出 / 文字挤扁 / 触摸交互 | **57 次诊断零异常 + 46 项交互全绿** |
| APK | 产物 MD5 比对、权限白名单、v2+v3 签名 | **16 / 16** |

几个踩过的坑，都留在了验证脚本里当断言：

- 底部栏 8 个按钮**一个都没绑上点击事件**的时候，前六层照样全绿 —— 布局层测不了交互。
- `<select>` 的**自动最小尺寸等于它最宽那个 `<option>`**（约 430px）且拒绝收缩，会把同行说明文字啃到只剩 1 个字宽。溢出诊断完全看不见（`scrollWidth` 一点没变，恰恰相反是文字被压到最窄），必须单独量「说明块宽 / 所在行宽」。
- 数据里有 **171 条**释义首行不含中文（ECDICT 把 `adv.` 切成了 `ad` + `v.` 两段），而**选择题的正确项取的就是这一行** —— 正确选项会显示成一个孤零零的 `ad`，一道没法做的废题。清洗挂在构建流程里，不是跑一次就算。

## 自己构建

构建链是纯 Node.js + Python，不需要 Android Studio。

```bash
# 组装单文件产物（内置语法预检；数据没问题就直接出 dist/）
node _dev/build.js

# 八层验证
node _dev/check-structure.js "dist/词匠-离线背单词.html" _dev/check.txt   # 结构：0 错误 / 0 警告
node _dev/test-logic.js     "dist/词匠-离线背单词.html"                  # 逻辑回归
node _dev/verify-settings.js                                             # 真实 Chrome：设置面板
node _dev/verify-read.js                                                 # 真实 Chrome：精读模块
node _dev/verify-cn.js      "dist/词匠-离线背单词.html"                  # 用抓下来的真实网页夹具跑解析
node _dev/shot.js                                                        # 35 张界面截图
node _dev/check-mobile-view.js                                           # 手机窄屏：溢出 / 挤扁 / 交互
node _dev/verify-cn-live.js                                              # 端到端（需要真实网络）
```

打包 APK 不需要 Gradle / Android Studio，只要 JDK 17 + Android build-tools。
打包脚本在工作区之外的技能目录里（`build-apk.js` / `verify-apk.js`），
仓库里放的是配置模板与 `apk-src/` 工程骨架。

**先复制一份配置模板**，把里面的 `<...>` 占位符改成你自己机器上的值：

```bash
cp apk.config.example.json apk.config.json    # 然后编辑 apk.config.json
```

```bash
node <skills>/single-html-to-apk/scripts/build-apk.js  apk.config.json
node <skills>/single-html-to-apk/scripts/verify-apk.js apk.config.json
```

> ⚠️ **真正的 `apk.config.json` 不在仓库里**，因为它含签名口令与本机路径
> （`keystorePass`、Android SDK 目录、含城市的签名信息）。模板是 `apk.config.example.json`。
>
> ⚠️ 签名密钥库（`apk-src/keystore/`）同样不入库。自己打包时生成一个新的即可 ——
> 密钥是你的签名身份，公开之后别人就能签出「同包名同签名」的包，可以覆盖安装你的更新。
> `*.jks` / `*.keystore` / `*.p12` / `*.pfx` 都写在 `.gitignore` 里了。

### 关于行尾（`.gitattributes`）

文本文件统一锁成 LF。这不是洁癖 —— `dist/词匠-离线背单词.html` 的**字节数与 MD5 是 APK 的校验基线**
（打包脚本会拿 `assets/index.html` 跟它比对），一旦某次 clone 把几千个换行改成 CRLF，
产物会凭空变大、校验莫名其妙变红，而代码其实一行没改。

反过来，`_dev/_cd_*.html` / `_dev/_gt_*.html` / `_dev/_gt_feed.txt` 这些**抓下来的真实网页与 RSS 夹具**
标了 `-text`，**逐字节原样保存** —— 它们是外部世界的快照，归一化行尾等于偷偷改了测试依据。

### 重建词库数据

`build/data_*.json` 已经提交，正常情况下不需要重建。
如果要重建整条数据链（从 ECDICT 65 MB 原始词典开始跑 ETL），
`raw/ecdict.csv` 等大文件需要自行下载，脚本在 `_dev/etl.py` 与 `_dev/prep_*.{js,py}`。

## 目录结构

```
build/          源码分片（构建时拼成一个 HTML）
  part1_head.html   CSS 设计系统 + 7 套主题
  part2_body.html   SVG 图标 + 页面骨架
  part3_app.js      引擎：数据字段表、记忆算法、卡片、路由、设置
  part3b_read.js    精读引擎：联网唯一出口 + 域名白名单、取文、语言画像
  part4_views.js    视图层（10 个视图）
  part4b_read.js    精读界面
  data_*.json       词库数据（词条 / 词书 / 词根 / 易混词组）
_dev/           构建脚本、ETL 脚本、八层验证脚本，以及精读用的真实网页夹具
dist/           构建产物：单文件 HTML
preview/        界面截图
apk-src/        APK 工程（Manifest + MainActivity.java + 资源）
docs/           功能分析文档
raw/            人工校对的词表与语料（大文件不入库，见 .gitignore）
.gitattributes  行尾与二进制规则（产物字节可复现，夹具逐字节保真）
apk.config.example.json   打包配置模板（复制成 apk.config.json 再用）
```

### 仓库里没有的东西

| 内容 | 为什么不在 | 怎么获取 |
|---|---|---|
| `apk-src/keystore/*.jks` | 签名身份，公开等于把签名权交出去 | 自己生成一个新的 |
| `apk.config.json` | 含签名口令与本机路径 | 复制 `apk.config.example.json` 改 |
| `raw/ecdict.csv` | 62.9 MB，有公开出处 | 从 [ECDICT](https://github.com/skywind3000/ECDICT) 下载 |
| `raw/npm*/` `raw/qwerty/` | 大体积第三方语料包 | 见 `_dev/dl_*.js` 里的下载地址 |
| `_dev/_probe_*` `_dev/probe*` | 开发时随手写的一次性排查脚本 | 不需要 |
| `_dev/*.txt`（除 `_gt_feed.txt`） | 运行日志与统计快照 | 自己跑脚本生成 |

## 设计上的几个取舍

**为什么是单文件 HTML 而不是普通网页应用？**
因为「离线可用」是硬要求。只要数据还在服务器上、或者要联网校验，就不算真的离线。
代价是文件大（11.6 MB）、每次改代码都要重新构建 —— 换来的是双击就能用、不依赖任何服务。

**为什么学习记录不存云端？**
不想让「我的学习数据」变成别人的资产，也不想为了同步功能引入账号体系。
数据在浏览器 localStorage 里，可以导出。

**精读为什么用公益 CORS 中转？**
China Daily 的文章页不发放跨域头，浏览器直接取不到正文。方案是「先直连，失败再走公共中转」，
并给了「换成环球时报（全程直连）」的退路。中转服务会限流甚至挂掉 —— 这是已知的可靠性上限，
界面上会如实说明原因，而不是静默失败。

## 数据来源

- [ECDICT](https://github.com/skywind3000/ECDICT) —— 词典主数据（MIT License）
- [Tatoeba](https://tatoeba.org/) —— 例句语料（CC-BY 2.0 FR）
- [WordNet](https://wordnet.princeton.edu/) —— 同义词 / 反义词
- 大学英语四六级考试大纲词汇表 —— 词书范围

## License

[MIT](LICENSE)

---

可用 Chrome 打开、可装安卓、可离线跑、可自己改。就这样。
