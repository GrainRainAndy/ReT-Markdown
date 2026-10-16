# Projection performance fix and AP-1 / AP-2 follow-up

2026-10-16. **Current candidate is frozen and ready for independent review/controller performance verification.** Production changes are limited to `web/src/live/syntax.ts` and `web/src/live/decorations.ts`. All retained 62 browser cases plus six review regressions pass: **68/68**. Full unit snapshot: **272 passed, 1 skipped**; typecheck exits zero. Final current-candidate 1MiB live-open diagnostic: **542.8ms**, exact source, focused/editable first screen. This single diagnostic is not a completed performance acceptance series or native acceptance.

## Measured cause before changes

The controller's existing `build/performance-acceptance/performance.json` is incomplete after graceful interruption. Its reported regular-live degradation and repeated 1MiB 15-second failures prompted this investigation; its missing samples are not replaced with zeros or treated as a P95 result.

Before touching production, private esbuild `write:false` bundles instrumented boundaries around the **real** configured Lezer parse/traversal, Markdown/math parse, blank-line scan and projection construction. No fake parser/clock/editor was used. Node-only measurement separated parser/projection work from all DOM/layout work. A Chromium diagnostic then reused the **unchanged** `harnessSource` extracted from `scripts/measure-performance.mjs`, real production transport/session, existing fonts/styles, frozen fixtures and the same 15-second open boundary. CDP metrics separately measured layout/style work.

| Before-change measurement | Regular 256KiB | Boundary 1MiB |
| --- | ---: | ---: |
| Node Lezer parse | 17.7ms | 62.2ms |
| Node Lezer walk | 5.0ms | 19.6ms |
| Node Markdown/math parse | 13.3ms | 86.1ms |
| Node blank-line root scan | 17.8ms | 1043.7ms |
| Node one projection construction | 107.9ms | 5089.6ms |
| Chromium editable-open diagnostic | 647.2ms | exceeded unchanged 15000ms boundary |
| Chromium one projection | approximately 124–127ms during open | 5766.9ms, then 5727.0ms before timeout |
| Chromium layout + style during regular open | 15.6ms | timeout, no completed metric |

The primary regression is repeated quadratic script work, not measured giant-line virtualization failure. Frozen fixtures have short paragraphs (controller measured maximum UTF-16 length 65). No large-paragraph fallback, cutoff, truncation, fixture changes or raised timeout/budget was introduced.

Specific causes:

- Blank-line collection used `roots.some(...)` for every source line, scanning the entire root-block list repeatedly.
- Projection's `activeQuote` scanned **all spans** for each paragraph/gap even when no quote was active. Gap membership used repeated array `includes`; marker containment scanned every hidden gap.
- The field rebuilt projection for unrelated effects/transactions despite unchanged document/selection/mode, multiplying that cost during open and other UI updates.

Raw before profiles: `/private/tmp/ret-projection-profile-red.jsonl`, `/private/tmp/ret-projection-browser-red.jsonl`. They are instrumentation diagnostics under uncontrolled external workload, not native timings or completed P95 series.

## Bounded changes

`syntax.ts` now advances one root-block pointer through source lines: root membership is O(lines + blocks). A pure internal-module helper `indexedContains(ranges: readonly Range[]): (range: Range) => boolean` sorts source starts, retains prefix maximum ends, and answers containment in O(log N). It preserves nested-owner containment without merging separate ranges. It is shared by table/math exclusion, quote/opaque membership and decorations; no published editor contract or renderer API changed.

`decorations.ts` builds an index of **active** quotes once, uses a Set for hidden-gap identity and indexed gap containment for marks. Index construction is at most O(N log N), instead of per-query O(N) scans. Unrelated transactions reuse the existing projection; document edits, explicit selection, reconfiguration and composition-end refresh still recompute. Composition still maps the existing decoration/wrapper sets, preserving marked DOM. Document-reference context invalidation remains keyed by immutable CM document identity.

The existing paragraph wrappers, source LF boundaries, `display:none` blank-line tiles, intrinsic table width, math centering and frozen theme remain. No cell widget, table interaction, session, main, native, config, resource or publishing changes were made.

## Deterministic performance regression tests

New `web/test/projection-performance.test.ts` instruments range/discriminant **reads in the real owned modules** in a private bundle. It tests algorithm work, with no elapsed-time threshold and no production instrumentation/API:

- Doubling a mixed paragraph/quote/list/code document from 100 to 200 blocks must remain below 2.6× work and below 100,000 counted reads.
- Before the fix, syntax required **4,432,596** reads at 200 blocks; projection required **12,393,396**. Both scaling assertions failed. Both now pass their deterministic bounds.
- An unrelated effect formerly caused **3,105,296** projection reads. It now causes **zero**, with the same immutable document.
- Indexed containment tests nested owners, zero-length boundaries, disjoint-range crossings and empty input.
- Two full frozen-fixture span fingerprints captured before the fix remain **identical** after it. This checks every original span/mark/label/break and UTF-16 range, not just counts.

Initial performance suite: **3 RED**. Current performance suite: **6 GREEN** (including containment and the two fixture fingerprints). Before-change failure log: `/private/tmp/ret-projection-operations-red.log`.

Frozen source/span identities:

