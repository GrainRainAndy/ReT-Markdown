**Final whole-implementation review — 2026-10-15**

> 2026-10-16 controller status: subsequent native acceptance confirmed nine additional defects; this historical code verdict does not approve those paths or the current repairs. See `../2026-10-16-acceptance-fix-plan.md`. A fresh scoped review and actual-editor verification are required after the fixes.

**Overall Spec / CODE verdict: PASS for the reviewed implementation and approved corrections.** FR-1–FR-4 and the subsequently confirmed native Save As shortcut misrouting are closed by the scoped reviews below. No remaining actionable P0/P1/P2 code finding was established. This supersedes the initial CHANGES REQUIRED verdict; the original findings and initial-run evidence below are retained as history.

**Overall Quality / CODE verdict: PASS for the captured reviewed sources.** The source/undo, native persistence/recovery/assets, shared-parser/live projection and isolated-print boundaries have completed their scoped corrections and review. This is a code-review verdict, not a claim that every product acceptance scenario passed.

**Release / native acceptance: NOT COMPLETE.** Accepted SavePanel completion and exact output bytes, dirty-SOURCE accepted Save As/undo continuity, genuine native IME, system lifecycle/settings, full Typora visual comparison and native Release 20-run performance/RSS remain pending.

**Controller verification addendum after the independent review (23:48 +0800):** final clean Release build and strict/deep ad-hoc signature verification passed; all 83 Web files match the app resource bundle; no temporary trace key/string remains. Final native suite:84 total,83passed,1opt-inPDFskip,zero failures; the skipped realWKWebView PDF test separately passed0.490s and produced27A4pages. Web189passed/1opt-inskip,32Chromiuminteractionspassed,typecheckpassed; skippedbrowserexporttest separately enabled in its22/22passing suite. Packagedsession/renderbrowsercheckspassed. Logs `build/final-*.log`, artifact/source manifests `build/verification/final-bundle.json` and `final-source-sha256.json`. This addendum records controller execution, not a fresh independent reviewer test run; native acceptance above remains open.

| Closed finding / follow-up | Current independent review |
| --- | --- |
| FR-1 live link opening, FR-2 body reference images, FR-4 live code highlighting | [final-live-fix-review.md](final-live-fix-review.md): scoped Spec/Quality PASS. |
| FR-3 native continued-reference discovery, resource preflight and Save As warning data | [final-assets-fix-review.md](final-assets-fix-review.md): scoped Spec/Quality PASS. |
| Native Cmd-Shift-S routed to automatic Duplicate instead of public Save As | [native-save-as-fix-review.md](native-save-as-fix-review.md): frozen clean source Spec/Quality PASS, actual packaged keyboard RED/GREEN routing and 20 clean focused tests. |

The native routing root cause was reproduced in an empty untitled SOURCE document; dirty content was not required. The explicit menu wrapper now reaches public Save As and the native panel. A separate real dirty-SOURCE public-action test verifies panel preparation/cancellation with unchanged source/session/undo. Actual accepted-panel saving is still incomplete manual acceptance; the CUA panel-closing observation supplies no established residual product defect. No speculative type/panel correction was approved.

**Historical initial findings and review evidence follow.** Their original triggers remain documented for traceability; the linked scoped reviews supersede their open status. The historical bundle hashes/counts and test totals below describe that initial checkpoint, not the later clean final build.

**Scope and method.** Reviewed the complete current additions in this non-Git workspace against F01–F20, the native architecture, implementation/rendering plans, execution ledger, task reports and original/fix reviews. Focus was cross-component behavior, not a repetition of task reviews. No product edits, subagents, Git operations, shared build writes, application launches or UI control were performed. Existing successful suites were read, not rerun. New probes were confined to `/private/tmp/ret-final-review-20261015`: an unchanged extracted Swift scanner and production editor/renderer code bundled in memory into a JSDOM document. These prove parsing/DOM/event-routing behavior, not native visual or input acceptance. A separate `write:false` compilation compared current Web outputs with the assembled bundle.

**FR-1 — P2: ordinary live-document links cannot reach the native browser action.**

Locations: `web/src/live/decorations.ts:61`, `web/src/editor/session.ts:119`; downstream wiring is present in `web/src/main.ts:88` and `Sources/ReTMarkdown/Bridge/EditorBridge.swift` (`.openLink`). Requirement: F08 external-link opening.

