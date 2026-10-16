**2026-10-16 — final frozen projection correction re-review, AC3 / AC4 / AC9**

**Current Spec: PASS within AP-1/AP-2 and the affected projection correction. Current Quality: PASS within the reviewed syntax/decorations algorithm and cache changes at the final hashes below.** Both original P2 findings are resolved. No concrete residual P1/P2 or affected-path regression was established. The measured repeated-scan cause has an appropriate code correction; **final 20-sample performance acceptance remains PENDING with the controller**, after the separate AC2 freeze. This is bounded code approval, not whole-V1, native IME, packaged visual or native performance acceptance.

This supersedes the initial CHANGES REQUIRED verdict and mutable-hash hold below for this final frozen candidate only. Historical reproductions, initial measurements and intermediate drift remain below for traceability. Executor remains Codex; no Astra execution is claimed.

Read both updated owner reports, the complete final `syntax.ts` and `decorations.ts`, new/expanded functional and operation-count assertions, final manifest and retained RED/GREEN/profile logs. Fresh work consisted of source inspection, manifest verification and the two focused unit suites below. Only this projection review document was updated; the frozen table review and product files were not edited. No broad test or performance-series rerun, shared build, app publication, subagent or UI/process control was performed. The existing user application and its Untitled document were untouched.

| Correction | Current implementation and evidence |
| --- | --- |
| **AP-1 resolved** | `syntax.ts:103` stops soft text breaks before the underline source line's LF. `decorations.ts:87` replaces from that same LF (`lineAt(mark.from).from-1`) through the original HeaderMark end, covering the omitted quote/container prefixes without rewriting source offsets. The remaining heading text still belongs to one wrapper. New single/multiline/nested quoted browser cases compare actual CM text and height to the production renderer, click a real title coordinate back to the original UTF-16 position, edit/undo locally and roundtrip source mode with exact bytes. |
| **AP-2 resolved** | `syntax.ts:76,88` gives `HardBreak` its own span and a marker range ending before LF. `decorations.ts:96–98` hides only that inactive marker; the hard line boundary remains. Unit cases cover both backslash and two-space syntax plus opaque inline code. The browser case compares text/two-line geometry, reveals the raw backslash, edits and restores exact bytes with one root undo. |
| **Indexed containment** | `syntax.ts:30–39` copies/sorts starts and stores prefix maximum ends. The binary search finds the last start no later than the query start; its prefix maximum proves whether at least one individual owner contains the entire query. It does not union disjoint intervals. This preserves the old existential-containment semantics for nested owners, zero-length boundaries and crossing ranges. The helper replaces table/math and quote/opaque membership scans without dropping spans. |
| **Blank-line sweep** | `syntax.ts:117–130` advances a monotonic cursor through sorted, nonoverlapping top-level parse nodes. It skips nodes ending at/before the line start and tests the next node's start; this retains the previous half-open root membership rule. Quote-only blanks and opaque code/table exclusions retain their predicates through the index. The specific root-membership pass is O(lines + root blocks); the indexed passes include sorting and logarithmic queries. This is not a universal linear-time claim for every parser operation or document shape. |
| **Projection membership** | `decorations.ts:55–57,66,122` builds active-quote containment once, uses a Set for hidden-gap identity and an index for marker containment. Filtering active quotes before indexing is equivalent to the original contained-and-active test. Marks, paragraphs, wrappers, tables and math still traverse the same presentation branches; there is no cutoff, truncation, large-file fallback or lowered rendering requirement. |
| **Cache invalidation** | `decorations.ts:145–157` maps decorations and wrappers first during composition. Otherwise only transactions with no document change, explicit selection, reconfiguration or private refresh reuse the projection. Document edits still reparse; immutable-document identity still invalidates contextual link/image rendering. Selection-driven marker/gap reveal still rebuilds. Mode changes use reconfiguration, and composition-end dispatches the private refresh, so neither can be swallowed by the unrelated-effect fast path. Query-only effects still reach the independent table ViewPlugin, which refreshes on root updates even when this field reuses its value. |

