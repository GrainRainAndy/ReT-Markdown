# Task 3 fixes — scoped independent re-reviews

## Round 2 — current verdict, S3-R1 only

Date: 2026-10-15. Reviewed the round-two section of `docs/testing/task-3-fix-report.md`, current `web/src/editor/clipboard.ts`, and `web/test/clipboard.test.ts`. Scope is exclusively multiline/container reference conversion and possible context leakage introduced by its correction. S1/S2/S4/S5 remain closed and were not re-reviewed or exercised.

**Spec: PASS for S3-R1.** The two reported blockquote triggers now preserve reference destination/title semantics while keeping the definitions invisible to clipboard conversion.

**Quality: PASS for the affected path.** S3-R1 is **resolved; P2 closed**. No residual defect was established in this scoped review. S3 therefore has no remaining actionable finding from the previous reviews. This verdict does not assert full-product acceptance.

### Resolution and evidence

`web/src/editor/clipboard.ts:14`–`:26` now parses the whole document into MarkdownIt's semantic `env.references` table instead of copying raw Lezer source ranges. The block parser consumes quote/list prefixes and continuation lines. The reference parser's link-validation policy matches the existing renderer. Serialization uses the parsed href/title, escapes backslashes/entities/quotes and title newlines, and retains the parser's first-definition precedence. `clipboard.ts:69` returns exact source copy before constructing this context; `:71`–`:74` supplies the serialized definitions only to existing plain/rich renderer helpers. Public renderer APIs remain unchanged.

The new regressions at `web/test/clipboard.test.ts:65`–`:103` cover both original blockquote definitions, selected-label and unrelated-text copies, nested quote/list context, duplicate-definition precedence, and escaped URL/title semantics. They assert exact source, plain/text fallback, semantic HTML, absence of visible container/definition leakage, and unchanged source/revision/history. The earlier six full/collapsed/shortcut reference-link/image cases remain in the clipboard test file.

Independent probes bundled only the affected clipboard/source/renderer code into `/private/tmp` and checked five context cases:

- The original continued-title blockquote produces plain `label`, a rich anchor retaining `title="title"`, and no visible title or blockquote.
- The original continued-destination blockquote resolves the link and emits no literal definition text.
- Nested quote/list definitions retain first-definition precedence and escaped destination/title semantics.
- A title continued over multiple quoted lines retains the same semantic title as full-document rendering.
- Entity-escaped angle brackets, ampersands, quotes and title newlines survive conversion without creating extra visible content.

For every case, probes also asserted exact default source copy, text fallback `label`, byte-for-byte unchanged source data, and unrelated ordinary-text output containing only `ordinary text`. All five passed. Rich anchors were compared directly with the fixed renderer's full-document anchors, rather than inferred from plain output.

### Verification boundaries

Owner-recorded evidence: actual RED **5 failed / 11 passed**, clipboard GREEN **16 passed**, focused session/clipboard/transport **47 passed**, and typecheck PASS. These suites were not rerun by this reviewer; the independent probes above are fresh reviewer evidence. The ten Task 6 export RED tests are outside Task 3 ownership and do not count against this verdict. No whole-workspace green result is claimed.

Reviewed SHA-256 fingerprints: clipboard `68e637c034597d67b269a181871718057805bf9a7c2afe31d3074da68525c868`; clipboard tests `971e965d76117655837204b1174d0d3ca75cc88787f4cde68d7ae99474a8d270`.

No product writes, Git operations, subagents or shared build writes were performed. No S1/S2/S4/S5 checks, browser rebuild, native review or root-build review was performed in round two. The round-one review below is retained as historical evidence; its open S3-R1 status and required-action conclusion are superseded by this closure.

## Round 1 — historical review (superseded for S3-R1)

Date: 2026-10-15. Scope: S1–S5 from `task-3-review.md`, their changes in current Task 3 commands/clipboard/main/tests, and the new bootstrap connection to Task 4's real factory. This is not a broad product re-review.

## Verdicts

**Spec: CHANGES REQUIRED.** S1, S2, S4 and S5 are resolved. S3's original top-level-reference trigger is fixed, but its new context extraction introduces the reproduced P2 residual below.

**Quality: CHANGES REQUIRED.** One actionable residual, S3-R1 (P2 / Important). No other regression was established in the scoped changed paths; no P0/P1 finding was established.

## Finding statuses