Trigger: load `[site](https://example.com)` followed by another paragraph, then move the caret outside the link and attempt to open it. The live projection creates a `<span class="cm-live-link">`, hides the destination/markers and never supplies an anchor or a source-position link-opening action. The session handler only recognizes `a[href]`. There is no alternative document-link menu/handler. Consequently the implemented native allowlisted `NSWorkspace` path is unreachable for an ordinary body link.

Probe: the production live DOM contains the styled span and **zero `a[href]` elements**; dispatching a click with modifier keys produces **zero `openLink` callbacks**. Full-document rendering of the same source produces the correct anchor. The source remains unchanged. This concerns the missing live-to-bridge connection, not the correctness of the native URL allowlist.

Fix: associate live link spans with destinations resolved in the document's Markdown context and connect an explicit opening gesture/action to `openLink`, preserving normal caret editing and the native scheme policy. Regression: ordinary inline and reference links must emit the exact URL through the real transport, without changing source/history; unsupported schemes remain inert.

**FR-2 — P2: body reference images lose their definition context in live mode.**

Locations: `web/src/live/decorations.ts:15`, `:46`. Requirements: F04, F08 and F14.

Trigger:

```markdown
![x][pic]

[pic]: image.svg

end
```

With `image.svg` authorized and the caret on `end`, `RenderWidget` receives only `![x][pic]` and calls the whole-document renderer on that substring. The external definition is absent, so the widget renders literal Markdown rather than the image. This occurs even with a correct capability map and a conventional single-line definition; it is independent of FR-3.

Probe: the actual `.cm-live-image` widget contains `<p>![x][pic]</p>` and **zero image elements**. An inline-image control using the same resolver produces one image, while full-document rendering of the reference form also produces an image. All source bytes represented by the session remain unchanged. Table cells and clipboard conversion already have their own reviewed document-context handling; this body-widget call site does not use it.

Fix: render the image in its original document inline/reference context, retain exact source mapping, and invalidate the widget when its definition changes outside the image span. Regression: full/collapsed/shortcut references, local and remote placeholders, and definition-only edits must agree with the shared renderer while preserving source and root undo history. This does not reopen the closed table-cell or clipboard findings.

**FR-3 — P2: a valid continued image definition is omitted from native capabilities and Save As warnings.**

Locations: `Sources/ReTMarkdown/Storage/AssetStore.swift:613`, `:690`; consumers `NativeAssetIntegration.swift:129–145`, `AssetStore.swift:183–184`, and `DraftStore.swift:115`. Requirements: F08, F12–F13 and F16.

Trigger: an existing document beside a valid `image.svg` contains:

```markdown
![x][pic]

[pic]:
  image.svg
```

Both scanner definition checks require the destination on the same line as the colon. They therefore exclude a valid CommonMark continued destination, although the configured renderer resolves it. The production adapter supplies the scanner's results to authorization; the resulting empty map makes export report a missing local image even when the file exists. The same omitted range never enters `planMigration`, so a cross-directory Save As does not list this unmanaged image in its breakage confirmation. This is an uncovered continued-definition case; the closed R5-3 list-indentation fixtures and their correction remain closed.

Probe: the exact current `AssetReference`/`AssetReferences` implementation was extracted without modifying its logic and run with a private Swift module cache under a 45-second deadline. Single-line definition control returns `["image.svg"]`; both plain and blockquote continued-definition cases return `[]`. The actual renderer resolves the continued definition with a supplied capability; with the scanner-implied empty map it produces an image issue `Missing local image: image.svg`, range `[0,9)`. The Save As consequence follows directly from the production scanner-to-migration call chain; no native Save As UI was operated.

Fix: obtain grammar-consistent destination ranges across continuation lines and containers, with original UTF-16 offsets, and use them consistently for authorization, recovery and migration. Regression: a real local continued-reference image must receive a capability, pass PDF resource preflight and appear in the unmanaged cross-directory Save As confirmation; managed equivalents must receive local destination patches. Preserve the existing code-exclusion and nested-list regressions.

**FR-4 — P2: live code blocks have no syntax highlighting despite the renderer supporting it.**

Locations: `web/src/editor/session.ts:61` (bare `markdown()` extension), `web/src/live/decorations.ts:49–60`; contrast `web/src/render/markdown.ts:29–33`. Requirements: F04 and F08.