**Source, marked DOM and table boundaries.** The code still keeps LF-preserving `Decoration.line` gap tiles (`decorations.ts:63–66`), the heading/code line classes, paragraph wrappers, centered math and intrinsic tables. It retains the one root source/history and existing table factory contract. New AP-1/AP-2 active-marker composition tests assert real marked-node identity, zero committed revision during provisional input, one commit after compositionend and byte-exact root undo. Existing heading/code-frame and focused-table boundary assertions remain in the final combined run. No new source-mutating presentation path or independent history was introduced.

The table-owned `cell-widget.ts` and `table-interactions.ts` hashes still exactly match the prior scoped PASS. The new live factory continues to install their extension. The retained 22 editor and 10 final-live cases cover L1–L4 and FR1/2/4; FR3 remains closed by its separate native-assets review. Root/session/nativeMenu, AC2, application release output and isolated-copy handling remain controller-owned and are not re-adjudicated here.

**Fresh verification versus retained execution.** Fresh command at 00:47:50 local: `npx vitest run web/test/acceptance-projection.test.ts web/test/projection-performance.test.ts` — **11 passed across two files, exit 0**. This includes the two exact range corrections, containment boundaries, counted-work scaling, unrelated-effect reuse and both full-fixture span fingerprints. No elapsed-time threshold or mock parser substitutes for these production-module checks. Instrumentation is confined to the tests' private `write:false` bundle.

Read the actual historical RED logs: functional units **2 failed / 3 passed**, browser **4 failed / 2 composition controls passed**, algorithm tests **3 failed**. The algorithm failures counted 4,432,596 syntax reads and 12,393,396 projection reads at 200 blocks, plus 3,105,296 projection reads for an unrelated effect. The final tests retain the 100-to-200 scaling bound (<2.6×), absolute read bounds and zero-read unrelated-effect check; they passed in the fresh focused run. The two fixture tests compare complete JSON span fingerprints, not counts alone.

Read `/private/tmp/ret-projection-review-browser-green.log` (**6 passed**) and `/private/tmp/ret-projection-complete-browser.log` (**68 passed, 25.0 s**): 16 projection + 11 session + 9 table + 22 editor + 10 final-live. Read `/private/tmp/ret-projection-complete-unit.log` (**272 passed / 1 skipped**, 00:42:45 snapshot) and the final typecheck log (`tsc --noEmit`, no diagnostics). These full-suite/browser/typecheck results are owner execution records, not reviewer reruns or claims about concurrent AC2 work. The updated default-live harness remains compatible and retains hash `49c7c947d454f9f3d945cefdec4c0491721ccffc35d6e592542a72dd077142d7`.

**Performance evidence and remaining gate.** Inspected the actual retained pre-fix phase records: 1 MiB blank-line scan **1043.68 ms**, projection **5089.61 ms**, with Chromium's unchanged 15000 ms open boundary exceeded. These measurements support the diagnosed repeated scans; they are not evidence that layout/virtualization or every remaining input cost is solved. The owner reports post-index Node gap/projection diagnostics of **9.1 / 31.6 ms**. The final current-candidate browser record `/private/tmp/ret-projection-current-open.jsonl` shows **542.8 ms** live open, `exactText:true`, all **711854 normalized UTF-16 units**, unchanged fixture/budget, and three projection passes of **36.5 / 34.9 / 34.8 ms**. The fixture has 1048762 bytes; its size and full source were not reduced to obtain that result.

That single browser observation and earlier exploratory input diagnostics do **not** establish P95, the unmodified 20-sample acceptance result, physical-display timing or native performance. Both interrupted series remain incomplete; shutdown errors and missing samples are not successes or zero-duration samples. The previous functional/code hold is now closed for this manifested correction; the controller's final performance acceptance gate stays open. No further owner or reviewer full benchmark was started.

**Final frozen SHA-256 capture.** All seven entries in `/private/tmp/ret-projection-final.sha256` matched current files on review; unchanged table dependencies were also verified. These are file hashes, not commits. Approval is limited to this candidate and must not be transferred to subsequent drift.

