# ReT Markdown Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans when implementing inline, or superpowers:subagent-driven-development when the controller dispatches authorized workers. Steps use checkboxes. This design task spawns no agents.

**Goal:** Deliver the full agreed macOS v1: source-preserving live editing, editable tables, system documents/recovery/assets, and paginated searchable PDF.

**Architecture:** AppKit NSDocument owns persistence and windows; a CodeMirror session owns source transactions and the sole history. A revisioned bridge transfers immutable committed snapshots; offline rendering serves rich copy and a separate printing WebView.

**Tech Stack:** Swift 6.4/Xcode 27, SwiftPM, AppKit/WebKit, Node 26/npm 12, TypeScript/CodeMirror 6, markdown-it/KaTeX/highlight.js, esbuild/Vitest/Playwright.

**Spec:** [Agreed spec](../specs/2026-10-14-markdown-editor-design.md), [architecture and interfaces](../architecture/2026-10-14-native-editor.md), [visual baseline](../references/typora-github-visual-baseline.md). Read all before implementation; renderer also follows [its fixed plan](2026-10-14-rendering.md).

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

## Review Focus

1. Astral and decomposed Unicode adjacent to CRLF must survive local patches/undo exactly (Task 1/3).
2. Save/close during IME and delayed bridge acknowledgements must preserve the latest committed state without marking later edits saved (Task 2/4).
3. Escaped pipes, inline code and malformed table rows must not corrupt cell mapping or neighboring source (Task 4).
4. Save As failure after image copying, app crash, and symlink/parent-path resources must leave recoverable content without loading unauthorized files (Task 5).
5. Late font/image completion, oversized math and failed PDF replacement must not produce an apparently successful clipped or partial PDF (Task 6).

## Ownership and execution order

Model labels are user assignments: **Astra high** for hard synchronization/live-table work; **Sol6.1 high** for general implementation. Do not use Luna except a separately assigned mechanical task. Actual tool model identifiers are resolved by the controller. No worker edits another owner's files.

Renderer Task R is already dispatched and retains its fixed interfaces. Task 1 can start immediately; Task 2 native scaffolding can start against the published types in parallel. Task 3 consumes Task 1; Task 4 consumes Task 3. Task 5 consumes Task 2 and editor patch handling; Task 6 consumes renderer+Task 2. Controller integrates Task 7 after all gates. A failed high-risk proof is repaired before dependent acceptance, not reclassified as optional.

### Task R: Offline renderer and styles — Sol6.1 high, already dispatched

**Files/Interfaces:** Exactly the renderer subplan; preserve `renderMarkdown`, `RenderOptions`, `RenderResult`, `RenderIssue`, `plainText`, `richClipboard`. Its UTF-16 ranges receive normalized source from the editor/export adapter.

- [ ] Complete its focused RED/GREEN cycle, offline font/license packaging, typecheck and build; report to controller.
- [ ] Cover T18/T20/T23/T24/T25 render portions; supply missing-image/math failures and remote placeholders for Task 6.

### Task 1: Source fidelity and bridge schema — Astra high

**Create:** `web/src/protocol.ts`, `web/src/editor/source.ts`, `web/test/source.test.ts`, `Sources/ReTMarkdown/Bridge/BridgeTypes.swift`, `Sources/ReTMarkdown/Storage/SourceCodec.swift`, `Tests/ReTMarkdownTests/SourceCodecTests.swift`.

**Consumes:** Architecture Source/Snapshot/Patch/Commit, normalized UTF-16 and EOL rules. **Produces:** TS `decodeSource(bytes)`, `encodeSource(source)`, `applyPatches(source,patches)` and Swift `SourceCodec.decode`, `encode`, `applying`; Codable wire structs exactly match protocol v1. Swift harness is supplied by Task 2.

- [ ] Write failures: encode(decode(bytes)) equals input for BOM/mixed CRLF/LF/CR/no-final-newline and decomposed Unicode; edit middle paragraph leaves prefix/suffix bytes unchanged; patch boundaries cannot split surrogate pairs; malformed UTF-8/EOL cardinality fails without mutation.
- [ ] Run `npx vitest run web/test/source.test.ts` and (after Task 2 harness) `swift test --filter SourceCodecTests`; record expected missing-symbol/test failures.
- [ ] Implement codecs, patch validation and schema only; use explicit UTF-16 mapping, no Unicode normalization or inferred whole-file newline policy.
- [ ] Rerun the same tests to green; compare TS/Swift encoded output against identical controller fixtures. Gate T01/T02/T20 byte fidelity before session integration.

### Task 2: Native shell, ordered bridge and revision-safe saving — Astra high

**Create:** `Package.swift`, `Resources/Info.plist`, `scripts/build-app.sh`; `Sources/ReTMarkdown/App/{AppMain,AppDelegate,MenuController}.swift`; `Documents/{MarkdownDocument,DocumentController,DocumentWindowController}.swift`, `Bridge/{EditorBridge,EditorWebView}.swift`, `Storage/{SaveCoordinator,ExternalChanges}.swift` under `Sources/ReTMarkdown/`; `Tests/ReTMarkdownTests/{Bridge,Save}Tests.swift`.

