# AC2 fix round 2 — effective descendant columns

2026-10-16. Implements the remaining P2 **AC2-R1a** from the current Round 1 section of `reviews/acceptance-list-fix-review.md`. Original R1 reproductions remain corrected; R2 remains independently closed. This is the third implementation attempt counting the initial implementation and round 1. **Ready for Sol's independent final re-review; this implementer report does not close R1a.**

## Scope

Repository writes are limited to `web/src/editor/commands.ts`, `web/test/acceptance-list.test.ts`, and this report. No subagents, Git operations, shared build, browser/native UI, application packaging or publishing were used. Controller/session, source/history, live projection, tables, root configuration and performance implementation were consumed read-only or left to their owners. Previous review and round-one reports were not edited.

## General root and correction

Round 1 mixed two coordinate systems: each selected marker's gap was evaluated against its original prefix, while ancestor indentation shifts were accumulated and applied later. An unselected descendant, or one whose marker already matched, bypassed gap evaluation altogether. Because a tab's width depends on its effective start column, retaining those bytes could change paragraph/code grammar or the logical spaces in code. Blindly shifting the end of all leading whitespace could also consume a literal code-body tab.

The list branch now separates selection intent from a top-down local patch plan:

1. Resolve selected owning items and their target markers using the existing sibling counters and code-first task guard. The R2 guard still precedes marker, checkbox and indentation generation for that selected owner.
2. Visit real items in document order. Each affected item sees the prefix after all preceding ancestor changes, whether selected, unselected, or already matching the target type. Its own container delta is computed relative to that inherited change, rather than added from an independent original-column calculation.
3. Re-evaluate the item's gap at that effective column. Preserve prose separator width when ancestor movement changes its tab expansion. For code-first gaps, compare the logical suffix after the one list separator and four code-indent columns; retain complete literal tabs in that suffix and materialize only partial-tab overhang or necessary structural spaces. An existing code gap may exceed four columns; prose padding still cannot introduce such a gap.
4. Keep virtual changes only for structural line prefixes. Actual grammar quote markers distinguish container quotes from literal code `>` characters. CodeText starts and fence indentation bound the structural prefix so code-body whitespace remains literal. Translate deeper container tabs by the same ancestor delta, repairing only tab expansions that would differ. Emit minimal whitespace differences per quote-separated segment and marker/gap patches in original coordinates.

All patches still reach the existing `target.edit` once. There is no AST serialization, document normalization, second history, renderer change or new conversion feature. If a structural prefix cannot absorb a planned dedent without crossing its quote boundary, the command conservatively emits no edit. The matrix verifies requested target markers and expected commit/history counts, so successful results cannot be explained by silently declining required conversions.

## Exact review results

Both exact normalized selections now preserve the unselected child's Lezer CodeBlock and the markdown-it logical body **`" literal\n- code\n"`**:

```text
Narrowing, unorderedList, [6,12):
before: "1.    parent\n      - \t literal\n            - code\n- next"
after:  "-    parent\n     -      literal\n           - code\n- next"

Widening, orderedList, [2,8):
before: "- parent\n  - \t literal\n        - code\n- next"
after:  "1. parent\n   -      literal\n         - code\n- next"
```

The child's marker is unchanged. Its gap is the necessary local adjustment at the shifted tab stop. Both fixtures also run with BOM, mixed LF/CRLF/CR, Unicode outside the selection, surrounding paragraphs and no final newline. Assertions cover exact output bytes and EOL/BOM metadata, unchanged outside source, parsed item subtrees, rendered code, one initial commit/undo event, exact undo/redo, and replay of every edit/undo/redo commit against its corresponding snapshot. Patches cannot span or introduce newlines.

## RED, matrix and final verification

Before any round-two product edit, retained the reviewed source/test snapshots and added the small exact narrowing/widening failures. Added a deterministic matrix to expose the general column condition, then container and literal-tab controls while the product implementation remained unchanged.

All focused commands used `--cache=false --fsModuleCache=false --configLoader=runner`; logs live in `/private/tmp/ac2-fixround2.hmXWZR/`.

