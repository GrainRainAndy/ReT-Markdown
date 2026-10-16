# Task 4 independent live/table review

Date: 2026-10-15. Target: current files in `/Users/grainrain/Developer/GitHub/ReT-Markdown`, against `docs/testing/briefs/task-4.md`, `docs/testing/task-4-report.md`, the architecture, F02/F04–F08/F19 and C16. This is a direct new-file review, not a Git diff or review of a generated bundle. The SHA-256 manifest below identifies the reviewed inputs.

## Spec verdict: CHANGES REQUIRED

The live adapter, normalized UTF-16 projections, local table patches, sole root history and synthetic composition safeguards are substantially implemented. Four reproducible table defects L1–L4 remain. Installing the factory in main belongs to the Task 3 fix owner and is expressly **not** a Task 4 finding. Native T04/T05/T21 and final F19 visual acceptance remain open independently of these findings.

| Requirement | Current assessment |
| --- | --- |
| Live primitive and source maps | `syntax.ts` derives Markdown spans from Lezer and math positions from the renderer grammar; activity includes selections, boundary carets and composition ranges. Table math is excluded from root replacements. Cell display/raw boundary arrays and scalar-safe `netPatch` avoid HTML-to-source guessing. Existing tests cover astral text, escaped pipes and inline code. L1 exposes a disagreement with the actual renderer's pipe grammar. |
| Stable DOM and IME | `decorations.ts:72–83` maps the existing decoration set during composition; `TableWidget.updateDOM` updates the retained controller, and same-shape edits retain the mini-view. Cell composition opens the root barrier with `input.type.compose`, projects provisional changes into the root, forwards completion and defers structural actions. Recorded tests check marked-node/view identity, provisional source versus committed barrier, queued mode/undo/structure and captured browser errors. These are synthetic lifecycle proofs, not real candidate-window acceptance. |
| Root-only history and byte fidelity | No `history()` extension is installed in the mini-editor. Undo/redo target the root; normal edits call the published `apply`, and composition dispatches annotated root transactions. Root history owns inverse EOL effects. Recorded tests exercise byte-identical BOM/mixed-EOL undo across modes. No second history or independent cell persistence path was found. |
| Tab and focus boundaries | `tableTab` visits only existing coordinates and exits before/after the table. The browser tests verify root focus at boundaries, no new row and mapped selection/focus on mode change. |
| Local and structural patches | Cell patches use the content span and a minimal raw replacement; row/column batches remain within the table and inherit local EOLs. Tests explicitly cover deletion of the last body row, final column, malformed fallback and unbordered boundary-column preservation. The documented header-deletion policy removes the table. |
| Input preservation and clipboard | Plain-text paste is explicit; rejected multiline input is retained in an editable textarea instead of being discarded. Default copy maps cell selection back to raw Markdown. Cut lacks that mapping: L4. |
| Shared syntax and aligned tables | L1–L3 break agreement between the live table and rendered/exported table: escape boundaries, column alignment and inline-only cell semantics. |
| Latest F19 correction | The current base theme has H1–H6 sizes `2.25/1.75/1.5/1.25/1/1em`; H5 is now 16px at the 16px baseline. Heading line heights/margins/borders, quote border/padding, code sizing/frame, list indentation and cell padding/borders use the fixed baseline values. The current 14-test browser source asserts these values plus dark/print variables and visible list markers. No stale H5=17.6px finding is carried forward. L2/L3 still affect table presentation. Font-loaded native comparison at 1000/1400/1800 logical widths remains a separate gate. |

## Quality verdict: CHANGES REQUIRED

The adapter boundary and separation of pure patching, syntax projection and cell UI are sound. Composition comments explain the root-versus-mini-view ownership, and browser tests now fail on page/console errors. However, duplicating table parsing without matching the pinned renderer, rendering each cell as a standalone block document, and handling copy without cut leave observable semantic gaps. Fix L1–L4 and add the specific regressions below. No product changes were made during review.

### L1 — P2 / Important: a backslash-pipe cell edit makes the live table disappear

**Locations:** `web/src/live/tables.ts:11–13`, `:65–70`; `web/src/live/decorations.ts:39–42`. The renderer's matching rule is in `web/src/render/positions.ts:37–59` and installed markdown-it 15.0.2's `escapedSplit`.

Start with:

```markdown
| A | B |
| - | - |
| old | other |
```

Replace the first body cell's mini-editor content with `left\|right` (one backslash followed by a pipe). The local patch inserts `left\\|right` into source (two backslashes before the pipe). The live parser counts backslash parity and treats that pipe as a new boundary; the body now appears to have three cells, so `parseTable` returns null and the widget disappears. The isolated real-CM browser probe confirmed zero `.cm-live-table` widgets after that edit. Separately, the current renderer still renders two body cells for this source: its table rule treats a pipe immediately preceded by a backslash as escaped, including runs of backslashes. The live syntax scanner also still reports a table span.

