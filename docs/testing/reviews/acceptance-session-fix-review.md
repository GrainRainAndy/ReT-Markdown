**2026-10-16 acceptance session fixes — scoped independent review**

**Current Spec verdict: PASS within AC1/6/8 and the assigned AC9 scroller portion. Current Quality verdict: PASS within that frozen scope.** AS-1 is resolved by the root replacement-transaction isolation described below. No actionable residual or demonstrated regression was established in the correction and affected paths. This supersedes this report's initial CHANGES REQUIRED verdict only; it does not grant overall CODE PASS or native acceptance.

**AS-1 fix re-review — current conclusion.** Read the new AS-1 section of the owner report, current two-line `EditorSession` correction, all three added browser regression cases and the actual RED/GREEN logs. No product edits, subagents, shared builds, UI control or test-suite reruns were performed. Other AC2/projection/table work remains outside this re-review.

`session.ts:64–65` adds a root `transactionExtender` only when `tr.docChanged && tr.isUserEvent('input.replace')`, supplying `isolateHistory.of('full')`. CM's public `replaceNext` and `replaceAll` emit `input.replace` / `input.replace.all`; the prefix-aware event check covers both. Since the extender observes the actual root transaction, it applies equally to the bridge/native-equivalent command and the CM panel button. Non-content find/selection changes are excluded. It changes neither replacement semantics nor the single SearchQuery, source patches, EOL effects, revision publication, composition deferral or the sole history. Installed CM history consumes full isolation before and after recording that replacement, preventing either neighboring typing event from joining it.

**Genuine failure and regression evidence.** `build/verification/acceptance-replace-boundary-red.log` records **two failures** at the exact post-typing Undo assertion: expected `新 新\n尾`, received `alpha alpha\n尾`. The tests commit the actual replacement field, invoke either bridge Replace All or the real panel button, press Escape, then immediately type over the still-selected first result without moving the root selection. The report documents the earlier nonadjacent/end-of-file probe and panel default-query/reset harness correction; those earlier attempts are not counted as behavioral RED evidence.

`acceptance-session-green.log` now records **11 passed (4.1 s)**, including both corrected sequences and a prior-typing control. After typing over the first replacement, Undo retains the replacement; the next Undo restores the pre-replacement source. The control explicitly requires three separate undos: following input, replacement, preceding input, ending in exact original BOM/mixed-EOL bytes. All previous eight assigned regressions remain in that recorded run. These results were read, not rerun by this reviewer. Native menu/keyboard and genuine IME acceptance are not inferred from browser evidence.

**Change-boundary check.** Removing only this two-line extender reproduces the exact prior reviewed session SHA-256 `c807b5d0ad39ace45d410f1bd4b53259822b313ed07f03ba73785eb93035d4f9`. Main transport, native menu, source history/search helpers and palette still match their preceding review capture. The headless regex/capture/line-anchor differences documented below remain testing-interface limitations; no headless success is used to certify the mounted correction.

**Current frozen SHA-256 capture.** Full ten-input manifest: `/private/tmp/ret-acceptance-session-review-20261016/as1/source-hashes.json`. Inputs were rechecked before delivery.

```text
8ec07ee6dcfc1eb559a848ca6d95f1ebe8d37d8cb3d1397c2e7c7bfd2c3cd82d  web/src/main.ts
6ce10de85659f9ce5976ca21ef4bedba86b5530f36932f31cdbddaf93eaea877  web/src/editor/session.ts
f5db63004d310cd7f3d753b779371f80e3bcb5f8ae1d480f5721f5a5d788f9fb  Sources/ReTMarkdown/App/MenuController.swift
25953c17f944ca384931d16d4bc6e3cec619c81ecc8a79a05584bf30e4633dc8  web/test/acceptance-session.spec.ts
61f3cb6d5b6b159cafef7eb9f4d9a832032f4161f2b7af4715f738a1d1c1bd2d  docs/testing/acceptance-session-fix-report.md
3825c55ed6029efc3934c6e6fa550aac2e016bcebfc8c0389a008ead7cc08de2  build/verification/acceptance-replace-boundary-red.log
d00cf009f3d2c867bc701f305825fb8a7b449c2dc2ce803caddc2f0db302a95b  build/verification/acceptance-session-green.log
```

