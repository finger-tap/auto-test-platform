# Midscene 报告页面 Branding 改造方案

> 调研日期:2026-06-29
> 本地 midscene 源码版本:`/Users/dinghao/工作/midscene` main HEAD `948eded94`,对应 v1.10.0
> 项目版本:`@midscene/* @ ^1.8.7`(已锁定 `1.8.7`,但 `^` 解析会跳到 `1.9.x`/`1.10.x`)

## 1. 问题

项目 Web / PC / Mobile 测试报告 iframe 内嵌 midscene 生成的 HTML 报告,页面里包含 midscene 自己的品牌字样(`Midscene Report` 大标题、Midscene logo、`midscenejs.com` 跳转、`<title>Report - Midscene.js</title>` 等),显示成"是 midscene 的产品",不是我们的产品。

## 2. midscene 公开 API 不支持自定义模板

`@midscene/core` 的 `ReportGenerator` / agent 构造参数里所有可调项(`reportFileName` / `outputFormat` / `groupName` / `groupDescription` / `reportAttributes.testTitle` 等)都**不能改 HTML 模板内容**。模板来源是源码里的一个固定字符串。

## 3. 报告模板注入链路(1.10.0 验证)

```
[构建阶段 — pnpm run build]
  apps/report/template/index.html        ← rsbuild 入口 HTML 模板(17 行)
    ↓ rsbuild 构建出 apps/report/dist/index.html(webpack 打包好的 SPA)
  apps/report/rsbuild.config.ts:copyReportTemplate 钩子
    ↓ 读 dist/index.html,移除 magicString
    ↓ 调用 buildReportTemplateInjection() 生成 finalContent
    ↓ 写回到 packages/core/dist/{lib,es}/utils.js 的
       /*REPORT_HTML_REPLACED*/"..." 占位
  packages/core/rslib.config.ts:injectReportTemplate 钩子
    ↓ 同样的字符串注入逻辑(MIDSCENE_SKIP_REPORT_TEMPLATE_INJECTION=1 可跳过)

[运行阶段 — executor 调 agent]
  @midscene/core/src/utils.ts:getReportTpl()
    ↓ 返回 dist/lib/utils.js 里 /*REPORT_HTML_REPLACED*/"..." 整段 HTML
  agent.finalize() → fs.writeFile(reportPath, HTML)

[历史兼容]
  @midscene/core/src/utils.ts:__DEV_REPORT_PATH__
    ↓ USE_DEV_REPORT=1 时直接读 apps/report/dist/index.html,不嵌入
```

### 1.9.1 → 1.10.0 的逻辑变更(已验证)

| 文件 | 变更 |
|---|---|
| `packages/core/src/utils.ts` | `</script>` 闭合改 `String.fromCharCode` 拼接(防 XSS)。不影响 reportTpl 路径 |
| `packages/core/rslib.config.ts` + `apps/report/rsbuild.config.ts` | 把 magicString/replacedMark/regex 抽到 `scripts/report-template-utils.mjs`,行为等价 |
| `apps/report/template/index.html` | **未改动** |
| `packages/visualizer/src/component/logo/index.tsx` | **未改动** |

**结论**:升级前后报告生成逻辑等价,branding 字符串位置没变。

## 4. 可改的 8 行 branding(实测在 1.10.0 源码)

| 文件 | 行 | 当前内容 | 改成 |
|---|---|---|---|
| `apps/report/template/index.html` | 4 | `<title>Report - Midscene.js</title>` | `<title>AutoTest Platform - 测试报告</title>` |
| `apps/report/template/index.html` | 6-10 | favicon URL `lf3-static.bytednsdoc.com/obj/eden-cn/...favicon-32x32.png` | 指向自有 favicon(或删掉整段) |
| `packages/visualizer/src/component/logo/index.tsx` | 5 | `LogoUrl = '...Midscene.png'` | 指向自有 32x32 logo |
| `packages/visualizer/src/component/logo/index.tsx` | 8 | `LogoUrlLight = '...midscene_with_text_light.png'` | 自有亮色 logo |
| `packages/visualizer/src/component/logo/index.tsx` | 10 | `LogoUrlDark = '...midscene_with_text_dark.png'` | 自有暗色 logo |
| `packages/visualizer/src/component/logo/index.tsx` | 23 | `<a href="https://midscenejs.com/">` | 改 # 或自家官网 |
| `packages/visualizer/src/component/logo/index.tsx` | 24 | `<img alt="Midscene_logo" ...>` | 改 alt |
| `apps/report/src/App.tsx` | 509 | `message="Midscene.js - Error"` | 改自家文案 |

## 5. 改不动的(知道边界)