This is an ordinary edit creating disagreement with the shared grammar, not the intentional malformed-table fallback. The existing single-backslash tests miss it.

**Action/regression:** Match the pinned renderer's cell-splitting and escape-removal semantics and make cell encoding/decoding consistent with them. Cover runs of one/two/three backslashes before a pipe, both loaded and typed/pasted, including inline code. Assert the same cell boundaries as the renderer, retained focused widget, intended cell text, local patches and byte-identical root undo. Include provisional composition through this sequence so an invalid table cannot enter controller state unnoticed.

### L2 — P2 / Important: live tables ignore column alignment

**Locations:** `web/src/live/cell-widget.ts:41–47`; `web/src/live/tables.ts:45–47`.

For `| A | B |\n| :--- | ---: |\n| text | 42 |`, the table model retains separator text, but `build()` never derives/applies its alignment. The isolated browser probe measured header alignment `center, center` and body alignment `start, start`; the shared renderer emits `text-align:left` and `text-align:right` on the corresponding cells. Right-aligned numbers therefore visibly change alignment between live and rendered/exported views. This violates F08's GFM column alignment, rather than being a style preference.

**Action/regression:** Derive alignment from each separator cell and apply it consistently to header/body hosts, including focused mini-editor content. Test left/center/right columns before and after cell edits, column insertion/deletion and undo; preserve unrelated alignment declarations in source.

### L3 — P2 / Important: cell rendering uses block-document semantics

**Location:** `web/src/live/cell-widget.ts:54–56`.

For a body cell containing `# title`, `paint()` calls `renderMarkdown` on the cell text alone. The actual live host contains `<h1>title</h1>`, whereas the shared renderer's table contains literal `# title` inside `<td>`. A GFM cell is an inline parsing context; treating it as a standalone document changes both visible content and typography. The same call site admits other block constructs such as list markers and horizontal rules. The browser probe asserted the heading discrepancy against the current renderer.

**Action/regression:** Render in the document's table-cell inline context, preserving allowed inline formatting/math/images without interpreting block markers. Test `# title`, `- item`, `---` and ordinary inline emphasis/code/math, both initially and after focus/blur and root undo. Compare cell content with the renderer's actual table output. Use document reference context where necessary rather than assuming an isolated cell is a whole Markdown document.

### L4 — P2 / Important: cut drops the raw pipe escape that copy preserves

**Location:** `web/src/live/cell-widget.ts:120–133` and the mini-editor extension list at `:82–135`.

In a cell whose original source is `` `c\|d` ``, select the whole mini-editor. Copy produces `` `c\|d` `` as intended; cut produces `` `c|d` `` and clears the source cell. The isolated browser probe dispatched actual clipboard events to the real mini-view and asserted both payloads. There is a custom source-mapped `copy` handler but no corresponding `cut` handler or output filter, so CodeMirror's default cut copies its unescaped local document. The table widget ignores parent events; the root source-mapped cut cannot repair this. Pasting that payload into source mode loses the escape and can create an extra column instead of moving the original Markdown.

**Action/regression:** Use the same raw-selection mapping for default cut, with deletion projected through the sole root transaction/history and appropriate composition handling. Test full and partial escaped-pipe/code selections: copy and cut payloads must agree on original Markdown, only the selected source content may be deleted, and one root undo must restore exact BOM/EOL bytes.

## Verification and limits

Accepted as recorded evidence, without rerunning: **18 live/table unit tests**, **14 live browser tests**, **39 renderer-focused tests**, successful typechecks and the latest full suite **149 passed, 1 skipped**. The renderer fix report's earlier full-suite count is 148; the later Task 4 report records 149. The skipped export browser test remains gated by `RET_EXPORT_BROWSER=1` and is not counted as passing.

Review-specific checks addressed concrete uncovered risks only. A Node `write:false` esbuild bundle compared live parsing/patching with renderer output for backslash-pipe runs. `/private/tmp/ret-task4-review-probe.mjs` bundled the current browser harness in memory and used a separate headless Chromium page to assert L1–L4. Final command: `node /private/tmp/ret-task4-review-probe.mjs`, exit 0, no captured page errors. Exit 0 here means the assertions reproduced the stated defects, not that they were fixed. The first sandboxed browser launch aborted before tests; the isolated launch succeeded after automatic escalation approval. No existing suite, shared build, native UI, Git or subagent operation was run.

Only the two requested review documents were written in the repository. Real WKWebView Chinese candidate selection/deletion/cancellation, Cmd-S during preedit, integrated T04/T05/T21, final F19 comparisons and performance/export acceptance remain with the ongoing main verification. This review neither claims those passes nor assigns the pending Task 3 main connection to Task 4.

