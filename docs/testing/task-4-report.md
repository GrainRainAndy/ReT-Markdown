# Task 4 — live Markdown and directly editable tables

Updated 2026-10-15. Implementation is ready for controller integration and native verification. Browser composition tests below are synthetic lifecycle tests in real CodeMirror views; they are **not native IME proof**. T04/native T05/T21 acceptance remains with the controller.

## Owned changes

- `web/src/live/syntax.ts`: UTF-16 CommonMark/GFM spans using Lezer; math positions use the renderer's `installPositions`/`installMath` grammar. Code/escaped dollars stay source; math inside tables belongs to the table widget.
- `web/src/live/decorations.ts`: exported `liveExtensions: LiveExtensionFactory`; active delimiters reveal, inactive Markdown styles and math/image widgets; composition maps the existing decoration set instead of replacing marked DOM. Scoped CM base theme follows the F19 renderer variables and numeric baseline.
- `web/src/live/composition.ts`: minimal net replacement widened to avoid splitting surrogate pairs; used by cell patches.
- `web/src/live/tables.ts`: conservative table parsing, raw/display UTF-16 boundary maps, atomic local cell/row/column patches, EOL inheritance, boundary navigation.
- `web/src/live/cell-widget.ts`: stable rendered table and focused-cell mini CodeMirror without a local history extension; root undo/redo, mapped source copy, plain-text paste, retained multiline input, context commands and composition lifecycle.
- `web/test/live.test.ts`, `web/test/tables.test.ts`: focused behavior tests.
- `web/test/editor.spec.ts`, `web/test/live-browser-harness.ts`: actual Chromium/CM/session proofs. The harness bundles with esbuild `write:false`; it does not publish `build/web`.
- `docs/testing/task-4-report.md`: this handoff report, explicitly requested by controller.

No session/main, root configuration, renderer CSS, or published `build/web` files were edited. No Git, subagents, package installation, or dependency changes were used. `playwright/test` is provided by the installed `playwright` package; `@playwright/test` was not needed.

## Exact integration

The published `web/src/editor/live-contract.ts` was read before implementation; its interface was not changed.

In `web/src/main.ts`:

```ts
import { liveExtensions } from './live/decorations';
```

After `const transport = createTransport(...)` in `bootstrap()`, before native/browser load:

```ts
transport.installLiveExtensions(liveExtensions);
```

A directly created session can instead receive `{ liveExtensions }` as its editor options or call `session.liveExtensions(liveExtensions)` once. Do not install twice. At the final source inspection, main exposed `installLiveExtensions` but did not yet import this factory; the controller/Ptolemy owns that integration and publishing.

## Composition and history behavior

Normal cell edits call `LiveOptions.apply` with minimal source patches and a mapped selection. There is no cell history. Undo/redo targets the actual root view and sole source history, including original BOM and EOL metadata.

During cell composition, an empty root transaction annotated `input.type.compose` opens the existing session barrier. Each provisional local cell patch is projected through the root CM dispatcher with that annotation. Thus `getSource()` includes preedit while `snapshot()`/save barrier remains committed, and the session coalesces preedit into one commit. The root DOM must **not** receive a cloned compositionstart: its own CM composition tracker would mistake a cell's text node for a root block tile. The mini-editor retains the actual marked node. A forwarded end event uses the existing parent end barrier; queued undo/mode changes then observe the completed root commit. Structural commands requested in the cell wait until that barrier finishes.

This uses Ptolemy's existing CM dispatcher/composition behavior without changing the published factory interface or session implementation. Native event ordering still requires WKWebView acceptance.

## Table policies

- Row 0 is the header. `insertRow.row` is an insertion position from 1 through row count; `deleteRow.row` is an existing row index. Column insertion accepts 0 through column count.
- Cell changes touch only content spans, preserving padding/pipes and unrelated text/EOLs. Small changes use minimal raw patches. Escaped pipes, including those inside inline code, have explicit boundary maps.
- Empty cells split their whitespace into left/right padding; clear-then-type preserves the tested `| x |` shape.
- Last body row deletion leaves a valid header/separator table. Deleting the header or final column explicitly removes the table range, preserving surrounding source.
- Adding a first/last empty column to an unbordered table introduces only the necessary outer pipe so the column cannot disappear in GFM parsing. Deleting down to one column also retains a required outer pipe.
- Irregular rows, invalid separators, incomplete tables, and unescaped code pipes that change cell count fall back to editable source.
- Tab/Shift-Tab navigate existing cells and exit into the parent at boundaries, without adding a row.
- Multiline insertion leaves source unchanged and exposes the full rejected text in an editable textarea with source-mode guidance. It is not silently stripped or lost.