```text
73722f27dd1d3dc3f7e46c87b3baa6d85323c4b319f91895e5f00acb070af047  web/src/live/syntax.ts
257385fba6242f98c30fbefd437aea80d0259273feb94dda8b3355e5f4b02c1c  web/src/live/decorations.ts
ffcdeeba4268bf11353d8adcbd45a431e5c7cd4be63f322d8068b2b7c621ab68  web/test/projection-performance.test.ts
e9e5beebad974c469ac5ec6cc2e2273a54fd5b5b9b3fa546e3cb44513d29dd1a  web/test/acceptance-projection.test.ts
5bcb1720cd3cf78ea07e2d135dba9fbdb05bfe35f9be84af97c1dc569ecb601f  web/test/acceptance-projection.spec.ts
7023bcf931ab07dc2d02133e32182447062179daf7869941a4ea7de04893015f  docs/testing/acceptance-projection-fix-report.md
11725838e13f180bd1d3e14a8ee21033a4575783cc25eb40189a64b5a0f8ece1  docs/testing/acceptance-projection-performance-fix.md
9a4224bed3da8a776c379034fa461635066a855f653bd59264800c0f4ee69ae1  web/src/live/cell-widget.ts
cf663bb4ae31eb2ba94e5c7e4765cc0792c4e6e3645b0c45dff13acf28298867  web/src/live/table-interactions.ts
```

**Historical initial review follows — its open verdict and intermediate hashes are superseded by the final frozen conclusion above.**

**2026-10-16 — initial independent acceptance projection review, AC3 / AC4 / AC9**

**Spec: CHANGES REQUIRED — AP-1 and AP-2, both P2. Quality: CHANGES REQUIRED for the same incomplete projections; performance/integration approval additionally withheld.** These findings apply to the frozen hashes below. They are residual failures of existing F04/F08 requirements, not requests for new Markdown features. No final approval is given to the resumed owner's mutable syntax/decorations work.

Executor: Codex. The requested Astra/high model could not be selected or authenticated by this session; this document must not be represented as an Astra execution. No subagents were used.

Read the acceptance handoff, F02/F04/F07/F08/F19, the fixed Typora GitHub visual baseline, both acceptance owner reports, all four affected live source files, all six new acceptance projection/table tests and harnesses, and retained L1–L4/FR1–FR4 reviews and relevant regression assertions. This is a non-Git, current-file review. Only the two requested review documents were written. No product edits, shared build, app publication, native UI control, broad test rerun or duplicate performance investigation was performed.

**AP-1 — P2: a quoted Setext heading leaves its underline line's `>` visible.**

Locations at the captured hash: `web/src/live/syntax.ts:79–90` and `web/src/live/decorations.ts:79–86`.

Reproduce in live mode, with the caret in the final `end` paragraph:

```markdown
> Title
> ===

end
```

Actual inactive heading text is **`Title >`**; the production renderer's heading text is **`Title`**. With `> Title\n> more\n> ===\n\nend`, actual is **`Title more >`**, expected **`Title more`**. This is ordinary supported quote/heading syntax under F04/F08 and directly intersects AC3's quote-prefix correction and AC4's Setext projection.

The fresh grammar probe returned quote marks only at `[0,2)` for the first sample, heading marker `[10,13)`, and a soft-break range `[7,8)`. Lezer does not supply the final underline prefix as a collected `QuoteMark`. The Setext projection replaces `[mark.from-1, mark.to)`, namely `[9,13)`, leaving the `>` at offset 8. Joining the preceding newline makes that marker appear at the end of the heading. The same omission survives the multi-line variant.

The bounded headless Chromium probe used the real production transport harness and actual CM DOM, with `esbuild write:false` and the four live files captured in memory before bundling. Both the failing quoted heading and the unquoted control measured **54.984375 px** tall, matching the renderer. Thus the confirmed failure is leftover syntax, not a second border or a fabricated geometry failure. Revision remained zero and encoded bytes were unchanged; browser errors were empty.

Required correction: include the underline line's container prefix in its source-preserving hidden projection. Retain one heading frame, raw-range reveal and original bytes. Add this quoted case to the existing Setext/quote assertions; the current separate plain-Setext and quote-paragraph tests do not exercise their intersection.

