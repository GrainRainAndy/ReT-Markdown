# Task brief

Spec: docs/specs/2026-10-14-markdown-editor-design.md
Architecture: docs/architecture/2026-10-14-native-editor.md

## Global Constraints

- Markdown 源文是持久化的权威内容。无编辑保存字节一致；局部修改不改写无关源文。
- 新建文件：UTF-8、无 BOM、LF；默认不自动补末尾换行。Existing BOM, mixed EOLs and trailing-newline state survive.
- 两种模式共享同一文档、修改状态和撤销历史。中文组词期间不打断候选文字或使光标跳动。
- 表格直接编辑渲染后的单元格，支持 Tab 导航及右键增删行列；默认粘贴纯文本。
- 默认复制 Markdown 源文；另提供纯文本和 HTML 富文本复制，后者提供纯文本回退且不加载远程资源。
- 首版仅渲染本地图片；远程引用保留并显示占位。Core workflows and fonts/math/highlighting are offline.
- A4 纵向、四边 20 mm、白底、13 px 打印根字号；不添加封面、目录、页眉、页脚或页码。
- One document/window; no tabs, sidebars or floating toolbar. All F01–F20/C01–C21 remain in scope.
- Current macOS 27.0.1 arm64 acceptance. 20 Release runs: startup P95 ≤3 s; 1 MiB open ≤2 s; ordinary input ≤50 ms; IME target ≤100 ms; ~20-page PDF target ≤15 s. App + dedicated WebContent RSS ≤512 MiB; app bundle ≤80 MiB. Do not reject >1 MB automatically.
- Renderer owns root npm/config, web/index.html, scripts/build-web.mjs, web/src/render/** and web/styles/**. Request root edits through its owner. npm cache: `/private/tmp/ret-markdown-npm`.
- Controller reserves scripts/generate-fixtures.py, tests/fixtures/**, docs/testing/**. Consume build/fixtures; send reports to controller. No Git commit steps in this non-Git workspace.


### Task 2: Native shell, ordered bridge and revision-safe saving — Astra high

**Create:** `Package.swift`, `Resources/Info.plist`, `scripts/build-app.sh`; `Sources/ReTMarkdown/App/{AppMain,AppDelegate,MenuController}.swift`; `Documents/{MarkdownDocument,DocumentController,DocumentWindowController}.swift`, `Bridge/{EditorBridge,EditorWebView}.swift`, `Storage/{SaveCoordinator,ExternalChanges}.swift` under `Sources/ReTMarkdown/`; `Tests/ReTMarkdownTests/{Bridge,Save}Tests.swift`.

**Consumes:** Task 1 Swift types and SourceCodec; generated build/web; protocol ready/load/commit/barrier/snapshot/state/saved. **Produces:** `EditorBridge.snapshot(purpose:) async throws -> Snapshot`, `send(command:) async throws`; `SaveCoordinator.save(_:) async throws -> SaveReceipt` and SaveRequest/SaveReceipt from architecture; standard NSDocument entry points. Asset/export protocols use no-op test doubles until their owners implement them.

- [ ] Write failures with fake bridge/writer: duplicate commit applies once; wrong session/base rejected; save r10 while r11 arrives writes r10 and leaves dirty; delayed old write never overwrites newer one; failure retains dirty mirror; external dirty conflict never overwrites disk.
- [ ] Run `swift test --filter 'BridgeTests|SaveTests'` to red; establish SwiftPM executable/test/resource targets and document UTIs without touching npm files.
- [ ] Implement MainActor bridge and NSDocument asynchronous barrier before synchronous captured-byte write; preserve standard safe writing, file coordination and change-count-token accounting. Route native undo/redo to JS, not a second history.
- [ ] Implement one-window/file identity deduplication, Finder open, save/close/version/restoration menus, error retry/Save As; avoid automatic window tabbing. Restore system preferences' close behavior.
- [ ] Run tests green and `bash scripts/build-app.sh`; controller verifies two file windows, same-path activation and system close settings. Record T07–T10 plus deferred Task 5 recovery tests. App assembly copies the SwiftPM resource bundle alongside executable and uses Bundle.module lookup, not cwd.