## Current-file SHA-256 manifest

Digests identify current source, tests, requirements and supporting contracts used for this review; they are not commit IDs or generated-output hashes. Inputs were checked again before report delivery. Root main/publishing changes are outside this manifest and verdict.

```text
27b0b112d8bf5f3455ddc76ef30a452fc5488ddb321c87b967db522201274145  docs/architecture/2026-10-14-native-editor.md
0506c97ef2586ef79805c08f2105b691873a3d4b6e107a2aaf08623ea982a0fb  docs/references/typora-github-visual-baseline.md
aa1506a9fce3c1bd536ef79c0ec45ad25197df4a065f1f3555dcc980ec3da47c  docs/specs/2026-10-14-markdown-editor-design.md
9085ddddf4cbe0bfac2ec786577173358ecb0c3124df4a67be6156bce41b3aec  docs/testing/briefs/task-4.md
11d5aaddbf661d7380232fb603e206d1278e66f76bcca4a04f4dcbc96f6b8394  docs/testing/task-4-report.md
73339f0c64071b55fc2d24e69ad6527a37068c2465b1fec3a50726923f3b7ea5  node_modules/@codemirror/view/dist/index.js
499649c0b497ed031bf21b1f29e5a53b9a49101d6f432eb13e68050ba754f860  node_modules/markdown-it/dist/markdown-it.mjs
ab263c54fb2bedfce5b3cd309b6f9f412d0936bd043ca9eddf10482ad79cd254  package-lock.json
45f1a3500562db03a4e1833bd8a44cc1d0fcd9c4ab79955409f45dea41b3664a  package.json
f3010ab2c6a425fb3098fb761d1a629ef33516d452192a45ad0d350a765e697a  web/src/editor/history.ts
5ee98db700b7fcd23ea288ba3557ecb3b99de0a88d278f637ef12a217c5bfd25  web/src/editor/live-contract.ts
176634d18d6b5afafcc9b237e43de2108ed88cb9bdb36c87af13f1fad36f73cd  web/src/editor/session.ts
5ed5510266da4e259610df90b24c8e4b76d4a32bb2627c1fe26219e23754bbec  web/src/editor/source.ts
87dcb087cbe4b60973fb56655db8986973978675b2872a3052db398534d56460  web/src/live/cell-widget.ts
700ba20ccecc5cf2b59bdbc0aeda158bd6b2fc19edd8e026f6bb8f8c8b4f8941  web/src/live/composition.ts
b68ae784f65d77e08929787e65d90fbc3af36762480bca43c7b4153ceb71ad2c  web/src/live/decorations.ts
60b4e08d7376ef0a080c9e3365db032fd485890447c5df94e40263dea98385a0  web/src/live/syntax.ts
3c7ecba319fd147774f449b702203a8d5e8b22c080690ea491e526b4d8ee4f43  web/src/live/tables.ts
940b561f2088ad8d444fc4761c5caa4cdf52e40c6389d832b6df7dc3169d3a4c  web/src/protocol.ts
418757d66c1fce19982c495eed4ccddf8bc1b5b6e29f0914b57d6f4b1310d04f  web/src/render/assets.d.ts
36fcb034f975f93b73af938c27db1c2a5be6f58da8c089ea38bdf9c30234630f  web/src/render/markdown.ts
c1dd964695182497d101a0fff972fee68a45572c3cbfa15fa6f36be114d278f2  web/src/render/math.ts
f9838bedac84f0e76c4942c259f23dfb6f2ef87b98e6195ee22c5d177302076a  web/src/render/positions.ts
0707515fb6eb10004894a68e4fab24cbe54ee4b9fd472f99f457c11f1257a930  web/styles/fonts.css
9ee37568c72d8f4e4a85ad500a96a12b02d6c6c3670257bea8b63893e42c5582  web/styles/palette.css
067a5480e4ad528f3de2bca18284a545da05c2a2712ea1e60b96cedd476d320f  web/styles/print.css
26e03e0b3b16e2d9f9ffe88aa9c42fad982ea3b8218a5a22bc28c3523b7f850b  web/styles/typography.css
b0650b08a002a1abb7958a7191ca2753fd71fd0daa851e06e0a6e30908a1bd43  web/test/editor.spec.ts
e00396a3112e0fe26c064e5e3bcc718ee0b40c094394e3b26f17f49e1bed0251  web/test/live-browser-harness.ts
565bc04a160e6d4f9599c0d36c3a473eabf003197ed3a94bbd73284af77161f7  web/test/live.test.ts
972d4b190aa0b058a46afb80af1b156d715b66ad4edaa87673933cea928f84ba  web/test/tables.test.ts
```
