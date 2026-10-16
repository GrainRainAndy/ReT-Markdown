# AC5 / AC7 table acceptance fixes

2026-10-16. Final scoped web result: **41/41 combined browser tests passed; 239 unit tests passed, 1 skipped; typecheck passed.** Scope: visible root Find feedback in replaced live tables, and table context-menu overlay/dismissal. Read the design baseline, acceptance handoff, Task 4 reports/reviews and final-live reviews. `AGENTS.md` is empty. No Git commands, subagents, dependency/configuration edits, native edits, shared `build/web` output or application publication.

## Owned files

- `web/src/live/cell-widget.ts`: projects root query/selection into the active cell, preserves root/panel focus, and owns menu focus/dismissal/listener cleanup.
- `web/src/live/table-interactions.ts` (new): root-view lifecycle extension, widget subscriptions, inverse raw UTF-16 mapping, mini-view highlight effect/field and scoped menu/highlight theme.
- `web/test/acceptance-table.spec.ts` (new): nine real CodeMirror/Chromium acceptance regressions (including the shared gap/Tab integration regression).
- `web/test/acceptance-table-harness.ts` (new): small additions to the existing real-session browser harness; final tests use the production live factory without a test-only extension installation.
- `web/test/acceptance-table-mapping.test.ts` (new): two focused inverse-map tests.
- This report.

The decorations owner integrated `tableInteractions(options)` into `liveExtensions` and removed its obsolete menu theme entries. This task did not edit `decorations.ts`, `live-contract.ts`, session/main/search, syntax, native files or shared styles. Controller-owned search now uses CM's authoritative query and native CM commands.

## Behavior and integration

`tableInteractions(options: LiveOptions): Extension` observes root view updates. It coalesces refreshes into a microtask after CM finishes updating replacement DOM, avoiding nested root updates. Each table subscribes/unsubscribes with its controller lifecycle; pending callbacks check destruction and composition. No LiveOptions contract or TableWidget constructor change was needed.

The controller reads `getSearchQuery(root.state)` and the current root selection. Matching cells receive a visible outline. A nonempty root selection contained within a cell opens its mini-view without taking focus or mirroring a transaction back into the root. Raw offsets map through the existing cell offset table, including escaped pipes and UTF-16 astral characters. A local selection and explicit colored match decorations remain visible while the search panel owns focus. Query changes remove stale highlights. The mini-view has no history; source/history/composition remain root-owned. Search feedback is suspended during root or cell composition.

The context menu is a fixed overlay attached beside the root scroller, outside the table's scrolling/layout box. It is clamped to the viewport, focuses its first action, supports wrapping Up/Down and Home/End, and uses native button keyboard activation. Escape restores the originating cell; outside pointer/focus dismisses while preserving the new focus target. Actions dismiss and restore root focus, including deletion of the table. Tab consumes the key before restoring cell focus; root scrolling, window resize/blur and widget destruction also dismiss. Every installed document/window/scroller listener is removed by the same cleanup function. The six existing structural actions and atomic root patch path remain intact.

## RED → GREEN evidence

Initial sandboxed Chromium launch aborted before testing; this was infrastructure failure, not behavioral RED. Authorized unsandboxed execution used in-memory esbuild bundles (`write:false`) and only private output directories.

`/private/tmp/ret-acceptance-table-red.log` records four actual failures before implementation: missing mini-view/visible Find hit, no panel Find highlight, menu layout height increasing from 220.75 to 303.92 px, and the menu remaining after an outside click.

The first implementation passed direct Find and outside/action dismissal. Investigation corrected two harness assumptions: CM's search panel commits on keyup, so simulated fill is followed by an ArrowRight key before Enter; menu layout is measured after entering the cell so cell-editor geometry is not attributed to the overlay. The four tests then passed. Four further acceptance checks, the later boundary-Tab integration regression and two inverse-map checks were added. No product behavior was weakened to satisfy those harness corrections.

Final coverage includes actual CM panel next/previous, replacement and replace-all with one root undo each, unchanged BOM/mixed EOL bytes, unchanged revision/history during Find, retained redo, computed highlight color, full/partial pipe-escape matches, astral positions, deep-table hit visibility, synthetic composition marked-DOM identity and one root commit, menu layout/focus/navigation/dismissal, deleting a table, and destruction without stale Escape handling.

## Verification

- `npx playwright test web/test/acceptance-table.spec.ts web/test/editor.spec.ts web/test/final-live.spec.ts --workers=1 --reporter=line --timeout=15000 --output=/private/tmp/ret-acceptance-table-frozen`: **41 passed**, 18.1 s, exit 0. Nine acceptance-table cases, all 22 existing editor cases (including L1–L4), and all ten final-live cases (FR1/FR2/FR4). Log `/private/tmp/ret-acceptance-table-frozen.log`.
- `npx vitest run web/test/acceptance-table-mapping.test.ts`: **2 passed**; also included in the full suite below.
- `npm test`: **239 passed, 1 skipped**, 13 files, exit 0. Log `/private/tmp/ret-acceptance-table-unit-frozen.log`. The skip is the existing opt-in export-browser test. Earlier concurrent owner-WIP failures in `acceptance-projection.test.ts` (AC3 syntax/literal mapping, AC4 Setext mapping, AC9 paragraph mapping) all pass in this final run.
- `npm run typecheck`: **PASS**, exit 0. Log `/private/tmp/ret-acceptance-table-typecheck-frozen.log`.

Browser suites assert absence of page and console errors. No shared build was published; the existing build test uses its own private temporary outdir. Owned-source/test hashes: `/private/tmp/ret-acceptance-table-owned.sha256`.

The first production-factory combined run passed 39/39. Concurrent block-projection changes then produced 37/40, with failures in the existing boundary Tab, six-heading typography and four-row code-frame tests (`/private/tmp/ret-acceptance-table-regression-final.log`). The new boundary-Tab test reproduced the focus loss twice: an adjacent gap replacement swallowed its LF and recreated the table widget. The decorations owner changed gaps to stable line styling, preserving source/DOM boundaries. All four affected checks passed without weakening existing assertions (`/private/tmp/ret-acceptance-table-integration-recheck.log`), followed by the final 41/41 above.

A final menu Tab check reproduced dismissal continuing default navigation and losing cell focus (`/private/tmp/ret-acceptance-table-menu-tab.log`). The existing Tab branch now prevents default and propagation before restoring the cell. That assertion is retained in the menu test and passes in the final combined run. No outstanding failure from any run above is omitted or counted as passing.

## Limits

The new cell selection projection covers selections contained in a cell; it does not introduce a raw-source editor for table separator syntax or a multi-cell editing selection. Closed L1–L4 and FR1/FR2/FR4 web behavior is covered by the combined regression run. FR3 is the separate native continued-reference scanner finding, already closed in `reviews/final-assets-fix-review.md`; this task did not rerun or reopen that native gate. Genuine WKWebView/Chinese IME, native menu/OS focus acceptance and packaged application publication remain controller verification. Synthetic browser composition is not native IME proof.