**AP-2 — P2: the backslash hard-break marker remains visible in an inactive paragraph.**

Locations: `web/src/live/syntax.ts:38–40,61–64` and the paragraph projection at `web/src/live/decorations.ts:74–77`.

Reproduce with source `hard\\\nbreak\n\nend` (a single backslash immediately before the first LF), caret in `end`:

```markdown
hard\
break

end
```

Actual CM text is **`hard\\\nbreak`**; the production renderer displays **`hard\nbreak`** without the backslash. The newline correctly remains a hard break. The real CM paragraph and renderer paragraph both measured **51.1875 px**, so this is a semantic source-marker leak rather than incorrect line height.

`softBreaks` explicitly recognizes `HardBreak` to avoid joining its LF, but the syntax-kind map does not project a `HardBreak` marker. It is not an `Escape` node and therefore never reaches the new literal handling. Source bytes and revision were unchanged in the fresh browser probe. This is an existing supported Markdown hard-break/escape case left incomplete by AC3/AC9; it is not claimed to have been newly introduced by this patch.

Required correction: hide the hard-break syntax marker when inactive while preserving its real LF and original source range for editing. The current unit and mixed-browser hard-break cases use two trailing spaces and therefore cannot catch the visible backslash variant.

**Other assessed boundaries at the frozen snapshot.**

| Boundary | Evidence and conclusion |
| --- | --- |
| HR / ordinary quotes / numbered lists / inline escapes and entities | Read actual range and browser assertions. Real HR widgets, complete ordinary quote prefixes, sibling ordinal calculation and renderer-decoded literals are implemented. Code remains opaque; literal click/Enter reveal uses raw UTF-16 boundaries. Fresh ordinary quote control displayed `first second` and matched renderer height. AP-1/AP-2 prevent a blanket semantic PASS. |
| Plain Setext single border | One wrapper owns text/underline; inactive underline is joined into the text line. Scoped caret-buffer height rule explains the corrected 1 px discrepancy. Fresh plain control independently matched renderer height. Existing tests check both underline forms, source reveal and mode changes. |
| Paragraph soft breaks and gaps | Soft-break replacement preserves hard LF boundaries. Inter-block gaps now use `Decoration.line` with `display:none`, preserving the LF/next line start. The retained heading/code test asserts all six heading styles and four code-frame lines; the retained table boundary test asserts focused mini-view survival after exit/re-entry. No regression was established in these corrected paths. |
| Actual CM math/table geometry | Owner tests measure real CM paragraph height/gap, scroller ratio 1.6, formula center and intrinsic table width against an independent renderer surface at 1000/1400/1800 px. Code contains centered block math, intrinsic tables and the production table-interaction factory. These are inspected existing execution results, not a fresh complete visual or font-loading approval. |
| F02 / history / composition | Presentation does not dispatch content patches; provisional updates map both decoration and wrapper sets. Tests assert BOM/mixed EOL preservation, local literal editing, marked-node identity, one composition commit and root undo. Fresh projection failures also left bytes and revision untouched. Table-specific probes and retained contracts are detailed in the companion review. |
| FR1/2/4 and L1–L4 retention | Contextual links/images, language highlighting, pipe mapping, table alignment/inline rendering and root clipboard/history paths remain present. Their renderer/helpers and original regression suites retain the previously approved hashes. FR3 remains closed by its separate native-assets review; it was not rerun or reopened here. |

**Performance blocker reported during this review — not independently rerun.** The controller reports the first four regular-live-input rounds at approximately **232 ms versus the prior 48 ms**, and **four 15-second timeouts** for boundary 1 MB live input versus the prior **844 ms**, while source input remained approximately **32 ms**. The benchmark was stopped gracefully and its save result is incomplete. These are controller observations, not a completed performance suite or a causal profiling result from this reviewer. The controller resumed the projection owner for syntax/decorations profiling only. No duplicate engineer or performance run was started.

Consequently, performance and final integrated Quality approval remain **PENDING/BLOCKED** even if AP-1/AP-2 are corrected. A new owner handoff must identify the changed performance hunks and final hashes, with relevant functional evidence and completed controller performance verification. This report approves neither future mutable source nor whole-V1 visual/native IME/performance acceptance.

