# ReT Markdown 初版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 交付从零实现的可运行 macOS 初版，支持结构化 Markdown 编辑、源码模式、文件/资源工作流及 PDF，供用户实际体验。

**Architecture:** AppKit/NSDocument + WKWebView 宿主；TypeScript 根源文事务与结构投影；ProseMirror 正文、CodeMirror 源码/字面输入；显式版本化协议。

**Tech Stack:** Swift 6、TypeScript、ProseMirror、CodeMirror 6、mdast/micromark、KaTeX、esbuild、Vitest、Playwright。全部新建依赖清单和工程，不读取或复制 legacy 产品实现。

**Spec:** `docs/specs/requirements.md`, `docs/specs/editing-contracts.md`, `docs/architecture/technical-design.md`。

## Global Constraints

- 用户已于本轮批准实现并要求初版产出后查看；连续执行，细化规则的合理实现选择记入日志。
- 工作在 `rewrite/from-zero`，保留 legacy 分支和 Typora/analysis，不从旧 Sources/web 复制实现。
- macOS 本地、普通 UTF-8 Markdown、每窗口一文档；源文保真、统一撤销、离线能力为硬约束。
- UI 16 CSS px/1.6、860 px 基础宽度、30 px 水平边距、GitHub 风格；不添加固定侧边栏或格式工具条。
- 初版版本 `0.2.0-alpha.1`，应用显示 `ReT Markdown Preview`，bundle ID `com.retmarkdown.rewrite.preview`，与旧应用隔离。
- 构建输出 `build/rewrite/0.2.0-alpha.1/ReT Markdown Preview.app`；不覆盖旧 build 路径。
- 初版不等于最终验收通过；未完成的原生/性能门槛必须明确列入验收记录，不以浏览器合成 IME 代替系统输入法。

## Review Focus

- CRLF/BOM/EOF 与 emoji 修改不得因投影或源码切换漂移（Task 1/2）。
- IME 与异步投影、保存/关闭交错不能丢最终文字（Task 2/3/5）。
- 旧 revision 完成保存不能将新输入标为 clean（Task 1/3）。
- 相对资源、特殊字符路径、另存及失败回滚不得保存断裂引用（Task 3/4）。
- 序列化不支持的结构必须保留源文和恢复入口，不能悄悄丢失（Task 1/2）。

## Shared host protocol

`Envelope = {v:1,documentId:string,epoch:string,requestId:string,method:string,payload:object}`。
Web → native：`window.webkit.messageHandlers.ret.postMessage(envelope)`。
Native → web：`window.retNative.receive(envelope)`。

