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


### Task 3: Single editor session, commands and clipboard — Sol6.1 high

**Create:** `web/src/main.ts`, `web/src/editor/{history,session,commands,clipboard,search}.ts`, `web/test/{session,clipboard}.test.ts`. Own main entry; ask renderer owner to wire esbuild entry/scripts.

**Consumes:** Task 1 source/protocol and fixed renderer helpers. **Produces:** architecture `createEditor`/EditorSession; implements protocol handlers and `ret` transport. Native owns OS clipboard/image capabilities, editor owns text selection and patches.

- [ ] Write failures: alternating live/source edits undo to identical initial bytes including EOL metadata; mode/theme/zoom create no history event; replace-all has one undo; source copy includes hidden full-element markers; rich copy has HTML+text; rich paste inserts plain text only.
- [ ] Run `npx vitest run web/test/session.test.ts web/test/clipboard.test.ts` to red.
- [ ] Implement persistent EditorState, EOL StateField with inverse history effects, committed revision stream and acknowledgement queue. State messages drive menu availability; barrier excludes provisional IME state. Retain last committed snapshot separately from provisional view text.
- [ ] Implement F06 formatting/list continuation and indent commands, source-based find/reveal/replace, selection-aware copy and pure-text/image-only paste routing. Use renderer APIs unchanged and no remote resource requests.
- [ ] Run same tests green plus `npm run typecheck`; prove T03/T05/T06/T13/T22/T24. Connect native shell before Task 4; basic source mode is an integration milestone, not v1 completion.