**Consumes:** Task 1 Swift types and SourceCodec; generated build/web; protocol ready/load/commit/barrier/snapshot/state/saved. **Produces:** `EditorBridge.snapshot(purpose:) async throws -> Snapshot`, `send(command:) async throws`; `SaveCoordinator.save(_:) async throws -> SaveReceipt` and SaveRequest/SaveReceipt from architecture; standard NSDocument entry points. Asset/export protocols use no-op test doubles until their owners implement them.

- [ ] Write failures with fake bridge/writer: duplicate commit applies once; wrong session/base rejected; save r10 while r11 arrives writes r10 and leaves dirty; delayed old write never overwrites newer one; failure retains dirty mirror; external dirty conflict never overwrites disk.
- [ ] Run `swift test --filter 'BridgeTests|SaveTests'` to red; establish SwiftPM executable/test/resource targets and document UTIs without touching npm files.
- [ ] Implement MainActor bridge and NSDocument asynchronous barrier before synchronous captured-byte write; preserve standard safe writing, file coordination and change-count-token accounting. Route native undo/redo to JS, not a second history.
- [ ] Implement one-window/file identity deduplication, Finder open, save/close/version/restoration menus, error retry/Save As; avoid automatic window tabbing. Restore system preferences' close behavior.
- [ ] Run tests green and `bash scripts/build-app.sh`; controller verifies two file windows, same-path activation and system close settings. Record T07–T10 plus deferred Task 5 recovery tests. App assembly copies the SwiftPM resource bundle alongside executable and uses Bundle.module lookup, not cwd.

### Task 3: Single editor session, commands and clipboard — Sol6.1 high

**Create:** `web/src/main.ts`, `web/src/editor/{history,session,commands,clipboard,search}.ts`, `web/test/{session,clipboard}.test.ts`. Own main entry; ask renderer owner to wire esbuild entry/scripts.

**Consumes:** Task 1 source/protocol and fixed renderer helpers. **Produces:** architecture `createEditor`/EditorSession; implements protocol handlers and `ret` transport. Native owns OS clipboard/image capabilities, editor owns text selection and patches.

- [ ] Write failures: alternating live/source edits undo to identical initial bytes including EOL metadata; mode/theme/zoom create no history event; replace-all has one undo; source copy includes hidden full-element markers; rich copy has HTML+text; rich paste inserts plain text only.
- [ ] Run `npx vitest run web/test/session.test.ts web/test/clipboard.test.ts` to red.
- [ ] Implement persistent EditorState, EOL StateField with inverse history effects, committed revision stream and acknowledgement queue. State messages drive menu availability; barrier excludes provisional IME state. Retain last committed snapshot separately from provisional view text.
- [ ] Implement F06 formatting/list continuation and indent commands, source-based find/reveal/replace, selection-aware copy and pure-text/image-only paste routing. Use renderer APIs unchanged and no remote resource requests.
- [ ] Run same tests green plus `npm run typecheck`; prove T03/T05/T06/T13/T22/T24. Connect native shell before Task 4; basic source mode is an integration milestone, not v1 completion.

### Task 4: IME-safe live syntax and editable tables — Astra high

**Create:** `web/src/live/{syntax,decorations,composition,tables}.ts`, `web/test/{live,tables}.test.ts`, `web/test/editor.spec.ts`. Task 3 owner supplies session hooks; changes to session stay with that owner.

**Consumes:** Source/Patch, root EditorSession and renderer grammar scope. **Produces:** `tablePatches(source,table,action):Patch[]`, TableAction union with cell text/row/column indices; live extensions wired through an exported `liveExtensions()` adapter. Cell history delegates to root; syntax ranges stay normalized UTF-16.

- [ ] Write failures: editable headings/list/quote/code/math spans map to original source; active mark/selection/composition reveals syntax; escaped pipe and inline-code cells patch only target content; add/delete row/column changes only table; undo restores exact bytes; Tab exits boundaries without inserting rows.
- [ ] Run `npx vitest run web/test/live.test.ts web/test/tables.test.ts` to red, then implement mapped decorations and stable cell mini-editors with no local history. Define last-row/column deletion and malformed-table source fallback explicitly in tests.
- [ ] Freeze intersecting replacement widgets during composition; commit net composition patches once. Queue structural commands while marked text is active; preserve selection through mode changes and table focus transitions.
- [ ] Run focused tests green and `npx playwright test web/test/editor.spec.ts`. Controller performs native WKWebView Chinese candidate selection/delete/undo around headings, formulas and cells, including Cmd-S while composing. Synthetic composition alone cannot pass T04.
- [ ] Gate T04/T05/T21 and byte-preserving undo before calling live editing complete; report any native-only failures immediately.

### Task 5: Local assets, draft recovery and Save As — Sol6.1 high

**Create:** `Sources/ReTMarkdown/Storage/{AssetStore,DraftStore}.swift`, `Sources/ReTMarkdown/Bridge/AssetSchemeHandler.swift`, `Tests/ReTMarkdownTests/AssetsTests.swift`. Task 2 owner integrates hooks in document/bridge; Task 3 owner integrates image insert patches.

