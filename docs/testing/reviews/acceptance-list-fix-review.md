# AC2 list conversion — independent scoped review

## Final round 2 re-review — current bounded verdict

2026-10-16. Reviewed the frozen round-two implementation against AC2-R1a, the new effective-column planner, and previous R1/R2 closures. This supersedes the finding statuses in both historical sections below.

**Spec verdict: PASS within AC2-R1/R1a/R2 and their affected local grammar paths.**

**Quality verdict: PASS within the same scope.** **R1, R1a and R2 are resolved/closed.** No remaining concrete P1/P2 or same-root residual was established in this review. This is a bounded code-review verdict, not whole-product or release acceptance.

### Closure and implementation assessment

| Finding / affected boundary | Current evidence and conclusion |
| --- | --- |
| **R1a — resolved** | `commands.ts:213–254` plans real items in source order using effective prefixes after ancestor changes. An unchanged or unselected descendant is processed when its prefix moved (`:218`); it no longer bypasses gap repair merely because its marker is unchanged. Old/new marker columns and inherited movement are reconciled at `:219–232`. Both exact original child-code reproductions retain the logical body `" literal\n- code\n"`, grammar CodeBlock, and unchanged child marker. |
| **R1 — remains resolved** | Separator classification and code-body extraction at `:205–232` distinguish structural columns from literal code whitespace. Prose padding at `:240–245` remains bounded by the four-column separator limit. Independent original long-marker, four-space, task and code-first probes retain their required body types/content and expected local output. |
| **R2 — remains closed** | The resolved-owner code-first task guard at `:133–135` still precedes selected marker recording and checkbox patches. Independent later-paragraph fenced/indented probes remain exact no-ops with zero commits/history. Existing plain/mixed-EOL and explicit-marker regressions are unchanged. |
| Structural versus literal whitespace | Grammar QuoteMark/CodeText and fence-column metadata at `:103–121` bound the structural prefix used at `:168–184`. `shiftPrefix` translates deeper structural tabs while preserving their visual width (`:186–203`). `codeGapBody` retains literal suffix tabs and accounts for partial-tab overhang (`:205–211`). Independent leading-tab controls retain identical logical bodies in both indented and fenced code. |
| Local patches and sole history | Prefix differences are emitted per quote-separated segment (`:255–265`); marker/gap and checkbox edits retain original coordinates. One sorted batch reaches the existing `target.edit` at `:268`. Independent mixed-EOL/BOM probes retain exact outside bytes, one initial edit/history event for conversions, exact undo/redo and per-commit mirror replay. No document serialization or second history was added. |
| Conservative fallback and conversion intent | A prefix shift that would cross its structural quote boundary returns before any edit (`:190`, `:250`). The inspected matrix explicitly checks requested selected markers and expected zero/one commit/history counts, so its passing cases are not explained by silently declining the conversion. No failing supported conversion was demonstrated. |

The exact R1a results are now:

```text
Narrowing, unorderedList, original [6,12):
before: "1.    parent\n      - \t literal\n            - code\n- next"
after:  "-    parent\n     -      literal\n           - code\n- next"

Widening, orderedList, original [2,8):
before: "- parent\n  - \t literal\n        - code\n- next"
after:  "1. parent\n   -      literal\n         - code\n- next"
```

Only necessary descendant gap/container whitespace changes accompany the selected parent conversion. Both still contain the original logical child code, including its leading space.

### Verification and scope

Read the complete current command file, round-two test additions and `acceptance-list-fix-round2.md`. Compared the retained before-copies with this review's round-one hashes: the prior **70-case list-test prefix is byte-identical**, and all commands outside the list branch are byte-identical. Source/history and the unchanged session-test hash retain the previously reviewed contracts and closed S1/S5. No unrelated owner path was reviewed or modified.

Read the retained initial RED, expanded matrix RED, literal-tab RED, first post-fix GREEN, final GREEN and no-emit typecheck evidence. The exact R1a cases failed on body/grammar before the fix. The final owner execution records **111 passed, zero failed/skipped**: 87 list tests, including all previous 70, plus 24 session tests. Typecheck completed successfully. These are retained owner executions, not reviewer suite reruns.