## RED evidence

1. Initial focused run failed imports because the new modules did not exist. This was scaffolding evidence, not the behavioral RED claim.
2. After exporting the factory and empty behavior stubs, `npx vitest run web/test/live.test.ts web/test/tables.test.ts` ran 13 tests: **11 failed, 2 passed**. Failures covered source mapping, active spans, net composition patches, local cell edits, multiline rejection, structural edits, EOL inheritance and Tab boundaries.
3. Real browser run against the empty extension: **6 failed, 2 passed** of 8. Missing live syntax and cell widgets failed the visible/editor behavior checks. A sandboxed launch attempt aborted Chromium; the same requested suite ran after automatic escalation approval. Launch failure was not counted as functional RED.
4. Clear-then-type regression: `retains surrounding padding when an emptied cell is typed into again` failed with `|  x| right |` instead of `| x | right |`; the mapping fix then passed.
5. Added composition/focus checks failed because root provisional source lacked cell preedit and a mode switch lost focus. The root provisional transaction and focus restoration fixes passed those checks.
6. The F19 computed-style test failed on H5 `17.6px` versus `16px`. Scoped typography now checks all six heading sizes/line heights/margins, H1/H2 borders, quote/table/link/code styling, and dark/print variables.
7. Three focused regressions failed for a nonminimal escaped-code patch, disappearing boundary columns in unbordered tables, and overlapping root/table math replacements. All passed after their fixes.
8. Additional browser RED checks caught missing rendered list markers and copying unescaped cell text instead of source Markdown. Both now pass.
9. Deleting a column from a two-column unbordered table initially produced non-table text. The regression failed, then passed after retaining the necessary outer pipe.
10. Runtime error assertions exposed `TileBuilder.addComposition: Cannot read properties of null (reading 'dom')` during cell composition plus mode/structure changes, even when content assertions passed. Root native compositionstart forwarding was the cause. Replaced it with the session's compose transaction annotation. Each of the two failing scenarios was repeated three times: **6/6 passed with no captured browser errors**.

## Final verification

The exact commands and final counts are recorded below after the final run. Every browser test also asserts no page errors or console errors.

- `npx vitest run web/test/live.test.ts web/test/tables.test.ts`: **18/18 passed**.
- `npm test`: **149 passed, 1 skipped**, 9 test files. The existing skipped test is `web/test/export.test.ts`, `checks real browser fonts, image decode, print wrapping and formula overflow`, gated by `RET_EXPORT_BROWSER=1`; it was not silently counted as passing.
- `npm run typecheck`: passed, no diagnostics.
- `npx playwright test web/test/editor.spec.ts --workers=1 --reporter=line --timeout=15000`: **14/14 passed**, no captured page/console errors.

Browser proofs cover hide/reveal of heading/inline/list/quote/code/math/image source; real mini-CM typing; local patches and exact source/BOM/EOL undo across modes; boundary Tab navigation; retained multiline paste; atomic context row/column actions; root marked-node identity; cell DOM/focus stability; provisional source versus committed barrier; single composition commit followed by queued undo; queued structure edits; mapped selection/focus on mode switch; malformed fallback; F19 computed styles in light/dark/print; rendered list markers/code frame; and escaped Markdown cell copy.

## Remaining controller/native gates

- Real macOS WKWebView Chinese candidate selection, replacement and deletion around headings, formulas, code and cells. Verify candidate UI and actual native marked-node stability, rather than dispatching synthetic DOM events.
- Cmd-S/barrier during preedit, completion/cancellation, and undo/redo across source/live mode and parent/cell focus transitions. Run T04/T05/T21 on the integrated app; these are not waived by browser success.
- Actual F19 visual comparison at 1000/1400/1800 logical widths with bundled fonts and the native app's explicit/system appearance settings. Computed-style checks cover live elements, not a claim of complete app typography acceptance.
- Native Release performance/memory acceptance was not measured by this task. No WKWebView/native IME pass is claimed here.
