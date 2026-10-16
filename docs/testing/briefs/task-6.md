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


### Task 6: Real paginated PDF — Sol6.1 high; Astra reviews print/save races

**Create:** `Sources/ReTMarkdown/Export/{PDFExporter,PrintProfile}.swift`, `web/src/export.ts`, `web/test/export.test.ts`, `Tests/ReTMarkdownTests/PDFTests.swift`. Request renderer-owned print CSS/build changes through its owner.

**Consumes:** fixed renderMarkdown contract, immutable Snapshot/AssetManifest, asset capabilities. **Produces:** `prepareExport(snapshot,assets):Promise<ExportReady>` and `PDFExporter.export(snapshot:assets:to:) async throws` from architecture.

- [ ] Write failures for font/image readiness, local missing/math issues, remote URL placeholder success, snapshot fixed during continued typing, and cancelled/failed replacement preserving an existing PDF.
- [ ] Run `npx vitest run web/test/export.test.ts` and `swift test --filter PDFTests` to red; implement detached retained printing WebView, load barriers and overflow diagnostics.
- [ ] Implement WKWebView.printOperation(with:) → NSPrintInfo .save/jobSavingURL → temp sibling → verify → atomic replace. Set A4/20 mm/scale 1 without settings UI; print CSS removes screen padding and stays white. Do not substitute createPDF bounds capture.
- [ ] Run tests green; controller measures actual PDF MediaBoxes at 595.276×841.890 pt (±0.5 pt), margins near 56.693 pt, >1 page for multi-page input, extractable Chinese/code, no clipped final text, correct formula/image display. Check same normalized content yields equivalent layout from either mode (ignore PDF metadata differences).
- [ ] Gate T14–T17/T23/T25 print coverage with short/long code, multi-page table, page-end heading and overwide math; formula text extraction is not required. Failed overflow blocks export and reveals its source range.