- **`webpackChunk_midscene_report`**:webpack output library 名,改了就崩
- **`Midscene Report` / `Midscene Codex Provider`**:1.10.0 源码里没找到对应 .tsx 静态字符串,可能是从 dump 数据(`codex_app_server` adapter 名)动态渲染,不在源码层
- **`logo/index.tsx` 里 `hideLogo=true` 已经是 props** — 可以从调用方传 `hideLogo` 把 logo 整个隐藏,但会显得报告"无品牌",不如换成自家 logo

## 6. 推荐方案:本地源码 + pnpm overrides

不走 fork(后续升级维护成本高),也不走后处理正则(易误伤压缩 JS)。本地源码改 8 行 + 项目用 `pnpm.overrides` 引用 file:。

### 6.1 准备本地 midscene 源码

```bash
cd /Users/dinghao/工作/midscene
# 已经 main HEAD 948eded94 = v1.10.0,工作区干净,无需升级
# 应用 8 行改动后:
pnpm install
pnpm run build:skip-cache   # 触发 reportTpl 注入,产出 packages/core/dist
```

### 6.2 项目侧 pnpm overrides

`package.json` 里加(当前锁的是 1.8.7,先把 `^1.8.7` 改成 `^1.10.0` 或 `workspace:*`):

```json
{
  "dependencies": {
    "@midscene/core": "^1.10.0",
    "@midscene/web": "^1.10.0",
    "@midscene/computer": "^1.10.0",
    "@midscene/android": "^1.10.0",
    "@midscene/ios": "^1.10.0",
    "@midscene/harmony": "^1.10.0"
  },
  "pnpm": {
    "overrides": {
      "@midscene/core": "file:/Users/dinghao/工作/midscene/packages/core",
      "@midscene/web": "file:/Users/dinghao/工作/midscene/packages/web",
      "@midscene/computer": "file:/Users/dinghao/工作/midscene/packages/computer",
      "@midscene/android": "file:/Users/dinghao/工作/midscene/packages/android",
      "@midscene/ios": "file:/Users/dinghao/工作/midscene/packages/ios",
      "@midscene/harmony": "file:/Users/dinghao/工作/midscene/packages/harmony",
      "@midscene/visualizer": "file:/Users/dinghao/工作/midscene/packages/visualizer"
    }
  }
}
```

然后 `pnpm install` 触发重新链接。

### 6.3 升级流程(每次 midscene 上游发版)

```bash
cd /Users/dinghao/工作/midscene
git fetch --tags && git checkout main && git pull
# 应用/同步 branding 改动(8 行 diff)
pnpm install && pnpm run build:skip-cache

cd /Users/dinghao/工作/auto-test-platform
pnpm install    # 重新链接 file: 引用
```

### 6.4 改动工作量

- 一次性:8 行改动 + 跑构建 + 配 pnpm.overrides + 验证报告生成 ≈ 1-2 小时
- 后续升级:同步 branding diff + 重新构建 ≈ 30-60 分钟

## 7. 备选方案(不推荐但列出来)

### 备选 A:patch-package

只 patch `node_modules/@midscene/core/dist/lib/utils.js` 里的 `/*REPORT_HTML_REPLACED*/` 字符串。**只能换 `<title>` 和 favicon**,改不了 visualizer 包里的 logo(那是另一个独立 npm 包,运行时从 @midscene/visualizer 引用)。

### 备选 B:post-process 整份 HTML

executor 落盘后用正则批量替换字符串。**风险高**:压缩 JS 里的 prop 字符串、localStorage key、CSS 类名都包含"Midscene"字样,正则容易误伤 React 组件挂载。

### 备选 C:fork 整个 midscene monorepo

改动全,但失去 `pnpm install @midscene/web@latest` 升级能力。每次升级要 cherry-pick 或 rebase,长期成本高。

## 8. 相关文件清单(本项目侧)

虽然不在本次改动范围,但报告 URL/存储路径在以下位置,改 branding 不影响它们:

- `src/server/index.ts:93` — `app.use('/midscene-reports', serveMidsceneReport)`(URL 路径,有 midscene 字样但和 branding 无关)
- `src/server/engine/report-paths.ts` — 报告生成路径、URL 模板
- `src/server/midscene-reports-static.ts` — 静态服务中间件
- `src/client/components/MidsceneReportViewer.tsx` — iframe viewer(label 默认 "Midscene 报告")
- `src/client/components/tabs/LogTab.tsx` — 报告列表 tab,`reportLabel` 默认 "最近一次执行的 Midscene 报告"

如果要全平台重塑品牌(包括 URL/路径/列名),再起一份单独的重构文档。