Trigger: open a fenced `javascript` block containing `const answer = 42;` in live mode. The editor installs neither language-specific fenced-code support nor a syntax-highlighting extension. Its live adapter adds code-line styling only; highlight.js is invoked by the separate HTML renderer, not by this editor path.

Probe: the actual live code line is `<div class="cm-line cm-live-code">const answer = 42;</div>` with no token spans. The same source rendered for HTML/export contains `hljs-keyword` and `hljs-number` spans. Inspection of the complete editor extension list confirms this is not delayed parsing or a missing CSS file. This is an explicitly required capability missing from the writing surface, not a request for a different color theme.

Fix: connect common-language parsing and token decoration/highlighting to the existing source editor without replacing its state/history; retain plain-code fallback for unknown languages. Regression: representative JavaScript/Python/JSON fences show token differentiation in live mode, remain editable, and preserve exact source through edits, mode changes and undo.

**Cross-boundary assessment beyond the findings.** “Implemented/reviewed” below does not mean every corresponding T-case has passed native acceptance.

| Requirements / boundary | Current assessment |
| --- | --- |
| F01–F03: source, codecs, unknown content | Source remains authoritative. TS/Swift patches share normalized UTF-16 coordinates and explicit EOL/BOM metadata; native writes encoded snapshots, not rendered HTML. Existing exact-byte/invalid-input evidence remains applicable. No new whole-document serialization or source-loss path was established. |
| F04–F08: live/source, undo, commands, search, parser | One root session/history survives compartment changes. EOL inverse effects and table parent transactions retain byte fidelity; replace-all is one root operation. The real live factory is wired in `main.ts`. Closed clipboard/table/parser fixes remain intact. The initially missing FR-1/2/4 live consumers and FR-3 native grammar disagreement are now corrected and approved in the linked scoped reviews. Genuine IME remains unverified. |
| F09–F11: native bridge, NSDocument, activities | `load`/`setAssets`, command results and patch payloads agree. Barrier replies retain committed preedit state; close rejects active composition. Native saves serialize captured snapshots and change-count tokens through public NSDocument operations. The closed public-activity deadlock has real menu/menu and autosave/menu regression evidence; no raw-file save substitute was introduced. Post-write fingerprints and retained finalizers distinguish committed disk state from failed acknowledgement. |
| F10–F14: recovery epochs, assets, Save As, undo | Recovery is scoped by UUID plus canonical path and durable session eligibility; reset callbacks rotate bindings before new commits. Delayed writers retain old binding/epoch and cannot win a new session. Save As adopts staged provenance and applies one root patch without replacing mirror/bridge/history; originals, aliases and old capability tokens survive. Recovered frozen bytes persist through import/rename/migration. No regression in the closed R2/R5 cases was found. FR-3 discovery is now corrected and approved separately; recovery/migration behavior outside the scanner was unchanged. |
| F15–F17: export/print | AppDelegate connects a frozen authorized manifest to the independent retained print WebView. Snapshot/capability values are copied, image/font readiness and blocking errors precede printing, and the finalizer validates a temporary A4 PDF before atomic replacement. Print settings own 20 mm margins; CSS uses white 13 px output without extra screen padding. The fixed source-range mapper shares the actual renderer grammar. Existing real pagination/text proofs remain evidence for their fixtures, not every native menu/cancel/layout scenario. |
| F18–F20: layout/styles/offline | Single document windows, no automatic tabs/sidebar/toolbar; separate typography, palette and print resources, bundled fonts and network restrictions are present. No new source-mutating style path was found. FR-4 functional highlighting is now implemented and approved, independently of the pending full Typora visual comparison. |
| Build and packaging | Build script selects the real main/export entries, copies Web resources into the SwiftPM resource bundle and assembles/signs the app. Current in-memory compiler outputs and all 83 `build/web` files agree with the app's actual `…bundle/Contents/Resources/Web` tree. No stale Web bundle defect was found. The controller's final Release build and native test logs are now also available, as recorded below. |

**Evidence read and fresh checks.**

Controller final evidence received before delivery and read from `build/final-*.log`: web **187 passed / 1 skipped**, native **79 total / 78 passed / 1 skipped / zero failures**, typecheck success, production Release build/re-signing success, Playwright **22 passed**, and final real-browser session/render checks PASS. `final-pdf-runtime.log` records bounded native runtime **exit 0, 0.713 s wall time**; the controller reports the test itself passed in **0.609 s**, producing `/private/tmp/ret-final-pagination-proof.pdf`. These final results supersede historical full-suite checkpoints for the unchanged code. They do not exercise the four uncovered triggers above. No broad tests were duplicated by this reviewer.