| Execution | Observed result |
| --- | --- |
| List tests, `-t 'round 2'`, initial exact reproductions + initial matrix | **9 failed, 2 passed, 70 filtered out**. Both exact reviewer reproductions failed on code body/grammar assertions. |
| Container controls, `-t 'effective columns through'` | **3 failed, 1 passed, 81 filtered out**. Quoted, nested-quote and already ordered middle-item cases reproduced body-space changes. Literal code quote was a passing control. |
| Expanded matrix with repeated tabs, `-t 'round 2'` | **14 failed, 1 passed, 70 filtered out**. Every numbered-width matrix group failed before the fix. |
| Literal code-body tab controls, `-t 'literal leading tab'` | **2 failed, 85 filtered out**. Indented and fenced code changed literal tabs to spaces. |
| First execution after the unified product correction: list + session tests | **111 passed, zero failed/skipped**. No subsequent product patch was needed. |
| Final execution after strengthening matrix target-marker/history assertions: list + session tests | **111 passed, zero failed/skipped**, exit 0. |
| `npm run typecheck` after final code/test changes | **Exit 0** (`tsc --noEmit`). |

Final test command:

```text
npx vitest run web/test/acceptance-list.test.ts web/test/session.test.ts --cache=false --fsModuleCache=false --configLoader=runner
```

There are **87 list tests: all previous 70 unchanged plus 17 additions**; all 24 existing session tests pass, including closed S1/S5 and actual ordered/task Enter continuation. A scoped comparison against retained before-copies confirmed that the complete original 70-test file prefix and all commands outside the list-conversion branch are byte-identical.

The nine matrix groups execute **9,504 combinations**: 1–9 numbered digits (plus bullet markers), four root indentation/tab phases, narrowing/widening, four child marker widths, eleven space/tab gaps including repeated literal tabs, and parent-only / parent+child / child-only selection. Each fixture requires the original three-item structure, unchanged markdown-it logical body tokens and rendered code, unchanged Lezer item subtrees modulo the requested list type, the actual requested selected markers, and the appropriate zero/one commit and history event. Separate controls cover deeper nesting, matching middle markers, quote containers, literal code quote tabs, and leading literal tabs in both code forms.

No same-condition failure remained after this implementation's first product correction; therefore the user-specified stop-before-further-patching condition did not trigger. This evidence covers the tested column/grammar root, not exhaustive Markdown conversion or a performance benchmark.

## Fingerprints and retained evidence

Final product/test SHA-256:

```text
76eaf64964b7b71f843d79620e27fe33b99b81a0ce66c8dd2934ec27607984f3  web/src/editor/commands.ts
4ec3636066d977c8162a6bdf92341bddfe778a2e805a18c5179b7b9a3c551839  web/test/acceptance-list.test.ts
```

Read-only dependencies at final verification (same hashes as this round's initial reads):

```text
6ce10de85659f9ce5976ca21ef4bedba86b5530f36932f31cdbddaf93eaea877  web/src/editor/session.ts
5ed5510266da4e259610df90b24c8e4b76d4a32bb2627c1fe26219e23754bbec  web/src/editor/source.ts
f3010ab2c6a425fb3098fb761d1a629ef33516d452192a45ad0d350a765e697a  web/src/editor/history.ts
a569d7d1e8529330e8ec23fbe6eb62c048b4febccdf669051c2d68aa248d44a5  web/test/session.test.ts
```

Private evidence directory `/private/tmp/ac2-fixround2.hmXWZR` contains the two before-copies, initial/exploratory RED logs, first post-fix `green-or-stop.log`, final `green.log`, and `typecheck.log`. Selected evidence SHA-256:

```text
c3a94ad4948e9cb1848fba32dd529c4005e3f95482a69c12903f1cb8dbdb45d0  red.log
850fda707fe156861b61e1f224ae8daa34c608f2dc505e61768d23bf5779c895  matrix-red.log
a84f02df75a1d33475e2cc39cb01e92d0c69c0fac3e19111ccefe3ca5d9b88ae  literal-tab-red.log
3fc32fa4408c33833a7f44bca1cac5028f810693f7d694a52e2b1a64fc1b18ba  green.log
1fc307878d27824dafdf5b4e7ab3c477bc3927e69a5dfa318dd075a4e0235b21  typecheck.log
```

Final independent re-review remains required against these current files. Root retains final build/native UI/menu/save acceptance, parallel projection findings and performance work. No full suite, shared build or UI acceptance is inferred from this scoped delivery.
