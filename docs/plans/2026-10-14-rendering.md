# Offline Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** 提供供编辑器、带格式复制和 PDF 共用的离线 Markdown 渲染与 GitHub 样式。

**Architecture:** 纯 TypeScript 渲染模块接受源文和显式的本地图片解析器，返回 HTML 与可定位问题。排版、配色和打印规则独立；原生接口由总架构定义。

**Tech Stack:** TypeScript、markdown-it、KaTeX、highlight.js、CodeMirror 6（后续编辑任务使用）、esbuild、Vitest、Playwright。

**Spec:** `docs/specs/2026-10-14-markdown-editor-design.md`，尤其 F08、F14、F16、F19、F20、C19；视觉基准 `docs/references/typora-github-visual-baseline.md`。

## Global Constraints

- Markdown 源文是持久化的权威内容。
- 首版仅渲染本地图片；远程图片引用保留并显示占位。
- 字体资源离线提供，不能引入主题文件中用于导出的远程字体加载行为。
- PDF 使用 A4 纵向、白底、四边 20 mm，不添加页眉页脚页码。
- 不复制 Typora 的应用实现文件；按观察数值独立实现样式。

## Review Focus

恶意或不支持的 HTML 不执行；远程图片及不安全链接不发请求；未闭合和错误公式保留源文并定位；中文与空格路径可解析；打印长代码及表格不裁切。

### Task 1: 渲染、离线资源与样式

**Files:** Create `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `web/src/render/markdown.ts`, `web/src/render/math.ts`, `web/styles/{typography,palette,print,fonts}.css`, `web/test/render.test.ts`, `scripts/build-web.mjs`, `web/index.html`; rendered output in `build/web/`。根配置由本任务唯一拥有。

**Interfaces:** Export `renderMarkdown(source: string, options?: RenderOptions): RenderResult` with `RenderOptions { resolveImage?: (destination: string) => string | null }`, `RenderResult { html: string; issues: RenderIssue[] }`, `RenderIssue { kind: 'math' | 'image'; message: string; from: number; to: number }` using UTF-16 source offsets. Export `plainText(source: string): string` and `richClipboard(source: string, options?: RenderOptions): { html: string; text: string }`. Remote image placeholders are expected and not export-blocking issues. Resolved local image URL must be explicitly supplied; otherwise local image is missing. Pure rendering must not modify source or access network/files.

- [ ] Write and run failing behavioral tests for headings/GFM/table/math/highlight, unsupported HTML, safe links, remote placeholders, missing images, formula errors, Unicode offsets, plain/rich clipboard.
- [ ] Implement renderer and independent CSS following exact visual baseline. Use `trust:false` math, escaped raw HTML, no network font imports. Print stylesheet handles overflow/wrapping and page-break constraints; native host owns physical page margin.
- [ ] Install dependencies with project lockfile and writable npm cache; package offline Open Sans and KaTeX fonts and preserve licenses. Include editor dependencies for later tasks without building editor behavior here.
- [ ] Provide reproducible build script exporting a reusable resource-copy helper or a documented `npm run build:web` contract; later editor entry is `web/src/main.ts` (do not create it in this task). Initial renderer-only entry allowed as `web/src/render-entry.ts`.
- [ ] Run `npm test` and `npm run typecheck`, and build the renderer resources. Write RED/GREEN evidence, versions, changed paths and any limitations to `docs/testing/rendering-report.md`. No Git commit (repository not initialized).
