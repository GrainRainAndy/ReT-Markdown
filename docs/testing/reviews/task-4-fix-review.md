# Task 4 L1–L4 scoped fix re-review

Date: 2026-10-15. Reviewed current files directly against `task-4-review.md` and `../task-4-fix-report.md`. Scope is L1–L4 and regressions in their affected table/rendering/clipboard paths, including the expressly authorized pure renderer helpers. This is not a new broad product review. The current-file SHA-256 manifest below identifies the reviewed inputs; no Git snapshot is implied.

## Spec verdict: PASS within L1–L4 scope

| Finding | Status | Current implementation and regression evidence |
| --- | --- | --- |
| L1 — backslash-pipe editing removes the live table | **Resolved** | `tables.ts:12–15` now uses the pinned renderer's immediate-preceding-backslash boundary rule. Cell decoding removes exactly the slash immediately before a pipe, and `tablePatches` restores it when encoding editable cell text. `cell-widget.ts:170–179` validates the candidate source/table before ordinary or provisional submission and retains a non-null controller table. Unit tests cover loaded/encoded runs of one, two and three slashes, renderer cell-count agreement and local patch bounds. Browser tests at `editor.spec.ts:237–268` cover loaded, typed, pasted-code and Chinese provisional input for each run, unchanged focused mini-view DOM, intended root source and exact BOM/mixed-EOL undo. |
| L2 — alignment declarations are ignored | **Resolved** | `Table.alignments` derives left/center/right/default alignment from the separator. `cell-widget.ts:48` applies it when building every header/body host; `:69` updates it without requiring a shape change. The mini-editor inherits the host alignment. `editor.spec.ts:270–286` asserts computed host/content/line alignment, cell edits, insertion/deletion of a column, preserved separator declarations and structural undo. The unit test also covers the unspecified/default case. |
| L3 — cells are rendered as independent block documents | **Resolved** | `renderTableCells` at `render/markdown.ts:157–175` parses the full document with the private configured renderer, selects the actual table tokens and renders each inline token's already parsed children. `cell-widget.ts:38,59–66` consumes these cell results rather than calling block rendering on isolated text. Literal `# title`, `- item` and `---` remain literal; reference links/images retain document definitions, and math/image issues retain original coordinates. `live.test.ts:43–73` checks inline output, reference context and repeated escaped-pipe/astral/CRLF issue coordinates. `editor.spec.ts:288–308` compares actual live cell HTML against full-document renderer cells before/after editing, focus transitions, undo and composition, and verifies external reference-definition refresh. |
| L4 — cut loses the raw escape preserved by copy | **Resolved** | Both clipboard events call the same source-mapped routine (`cell-widget.ts:126–127,140–152`). For a nonempty selection, copy/cut obtain the same original raw slice; cut dispatches deletion through the mini-view's existing root projection, without adding local history. Cut is blocked before clipboard mutation during cell/root composition or root read-only state; missing clipboard data also prevents deletion. `editor.spec.ts:310–325` checks full/partial payload equality, exact deleted source spans, one root commit and byte-identical undo. `:327–344` checks actual provisional content, blocked cut preserving clipboard/preedit/focus, post-composition mapped cut and two separate root undos. |

## Quality verdict: PASS within L1–L4 scope

The changes address the original causes. The new inline helper uses the existing parser, source maps, reference resolution and safe math/image rendering rules. It resets and copies issue collection per cell, includes the header and omits separator rows. It does not mutate source or export a mutable parser. `TableWidget` includes document text in equality, so edits to external reference definitions invalidate presentation; `updateDOM` retains the controller and unchanged-shape focused mini-view. Composition still maps existing root decorations and defers controller repaint rather than replacing marked DOM.

The clipboard fix retains the sole root history and ordinary local patch path. Existing table structural operations, boundary Tab behavior and multiline-input retention remain in the affected test coverage. The original 14 browser tests remain alongside the eight new fix regressions, including composition barriers, root/cell DOM identity, mode/focus mapping, local source patches and corrected F19 computed styles.

**No introduced affected-path regression was identified.** The two renderer additions are authorized, not scope violations. Removing only their contiguous source section from current `render/markdown.ts` produces SHA-256 `36fcb034f975f93b73af938c27db1c2a5be6f58da8c089ea38bdf9c30234630f`, exactly the prior independently reviewed renderer. `positions.ts` and `math.ts` also retain their previously reviewed hashes. Existing R1–R3 rules and public render/clipboard APIs therefore were not rewritten as part of these additions. The second helper, `blockSourceRanges`, has its consumer assessment in `task-6-fix-review.md`.

## Verification and limits

