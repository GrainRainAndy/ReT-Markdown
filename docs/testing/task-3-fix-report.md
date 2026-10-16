# Task 3 fix round 1

2026-10-15. Read `docs/testing/reviews/task-3-review.md` before changes. All reproduced findings S1–S5 addressed within Task3 ownership. Architecture, source codec, protocol, renderer APIs, styles and live implementation were not rewritten. No subagents or Git operations.

## Fixes

- **S1 — descendant indentation:** Commands use Markdown ListItem source ranges to include the selected item's descendants and continuation lines. Indent moves the subtree together; outdent removes the root's actual indentation uniformly. An outermost item does not lose its child's indentation. Following siblings and existing mixed EOL metadata remain unchanged; one undo restores identical bytes.
- **S2 — fenced code boundaries:** Code Block inserts only the necessary line separators before its opening fence and after its closing fence. It preserves the selected original text and surrounding prose, including original EOLs. Tests cover an inline selection and a collapsed paragraph-end caret, inspect the fixed renderer's actual fenced code output, and verify exact source plus one-step undo.
- **S3 — reference conversion context:** Plain/rich conversion prepends document LinkReference definitions as invisible parsing context to the selected fragment. Definitions keep document order/first-definition precedence and are omitted by the existing renderer helpers. Default source copy remains exact. Tests cover full, collapsed and shortcut reference links and reference images, local capability resolution, HTML anchor/image output, plain fallback, unchanged revision and no undo event. Renderer helper signatures and implementation remain unchanged.
- **S4 — capability identity:** The resolver looks up the exact destination supplied by the renderer before attempting the percent-decoding fallback. Distinct literal-percent and space filenames resolve to their own opaque capability even when both keys exist. Native insertion continues to preserve existing percent escapes. The test inserts plural native destinations and renders them with a load-supplied map, then refreshes capabilities with setAssets and confirms unchanged source/revision.
- **S5 — Enter in code:** List continuation/empty-item exit now requires an actual Markdown ListItem context and excludes fenced/indented code ancestors. Tests cover unordered-looking, numbered-looking and empty-marker code content in both code forms, inherited EOLs and byte-identical undo. Existing unordered continuation and added ordered/task continuation checks remain green.

## Live factory integration

`main.ts` now imports `liveExtensions` from `./live/decorations`. Bootstrap calls `transport.installLiveExtensions(liveExtensions)` immediately after transport creation, before assigning `window.retEditor`, dispatching preview load, or the queued ready event. Native load therefore constructs the root session with the real Task4 factory. The independent createTransport test helper remains injectable as before.

The cached Chromium check verifies that the actual bootstrap produces `.cm-live-strong` and hides the `**wired**` source markers when live mode is active. It also retains the original local-file/native receiver, real typing, byte-preserving undo, plain paste, focus/settings, zoom, composition barrier and atomic native multi-image checks. Zero HTTP(S) requests and zero page errors were observed.

## Actual RED → GREEN evidence

First focused run after adding regressions, before production changes:

```text
npx vitest run web/test/session.test.ts web/test/clipboard.test.ts web/test/transport.test.ts
14 failed, 28 passed (42 total).
```

The 14 failures reproduced S1 (2 subtree cases), S2 (2 fence cases), S3 (6 reference cases), S4 (1 wrong-capability case) and S5 (3 code-marker cases). The initial rendered-prose assertions incorrectly expected Markdown to retain paragraph-edge spaces in HTML. Those assertions were corrected to standard renderer output, while exact source assertions separately verify that the spaces and original terminators are preserved.

Final checks:

```text
Focused session/clipboard/transport: 42 passed across 3 files.
npm run typecheck: PASS.
Private buildWeb({outdir}): PASS, /private/tmp/ret-task3-fix-ENQ5yD.
RET_EDITOR_WEB=/private/tmp/ret-task3-fix-ENQ5yD node web/test/session-browser.mjs: PASS.
npm test: 166 passed, 1 skipped across 9 files; no failures.
```

