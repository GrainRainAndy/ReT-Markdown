**2026-10-16 — independent acceptance table review, AC5 / AC7**

**Spec: PASS within the captured AC5/AC7 functional correction. Quality: PASS within the owned table changes and reviewed functional integration at the captured hashes.** No concrete new P1/P2 was established in this table correction. **Final integrated approval remains withheld:** the projection owner has resumed mutable syntax/decorations performance work, the controller has reported a severe live-input regression, and the companion projection review records two residual P2 rendering defects. This table verdict must not be carried forward automatically to a changed live factory or treated as whole-V1/native/performance acceptance.

Executor: Codex. The requested Astra/high model was unavailable for selection in this session; this is not an Astra execution. No subagents were used.

Read the acceptance handoff, F02/F04/F07/F08/F19, visual baseline, both acceptance fix reports, complete current `cell-widget.ts`, `table-interactions.ts`, `syntax.ts`, `decorations.ts`, all six new acceptance tests/harnesses, affected source/table/renderer/session adapters and retained L1–L4/FR1–FR4 review contracts and regression assertions. Root/session/main/nativeMenu and concurrent AC2 remain separate reviews. Only the two requested review files were written; no product or configuration edits, Git operations, shared build, publication, native UI control or broad test reruns.

| Boundary | Reviewed evidence and conclusion |
| --- | --- |
| Root Find into the existing widget | `cell-widget.ts:86–112` reads the root SearchQuery and raw selection, opens a selected cell with `takeFocus=false`, maps into its existing mini-view and sets explicit colored hits under `syncing`. `table-interactions.ts:16–24` widens partial pipe escapes/surrogate boundaries only in the visible projection. No root source or selection normalization is dispatched by this projection. Fresh existing-mini probe below retained exact DOM identity. |
| Search-panel focus and visible results | Existing real-CM tests exercise panel next/previous/query changes, computed hit color, raw escaped-pipe/astral ranges and a deep-table hit inside the viewport. `focus(...,false)` avoids taking panel/root focus. Query changes clear stale decorations. The scoped correction covers cell-contained selections; no new separator-source or multi-cell editor feature is inferred from it. |
| Root history and source bytes | Mini-views have no history extension. Projected selections/effects use `addToHistory(false)` and `syncing`, while input/structure still uses the existing sole-root patch path. Existing tests cover replacement/Replace All, exact BOM/mixed-EOL undo and retained redo. Root AS1 replacement isolation is separately owned/reviewed; it is not claimed as a table change. |
| Composition and deferred refresh | Observer callbacks are deferred beyond the current root update and check destruction/composition; provisional root decorations are mapped. Mini-view composition uses the established root barrier and no competing history. The fresh queued-Find probe disproved a suspected composition-end refresh-order failure in three trials, retaining marked DOM until commit and restoring original bytes with one undo. This is synthetic browser evidence, not genuine IME proof. |
| Overlay geometry and dismissal | `cell-widget.ts:240–284` mounts a fixed menu beside the root scroller, clamps its viewport position, focuses an action, and handles wrapping arrows/Home/End, Escape and Tab. The latter prevents both default and propagation before restoring cell focus. Outside pointer/focus dismissal preserves the external focus target. Existing browser assertions compare root height before/after opening and cover keyboard action/deleting the table. |
| Destruction / cleanup | A single `closeMenu` removes document pointer/focus/key listeners, window resize/blur and scroller listeners, then removes the overlay. Rebuild and destruction call it; destruction unregisters the observer and destroys mini-views. Pending callbacks test lifecycle state. Existing source-mode destruction test presses Escape on an external focused button to catch stale capture handling. No unmatched listener or demonstrated stale update was found. |
| Gap/focused-table regression | The captured `decorations.ts:62–65` styles source-only gap lines rather than replacing their LF. This preserves the next CM line boundary and adjacent widget identity. Existing six-heading/code-frame and boundary-Tab regression assertions were retained, not weakened. Their recorded failed-then-passing integration sequence is explicit in both owner reports. |