Inspected the nine matrix groups and their assertions: **9 × 4 × 2 × 4 × 11 × 3 = 9,504 combinations**, varying numbered width, root column phase, direction, child width, separator tabs/spaces and selection. They compare actual requested markers, three-item structure, logical body tokens, rendered code, grammar subtrees and expected commit/history counts. Additional controls cover quoted/deeper descendants, matching middle markers, literal code quotes and literal leading code tabs. This provides substantial evidence for the reviewed column root; it is not exhaustive Markdown coverage or a performance measurement.

Fresh reviewer execution used **10 bounded esbuild `write: false` production-session probes**, with assertions: the two exact R1a cases, four original R1 cases, two R2 cases and two literal-tab controls. All passed through actual commands/CM transactions. The probes wrapped inputs with BOM, Unicode outside the selection, mixed LF/CRLF/CR and no final newline; they checked logical bodies, exact expected encoded output where specified, metadata, expected commit/history counts, byte-identical undo/redo and replay against each committed snapshot. No broad test or matrix rerun was performed.

Only this review document was updated. No product/test edits, subagents, Git operation, shared build, UI or performance run occurred. The same-root failure escalation condition did not trigger because no residual was reproduced. Controller-owned final suites, new release packaging, native menu/save acceptance and component performance remain separate gates; this review does not infer their completion or issue a general code PASS.

### Final round 2 current SHA-256

Rechecked before delivery. Earlier manifests below identify historical snapshots only.

```text
76eaf64964b7b71f843d79620e27fe33b99b81a0ce66c8dd2934ec27607984f3  web/src/editor/commands.ts
4ec3636066d977c8162a6bdf92341bddfe778a2e805a18c5179b7b9a3c551839  web/test/acceptance-list.test.ts
6ce10de85659f9ce5976ca21ef4bedba86b5530f36932f31cdbddaf93eaea877  web/src/editor/session.ts
5ed5510266da4e259610df90b24c8e4b76d4a32bb2627c1fe26219e23754bbec  web/src/editor/source.ts
f3010ab2c6a425fb3098fb761d1a629ef33516d452192a45ad0d350a765e697a  web/src/editor/history.ts
a569d7d1e8529330e8ec23fbe6eb62c048b4febccdf669051c2d68aa248d44a5  web/test/session.test.ts
098beed53c35aa3473cb86b0d24345094a3951c763c8c0690c3b96bd139f6c51  docs/testing/acceptance-list-fix-round2.md
c3a94ad4948e9cb1848fba32dd529c4005e3f95482a69c12903f1cb8dbdb45d0  /private/tmp/ac2-fixround2.hmXWZR/red.log
850fda707fe156861b61e1f224ae8daa34c608f2dc505e61768d23bf5779c895  /private/tmp/ac2-fixround2.hmXWZR/matrix-red.log
a84f02df75a1d33475e2cc39cb01e92d0c69c0fac3e19111ccefe3ca5d9b88ae  /private/tmp/ac2-fixround2.hmXWZR/literal-tab-red.log
96f92d69016aef03c5ddb4acb5842282f8db6b7bbd61fea074123d5f8b902ef5  /private/tmp/ac2-fixround2.hmXWZR/green-or-stop.log
3fc32fa4408c33833a7f44bca1cac5028f810693f7d694a52e2b1a64fc1b18ba  /private/tmp/ac2-fixround2.hmXWZR/green.log
1fc307878d27824dafdf5b4e7ab3c477bc3927e69a5dfa318dd075a4e0235b21  /private/tmp/ac2-fixround2.hmXWZR/typecheck.log
```

## Round 1 re-review — historical verdict (superseded)

2026-10-16. Scope: AC2-R1/R2 and grammar paths affected by their correction in the frozen round-one implementation. Supersedes the initial finding status below for these current hashes.

**Spec verdict: CHANGES REQUIRED — one reproduced P2 residual, AC2-R1a.**