Chromium used the already cached executable and an approved sandbox escalation. Only the private temporary output directory was built. Shared `build/web` was neither rebuilt nor published; the controller retains sole publishing ownership.

## Exact files changed this round

- `web/src/editor/commands.ts`
- `web/src/editor/clipboard.ts`
- `web/src/main.ts`
- `web/test/session.test.ts`
- `web/test/clipboard.test.ts`
- `web/test/transport.test.ts`
- `web/test/session-browser.mjs` (private output path option plus actual live-bootstrap assertions)
- `docs/testing/task-3-fix-report.md`

No unresolved S1–S5 finding remains in these checks. Native IME/OS clipboard, packaged WKWebView behavior and other native acceptance gates remain controller-owned. Ready for review and the controller's integrated build; no waiting for other tasks is required.

## Round 2 — S3-R1 multiline/container reference context

Read `docs/testing/reviews/task-3-fix-review.md` first. This round addresses only the remaining S3-R1 finding. S1/S2/S4/S5, main/bootstrap, session/history, source/protocol, renderer files and shared build outputs were not changed.

Replaced raw Lezer LinkReference source-range extraction with MarkdownIt's parsed `env.references` table. MarkdownIt's block parser handles quote/list container prefixes, destination continuation lines and multiline titles before producing semantic href/title values. The parser uses the renderer's existing link validation policy and retains only the first definition of each normalized label. Conversion context serializes these parsed definitions without original container prefixes; backslashes, HTML entities, quotes and title newlines are escaped to preserve URL/title semantics on the existing renderer helper's second parse. This is parsed-definition serialization, not a regex guess at source lines. Default source copy returns before context construction and remains exact.

No public renderer API changed and `web/src/render/markdown.ts` was not modified. Parsing/conversion performs no resource fetch. Clipboard conversion still uses the existing plainText/richClipboard helpers and local image resolver.

Actual RED:

```text
npx vitest run web/test/clipboard.test.ts
5 failed, 11 passed (16 total), before production changes.
```

The failures reproduced both reviewed blockquote definitions (continued title and continued destination), contamination of unrelated ordinary-text copy for each definition, and a nested quote/list definition with duplicate-reference precedence plus escaped URL/title values.

GREEN:

```text
npx vitest run web/test/clipboard.test.ts: 16 passed.
npx vitest run web/test/session.test.ts web/test/clipboard.test.ts web/test/transport.test.ts: 47 passed.
npm run typecheck: PASS.
```

Regressions assert exact default source copy, plain `label`, rich anchor destination/title and text fallback, no visible definition/title/blockquote leakage, unchanged source/revision/history, unchanged unrelated ordinary copy, all six previous reference-link/image variants, and first-definition/escaping semantics. No browser rebuild was necessary for this pure conversion correction; no shared or private build output was written this round.

Latest full `npm test`: **176 passed, 10 failed, 1 skipped** across 9 files. All ten failures belong to the concurrently updated Task6 `web/test/export.test.ts > browser export source ranges` suite:

- reveals formula 24..242 after an atomic multiline HTML comment (R6-1)
- keeps a following formula aligned after HTML element
- keeps a following formula aligned after task list
- keeps a following formula aligned after table
- keeps a following formula aligned after reference definition
- reveals the containing task list for nested formula overflow after HTML
- reveals the containing table for nested formula overflow after HTML
- reveals the paragraph for a real host image decode rejection after HTML
- reveals the task list for a real host image decode rejection after HTML
- reveals the table for a real host image decode rejection after HTML

These are export source-range failures outside this round's ownership; Task3 did not change export code or tests. The previous round's full-suite green snapshot is historical and is superseded by this latest concurrent-workspace result.

Exact files changed in round 2: `web/src/editor/clipboard.ts`, `web/test/clipboard.test.ts`, `docs/testing/task-3-fix-report.md`. No subagents, Git, renderer writes or shared build writes. S3-R1 correction is ready for independent re-review and controller integration.
