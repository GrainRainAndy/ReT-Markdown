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


### Task 5: Local assets, draft recovery and Save As — Sol6.1 high

**Create:** `Sources/ReTMarkdown/Storage/{AssetStore,DraftStore}.swift`, `Sources/ReTMarkdown/Bridge/AssetSchemeHandler.swift`, `Tests/ReTMarkdownTests/AssetsTests.swift`. Task 2 owner integrates hooks in document/bridge; Task 3 owner integrates image insert patches.

**Consumes:** snapshot/patch and SaveCoordinator contracts. **Produces:** architecture AssetStore importImage/planMigration, ImportedAsset/AssetMigration/AssetManifest, DraftStore.persist and authorized capability resolution. Store durable managed-asset provenance separately from user Markdown.

- [ ] Write failures: duplicate/Chinese/space filenames retain original images; failed first-save resource copy preserves draft; failure after copying never commits rewritten Markdown; unmanaged Save As breakage needs explicit acceptance; crash recovers complete snapshot+assets; SVG/remote fetches blocked and symlink traversal checked.
- [ ] Run `swift test --filter AssetsTests` to red; implement collision-safe immutable imports, atomic draft generations, staged migration and no automatic deletion. Existing legitimate relative paths, including parent paths, must resolve through native authorization.
- [ ] Integrate image-only paste, drag and chooser; rename preserves resource directory; Save As adopts local reference patches only after successful write and keeps history-required originals reachable. Native owner serializes this short adoption against edits.
- [ ] Run tests green; controller verifies T08/T11/T12/T18/T22/T23 and NSDocument versions restoring historical image references. Also verify failure/cancel preserves old document and assets.