**Fresh focused checks.** Used headless Chromium with real CM, production session/live factory, and `esbuild write:false`. The four live product files were first captured in memory and checked against the frozen hashes below; bundling consumed those captured contents. No existing suite was rerun.

Input: BOM/mixed-EOL `before\r\n\r| A | B |\n| - | - |\r\n| 😀a\\|右 | needle |\n\nafter`.

1. Open body cell `1:0`, retain its `.cm-content` node, then call root `command('find',{query:'|右'})`. The existing node remained identical, mini selection was `{anchor:3,head:5,text:'|右'}`, raw root selection remained `{anchor:34,head:36}`, bytes were identical, and commit count stayed zero. This checks projection into an already instantiated editor, including the raw/visible escape mismatch.
2. In a fresh instance, begin synthetic composition in cell `1:0`, insert provisional `中`, and queue the production root `command('find',{query:'needle'})` while the barrier is active. Before composition end, marked DOM remained identical and commits stayed zero. End composition and await the queued command. In **three consecutive trials**, root selection was `{anchor:40,head:46}`, query `needle`, target mini selection `{anchor:0,head:6,text:'needle'}`, a visible `needle` hit and host outline were present, and revision/commit count were both one. One root undo restored exact original encoded bytes each time. An extra selection-only refresh did not change the correct result. No browser errors occurred.

The suspected refresh-order failure was therefore **not** promoted to a finding. The probe does not establish native candidate-window behavior, native menu focus or all timing schedules.

**Retained contracts.** `tables.ts` still uses the approved immediate-backslash pipe-boundary rule, removes/reinserts exactly the pipe escape and returns local patches (L1). Alignment metadata still reaches every host and mini-view (L2). `renderTableCells` still renders inline tokens in complete-document context and refreshes reference-dependent output without adding a second parser/history (L3). Raw mapped copy/cut share the existing selection-to-source routine, with preedit/read-only/no-clipboard cut barriers (L4). The new inverse mapping complements those paths rather than replacing them.

The renderer, source metadata/history, table patcher, composition helper, link plugin, highlighting and existing 22 editor/10 final-live regression files retain their prior approved hashes. FR1 link handling and FR2 contextual images remain in their existing production paths; FR4 highlighting is retained. FR3's native scanner closure remains in `final-assets-fix-review.md` and is neither re-tested nor re-certified here. The only reviewed cross-owner live-factory integration is the captured `tableInteractions(options)` installation and gap/theme behavior.

**Existing execution evidence read, not rerun.** `/private/tmp/ret-acceptance-table-frozen.log` ends with **41 passed (18.1 s)**: 9 table + 22 editor + 10 final-live. `/private/tmp/ret-acceptance-projection-frozen.log` ends with **62 passed (23.7 s)** including the 10 projection and 11 root session tests. `/private/tmp/ret-acceptance-table-unit-frozen.log` records **239 passed, 1 skipped**; the typecheck log runs `tsc --noEmit` without diagnostics. The owner manifest `/private/tmp/ret-acceptance-table-owned.sha256` exactly matches all five owned source/test files and its report in this capture. Those counts are historical snapshots, not new claims about ongoing shared workspace changes.

**Pending integration/performance gate.** During review, the controller reported approximately 232 ms regular live input versus 48 ms previously, and four 15-second timeouts for 1 MB live input versus 844 ms previously, while source remained about 32 ms. The benchmark was stopped gracefully with incomplete save evidence. These are controller measurements, not this reviewer's profiling or a completed run. The projection owner is investigating; no duplicate profiling was performed. Final handoff must supply affected hunks, hashes and relevant functional/performance evidence before this table integration conclusion can be applied to the new projection. The two P2 rendering residuals are documented in [acceptance-projection-fix-review.md](acceptance-projection-fix-review.md).