**Quality verdict: CHANGES REQUIRED within this bounded scope.** Original R1 reproductions are corrected; **AC2-R2 is resolved/closed**. R1 cannot yet close because descendant tab stops still change body semantics when an ancestor's indentation changes. No P1 established.

### P2 AC2-R1a — ancestor indentation changes an unselected child's tab separator

**Locations:** `web/src/editor/commands.ts:147–162` computes gap repair only for the item whose marker changes; lines 166–175 schedule ancestor indentation deltas across descendants; lines 193–200 apply those deltas without accounting for descendant marker-to-body tabs. In particular, a descendant with an unchanged marker never enters the gap repair at line 146.

**Exact reproduction:** Initialize the actual production session with this source (the `\t` is one literal tab), select normalized UTF-16 `[6,12)` (`parent`), then execute `session.command('format', { kind: 'unorderedList' })`:

```text
"1.    parent\n      - \t literal\n            - code\n- next"
```

**Actual result:**

```text
"-    parent\n     - \t literal\n           - code\n- next"
```

Original-coordinate patches are exactly:

```json
[
  { "from": 0, "to": 2, "insert": "-", "eols": [] },
  { "from": 18, "to": 19, "insert": "", "eols": [] },
  { "from": 42, "to": 43, "insert": "", "eols": [] }
]
```

Before conversion, both installed Lezer grammar and markdown-it recognize the unselected child as an indented code block. Its logical code body is `" literal\n- code\n"`. After the one-column ancestor dedent, the child separator's visual width falls from six columns to three. Lezer now recognizes a paragraph plus a nested bullet list; markdown-it emits ordinary `literal` and `code` inline bodies instead of any code block. The tab and code-looking source bytes survive, but their meaning does not. This violates the R1 body-preservation requirement and F02's necessary-local-syntax boundary.

The corresponding widening control also changes code content: source `"- parent\n  - \t literal\n        - code\n- next"`, selection `[2,8)`, `orderedList`, yields `"1. parent\n   - \t literal\n         - code\n- next"`. The child remains a code block, but its logical body changes from `" literal\n- code\n"` to `"literal\n- code\n"`. Both are the same ancestor/tab-stop problem; they are counted as one residual finding.

**Required correction:** Account for the effective indentation of descendants when preserving tab-containing marker separators and logical code indentation, including descendants whose marker is unselected or already has the requested type. Use necessary local whitespace adjustments or a conservative fallback if grammar cannot be preserved. Add the exact narrowing reproduction and widening counterpart, asserting child grammar/body content, surrounding bytes, and one-event undo/redo/replay. This is within the existing R1 correction, not a new feature.

### Resolved original cases and evidence

- **R1 original cases corrected:** Independent production-session probes confirmed the exact long-marker paragraph, four-space separator, long-marker task, and narrowed code-first reproductions. Paragraph/code types and logical bodies are preserved; task conversion produces a grammar `TaskMarker`. Every mutating probe retained one initial commit/history event, exact-byte undo/redo, and commit replay. R1 remains open only for AC2-R1a above.
- **R2 closed:** The owner-level guard at command lines 125–127 now runs before counting, marker changes, indentation scheduling, or checkbox insertion. Independent probes of the exact `[29,30)` fenced and `[30,31)` indented later-paragraph selections performed a byte-identical no-op, with zero commits/history events. New tests at lines 345–365 also cover BOM/mixed EOL and default/explicit `+`/explicit `1000.` markers, stable selection/revision/pending commits, and unchanged renderer output. The existing conservative code-first fallback is retained.
- **Scoped comparison:** The retained before-copies hash-match this review's original commands/test fingerprints. Actual diff changes only the list-conversion branch; Enter, indent/outdent, other formats and image insertion are byte-identical. The original 45-case test block is unchanged apart from the added imports. Read all 25 added cases, including 16 plain/mixed-EOL semantic cases, seven container controls and two R2 tests with six combinations each. Closed S1/S5 implementations and their session tests remain unchanged.
- **Recorded execution evidence checked:** Read and hash-checked the owner's retained initial RED (10 failures / 45 passes), final GREEN (**94 passed, zero failed/skipped**) and no-emit typecheck logs. These are owner executions, not reviewer reruns. New assertions cover actual body tokens/rendering, local patches, metadata, history and per-commit replay. They do not cover an unselected descendant's tab separator moving with its ancestor.