Accepted the owner's recorded **24 live/table unit tests**, **39 renderer/build tests**, **22 live browser tests**, successful full typecheck and **187 passed, 1 skipped** full suite. Read the actual regression assertions, not just their titles. The supplied Task 6 full-suite log independently records the same 187/1 totals. These are existing execution results, not freshly rerun tests. The default-suite skip is the opt-in export browser test; Task 6 separately records its successful opt-in Chromium run.

Fresh review work was limited to source/test inspection, existing-log inspection and current-file hashing, including the renderer comparison above. No concrete uncovered regression risk justified rerunning an existing suite. No product writes, runtime probes, subagents, Git commands or shared builds were performed. Only the two requested fix-review documents were authored in the repository.

This closes L1–L4 for the manifested files. Real WKWebView candidate input, native clipboard/GUI behavior, integrated IME acceptance, final F19 visual comparison and native GUI/epoch work remain outside this scoped gate. Synthetic composition tests do not replace those acceptance checks.

## Current-file SHA-256 manifest

Hashes are of current files, not commits or the original review's earlier source. They were checked again before delivery.

```text
3cbb06ef919bfb2125576bb1703d29859fe8ccf0d025d4e283cfcd3228e3c78a  /private/tmp/ret-task6-fixround1/green-full.log
9085ddddf4cbe0bfac2ec786577173358ecb0c3124df4a67be6156bce41b3aec  docs/testing/briefs/task-4.md
4e3a38f924b9a6c4ef2df7bd352056f0d8fbbd70a4b7437f2110ee5d279009c9  docs/testing/reviews/task-4-review.md
854134af024a0f05f02c718711ec3842096047ff6ccb3cb14f77181a694b433b  docs/testing/task-4-fix-report.md
499649c0b497ed031bf21b1f29e5a53b9a49101d6f432eb13e68050ba754f860  node_modules/markdown-it/dist/markdown-it.mjs
ab263c54fb2bedfce5b3cd309b6f9f412d0936bd043ca9eddf10482ad79cd254  package-lock.json
45f1a3500562db03a4e1833bd8a44cc1d0fcd9c4ab79955409f45dea41b3664a  package.json
f3010ab2c6a425fb3098fb761d1a629ef33516d452192a45ad0d350a765e697a  web/src/editor/history.ts
5ee98db700b7fcd23ea288ba3557ecb3b99de0a88d278f637ef12a217c5bfd25  web/src/editor/live-contract.ts
176634d18d6b5afafcc9b237e43de2108ed88cb9bdb36c87af13f1fad36f73cd  web/src/editor/session.ts
5ed5510266da4e259610df90b24c8e4b76d4a32bb2627c1fe26219e23754bbec  web/src/editor/source.ts
a18fc2338af99392310dc560e0223c94a7c77e59db735278ddd6678f53e91432  web/src/live/cell-widget.ts
700ba20ccecc5cf2b59bdbc0aeda158bd6b2fc19edd8e026f6bb8f8c8b4f8941  web/src/live/composition.ts
08161849f1ea94f26458236008fb9e46debb35e6c8538ff02233a99c9b4c2c8f  web/src/live/decorations.ts
60b4e08d7376ef0a080c9e3365db032fd485890447c5df94e40263dea98385a0  web/src/live/syntax.ts
f437d3c516a0801f113b76a9513ec1619a4e3c09f6af1cbaa69859741b87f21a  web/src/live/tables.ts
82bf4da4daff0e49d2791bd96b58f49509e4a58f70d008172af501dc3d8d8be8  web/src/render/markdown.ts
c1dd964695182497d101a0fff972fee68a45572c3cbfa15fa6f36be114d278f2  web/src/render/math.ts
f9838bedac84f0e76c4942c259f23dfb6f2ef87b98e6195ee22c5d177302076a  web/src/render/positions.ts
b5c849588529119f3aaa4fe6d56677d897525cd4f8a9f406bf0ca48ef759c768  web/test/build.test.ts
f9b0fb7be8ba8aa182469860c456e696088fbd018a907782639e2847ef019f5f  web/test/editor.spec.ts
1d3c4c1a102907f5e2f90f1b62d0f0ee488c6919bbf36479d18dcb3c7dbeb172  web/test/live-browser-harness.ts
cc897d383de16ac173cac34fe4d0399fc1b4358552fda9e8f16eb82edc887812  web/test/live.test.ts
87eb9aad4a5c0af71f3bb3765a32348e19fcd0e7979dc8433427c1a3bb39f9c7  web/test/render.test.ts
ad9c9b9eed34f6241be680cc93d3f01c27fa3f0e632cebd28a421e4efc40ede2  web/test/tables.test.ts
```