**Historical initial review follows.** AS-1's original trigger and initial-run evidence are retained for traceability; their open status and old frozen hashes are superseded by the current conclusion above.

Scope: frozen `main.ts`, `editor/session.ts`, native `MenuController.swift`, `acceptance-session.spec.ts` and `acceptance-session-fix-report.md`, against `build/verification/acceptance-handoff.txt`, the acceptance fix plan, F06/F07/F19 and the source/sole-history contract. No review of the concurrently owned live syntax/decorations, table modules or separately reviewed AC2 was undertaken. No product edits, subagents, shared builds, suite reruns or application/UI control were performed. Only this repository report was authored; fresh narrow probes and hashes are in `/private/tmp/ret-acceptance-session-review-20261016/`.

**AS-1 — original P2, now resolved: mounted Replace All merged the next typing event into the replacement undo.**

Location: `web/src/editor/session.ts:314–317`, together with unchanged root history at `editor/history.ts:43–60`. Requirement: F07's independently undoable Replace All operation and the established root transaction/history boundary.

The new mounted branch invokes CodeMirror's `replaceAll(view)` directly. Its transaction has `userEvent: "input.replace.all"`, but no `isolateHistory` annotation. It begins a new history event, yet leaves that event eligible to absorb an adjacent subsequent `input.type` within CM's default grouping interval. The existing headless branch uses `this.edit(...)` and `patchTransaction` with `isolateHistory.of('full')`, so it retains the previous isolation and does not reveal this mounted regression.

Concrete reproduction, without a root selection change after replacing:

1. Start with BOM/mixed-EOL `alpha\r\nalpha\rend`. Find `alpha`, open the shared panel, set its actual replacement field to `X`, then invoke the menu-equivalent `replaceAll` command. Source is `X\nX\nend`; the first match remains selected.
2. Close the search panel (Escape follows this public CM close path) and immediately type `Y` over the selected first `X`, within the normal 500 ms history grouping interval. Source is `Y\nX\nend`.
3. Undo once. **Actual mounted result: `alpha\nalpha\nend`** — both Replace All and the later input are reversed. **Required separate-operation result: `X\nX\nend`**; a second Undo should reverse Replace All and restore the original bytes.

Fresh bounded probe used the actual production `EditorSession`, CM search panel/commands, root dispatcher and history in JSDOM, without live projection extensions. It changed the real replacement field and dispatched its normal commit event, called the public search close command, and submitted the ordinary `input.type` transaction. The mounted path has **undo depth 1** after two content commits; the same headless control has **depth 2** and its first Undo retains `X\nX\nend`. Both emit `edit`, `edit`, `undo`; the mounted undo reverses both edits. Installed CM history inspection confirms `input.type` can join the preceding adjacent change, while the headless patch path explicitly isolates it. This is not a native keyboard/IME execution claim. The existing eight browser regressions only undo immediately after Replace All and therefore miss this sequence.

Fix: retain the public CM search commands and single SearchQuery, but isolate the actual mounted Replace All transaction from following input, using the existing root history mechanism. Add a mounted regression for panel Replace All → Escape → immediate typing → two separate undos, asserting first that replacement remains after the typing undo and then byte-exact BOM/EOL restoration after the replacement undo. Include a prior typing event as a control; do not fix by adding another history stack or bypassing source metadata.

**Assessment of the remaining assigned boundaries.**