**Execution evidence provenance.** Read `/private/tmp/ret-acceptance-projection-frozen.log`: **62 passed (23.7 s)**, comprising 10 projection, 9 table, 11 session and the prior 32 browser cases. Read the table frozen log (**41 passed**) and unit frozen log (**239 passed, 1 skipped**); read the typecheck log showing `tsc --noEmit` without diagnostics. These are retained owner/controller runs, not reviewer reruns, and do not cover AP-1/AP-2. Fresh review execution consisted only of a grammar probe, the five-sample bounded headless projection probe (two failing quoted variants, one failing hard-break case, two passing controls), and the focused table probe described separately. Probe output is captured in this review session; no new test or build artifacts were written into the workspace.

The root's later test-only harness change adds optional `bootNative(..., mode='live')` and passes that mode to load. Default live behavior is unchanged. The projection reproduction used the previous harness hash `211deee7a95fff13521a113433b1318f5d64fe5417ec649b46a4bd62fe9622af`; the inspected updated harness hash is below. Its source-load AC1 coverage remains root-owned. Root/session/nativeMenu and AC2 are not re-reviewed or modified here.

**Delivery-time drift check.** After the probes, the resumed owner changed `syntax.ts` to observed SHA-256 `6dd5c2bc45cf0959a61ba9ed70ef64f5040c4be5b3f29635f8f72dc9c48c2861` and `decorations.ts` to `65c9680173aec0d95d07cb79b688ca515eec3959f674b77a6eecf1b9e80c8a68`. These are observations of mutable work, **not reviewed or approved hashes**. All other files in the manifest below still matched. AP-1/AP-2 were reproduced on the old frozen files; neither their persistence nor their resolution on the new work is asserted. Await the owner's final handoff before reviewing that delta.

**Captured SHA-256 manifest — file identities, not commits.** The four live product files matched these hashes during the probes and their immediate post-probe check. The verdict remains bound to this capture despite the delivery-time drift above.

```text
2631f8258937fcf34a6fd69ed7fa312654461af432f441e392cd754970a181ce  web/src/live/syntax.ts
8affd228a9906b2f1b87d3af6bfe17548c3c8213abbc230f7ea226556bc1e769  web/src/live/decorations.ts
9a4224bed3da8a776c379034fa461635066a855f653bd59264800c0f4ee69ae1  web/src/live/cell-widget.ts
cf663bb4ae31eb2ba94e5c7e4765cc0792c4e6e3645b0c45dff13acf28298867  web/src/live/table-interactions.ts
3a9e8f38164af6949d1848c34d62d5259975f7d26222044748cee9bc8452c0d1  web/test/acceptance-projection-harness.ts
cb892c9936bc2881f95374e26e41f52d5c716fd6280212c91bf91df835b9f6c9  web/test/acceptance-projection.spec.ts
1776f484f5c9006f81b1aeaee0613caaf3ab3e8c3884565655eab0caaa28c6fd  web/test/acceptance-projection.test.ts
bdd0c1c66bedc5ea1f49fd32782f37735febeebc8cbbbcc383ecf8c027578812  docs/testing/acceptance-projection-fix-report.md
49c7c947d454f9f3d945cefdec4c0491721ccffc35d6e592542a72dd077142d7  web/test/final-live-browser-harness.ts
34564c5ff54f89d12e82c38e26ab986fc1814c3c315c6999936b443db8805074  web/src/render/markdown.ts
991b7989982d3f0250c0f683a2e4ac35adcb9ae8085f1599627f265e0dc97eb6  web/src/live/links.ts
43833c9adaf908b7086ffa0009fd57069afb99fbfc4e03d9da764f2df7591d26  web/src/live/code-highlighting.ts
f9b0fb7be8ba8aa182469860c456e696088fbd018a907782639e2847ef019f5f  web/test/editor.spec.ts
180d9e3c13ad60a74e49d45b04d40f0919fe0a573c9b348ea42ae368e4b757ce  web/test/final-live.spec.ts
```