- Web `ready`：载荷空；宿主以 `load` 返回 `{source:string,displayName:string,fileURL:string|null,revision:number,appearance:'system'|'light'|'dark'}`。source 包含原 BOM/CRLF（JS 核心自行保留）。初次 ready 允许 documentId/epoch 为空，宿主 load 分配身份；之后所有请求须匹配。
- Web `checkpoint`：`{source,revision,dirty}`；宿主只接受递增版本，记录接收与恢复持久化。Web 保存命令为 `save`、`saveAs`、`exportPDF`、`open`、`new`。
- Native `flush`：web 若 composition/recovery draft pending 返回 `flushResult {status:'pending',reason}`；否则返回 `{status:'ready',source,revision}`，沿用 requestId。
- Native `saved`：`{source,revision}`；只确认该源文，当前文档不等于它时仍 dirty。
- Native `command`：`{id:string}`；包括 undo/redo/toggleSource/find/replace/bold/italic/link/heading1…heading6/bulletList/orderedList/quote/codeBlock/mathBlock/table/insertImage。
- Web `importImage`：`{dataURL?:string,fileName?:string}`，空载荷启动原生文件选择器，或 `{source:'clipboard'}` 明确只取系统剪贴板中的图片（即使同时有文字）。clipboard 来源与 dataURL 不可同时提供；native `assetResult {relativePath,requestId,error?}` 的 envelope requestId 必须匹配待处理请求，payload requestId 若存在必须与之相同。成功后 web 作为一次根事务插入引用。
- Web `exportContent` 响应宿主 `prepareExport`：`{html,revision}`；html 是冻结源文的独立安全渲染内容，包含本地 CSS/公式，无编辑DOM；宿主独立打印WebView。
- Native `appearance`：`{mode:'system'|'light'|'dark'}`；native `error`：`{message,operation}`。
- 浏览器无 bridge 时具有内存文稿、下载/文件选择开发回退，但不冒称原生保存成功。
- Web `recoveryDraft`：`{draft:{baseRevision,owner,format:'text'|'prosemirror-json',content,recoverySource?,reason}|null}`，非空草稿须基于当前 received revision；原生持久化真实内容，不解释 PM JSON。null 明确清除已恢复/放弃的草稿；草稿未处理时阻止手动保存/关闭。
- Native `checkpointAck`：`{revision,stage:'received'|'durable'}`，沿用 checkpoint requestId；仅对应版本恢复记录成功落盘后发送 durable。`load` 可携带 `recoveryDraft`，恢复副本及渲染进程重启均交还草稿。
- 草稿内容恢复以 `checkpoint.resolvesRecoveryDraft:true` 原子提交新正文并清除草稿；待恢复期间拒绝普通 checkpoint。先清草稿、再发布正文会产生崩溃丢字窗口，因此 null 仅用于明确放弃或无内容变化的恢复。
- Native `load.savedSource` 传递真实已保存正文基线，恢复副本/渲染器重启后不能把收到的 dirty 正文误标为 clean。Web 本地 revision 从 0 开始时，协议版本统一加 `load.revision` 基线。

---

### Task 1: 文档核心、无损解析与新工程

**Files:** 新建 package.json/lock、tsconfig.json、vitest.config.ts；`editor/core/{document,history,types}.ts`；`editor/syntax/{parse,projection,mapping}.ts`；`tests/core/*.test.ts`。

**Interfaces:** `DocumentSession(source:string)` 提供 source/revision/dirty/selection、apply(patches,selection,group)、undo/redo、markSaved(source)、subscribe；patch 范围为 UTF16；构建纯 `parseDocument(source)` 与 `buildProjection(source)` 供 UI 使用，保留原文范围、raw/gap/inline 来源，接口实际结果记录报告。无需产品 UI。

- [x] 写 failing tests：`A\r\n\r\nB` 只改 B→C，源文为 `A\r\n\r\nC`；撤销原样恢复；源文 BOM/EOF/空行往返；旧保存确认不清除新内容；非法重叠和越界补丁拒绝；连续用户事务 root history。
- [x] `npm test -- tests/core` 观察缺失实现的 RED，然后实现；新 package 锁定下载版本，旧 node_modules 不能当依赖来源。
- [x] 解析测试：列表/引用/围栏/数学/表格、Setext、unknown/raw、gap、转义与引用定义均保留原范围；源文全覆盖且投影位置可映射。
- [x] 运行核心全部测试和 typecheck，提交；报告明确 G1 已证实和未知部分。

### Task 2: 结构化编辑器和交互工作流

**Files:** `editor/surfaces/*.ts`、`editor/render/*.ts`、`editor/protocol/host.ts`、`editor/main.ts`、`editor/index.html`、`editor/styles.css`、`scripts/build-web.mjs`、`tests/browser/*.spec.ts`、playwright.config.ts。

**Interfaces:** 消费 Task 1 根事务/投影。实现上述 host protocol；暴露仅生产用 `window.retNative.receive`，不依赖测试专用生产接口。bundle 入口 dist/web/index.html，资源离线。

