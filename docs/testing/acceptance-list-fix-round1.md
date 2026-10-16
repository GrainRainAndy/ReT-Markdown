# AC2 fix round 1 — grammar-preserving list conversion

2026-10-16. Implementer evidence for confirmed P2 AC2-R1 / AC2-R2 in `reviews/acceptance-list-fix-review.md`. **Ready for independent re-review; findings are not independently closed by this report.** Shared non-Git workspace; no subagents or model delegation.

## Owned changes

Only these repository files were edited:

- `web/src/editor/commands.ts`
- `web/test/acceptance-list.test.ts`
- `docs/testing/acceptance-list-fix-round1.md`

Read the independent review, original acceptance-list report, F02/F06, source/session/history contracts and implementations, and the closed S1/S5 evidence. The current controller's session changes were consumed read-only. No server/body-query, live projection, table, root configuration, native source, shared build, application package, or publishing changes were made.

## Corrections

**AC2-R1:** A narrower marker may retain its content column using local prefix padding only when the resulting separator remains at most four columns and the original gap does not belong to an indented-code body. Otherwise the command retains the logical body indentation by dedenting only necessary continuation/container whitespace. Signed indentation changes accumulate before the existing single edit transaction; a tab is split only when needed to reach the required column. Blank lines, lazy continuation lines, literal code quote markers, and surrounding source stay intact.

Moving a marker can also move a tab stop. If that would cross the paragraph/code separator threshold or alter the existing code body's leading spaces, only that item's marker-to-body whitespace is adjusted to the original visual width. This does not normalize other gaps or the document. Existing code indentation may legitimately exceed four columns; the fix does not introduce such a separator merely to preserve an absolute column.

Exact review reproductions now produce these normalized sources:

| Input / selection / command | Result |
| --- | --- |
| `1000. parent\n      continuation\n- next`, `[6,12)`, unorderedList | `- parent\n  continuation\n- next` — paragraph remains paragraph |
| `1.    parent\n      continuation\n- next`, `[6,12)`, unorderedList | `-    parent\n     continuation\n- next` — four-space separator remains prose |
| Long ordered parent above, `[6,12)`, taskList | `- [ ] parent\n  continuation\n- next` — grammar TaskMarker and rendered checkbox |
| `12.     literal\n        - code\n- next`, `[0,14)`, unorderedList | `-     literal\n      - code\n- next` — rendered code remains exactly `literal\n- code\n` |

**AC2-R2:** After resolving the selected line's owning item, the task fallback checks whether that item's marker line starts code. It runs before sequence counting or marker, checkbox, or indentation patch generation for that item. Selecting the later `after` paragraph in either exact review reproduction (`[29,30)` fenced; `[30,31)` indented) now preserves the complete source, selection, revision, pending commits and empty history. The fallback also applies with explicit `+` and `1000.` markers, which otherwise could change marker width and indentation before inserting a checkbox.

The original conservative code-first task behavior remains a no-op. List type conversion continues to use grammar ranges and local patches, with no whole-AST serialization, second history, or global normalization. Enter and indent/outdent implementations were not changed.

## RED / GREEN evidence

All commands below used the actual production EditorSession command router, CodeMirror transactions/history and source/EOL codec. The focused Vitest commands disabled result/module caches and used the runner config loader to avoid shared generated test/config artifacts.

1. Before any product edit, appended the exact review regressions and their BOM/mixed-EOL variants. Ran:

   `npx vitest run web/test/acceptance-list.test.ts --cache=false --fsModuleCache=false --configLoader=runner`

   **RED: 10 failed, 45 passed.** R1 failed on parsed/rendered body content: paragraph became code, checkbox became code, or leading spaces appeared in code. R2 failed on the exact injected `[ ] ` and revision increment. These were behavior failures, not setup/import failures. Original commands SHA-256 matched the independent review: `0526fed93c1d4d825a8ccdfcfa6c84a9a49013196f5f965c42e608b7a69f0986`.

