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


### Task 4: IME-safe live syntax and editable tables — Astra high

**Create:** `web/src/live/{syntax,decorations,composition,tables}.ts`, `web/test/{live,tables}.test.ts`, `web/test/editor.spec.ts`. Task 3 owner supplies session hooks; changes to session stay with that owner.

**Consumes:** Source/Patch, root EditorSession and renderer grammar scope. **Produces:** `tablePatches(source,table,action):Patch[]`, TableAction union with cell text/row/column indices; live extensions wired through an exported `liveExtensions()` adapter. Cell history delegates to root; syntax ranges stay normalized UTF-16.

- [ ] Write failures: editable headings/list/quote/code/math spans map to original source; active mark/selection/composition reveals syntax; escaped pipe and inline-code cells patch only target content; add/delete row/column changes only table; undo restores exact bytes; Tab exits boundaries without inserting rows.
- [ ] Run `npx vitest run web/test/live.test.ts web/test/tables.test.ts` to red, then implement mapped decorations and stable cell mini-editors with no local history. Define last-row/column deletion and malformed-table source fallback explicitly in tests.
- [ ] Freeze intersecting replacement widgets during composition; commit net composition patches once. Queue structural commands while marked text is active; preserve selection through mode changes and table focus transitions.
- [ ] Run focused tests green and `npx playwright test web/test/editor.spec.ts`. Controller performs native WKWebView Chinese candidate selection/delete/undo around headings, formulas and cells, including Cmd-S while composing. Synthetic composition alone cannot pass T04.
- [ ] Gate T04/T05/T21 and byte-preserving undo before calling live editing complete; report any native-only failures immediately.