- [x] 写真实浏览器 failing tests：段落 Enter/Backspace、源码切换保真、输入加粗文本、代码块/公式字面域、Undo/Redo、表格导航/修改、查找替换。先观测 RED。
- [x] 用 ProseMirror 结构视图及 CodeMirror 源码适配根事务；根源文局部 patch，禁止整文 Markdown 重排。未支持语法 raw block 可编辑；组合输入保持活动DOM；失败 RecoveryDraft 可恢复，不伪装保存。
- [x] 实现契约 E01–E45 对应能力：列表子树、标题、代码退出、数学、表格、剪贴板、选择；以明确安全行为补边界，不凭旧实现结果猜测。
- [x] 建立独立 Markdown/KaTeX 安全渲染与打印样式，渲染不运行原始 HTML，不主动加载远程图；键盘可操作的 find/replace 和轻量状态栏（不增加固定格式工具条）。
- [x] 运行 npm test/typecheck/browser tests 并写结果，提交供原生接入。

### Task 3: 原生文稿与持久化

**Files:** `native/Package.swift`、`native/Sources/ReTPreview/{App,Document,EditorHost,Menus,Persistence,Recovery,Protocol}.swift`、`native/Tests/*`、`scripts/build-app.sh`。

**Interfaces:** 实现 shared host protocol，加载 dist/web。App 启动按 NSDocument 标准新建/打开流程。数据以原始UTF8持久化，能打开现有文件；全新标识和输出路径。

- [x] 原生纯存储测试先 RED：UTF8/BOM精确保留、保存失败保留原件、received/durable 区分、旧revision与epoch拒绝、保存N期间N+1仍dirty、恢复损坏退回上一份。
- [x] 从零实现 NSDocument 宿主、菜单、系统打开/保存/另存/关闭、flush barrier、多窗口身份隔离、恢复持久化及外部变化处理；不阻塞主线程等待 JS。
- [x] Web 消息限定可信主frame、schema/身份/请求验证；外链系统打开、网页导航限制；窗口关闭 pending/取消/放弃明确，不用旧响应清掉新状态。
- [x] `swift test --package-path native`，新 bundle 构建与签名检查，提交。

### Task 4: 资产和 PDF 垂直链

**Files:** `native/Sources/ReTPreview/{Assets,Export}.swift`、相应Tests；必要的 editor protocol/render 适配。

**Interfaces:** importImage/assetResult、prepareExport/exportContent；应用自身 assets 根与 draft 目录，独立打印 WebView。

- [x] 写失败测试：资产重名不覆盖、路径转义、未命名首存迁移、另存保持引用、取消/失败不改文稿；PDF输出来自固定revision。
- [x] 实现图片选择/拖放/粘贴、资源journal和幂等；复制成功后再插入引用；删除引用不删除资源。实现独立 A4/20mm PDF，打印字体/公式/图片就绪后输出，取消与替换协调。
- [x] 运行 native+web测试、构建，生成实际样本PDF并检查页面尺寸、提取中文/代码与渲染分页，提交。

### Task 5: 原生验收、审查与初版交付

**Files:** `fixtures/preview.md`、`docs/verification/initial-preview.md`、README；缺陷修复按失败测试覆盖。

**Interfaces:** 打包 Task1–4 的最终同一版本；在独立文稿中通过 Computer Use 打开应用、输入、切模式、保存重开、Undo、公式/表格与PDF。

- [x] 运行完整 npm test/typecheck/browser suite、swift test、构建、参考物核验；冻结源码与包身份，不复用旧成绩。
- [x] 执行可用的真实应用关键路径及原生集成验证；原生自动化后续持续超时，真实IME/完整GUI/性能/VoiceOver明确记未验收。补充重载、恢复与焦点边界的失败回归并修复。
- [x] 独立完整代码审查，修复阻断问题并复验；记录范围差异和待验收项。
- [x] 留下可运行app、使用说明和验收记录，提交；不推送/替换用户旧app。用户在初版后体验反馈。

2026-10-23 初版生产源码冻结于 `836d5eb`：126 单元、80 浏览器、62 原生测试及类型检查、构建、严格签名通过，审查残余问题全部关闭。上述完成指 alpha 交付工作完成，不等于真实输入法、性能、辅助功能或 G1–G5 发布门槛通过；详见[初版验收记录](../../verification/initial-preview.md)。