| Boundary | Reviewed implementation and evidence |
| --- | --- |
| AC1: transport load focus | `main.ts:95` focuses the existing root view after selection, mode, appearance and zoom, before publishing the final state/loaded reply. It does not replace state/history. Recorded real-browser tests use production transport and type without a click in live mode and after switching to source, with content commits and `view.hasFocus`. Source-mode load uses the same post-configuration focus point, though the recorded source case switches mode after a live load. Packaged native Cmd-N focus remains to be checked. |
| AC6: query and native entry ownership | Native search sheet/cache and session `searchOptions` are gone. Native menu actions now execute the same bridge commands directly. Mounted find/replace read and update CM's sole `SearchQuery`, preserve panel flags, and invoke public CM next/previous/replace commands. Cmd-F, Cmd-G/Shift-G and Cmd-Option-F route through `command`; panel-native shortcuts operate on the same query. Tests inspect panel identity, query/replacement edits, selection and absence of find content commits. AS-1 is the remaining mounted history gap. |
| AC6: composition and source preservation | `command` waits for existing `afterComposition` completion before opening/focusing the panel or invoking search/replacement. A fresh private composed-state probe confirms queued find does not resolve early, runs after composition ends, and changes neither source bytes nor commit count. Existing EOL transaction extender/inverse effects still apply to public CM replacements. Recorded immediate Replace All undo restores BOM/mixed-EOL bytes; AS-1 identifies missing isolation from subsequent input. Genuine input-method and native shortcut dispatch are not certified. |
| AC8: system canvas variables | Root foreground, background and caret now use `--body-fg`/`--body-bg`, agreeing with the existing palette rather than hardcoded competing colors. Recorded empty/long-document browser checks compare body/container/editor computed background at `rgb(30,30,30)`, then system light at white with unchanged bytes. This approves the assigned system-color correction; it is not a full native screenshot/Typora comparison. |
| AC9: root scroller only | Explicit `.cm-scroller { line-height:1.6 }` overrides CM's 1.4 default; the recorded assertion measures the actual CM scroller ratio. No claim is made about paragraph, short-table or formula geometry owned by the other agent. |

**Headless testing-interface fidelity.** The fallback shares SearchQuery storage, but continues to evaluate it using the existing pure `findRanges`/`replacePatches`. It is not semantically equivalent to mounted CM for all flags: a fresh probe replacing `(alpha)` with `<$1>` yields literal `<$1>` headlessly and `<alpha>` mounted; a second `^alpha` search over two lines wraps to the first line headlessly while CM advances to the second. These are confirmed testing-interface limitations, not additional native product defects: mounted product UI uses CM, and the requested fallback is retained. Headless successes must not be used to certify regex capture substitution/line anchors or the mounted history boundary. AS-1 is independently reproduced on the actual mounted path, not inferred from fallback disagreement.

**Evidence read and limits.** `build/verification/acceptance-session-red.log` records the initial **7/7 failed** cases; `acceptance-session-green.log` records **8/8 passed (3.1 s)** after the added keyboard/panel-equivalence case. These suites were read, not rerun. `acceptance-native-unsandboxed.log` records **84 total / 1 skipped / zero failures** at 00:12:02, explicitly the pre-menu-change native baseline; it does not certify the modified native menu or current app. Fresh review probe (`probe.mjs`, `probe.json`, `probe.log`) ran in a private Node/JSDOM process under a 20-second external deadline. Its successful exit asserts reproduction of AS-1 and the stated controls, not a product PASS. Initial scratch execution needed a JSDOM `structuredClone` environment shim; that harness-only failure is not a product finding. No native WebView, display or real input-method proof follows from JSDOM.

**Historical initial SHA-256 manifest.** These initial review inputs were checked unchanged at the initial report delivery; current changed-file hashes appear above. The complete 11-input manifest, including logs and unchanged history/search/palette dependencies, is in the private review directory. Principal frozen files:

```text
8ec07ee6dcfc1eb559a848ca6d95f1ebe8d37d8cb3d1397c2e7c7bfd2c3cd82d  web/src/main.ts
c807b5d0ad39ace45d410f1bd4b53259822b313ed07f03ba73785eb93035d4f9  web/src/editor/session.ts
f5db63004d310cd7f3d753b779371f80e3bcb5f8ae1d480f5721f5a5d788f9fb  Sources/ReTMarkdown/App/MenuController.swift
3782e1be33994c81e77fb8a3853cad411fcafdfb06ca478a6c3b1aba331c5cda  web/test/acceptance-session.spec.ts
d162cb6ee8e1e99415c087a4cdb024abd66ce2c8e50c703b005fe2da00b7a1ad  docs/testing/acceptance-session-fix-report.md
2da9fbead3df16a2100eee2d4bcb08b438308383be1a65e1ab60a7ec79d95138  /private/tmp/ret-acceptance-session-review-20261016/probe.mjs
```

The new acceptance defects supersede earlier PASS claims for these paths. Native integration, the other acceptance fixes, genuine IME, system lifecycle, full visual comparison and native Release performance remain outside this bounded verdict.