Fresh reviewer execution was limited to eight in-memory esbuild **`write: false`** production-session probes: the six exact original cases and the two concrete descendant-tab concerns above. No test suite, shared build, product/test edit, subagent, Git operation or UI was run. Only this review document was updated. This does not issue a general code PASS or any V1/native acceptance verdict; the projection owner's separate performance work and all other pending scopes remain outside this gate.

### Round 1 current SHA-256

Rechecked before delivery. Historical hashes below remain evidence for the initial review only.

```text
db4ffbb0383f98bd86c01395b8939298a70910f5148a44a9eec0a8a6582c431c  web/src/editor/commands.ts
21006be7dccd9f1cc2a12128bd7b254061683d9b7315ccca22ff9f577550abd9  web/test/acceptance-list.test.ts
6ce10de85659f9ce5976ca21ef4bedba86b5530f36932f31cdbddaf93eaea877  web/src/editor/session.ts
5ed5510266da4e259610df90b24c8e4b76d4a32bb2627c1fe26219e23754bbec  web/src/editor/source.ts
f3010ab2c6a425fb3098fb761d1a629ef33516d452192a45ad0d350a765e697a  web/src/editor/history.ts
a569d7d1e8529330e8ec23fbe6eb62c048b4febccdf669051c2d68aa248d44a5  web/test/session.test.ts
1c1b0b80f26875e1573c7f30a29606e2b75873e079e779a01626f607426a6278  docs/testing/acceptance-list-fix-round1.md
9626645f4335320bfeaa54a9de1e35986046ecfe430423432a389737a052ca61  /private/tmp/ac2-fixround1.ie65g0/red.log
01fcc2eff7137807fddf0ce0a0f0ea17ba24f1d3491251797dcbaaf696421a21  /private/tmp/ac2-fixround1.ie65g0/green.log
1fc307878d27824dafdf5b4e7ab3c477bc3927e69a5dfa318dd075a4e0235b21  /private/tmp/ac2-fixround1.ie65g0/typecheck.log
```

## Initial review — historical findings and snapshot

2026-10-16. Direct current-file review in the shared non-Git workspace. Owner implementation is frozen; no product fixes were made.

**Spec verdict: CHANGES REQUIRED — two reproduced P2 findings against F02/F06.**

**Quality verdict: CHANGES REQUIRED — the indentation and code-first fallback paths below need correction.** No P1 finding established. The original AC2 marker-stacking trigger is fixed, but that does not close the affected conversion paths.

## P2 AC2-R1 — narrower-marker padding changes paragraph/code semantics

**Location:** `web/src/editor/commands.ts:147–165`, especially `replacement = marker + ' '.repeat(-delta)` at line 165. A preserved absolute content column is not sufficient to preserve Markdown grammar: five or more spaces after a bullet introduce indented code.

**Reproduction:** Create a production `EditorSession` with the following normalized source, select `[6,12)` (`parent`), then call `session.command('format', { kind: 'unorderedList' })`:

```markdown
1000. parent
      continuation
- next
```

**Actual output** (five spaces between the first bullet and `parent`):

```markdown
-     parent
      continuation
- next
```

The emitted patch is `{ from: 0, to: 5, insert: '-    ', eols: [] }`; the original separator supplies the fifth space. Before conversion, the first item contains a `Paragraph`. Afterwards, the installed Markdown grammar identifies `CodeBlock(CodeText,CodeText)`. Installed markdown-it independently renders `parent\ncontinuation` inside `<pre><code>`. This is a change in body meaning, not necessary list-type syntax.

This also occurs with a one-digit ordered marker and a valid four-space separator: `1.    parent\n      continuation\n- next` becomes the same code-first bullet. A BOM/mixed-EOL probe of that variant reproduced the semantic failure while preserving all EOL entries, BOM, surrounding bytes, one-event undo/redo, and commit replay. `taskList` on the long-marker reproduction produces `-     [ ] parent`, whose checkbox is code text rather than a task marker.