The later test-only `bootNative` mode parameter retains the default live behavior; its updated hash is recorded in the companion review. It does not change this table harness, which imports `live-browser-harness.ts`. The new initial-source-load AC1 assertion is root-owned. Full Typora visual acceptance, packaged fonts, native IME, native focus/menu behavior, application publication and native performance remain controller gates.

**Delivery-time drift check.** The final read detected resumed projection work: observed `syntax.ts` hash `6dd5c2bc45cf0959a61ba9ed70ef64f5040c4be5b3f29635f8f72dc9c48c2861` and `decorations.ts` hash `65c9680173aec0d95d07cb79b688ca515eec3959f674b77a6eecf1b9e80c8a68`. Neither mutable version is reviewed or approved. All table-owned files and other listed dependencies still match the capture below. The functional table PASS applies to the captured integration, not these new projection versions; final delta/hash review awaits owner handoff.

**Captured SHA-256 manifest — file evidence, not Git commits.** Table-owned files and the four live product files were checked unchanged immediately after the focused probes. The subsequent projection changes identified above are not covered.

```text
9a4224bed3da8a776c379034fa461635066a855f653bd59264800c0f4ee69ae1  web/src/live/cell-widget.ts
cf663bb4ae31eb2ba94e5c7e4765cc0792c4e6e3645b0c45dff13acf28298867  web/src/live/table-interactions.ts
ec620f0320a1d820fe5ad5b559eb646e68c901b04004971bae874c0054b17eaf  web/test/acceptance-table.spec.ts
ad1374e9884535dcdbeed1480354e74436df1e036e94a93b49b655407ff3055b  web/test/acceptance-table-harness.ts
ed17bbbcf07f3a3c54ea925da880ede8fab4196d8ad6443b7a0eb9e0025d7e39  web/test/acceptance-table-mapping.test.ts
dd048a62a92bbacdacd265cf5cdf0ae6383ad89f86b66589b1c574a5810bc59c  docs/testing/acceptance-table-fix-report.md
2631f8258937fcf34a6fd69ed7fa312654461af432f441e392cd754970a181ce  web/src/live/syntax.ts
8affd228a9906b2f1b87d3af6bfe17548c3c8213abbc230f7ea226556bc1e769  web/src/live/decorations.ts
f437d3c516a0801f113b76a9513ec1619a4e3c09f6af1cbaa69859741b87f21a  web/src/live/tables.ts
700ba20ccecc5cf2b59bdbc0aeda158bd6b2fc19edd8e026f6bb8f8c8b4f8941  web/src/live/composition.ts
5ee98db700b7fcd23ea288ba3557ecb3b99de0a88d278f637ef12a217c5bfd25  web/src/editor/live-contract.ts
f3010ab2c6a425fb3098fb761d1a629ef33516d452192a45ad0d350a765e697a  web/src/editor/history.ts
5ed5510266da4e259610df90b24c8e4b76d4a32bb2627c1fe26219e23754bbec  web/src/editor/source.ts
34564c5ff54f89d12e82c38e26ab986fc1814c3c315c6999936b443db8805074  web/src/render/markdown.ts
c1dd964695182497d101a0fff972fee68a45572c3cbfa15fa6f36be114d278f2  web/src/render/math.ts
f9838bedac84f0e76c4942c259f23dfb6f2ef87b98e6195ee22c5d177302076a  web/src/render/positions.ts
1d3c4c1a102907f5e2f90f1b62d0f0ee488c6919bbf36479d18dcb3c7dbeb172  web/test/live-browser-harness.ts
f9b0fb7be8ba8aa182469860c456e696088fbd018a907782639e2847ef019f5f  web/test/editor.spec.ts
180d9e3c13ad60a74e49d45b04d40f0919fe0a573c9b348ea42ae368e4b757ce  web/test/final-live.spec.ts
```
