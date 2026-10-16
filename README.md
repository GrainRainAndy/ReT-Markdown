# ReT Markdown

面向个人使用的本地 macOS Markdown 编辑器。采用 AppKit 文稿外壳、WKWebView 和 TypeScript 源文编辑核心；目标是单区实时编辑、普通 `.md` 文件保真、离线公式与图片，以及固定版式 PDF 导出。

当前发布候选版本为 **0.1.0-rc.1**，规范构建路径：[`build/releases/0.1.0-rc.1/ReT Markdown.app`](build/releases/0.1.0-rc.1/ReT%20Markdown.app)。版本化 app 已完成 Release 构建、资源及签名校验，独立 QA 副本已完成原生打开、查找、另存为及 PDF 导出抽查。单区实时／源码编辑、表格单元格、源文保真、图片资源、原生保存恢复和PDF导出已接入；2026-10-16的9类反馈及二次复验的公式上下文、表格查找边界已修复并独立复核，完整首版验收仍待真实输入法、系统生命周期、视觉对照及原生性能检查。RC 不代表 V1 验收通过；正式版目标为 **0.1.0**。详见[候选版本说明](docs/releases/0.1.0-rc.1.md)和[验收状态](docs/testing/acceptance-status.md)，需求以[基线文档](docs/specs/2026-10-14-markdown-editor-design.md)为准。历史应用副本及验收证据保留原路径。

先保存文稿并退出旧版，再通过Finder打开当前候选。`⌘/`切换源码模式，`⌘S`保存，`⌘⇧S`另存为，`⌘⇧E`导出PDF，`⌘`点击正文链接打开浏览器。每个原生窗口只有一份文稿，没有多标签页或侧边栏。

## 开发

当前开发环境为 Apple Silicon Mac、Xcode 27、Swift 6.4、Node 26、npm 12。首版仅在当前 macOS 环境验收。

```sh
npm ci --cache /private/tmp/ret-markdown-npm
python3 scripts/generate-fixtures.py
npm test
npm run typecheck
bash scripts/build-app.sh
```

原生构建脚本以 `package.json` 的 `version` 为唯一发布版本来源，默认生成 `build/releases/0.1.0-rc.1/ReT Markdown.app`，构建校验后通过 Finder 打开。包内 `CFBundleShortVersionString` 为纯数字 `0.1.0`，`CFBundleVersion` 为构建号 `1`，`ReTReleaseVersion` 保存完整的 `0.1.0-rc.1`。构建阶段下载依赖；产品的编辑、公式、图片和 PDF 核心工作流要求离线可用。

需要并存候选构建时，可通过 `RET_APP_OUTPUT` 指定完整 app 路径，例如 `RET_APP_OUTPUT="$PWD/build/releases/0.1.0-rc.1-isolated/ReT Markdown.app" bash scripts/build-app.sh`；路径覆盖不改变包内版本或产品显示名。请使用新的输出路径保留原应用副本。历史 `reacceptance` 脚本、日志与报告继续保留原名，维持证据链。

## 项目资料

- [架构与模块接口](docs/architecture/2026-10-14-native-editor.md)
- [实施计划](docs/plans/2026-10-14-editor-implementation.md)
- [GitHub 排版视觉基准](docs/references/typora-github-visual-baseline.md)
- [需求复核与验收输入](docs/testing/requirements-review.md)

`analysis/` 保存 Typora 的本地分析证据，与独立实现的应用代码分开维护。应用不加载其中的实现文件。