The same padding assumption modifies existing code content when narrowing a code-first item. Selecting `[0,14)` in `12.     literal\n        - code\n- next` and applying `unorderedList` produces `-       literal\n        - code\n- next`. The rendered code body changes from `literal\n- code\n` to `  literal\n  - code\n`. The item remains a code block, but two leading spaces are added to each logical code line.

**Required correction:** Preserve the existing body grammar and logical code content when choosing replacement separator width and necessary continuation/container indentation. Do not preserve an absolute column by creating a code-introducing separator. Add focused regressions for the four-space separator, long numbered parent, task conversion, and narrower code-first item, checking parsed/rendered body meaning and exact undo in addition to literal source. This stays within AC2's local conversion repair.

The existing narrower-marker regression at `web/test/acceptance-list.test.ts:167–174` uses `12)` with a single separator space, so its resulting separator stays below the code threshold and does not cover these failures.

## P2 AC2-R2 — a later paragraph bypasses the code-first task fallback

**Locations:** `web/src/editor/commands.ts:119` checks code membership of the selected line before resolving its owning item at line 123; checkbox insertion at lines 170–175 then modifies that item's code-first line without rechecking the item.

**Reproduction:** Use this exact source, select normalized UTF-16 `[29,30)` (the `a` in `after`), and execute `session.command('format', { kind: 'taskList' })`:

````markdown
- ```md
  - literal
  ```

  after
- next
````

**Actual output:**

````markdown
- [ ] ```md
  - literal
  ```

  after
- next
````

The emitted patch is `{ from: 2, to: 2, insert: '[ ] ', eols: [] }`, outside the selected later paragraph and inside the original code-opening line. The original item has a `FencedCode` followed by a `Paragraph`. After conversion, `- literal` becomes a nested list and the former closing fence opens a new code block containing `after`. The original code structure is destroyed.

The indented-code counterpart is also reproduced: source `-     literal\n      - code\n\n  after\n- next`, selection `[30,31)`, same command. Actual output begins `-     [ ] literal`; `[ ] ` is inserted into the existing code body, and no task marker is created.

Selecting `[0,1)` in either source correctly performs no edit and creates no history event. This confirms that the intended conservative fallback exists but depends incorrectly on which line of the same item is selected. The existing tests at `web/test/acceptance-list.test.ts:197–201` contain only code-first items without a later paragraph and therefore miss the bypass.

**Required correction:** Apply the existing code-first task fallback to the resolved owning item before emitting any marker, checkbox, or indentation patches, regardless of whether selection begins on its marker or a subsequent paragraph/continuation. Add both later-paragraph reproductions with byte-identical no-op/no-commit assertions. This extends the already chosen conservative rule; it does not request a new code-to-task feature.

## Other scoped assessment

| Contract | Evidence and assessment |
| --- | --- |
| Original AC2 marker replacement | Fresh production-session probe converts `- alpha\n- beta` to `1. alpha\n2. beta`, with exactly the two marker-replacement patches asserted at test lines 24–41. No stacked old markers. |
| Checkbox recognition and locality | Grammar `TaskMarker` drives removal/preservation at command lines 170–179. Tests cover x/X/space, ordinary checkbox-like prose, aliases, explicit markers and matching-type no-ops. R1/R2 are the demonstrated structural exceptions. |
| Necessary container indentation | Wider-parent, selected-child, code, quoted-list and nested-item assertions are present at test lines 87–122 and 149–194. A fresh tab-nesting probe retained parsed nesting. Narrowing is blocked by R1. |
| Mixed EOL, BOM, outside bytes | Patches contain no newlines; unchanged metadata flows through the existing codec/EOL field. Fresh mixed-EOL/BOM probe verified unchanged terminators and unrelated prefix/suffix bytes, exact undo/redo, and replay of commits into a mirror. R2 shows why literal locality alone is insufficient to approve body semantics. |
| One history event | The list branch sorts patches and calls `target.edit` once at line 184. Session `patchTransaction` uses the existing EOL restore effect and `isolateHistory.of('full')`. Fresh mutating probes produced undo depth 1 and exact-byte undo; the mixed-EOL probe also checked redo and commit replay. No second history or AST serialization was introduced. |
| Closed S1/S5 | Read the original Task 3 findings, fix report and scoped closure. Current indent/outdent and Enter/code-context implementations remain present, as do their unchanged regressions in `web/test/session.test.ts:154–188`. Source/history/protocol and that test file match the retained final-source manifest. Neither original finding is reopened by this review. |
| Other commands and concurrent owners | Read all 210 lines of `commands.ts`, including inline formats, headings, quotes, code blocks and image insertion. No additional concrete P1/P2 was established there. Current session search/theme changes belong to the concurrent controller repair and are not attributed to AC2. A non-Git working tree cannot establish all historical edit ownership; no whole-workspace no-change claim is made. |