**Consumes:** snapshot/patch and SaveCoordinator contracts. **Produces:** architecture AssetStore importImage/planMigration, ImportedAsset/AssetMigration/AssetManifest, DraftStore.persist and authorized capability resolution. Store durable managed-asset provenance separately from user Markdown.

- [ ] Write failures: duplicate/Chinese/space filenames retain original images; failed first-save resource copy preserves draft; failure after copying never commits rewritten Markdown; unmanaged Save As breakage needs explicit acceptance; crash recovers complete snapshot+assets; SVG/remote fetches blocked and symlink traversal checked.
- [ ] Run `swift test --filter AssetsTests` to red; implement collision-safe immutable imports, atomic draft generations, staged migration and no automatic deletion. Existing legitimate relative paths, including parent paths, must resolve through native authorization.
- [ ] Integrate image-only paste, drag and chooser; rename preserves resource directory; Save As adopts local reference patches only after successful write and keeps history-required originals reachable. Native owner serializes this short adoption against edits.
- [ ] Run tests green; controller verifies T08/T11/T12/T18/T22/T23 and NSDocument versions restoring historical image references. Also verify failure/cancel preserves old document and assets.

### Task 6: Real paginated PDF — Sol6.1 high; Astra reviews print/save races

**Create:** `Sources/ReTMarkdown/Export/{PDFExporter,PrintProfile}.swift`, `web/src/export.ts`, `web/test/export.test.ts`, `Tests/ReTMarkdownTests/PDFTests.swift`. Request renderer-owned print CSS/build changes through its owner.

**Consumes:** fixed renderMarkdown contract, immutable Snapshot/AssetManifest, asset capabilities. **Produces:** `prepareExport(snapshot,assets):Promise<ExportReady>` and `PDFExporter.export(snapshot:assets:to:) async throws` from architecture.

- [ ] Write failures for font/image readiness, local missing/math issues, remote URL placeholder success, snapshot fixed during continued typing, and cancelled/failed replacement preserving an existing PDF.
- [ ] Run `npx vitest run web/test/export.test.ts` and `swift test --filter PDFTests` to red; implement detached retained printing WebView, load barriers and overflow diagnostics.
- [ ] Implement WKWebView.printOperation(with:) → NSPrintInfo .save/jobSavingURL → temp sibling → verify → atomic replace. Set A4/20 mm/scale 1 without settings UI; print CSS removes screen padding and stays white. Do not substitute createPDF bounds capture.
- [ ] Run tests green; controller measures actual PDF MediaBoxes at 595.276×841.890 pt (±0.5 pt), margins near 56.693 pt, >1 page for multi-page input, extractable Chinese/code, no clipped final text, correct formula/image display. Check same normalized content yields equivalent layout from either mode (ignore PDF metadata differences).
- [ ] Gate T14–T17/T23/T25 print coverage with short/long code, multi-page table, page-end heading and overwide math; formula text extraction is not required. Failed overflow blocks export and reveals its source range.

### Task 7: Integrated acceptance and release evidence — controller

**Files:** Controller-owned scripts/fixtures/testing records; integration edits stay with their existing subsystem owners. **Consumes:** assembled `.app`, all interfaces above and generated fixtures. **Produces:** T01–T25 pass/fail evidence and measured targets, not inferred compliance.

- [ ] Run `npm test`, `npm run typecheck`, `swift test`, `bash scripts/build-app.sh`, and browser integration suite after all owners integrate. Fix failures with responsible owner and rerun affected checks.
- [ ] Exercise NSDocument reopen/versions/autosave/settings with real WKWebView and system IME; audit copy HTML+text in a compatible target, local SVG safety, remote-request absence and all source-byte comparisons.
- [ ] Compare fixed visual sample at 1000/1400/1800 CSS px and 100% zoom: 16px/1.6 body, 860/1024/1200 max-width, 30px padding and 100px bottom spacing; confirm dark mode preserves layout and print uses independent 13px rules. Do not copy Typora shipped code.
- [ ] Measure 20 Release runs and app+WebContent RSS/bundle size against Global Constraints using controller fixtures. Record targets missed as failures, including >1 MiB behavior without artificial rejection. Stop claiming v1 until hard correctness gates pass.

## Acceptance trace and unverified gates

| Cases | Primary tasks |
| --- | --- |
| T01/T02 | 1, 3, 4 |
| T03/T05/T06/T13 | 3, 4 |
| T04/T21 | 4, native verification 7 |
| T07/T08/T09/T10 | 2, recovery 5 |
| T11/T12 | 5 |
| T14/T15/T16/T17 | 6 |
| T18 | R, 5, 6, 7 |
| T19 | 7 |
| T20 | 1, R, 4 |
| T22/T24 | 3, R, 5 |
| T23 | R, 5, 6 |
| T25 | R, 4, 6, 7 |

API availability is verified; actual NSDocument barrier/change-token integration, native IME stability, cell projection fidelity, draft/version asset recovery, PDF pagination/searchability and performance are **not yet verified**. These are executable acceptance gates above, not scope reductions or reasons to postpone the independent tasks.