- Existing web log `/private/tmp/ret-task6-fixround1/green-full.log`: **187 passed, 1 skipped**, nine files. Task 4's final report records **22 browser tests** and typecheck PASS. These are attributed prior runs; no suite was rerun here, and skipped tests are not passes.
- Existing native `build/task2/fix-all-swift.log`: **79 total, 78 passed, 1 skipped, zero failures**; `fix-focused-final.log`: **18 passed**, including the real externally bounded public-activity regressions. The 18-entry Task 5 final source/test manifest still matches every current file. Current production hashes also match the Task 2/4/6 fix-review manifests checked here.
- Task 6's retained proof/report records real **5-page and 27-page** WKWebView PDFs, A4 boxes, searchable Chinese/code and complete final content for those fixtures. Prior visual inspection covered selected pages; this review did not rerun printing or claim every page visually checked.
- Fresh private Swift scanner and production-code JSDOM probes reproduce FR-1–4. The JSDOM process was bounded to 20 seconds; it makes no display, genuine user-event, native browser-launch or IME claim. Artifacts: `Scanner.swift`, `scanner.log`, `live-probe.mjs`, `live-probe.json`, `live-probe.log` in the private review directory. A successful probe exit means the defect assertions reproduced, not that the product is fixed.
- Fresh `write:false` esbuild comparison: app/export/renderer JS and legal notices match `build/web`, generated SwiftPM Web resources and packaged Web resources. Full packaged Web inventory: **83 files, zero mismatches**. `codesign --verify --deep --strict 'build/ReT Markdown.app'` exits **0**. Executable SHA-256: `09e0437b5e240876c2126f3f321d2495ec2351e26de0ae96531819c57df700ca`; logical app size **11,857,188 bytes** at inspection. Signing changes the executable relative to the pre-sign build product; byte inequality alone is not a stale-native-binary finding. The subsequently supplied controller final build log confirms a successful production build and re-signing; this reviewer did not rerun it.
- Review captured 53 production/configuration/script hashes in `/private/tmp/ret-final-review-20261015/source-hashes.json`; a final comparison found no changes to those inputs during the review. This is a current-file manifest, not a commit or an atomic repository snapshot. Bundle evidence is in `bundle-check.json` and `inventory-check.json` alongside it.

**Acceptance evidence limits retained explicitly.**

| Gate | Implemented / observed | Still unverified |
| --- | --- | --- |
| Native Chinese IME / T04 | Composition barriers, retained marked DOM and synthetic lifecycle regressions exist. | Real candidate selection, replacement/deletion/cancellation around headings/math/cells and Cmd-S during preedit. User input-method/shortcut question remains pending. |
| Save / system lifecycle / T07–T12 | Public-save activity regressions pass in recorded native tests. Controller observed rendered headings/table/math and a responsive first Cmd-S SavePanel after the fix. | The current GUI run did not finish disk save: Go To directory was followed by inactive binding / `cgWindowNotFound`; process remained alive without a crash report. Full Save As/undo/reopen, close-preference combinations, quit/restoration and Versions GUI remain acceptance work. This tooling interruption is not evidence that the original deadlock returned. |
| PDF / T14–T17 | Real fixture pagination/text/geometry and atomic-output tests exist. | Packaged menu flow, actual live/source equivalence, cancellation/error reveal, and remaining dedicated native pagination cases are not all certified by those proofs. |
| Typora / T25 | Fixed CSS/asset baseline and browser geometry assertions exist. | Full same-logical-viewport, 100% zoom comparison against Typora across required widths, including native font rendering. |
| Performance / T19 | Stable browser **18 series × 20 samples** is documented: regular live input P95 32.5 ms and boundary live open 1321.1 ms. Current artifact size was independently inventoried. | Native Release 20-run startup/open/display-input/IME/PDF latency and app-plus-owned-WebContent RSS. Browser measurements and individual Debug print timings do not pass native targets; boundary input is diagnostic, not a native 50 ms failure. |

All four initial P2 findings and the subsequent native shortcut-routing finding are closed by the linked scoped reviews. Overall Spec/Quality CODE PASS applies to those captured sources. The explicitly unverified manual/native-performance gates remain open; passing suites or a successful build do not by themselves certify them.
