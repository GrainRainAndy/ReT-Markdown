# Acceptance projection fixes — AC3 / AC4 / AC9

2026-10-16. Scope follows `build/verification/acceptance-handoff.txt`, the design/F19 baseline, and the controller's ownership split. Production projection source and tests are frozen, ready for fresh review and controller publication. Native application acceptance remains with the controller. Current round-1 frozen candidate: **68 browser cases pass; 272 unit tests pass, 1 skipped; typecheck exits zero**. Controller full performance/native acceptance remains pending; see the follow-up below.

## Files changed in this round

- `web/src/live/syntax.ts`: source ranges for horizontal rules, every quote prefix, escapes/entities, sequential ordered-list labels, Setext headings, paragraph soft breaks and source-only blank lines; block/display metadata for the existing math parser.
- `web/src/live/decorations.ts`: actual CM block wrappers, inline literal widgets and mapped reveal clicks, source-preserving blank-line styling, single Setext frame, centered display math, intrinsic short-table width, and the agreed `tableInteractions(options)` integration.
- `web/test/acceptance-projection.test.ts` (new): three focused range/grammar regressions.
- `web/test/acceptance-projection.spec.ts` (new): ten Chromium/real-CM/production-transport regressions, including geometry and byte/history assertions.
- `web/test/acceptance-projection-harness.ts` (new): reuses the production transport harness and adds an independent renderer reference surface for measured comparisons.
- `docs/testing/acceptance-projection-fix-report.md`: this report.

No edits to cell widgets, table patching, session, main, native code, palettes, renderer source, root configuration, or existing closed review tests in this round. The `TableWidget(table, raw, options, documentSource)` construction is unchanged. No Git, subagents, dependencies, shared `build/web`, app publication or remote resources. Browser bundles use esbuild `write:false`; outputs/screenshots are private temporary files. The full unit suite's existing build test also uses private temporary output.

## AC3 — missing basic live semantics

Horizontal rules now project a real `<hr>` while inactive. Selection reveals their original source. Quote wrappers encompass the entire source block and hide each owned line prefix, including paragraphs separated by quote-only blank lines. Ordered-list labels use the first source ordinal and sibling position: `5. / 1. / 1.` displays `5. / 6. / 7.` without changing those source numbers.

Escapes and named/numeric entities use the existing configured renderer for decoding and HTML escaping; code stays opaque. Their widgets retain the exact UTF-16 source span. A click on the leading/trailing half reveals source at the corresponding raw boundary; keyboard Enter reveals at the leading boundary. Tests cover escaped asterisks, ampersand, decimal and astral numeric entities, a combining named entity, literal inline-code entities, mapped clicks, local insertion and byte-exact root undo. Paragraph soft breaks project spaces; hard breaks keep real line boundaries.

## AC4 — Setext single frame

Setext uses one block wrapper around the editable heading source. Only the inactive newline/underline is replaced; no second heading line receives a duplicate margin or border. Multi-line heading text projects soft spaces using the same source ranges.

The browser exposed an additional 1px height discrepancy: CM's baseline-aligned caret buffer is a `1em` image, which enlarged the heading line box. The scoped Setext buffer rule sets its height to zero while preserving the buffer DOM and CM caret mapping. Both `===` and `---` now match the renderer's actual heading height and following paragraph gap within 0.5px. Active underline reveal and source/live mode changes preserve the original bytes.

## AC9 — actual CM block geometry

Root paragraph wrappers use the baseline `.8em` vertical margins; raw repeated blank lines no longer add line-height-sized visual gaps. Crucially, a hidden gap is a **line decoration with `display:none`**, preserving its LF and CM line boundary. An earlier replacement of the complete blank-line range consumed the following block's line start, dropping five heading line styles and the opening code frame. That defect was reproduced in a new browser regression before this correction. Keeping line tiles also avoids destroying the adjacent focused table during root/cell selection changes.

Display math uses a full-width block wrapper and a centered KaTeX display. Short tables use intrinsic width rather than `width:100%`; the old minimum cell width is removed, while frozen cell border/padding remain intact. The controller owns and supplied the scroller `lineHeight:'1.6'`; this round does not modify session styles.

At viewport widths 1000, 1400 and 1800, tests measure the **actual CodeMirror DOM** against the independently rendered reference: paragraph height and collapsed gap, formula/content center, short-table width, and computed scroller line-height ratio. A mixed document additionally compares multi-paragraph quote height, multi-line Setext height and a hard-break paragraph height. Screenshot manually inspected: `/private/tmp/ret-acceptance-projection-mixed.png` (live CM above, reference below). This is browser layout evidence; it does not substitute for the controller's packaged native UI comparison.

## RED → GREEN evidence