```text
35c7ef133edbc754dbf52f134cffb0768f6651e0f0e98a0654ae09832280958a  regular-256k.md bytes
2e424b51040a7e48f9c60a74a88dd3772c4e2fe57b59c6fedd9e44a57933d9e4  boundary-1m.md bytes
8006de70d5b4ee7c60b93245f810f326114c2da32009477c1564b2152756c6e8  regular complete JSON span fingerprint
e7e3ea9bc3c87efc5d1f2c70a8088baa2393bf678efe6b50b3c155b330d48b11  boundary complete JSON span fingerprint
```

## After-change diagnostics and controller handoff

Private Node diagnostic after the indexed fix measured regular projection **5.1ms**, boundary projection **31.6ms**; gap scan including final filtering was **1.7ms / 9.1ms** respectively. Private Chromium diagnostic measured regular open **110.2ms**, regular trusted inputs **43.8/41.4/35.3/34.3ms**, boundary open **542.5ms**. Boundary input diagnostics remain approximately 198–236ms; no new 1MiB input target is claimed. These exploratory diagnostics predate the two tiny functional follow-ups below and are not a complete acceptance run.

After AP-1/AP-2 and all final tests, the controller-requested **single current-candidate** boundary open check measured **542.8ms**, retaining all **711854 normalized UTF-16 units** from the unmodified **1048762-byte** fixture. Layout/style were **10.4/1.6ms**; three required projection passes were **36.5/34.9/34.8ms**. `exactText:true`, editable caret checks across two RAF callbacks, local resources, and the unchanged 15000ms boundary were retained. Log: `/private/tmp/ret-projection-current-open.jsonl`.

The owner briefly started the unchanged full performance harness before receiving the functional review, then stopped only that owned process with SIGINT when the candidate became stale. It saved `/private/tmp/ret-projection-performance-final/performance.json` as **incomplete** (17 regular and 16 boundary successful samples); subsequent closed-browser errors are shutdown artifacts, not invented timing samples. No P95/acceptance claim is made from that partial run. At the controller's request, no second owner full run was started. The controller alone reruns the unmodified 20-sample acceptance series against this frozen candidate. External workload was not isolated by the owner.

## AP-1 / AP-2 functional closure

Read `docs/testing/reviews/acceptance-projection-fix-review.md` and reproduced both exact reports before changing behavior. New focused unit result: **2 failed, 3 passed**. New browser result: **4 failed, 2 composition controls passed**.

- **AP-1 quoted Setext:** Lezer omits the final underline line's quote prefixes from collected QuoteMark nodes. The projection now joins from the underline **source line's LF**, including all quote/container prefixes, through the existing HeaderMark end. Soft text breaks stop before that same underline LF. Original HeaderMark/source offsets are retained. Single-line, multi-line and nested quoted headings (both underline forms across cases) now exactly match renderer text/height. Actual CM coordinate click maps to the original title UTF-16 position; local insertion, one root undo, active source reveal and mode roundtrip preserve bytes.
- **AP-2 hard breaks:** HardBreak has its own source span and a marker range excluding the LF. Inactive projection hides the backslash or trailing-space marker, leaving a real hard line boundary. Code remains opaque. Browser text and two-line height match the renderer; selecting the marker reveals original source and local insertion/undo is exact.

Both active-marker composition cases retain the actual marked text node, keep committed revision zero during provisional input, commit once after compositionend and undo once to exact BOM/mixed-EOL bytes. These are synthetic CompositionEvent controls, **not native IME proof**.

Focused functional browser result: **6/6 GREEN**. Logs: `/private/tmp/ret-projection-review-unit-red.log`, `/private/tmp/ret-projection-review-browser-red.log`, `/private/tmp/ret-projection-review-browser-green.log`.

## Final verification and frozen source identities

```sh
npm test
# 14 files; 272 passed, 1 skipped (00:42:45 local snapshot)
npm run typecheck
# exit 0
npx playwright test web/test/acceptance-projection.spec.ts web/test/acceptance-session.spec.ts web/test/acceptance-table.spec.ts web/test/editor.spec.ts web/test/final-live.spec.ts --workers=1 --reporter=line --output=/private/tmp/ret-projection-complete-browser
# 68 passed, 0 failed (25.0s)
```

Final logs: `/private/tmp/ret-projection-complete-unit.log`, `/private/tmp/ret-projection-complete-typecheck.log`, `/private/tmp/ret-projection-complete-browser.log`. Browser breakdown: projection **16**, session **11**, table **9**, retained editor **22**, final-live **10**. All closed L1–L4 and FR link/image/highlighting cases remain included. These results apply to this candidate and these suites; they do not certify parallel native/application review or full V1 acceptance.

```text
73722f27dd1d3dc3f7e46c87b3baa6d85323c4b319f91895e5f00acb070af047  web/src/live/syntax.ts
257385fba6242f98c30fbefd437aea80d0259273feb94dda8b3355e5f4b02c1c  web/src/live/decorations.ts
ffcdeeba4268bf11353d8adcbd45a431e5c7cd4be63f322d8068b2b7c621ab68  web/test/projection-performance.test.ts
e9e5beebad974c469ac5ec6cc2e2273a54fd5b5b9b3fa546e3cb44513d29dd1a  web/test/acceptance-projection.test.ts
5bcb1720cd3cf78ea07e2d135dba9fbdb05bfe35f9be84af97c1dc569ecb601f  web/test/acceptance-projection.spec.ts
```

Reports are frozen alongside the source; the complete file manifest is `/private/tmp/ret-projection-final.sha256`. Main/factory wiring is unchanged and already installed. No Git, subagents, shared build/app publication, budget changes or user-app closure. Native Chinese IME/candidate behavior, packaged UI/fonts, physical display timing and final performance acceptance remain controller work.