2. The initial correction passed all 55 cases. A private in-memory esbuild `write: false` probe then checked nearby narrowed-marker container/tab cases against installed markdown-it body tokens. It exposed tab-stop versions of R1. Added four tab fixtures, each with plain and BOM/mixed-EOL forms, before the tab-gap correction. Ran the same focused command with `-t 'tab'`: **RED: 8 failed, 1 passed, 54 filtered out**; after correction **9 passed, 54 filtered out**.

3. Added seven container controls: quoted descendants, nested owner, simultaneously selected parent/child, partial tab dedent, literal code quote, fenced code with a later paragraph, and lazy continuation. Initial control assertions incorrectly treated adjacent-list merging as a failure and included a non-1 ordered marker without the blank line required to begin that nested list. Corrected the fixture and compared per-item subtrees instead of separate outer list wrappers. These test-authoring corrections required no product changes.

4. Final post-cleanup execution:

   `npx vitest run web/test/acceptance-list.test.ts web/test/session.test.ts --cache=false --fsModuleCache=false --configLoader=runner`

   **GREEN: 2 files, 94 passed, 0 failed, 0 skipped** — 70 list cases (the original 45 unchanged plus 25 additions), and all 24 existing session cases including closed S1/S5. `npm run typecheck` also exited **0** after the final code/test changes. No full-suite or shared-build run was performed.

The 16 R1 semantic cases assert installed Markdown grammar node types and markdown-it logical body content/rendering, exact encoded source, BOM/EOL metadata, unchanged outside bytes, no newline-spanning patches, one initial commit/history event, byte-identical undo and redo, and replay of each edit/undo/redo commit against its corresponding snapshot. Task rendering additionally uses the production renderer. The two R2 cases each exercise six combinations (plain/mixed-EOL × default/explicit bullet/explicit ordered marker), asserting byte-identical no-op and no commit/history.

## Evidence locations and hashes

Private local evidence, outside shared build output:

- `/private/tmp/ac2-fixround1.ie65g0/red.log` — initial exact-reproduction RED.
- `/private/tmp/ac2-fixround1.ie65g0/green.log` — final 94-test GREEN.
- `/private/tmp/ac2-fixround1.ie65g0/typecheck.log` — final no-emit typecheck.
- Original owned-file copies in the same private directory support scoped file comparisons. The tab RED/GREEN outputs and in-memory probe output are in the tool transcript; no probe bundle was written.

Final source/test SHA-256:

```text
db4ffbb0383f98bd86c01395b8939298a70910f5148a44a9eec0a8a6582c431c  web/src/editor/commands.ts
21006be7dccd9f1cc2a12128bd7b254061683d9b7315ccca22ff9f577550abd9  web/test/acceptance-list.test.ts
```

Read-only dependency snapshot at final verification:

```text
6ce10de85659f9ce5976ca21ef4bedba86b5530f36932f31cdbddaf93eaea877  web/src/editor/session.ts
5ed5510266da4e259610df90b24c8e4b76d4a32bb2627c1fe26219e23754bbec  web/src/editor/source.ts
f3010ab2c6a425fb3098fb761d1a629ef33516d452192a45ad0d350a765e697a  web/src/editor/history.ts
a569d7d1e8529330e8ec23fbe6eb62c048b4febccdf669051c2d68aa248d44a5  web/test/session.test.ts
```

Session changed concurrently from the original review snapshot; this round did not write it. No whole-workspace immutability claim is made.

```text
9626645f4335320bfeaa54a9de1e35986046ecfe430423432a389737a052ca61  red.log
01fcc2eff7137807fddf0ce0a0f0ea17ba24f1d3491251797dcbaaf696421a21  green.log
1fc307878d27824dafdf5b4e7ab3c477bc3927e69a5dfa318dd075a4e0235b21  typecheck.log
```

## Acceptance boundary

This is implementer evidence for the two reviewed AC2 defects and nearby local grammar cases, not independent approval or exhaustive Markdown conversion coverage. Independent re-review is still required. The controller owns the final build and native UI/menu/selection/save verification; neither browser/native UI nor application publishing was exercised here. No V1 acceptance is inferred.