## Method and acceptance boundary

Read `build/verification/acceptance-handoff.txt` issue 2, F02/F06 and adjacent grammar requirements, the architecture's source/session/history contract, `docs/testing/acceptance-list-fix-report.md`, the complete implementation and new test file, retained final-source fingerprints, and closed S1/S5 reports. The owner's reported 45 new regressions / 69 focused passes and full-suite/typecheck results are existing owner evidence; these suites were not rerun by this reviewer.

Fresh probes used esbuild **`write: false`**, bundled the actual production session/commands/source/history, and executed headless CodeMirror transactions. Parsed structures were checked with the installed Markdown grammar and body rendering with installed markdown-it. An initial probe setup failed on CSS imports before running any product command; adding the text loader allowed the probes to execute. No generated build files, private probe files, product/test files, Git metadata, browser/native UI, subagents, full suites or broad tests were written or operated. The sole repository output is this report.

This is an AC2 code-review verdict. App packaging, actual native menu/selection/save behavior and remaining V1 acceptance belong to the controller; no V1 acceptance is inferred.

## Current-file SHA-256

Hashes identify the actual inspected files and were rechecked before delivery. The commands/test hashes remained stable throughout the probes. Session is the controller's current concurrent snapshot, not its historical final-manifest version.

```text
0526fed93c1d4d825a8ccdfcfa6c84a9a49013196f5f965c42e608b7a69f0986  web/src/editor/commands.ts
e241349ea775f337edc2d3cabb1763e233ed24f7783da8e07fad5df9a3d60706  web/test/acceptance-list.test.ts
c807b5d0ad39ace45d410f1bd4b53259822b313ed07f03ba73785eb93035d4f9  web/src/editor/session.ts
5ed5510266da4e259610df90b24c8e4b76d4a32bb2627c1fe26219e23754bbec  web/src/editor/source.ts
f3010ab2c6a425fb3098fb761d1a629ef33516d452192a45ad0d350a765e697a  web/src/editor/history.ts
940b561f2088ad8d444fc4761c5caa4cdf52e40c6389d832b6df7dc3169d3a4c  web/src/protocol.ts
a569d7d1e8529330e8ec23fbe6eb62c048b4febccdf669051c2d68aa248d44a5  web/test/session.test.ts
aa1506a9fce3c1bd536ef79c0ec45ad25197df4a065f1f3555dcc980ec3da47c  docs/specs/2026-10-14-markdown-editor-design.md
27b0b112d8bf5f3455ddc76ef30a452fc5488ddb321c87b967db522201274145  docs/architecture/2026-10-14-native-editor.md
7276ab893acd2840d7b47b2b2f90189ec6ac4ec46e0e002d5a7362a7726d378b  build/verification/acceptance-handoff.txt
cb16e96dd02a106bbad3870e6953827257245857b3a6482498b1ac9fc23b90a5  docs/testing/acceptance-list-fix-report.md
341d28774b45715f97ba55389c4fb4ead391be71b6569b792f08918db344f18a  docs/testing/reviews/task-3-fix-review.md
2d735fc934b665a64d2afd00c96844db5bbe435a0a3585faa267fc4f4027ff9b  docs/testing/task-3-fix-report.md
```
