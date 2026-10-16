# Task 4 fix round 1 — L1–L4

Date: 2026-10-15. Review: `docs/testing/reviews/task-4-review.md`. All four reproduced P2 findings were fixed and verified against the current source. This report supersedes the original Task 4 test counts for this fix round; native IME acceptance is still separate.

## Changes and owned paths

- `web/src/live/tables.ts`: L1 now uses the pinned markdown-it immediate-preceding-backslash pipe boundary rule, including runs of one/two/three backslashes. Decoding removes exactly the escape immediately before the pipe; encoding restores it. Added typed `ColumnAlignment` and `Table.alignments` derived from the actual separator for L2.
- `web/src/live/cell-widget.ts`: L1 validates the candidate table before submitting either normal or provisional cell patches, avoiding a null controller table. L2 applies separator alignment to every header/body host; mini-editor content/lines inherit that alignment. L3 paints renderer-provided inline cell results, retaining document references and math/image metadata. L4 shares one raw-selection clipboard function for copy/cut, then projects deletion through the existing mini-editor/root transaction path. Cut is blocked during cell/root composition and read-only state, and cannot delete when clipboard data is unavailable. No local history was added.
- `web/src/live/decorations.ts`: widgets now include the document text in projection identity, so reference-definition edits outside the table refresh its inline content without replacing a focused mini-editor of unchanged shape.
- `web/src/render/markdown.ts`: **explicitly authorized cross-scope additions only**: the two pure helper exports documented below. Existing render/clipboard APIs, renderer rules, `positions.ts`, `math.ts`, CSS, and R1–R3 fixes were not changed.
- `web/test/tables.test.ts`: L1 backslash-run decoding/encoding, renderer cell-boundary agreement, local patch bounds, and L2 source alignment tests.
- `web/test/live.test.ts`: new inline helper tests for literal block markers, inline formatting/code/math, document reference links/images, repeated issue offsets, astral prefixes, CRLF and escaped-pipe cells.
- `web/test/editor.spec.ts`: eight new real-CM browser regressions covering L1–L4, described below.
- `web/test/live-browser-harness.ts`: test-only renderer comparison and exact encoded-byte inspection.
- `docs/testing/task-4-fix-report.md`: this report.

No main/session, root configuration, shared `build/web`, Git, subagents, or dependency changes. Main's already wired factory was left intact. Browser bundles use esbuild `write:false`; build tests use their own temporary output directory.

## New pure renderer interfaces

```ts
renderTableCells(
  source: string,
  tableFrom: number,
  options?: RenderOptions,
): RenderResult[][];

blockSourceRanges(source: string): { from: number; to: number }[];
```

`renderTableCells` is the L3 inline helper authorized by the controller. `tableFrom` is an original UTF-16 offset on the table's opening source line. The helper parses the full document using the **same private configured `md` and `createEnv`** as `renderMarkdown`, finds that table, and renders its already parsed inline cell children. The result includes the header, omits the separator, and returns a `RenderResult` per cell, without paragraph/heading/list/rule wrappers. Document reference definitions are therefore resolved in their actual context. Issue offsets retain original source coordinates, including CRLF/astral/escaped-pipe mappings. It throws for an invalid offset or absent table. Rendering uses the existing safe image/math rules and supplied capability resolver; the helper itself loads no resources. Each controller obtains all cells from one parse rather than parsing each isolated cell as a new block document.

`blockSourceRanges` is the separate precise addition requested by the controller for Task6/Boole R6 integration. The definitive name is **only** `blockSourceRanges`; `markdownBlockRanges` was not exported. It selects shared-parser tokens with `level === 0`, a map, `type !== 'inline'`, and `nesting !== -1`. Normalized line starts are translated through `env.offsets`, yielding original UTF-16 ranges for top-level rendered blocks and excluding non-rendered reference definitions. No mutable parser is exported. Task6 owns its consumer and regressions; Task4 did not edit export files.

## RED → GREEN evidence

### Focused unit RED

`npx vitest run web/test/live.test.ts web/test/tables.test.ts` initially ran **23 tests: 5 failed, 18 passed** after adding the first regressions:

- Three L1 backslash-run tests failed: a loaded run of two was rejected, and encoding typed runs one/three made the next table invalid.
- L2 separator alignment failed because the model had no alignment projection.
- L3 inline helper failed because the export did not exist.

After the fixes, these 23 passed. A further original-offset regression added coverage for repeated math/image issues through CRLF and escaped pipes, bringing the final focused suite to **24 passed**. It compares hand-derived original offsets and also checks the existing renderer issue result for the reference-image case.

### Browser RED

`npx playwright test web/test/editor.spec.ts --workers=1 --reporter=line --timeout=12000 --grep 'L[1-4]'` initially ran **8 tests: 8 failed**:

- L1 runs 1/3 lost the widget after input; run 2 failed to render the loaded table.
- L2 measured centered headers/start-aligned body instead of source left/center/right declarations.
- L3 found real `<h1>`, `<ul>`, `<hr>` wrappers and unresolved document reference text instead of the renderer's inline cell DOM.
- L4 full and partial cut copied unescaped local text, unlike copy.
- L4 cut during composition overwrote the clipboard and ran the local cut rather than preserving preedit.

The same eight tests passed after the fixes. Further assertions within these tests verify real provisional input before the blocked cut, successful raw-source cut after composition commit, two separate root undos restoring the composed and original bytes, inline repaint after composition/blur, and external reference-definition invalidation.

### Browser proof details

The three L1 tests cover loaded raw runs one/two/three, ordinary typed plain text, pasted inline code, and Chinese provisional input with each backslash run. They assert one retained table, the same focused mini-editor DOM, intended editable cell text, exact normalized root source, local patch bounds, and byte-identical undo to original BOM/mixed EOL input.

L2 compares computed alignment on headers/body/mini content and lines, then cell edits, insertion/deletion of a column, preservation of the original alignment declarations, and structural undo.

L3 compares actual live body-cell HTML with the full document renderer's table-cell HTML for `# title`, `- item`, `---`, emphasis, inline code, math, reference links and remote reference-image placeholders. It repeats after focus/blur, edit, root undo and composition; changing an external reference definition updates the table link.

L4 dispatches clipboard events to the actual mini-view. Full and partial selections produce identical copy/cut raw Markdown payloads; exact selected source spans are deleted in one root commit. A single undo restores exact original BOM/EOL bytes. With provisional Chinese/backslash/pipe text active, cut preserves the clipboard, source, focused node and preedit; after completion it copies the mapped committed source and remains root-undoable.

Every browser test also fails on page errors or console errors.

## Final verification

- `npx vitest run web/test/live.test.ts web/test/tables.test.ts` — **24 passed**, 2 files.
- `npx vitest run web/test/render.test.ts web/test/build.test.ts` — **39 passed**, 2 files. Existing renderer R1–R3 offset/security/math-scope regressions remain green.
- `npx playwright test web/test/editor.spec.ts --workers=1 --reporter=line --timeout=15000` — **22 passed (8.6 s)**, no captured browser errors; includes the original 14 live/IME lifecycle/F19 tests and 8 L1–L4 regressions.
- `npm test` — **187 passed, 1 skipped (188)**, 9 test files, exit 0.
- `npm run typecheck` — passed with no diagnostics, exit 0.

An intermediate `web/test/export.test.ts` run while Task6's consumer was still being connected reported its 10 known R6 source-range regressions red (HTML comment/element, task list/table/reference prefixes, nested math, and image-decode ranges). This was reported to the controller and not edited in Task4. The final full run above, after Task6 connected `blockSourceRanges`, was green and supersedes that intermediate state. The one remaining skipped test is the existing export browser acceptance test gated by `RET_EXPORT_BROWSER=1`; it is not counted as passing.

## Remaining native acceptance

Real WKWebView Chinese candidate selection, replacement/deletion/cancellation and Cmd-S during preedit, integrated T04/T05/T21, and final native F19/performance acceptance remain controller work. The synthetic composition events above exercise real CodeMirror/session transactions and DOM identity, but **are not native IME proof**. No shared app publication or native acceptance pass is claimed in this report.