| Finding | Status | Current implementation and evidence |
| --- | --- | --- |
| S1 — parent indentation detaches children | **Resolved; original P2 closed** | `web/src/editor/commands.ts:72`–`:90` expands selected list items through their subtree and continuation lines, applies sorted patches once, and removes the root's indentation uniformly on outdent. `web/test/session.test.ts:155` checks indent/outdent, descendants, continuation lines, untouched following siblings, mixed EOLs and one-step byte-identical undo; `:166` covers outermost outdent. Independent probes confirmed the original parent/child trigger and its outdent counterpart, with exact-byte undo. |
| S2 — inline Code Block creates invalid fences | **Resolved; original P2 closed** | `commands.ts:45`–`:52` adds the necessary opening/closing line separators without rewriting selected prose. `session.test.ts:192` asserts exact mixed-EOL source, actual rendered code/prose and one-step undo for inline selection and collapsed paragraph-end cases. Independent probes of `before chosen after` at `[7,13)` and `paragraph` at `[9,9)` produced valid fenced blocks and restored original bytes on undo. |
| S3 — reference-link copy lacks document context | **Partially resolved; P2 remains as S3-R1** | `web/src/editor/clipboard.ts:53`–`:60` supplies definitions while leaving source copy unchanged. `web/test/clipboard.test.ts:43`–`:62` covers full/collapsed/shortcut reference links and images, HTML/text fallback, local capability resolution and unchanged session/history. The original top-level `[label][ref]` trigger independently produced plain `label` and a rich anchor. Multiline definitions in blockquotes break the new extraction, as reproduced below. |
| S4 — decoded image path selects the wrong capability | **Resolved; original P2 closed** | `web/src/main.ts:56`–`:60` now prefers the exact renderer-supplied destination over the decoding fallback. `web/test/transport.test.ts:100` inserts both native percent-escaped destinations and checks distinct capability selection before and after `setAssets`, plus unchanged source/revision on refresh. This directly exercises the old collision; insertion still preserves native percent escapes. The test's green result is recorded owner evidence, not a reviewer rerun. |
| S5 — Enter continues lists inside code | **Resolved; original P2 closed** | `commands.ts:16`–`:22` rejects fenced/indented code ancestors, and `:54`–`:68` requires an actual list item before continuing or exiting a list. `session.test.ts:171` covers all three code-marker triggers in both code forms, inherited EOLs and byte-identical undo; `:184` retains real ordered/task continuation alongside the existing three unordered-marker cases. Independent probes confirmed the three original fenced-code triggers and exact-byte undo. |

## S3-R1 — P2 / Important: raw multiline blockquote definitions become clipboard content

**Exact location:** `web/src/editor/clipboard.ts:55` copies the raw `LinkReference` range; `:59` prepends it as standalone Markdown conversion context. The raw range can include blockquote markers on continuation lines. Those markers are meaningful outside their original container, so the claim that these definitions are invisible context does not hold.

**Real trigger:** Open this valid document and select only the visible `label` in live mode:

```markdown
> [ref]: https://example.com
>   "title"
>
> [label][ref]
```

The fixed renderer renders the document as a link with `title="title"`. The new clipboard conversion instead produces:

- Source copy: `[label][ref]` — correct.
- Plain copy: `"title"\n\nlabel` — includes unselected definition text.
- Rich copy: a visible blockquote containing `"title"`, then the link without its title attribute.

A second valid definition with the destination on a continuation line also reproduces the failure:

```markdown
> [ref]:
>   https://example.com
>
> [label][ref]
```

The document renderer resolves this link. Clipboard plain output becomes `[ref]:\n\nhttps://example.com\n\n[label][ref]`; rich output contains the definition text and an unresolved literal reference. These are new effects of the S3 fix, within the original F06/F08/T24 conversion-context requirement.

**Action:** Build conversion context from the definitions' logical Markdown content, accounting for container prefixes on continuation lines, instead of prepending raw cross-line source ranges. Preserve destination/title semantics and first-definition precedence. Keep default source copy and the fixed renderer helper APIs unchanged.

**Necessary regression:** Add both blockquote cases to `web/test/clipboard.test.ts`, with definitions outside the selection. Assert exact source copy, plain `label`, a rich anchor with the correct destination/title, text fallback `label`, no visible definition/title text, and unchanged source/revision/history. Also select unrelated ordinary text in a document containing such a definition to ensure context does not leak into that copy. Retain the six existing reference cases and no remote-resource loading.

## Live-factory connection

The new import at `web/src/main.ts:2` and installation at `:197` connect the real Task 4 factory. Installation runs synchronously before assigning `window.retEditor`, before browser preview load, and before the queued `ready` publication at `:177`. Native load passes the stored factory into `createEditor` at `:83`. The injectable `createTransport` test helper remains available.

`web/test/session-browser.mjs:64`–`:72` checks the actual bootstrap for `.cm-live-strong`, visible `wired`, and hidden `**wired**` markers. Its private-file Chromium green result is recorded evidence. This closes the previous factory-connection handoff; it does not establish all widget/native acceptance gates.

## Verification and limits

- Read the fix report, original exact triggers, current changed implementation and regression tests. A filesystem comparison against the original snapshot confirmed that session/history/search/live-contract/protocol remain unchanged; the main diff contains only exact-key precedence, the real-factory import and installation.
- Owner evidence: actual RED **14 failed / 28 passed**, focused GREEN **42 passed**, full suite **166 passed / 1 skipped**, typecheck PASS, private build and private-file Chromium PASS. These suites/build/browser checks were not rerun by this reviewer.
- Independent `/private/tmp` probes exercised the original S1/S2/S3/S5 triggers and the nearby S3 container cases using current code and the fixed renderer. They established S3-R1 and the successful original-trigger behavior described above. No shared build output was written.
- Reviewed source fingerprints (SHA-256): main `723ac9d2432b6845770b3acb68e1d6bbe52df2f65f994baa7d6212addb2e8597`; commands `5798a4add31d32e311db952adf731fdf76b32266b30d18f55fdc01a683cf61e3`; clipboard `ea21e01798f05b1a53ac8a85d420912a5828d388b18f5959ea8a7626bea00075`.

No product edits, subagents or Git operations were performed. Gauss's native GUI deadlock repair, native acceptance, root build changes and final packaged integration remain outside this scoped verdict. The only remaining action from this fix-round review is S3-R1 and its focused regression.