- Initial new unit suite: **3 failed** (missing semantics/ranges, Setext metadata, paragraph breaks). Current focused command below: **27 passed**, including all existing live/table unit tests.
- Initial projection browser suite: **7 failed, 1 passed**. The passing control was synthetic composition; HR/literals, both Setext cases and all three responsive geometry cases failed before implementation.
- New inter-block boundary regression: **1 failed** (only H1 decorated instead of H1–H6). Final corrected projection suite: **10 passed**. Existing six-heading typography and four-line code-frame assertions were retained unchanged.
- First combined corrected live/table/final-review run: **50 passed**. Log `/private/tmp/ret-projection-combined-green.log`.
- Intermediate expanded run: **58 passed, 1 failed**. The sole failure was the table owner's newly added menu-Tab cell-focus assertion (`/private/tmp/ret-acceptance-projection-final.log`). Epicurus fixed event propagation in the owned menu branch; this report makes no cell/menu source claim.
- Initial-freeze mixed-browser run after that fix and the controller's new session/AS1 tests: **62 passed, 0 failed** (23.7s). Projection **10/10**, session **11/11**, table **9/9**, existing editor **22/22**, final-live **10/10**. Log `/private/tmp/ret-acceptance-projection-frozen.log`; private artifacts `/private/tmp/ret-acceptance-projection-frozen`.

Initial-freeze commands and results (superseded by round 1 below):

```sh
npx vitest run web/test/acceptance-projection.test.ts web/test/live.test.ts web/test/tables.test.ts
# 3 files, 27 passed
npm test
# Snapshot at 00:26:24 local: 13 files, 239 passed, 1 skipped
npm run typecheck
# exit 0; final SyntaxSpan optional metadata is published
npx playwright test web/test/acceptance-projection.spec.ts web/test/acceptance-session.spec.ts web/test/acceptance-table.spec.ts web/test/editor.spec.ts web/test/final-live.spec.ts --workers=1 --reporter=line --output=/private/tmp/ret-acceptance-projection-frozen
# 62 passed / 0 failed
```

The full-unit result above is a time-stamped snapshot, not a claim that all concurrent workspace work is complete. The controller reported additional AC2 grammar review work in parallel; its final unit verification/review is outside this projection freeze. The final 62-browser result applies specifically to the five listed suites. Typecheck exited zero again after the frozen menu change.

## Source, composition, integration and remaining acceptance

Presentation changes dispatch no content patches. Tests retain BOM, CRLF, lone CR, LF and trailing-newline state across reveal, mode changes and ordinary root undo. Literal click mapping uses raw UTF-16 boundaries, including an astral entity. The composition regression checks the actual active text node survives provisional insertion, revision stays zero before compositionend, one root commit follows, and one root undo restores encoded bytes. Existing L1–L4 and FR1/FR2/FR4 browser tests remain green.

Synthetic `CompositionEvent` tests are **not native IME proof**. Chinese candidate selection/deletion/commit, Cmd-S while composing, native undo across modes, packaged fonts and final macOS UI typography still require the controller's WKWebView/native acceptance. KaTeX browser geometry uses its shipped layout CSS with font-face declarations removed, so it does not claim packaged font loading.

Main already imports `import { liveExtensions } from './live/decorations'` and calls `transport.installLiveExtensions(liveExtensions)`; transport installs the factory through the existing session `.liveExtensions(factory)` adapter. The agreed `tableInteractions(options)` extension is imported and appended inside the factory after its module exists; no `LiveOptions` change or main/session edit is needed. The two previous base-theme menu rules were removed to let the table owner's overlay theme apply. Controller remains sole publisher.


## Round 1 — AP-1 / AP-2 and measured performance follow-up

The initial 62-case freeze did not exercise quoted Setext or backslash HardBreak. Read the independent review and reproduced both before changing source: two new unit failures; four new browser failures with two passing composition controls. Quoted Setext now hides the complete underline source line, including the quote/container prefix, and excludes its preceding LF from soft text breaks. HardBreak now hides only its syntax marker and retains the actual LF. Existing normalized UTF-16 HeaderMark positions and all frozen performance-fixture span fingerprints remain unchanged.

The new single/multi/nested quote-heading browser cases compare actual CM text and geometry with the renderer, verify actual-coordinate title clicks, raw source reveal, local edits, one root undo, mode roundtrips and exact encoded bytes. The backslash-hard-break case compares text/two-line geometry and mapped editing. Two synthetic active-marker composition cases preserve the actual text node and single root history event; native IME remains unproven by these synthetic controls.

The controller also identified a major live performance regression. Profiling isolated repeated quadratic root/span/gap scans rather than large-paragraph layout. Indexed containment, a monotonic root cursor, Set gap membership and unrelated-effect projection reuse remove that measured cost. Detailed RED/GREEN, phase measurements, deterministic operation-count tests, limits and frozen SHA-256 identities are in [the performance follow-up](acceptance-projection-performance-fix.md).

Final candidate verification: **68/68 browser** (all retained 62 plus six AP-1/AP-2 cases), **272 unit passed / 1 skipped**, **typecheck exit 0**. Logs are `/private/tmp/ret-projection-complete-browser.log`, `/private/tmp/ret-projection-complete-unit.log`, `/private/tmp/ret-projection-complete-typecheck.log`. The final single 1MiB live-open check measured **542.8ms**, exact source, under the unchanged 15-second boundary. This is one component diagnostic, not P95 or native acceptance. Controller owns the final unchanged 20-sample harness run and publication. No shared `build/web` or app was published by this owner.
