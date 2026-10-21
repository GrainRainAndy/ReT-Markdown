# ReT Markdown

面向个人使用的本地 macOS Markdown 编辑器。采用 AppKit 文稿外壳、WKWebView 和 TypeScript 源文编辑核心；目标是单区实时编辑、普通 `.md` 文件保真、离线公式与图片，以及固定版式 PDF 导出。

当前候选为 **0.1.0-rc.1 / ba965c55**，正式版目标为 **0.1.0**。本轮交互补修及关闭确认修复已通过独立审查、完整自动检查和 canonical 包校验。**固定 QA 已更新，代码块、剪贴板、标题、段落、列表和关闭流程的原生重放通过；真实 IME 预编辑退格仍待确认，完整 V1 验收仍待完成。** 详情见[交互补修报告](docs/testing/0.1.0-rc.1-interaction-implementation.md)、[原生补验](docs/testing/0.1.0-rc.1-native-interaction.md)和[缺陷处理流程](docs/testing/editor-interaction-workflow.md)。

本轮不可变构建为 [`build/releases/0.1.0-rc.1/465505e-ba965c55/ReT Markdown.app`](build/releases/0.1.0-rc.1/465505e-ba965c55/ReT%20Markdown.app)；[源码清单](build/verification/0.1.0-rc.1/interaction-implementation-20261021/source-inputs.json)、[包清单](build/verification/0.1.0-rc.1/interaction-implementation-20261021/bundle.json)及[验证记录](build/verification/0.1.0-rc.1/interaction-implementation-20261021/verification.json)保存完整身份和结果。固定 QA current.json 已对应本轮身份，历史候选证据继续保留。

2026-10-16 的版本化包 [`build/releases/0.1.0-rc.1/ReT Markdown.app`](build/releases/0.1.0-rc.1/ReT%20Markdown.app)、构建/签名校验、9 类反馈修复及二次复验、原生打开/查找/另存为/PDF 抽查均为**历史证据**，不证明本轮源码或最终候选通过。详见[候选版本说明](docs/releases/0.1.0-rc.1.md)和[验收状态](docs/testing/acceptance-status.md)，需求以[基线文档](docs/specs/2026-10-14-markdown-editor-design.md)为准。历史应用副本及验收证据保留原路径。

原生验证前按 [QA 身份流程](docs/testing/qa-application-identity.md)核对主控指定的包与 QA 身份；运行中的 QA 不替换、不自动退出，不触碰用户未保存文稿。`⌘/`切换源码模式，`⌘S`保存，`⌘⇧S`另存为，`⌘⇧E`导出PDF，`⌘`点击正文链接打开浏览器。每个原生窗口只有一份文稿，没有多标签页或侧边栏。

## 开发

当前开发环境为 Apple Silicon Mac、Xcode 27、Swift 6.4、Node 26、npm 12。首版仅在当前 macOS 环境验收。

```sh
npm ci --cache /private/tmp/ret-markdown-npm
npx playwright install chromium
export RET_CHROMIUM="$(node --input-type=module -e 'import { chromium } from "playwright"; process.stdout.write(chromium.executablePath())')"
python3 scripts/generate-fixtures.py
npm test
npm run typecheck
npm run test:interaction
bash scripts/build-app.sh
```

`test:interaction` 自动收集 `web/test/*.spec.ts`，覆盖真实浏览器的键盘、鼠标、投影和撤销操作链，失败附件写入 `build/test-results/playwright/`。它不能替代 WKWebView 的真实输入法及原生保存验收；新增编辑行为按[交互缺陷处理流程](docs/testing/editor-interaction-workflow.md)补充契约、失败回归和相邻结构检查。

`npm ci` 不安装浏览器。上述 `RET_CHROMIUM` 指向当前 lockfile 对应的 Playwright Chromium；也可指定已有兼容 Chromium 的可执行文件。未设置时，测试保留本机旧缓存的 Apple Silicon 路径回退，新环境应使用显式路径。

原生构建脚本以 `package.json` 的 `version` 为唯一发布版本来源，默认生成 `build/releases/0.1.0-rc.1/ReT Markdown.app`；默认输出路径本身不证明候选身份，实际验证入口以主控冻结记录和 QA 身份核对为准。包内 `CFBundleShortVersionString` 为纯数字 `0.1.0`，`CFBundleVersion` 为构建号 `1`，`ReTReleaseVersion` 保存完整的 `0.1.0-rc.1`。构建阶段下载依赖；产品的编辑、公式、图片和 PDF 核心工作流要求离线可用。

需要并存候选构建时，可通过 `RET_APP_OUTPUT` 指定完整 app 路径，例如 `RET_APP_OUTPUT="$PWD/build/releases/0.1.0-rc.1-isolated/ReT Markdown.app" bash scripts/build-app.sh`；路径覆盖不改变包内版本或产品显示名。请使用新的输出路径保留原应用副本。历史 `reacceptance` 脚本、日志与报告继续保留原名，维持证据链。

## 项目资料

- [架构与模块接口](docs/architecture/2026-10-14-native-editor.md)
- [实施计划](docs/plans/2026-10-14-editor-implementation.md)
- [GitHub 排版视觉基准](docs/references/typora-github-visual-baseline.md)
- [需求复核与验收输入](docs/testing/requirements-review.md)

`analysis/` 保存 Typora 的本地分析证据，与独立实现的应用代码分开维护。应用不加载其中的实现文件。
