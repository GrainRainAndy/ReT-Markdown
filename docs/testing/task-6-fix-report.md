# Task 6 scoped fix round 1 — R6-1

2026-10-15. R6-1 fixed and verified against the current shared workspace.

## Change and ownership

`web/src/export.ts` now imports `blockSourceRanges(source)` from the shared renderer. The independent `MarkdownIt({ html: false })` instance and its separately installed rules are removed. Export associates actual root DOM elements with ranges from the same configured grammar that rendered them. Atomic HTML, task lists, tables, math and non-rendering reference definitions therefore agree. Decode/layout diagnostics retain the enclosing root block range; renderer-reported inline errors retain their precise ranges. Existing public export interfaces are unchanged.

Main coordinated the helper with Task4 owner Parfit (`01a13aa7-c81c-79f0-a062-faa7acfa9125`). Parfit added the pure `blockSourceRanges` export in `web/src/render/markdown.ts`, using the existing configured `md.parse(source, createEnv(...))`, mapped level-zero opening/standalone tokens, normalized line starts and `env.offsets` for original UTF-16/CRLF coordinates. This task did not write that file or add a second parser/module/API alias.

This task wrote only `web/src/export.ts`, `web/test/export.test.ts` and this report. No Git operations, new agents, root edits, shared build outputs, Swift print/CJK/atomic-writer edits or native PDF regeneration were performed. Existing 5-page/27-page native proofs remain historical evidence for their original inputs.

## Regression coverage

Ten new tests call production `prepareExport` and `browserExportHost` with a local jsdom document:

- Exact review trigger: `<!--\nfirst\n\nsecond\n-->\n\n` followed by the 218-unit wide formula. Overflow must reveal **24–242**, not comment fragment **12–23**. The snapshot remains unchanged and HTML remains literal/inert.
- Formula positioning after a multiline HTML element, an HTML comment plus task list/table, and a non-rendering reference definition.
- Nested formula overflow reveals its containing task list/table after HTML.
- Actual host image-decode rejection reveals its paragraph/task-list/table after HTML. Only the image's decode operation is substituted; production issue collection and range lookup run unchanged.

The local DOM harness substitutes geometry and font readiness, and does not claim to prove physical layout or pagination. It stays local to these tests so esbuild and Playwright retain their Node environment. The existing opt-in Chromium test now uses the exact HTML-plus-wide-formula trigger with real geometry. It also checks offline fonts, image decoding, print wrapping, long-block fragmentation and zero HTTP(S) requests for the successful/formula fixtures. Resource copying and bundle output use a unique `/private/tmp/ret-export-browser-*` directory rather than consuming `build/web` resources.

## RED → GREEN evidence

Logs are in `/private/tmp/ret-task6-fixround1/`.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Focused RED | 10 new tests failed, 11 existing passed, 1 opt-in skipped. Exact trigger returned 12–23 instead of 24–242. | `red-focused.log` |
| Real Chromium RED | Exact trigger returned 12–23 instead of 24–242 with actual layout. | `red-browser-elevated.log` |
| Focused GREEN | 21 passed, 1 opt-in skipped. | `green-focused.log` |
| Real Chromium GREEN | 22 passed, including the exact 24–242 regression and existing readiness/layout checks. | `green-browser.log` |
| Full Web GREEN | 9 test files passed; 187 passed, 1 opt-in skipped. Build tests use their own temporary output directories. | `green-full.log` |
| Focused typecheck | Exit 0, export/entry/tests plus transitive renderer dependencies. | `typecheck-focused.log`, `tsconfig.focused.json` |
| Full typecheck | Exit 0. | `typecheck-full.log` |

Commands, run from the repository root:

```sh
./node_modules/.bin/vitest run web/test/export.test.ts --cache=false
RET_EXPORT_BROWSER=1 ./node_modules/.bin/vitest run web/test/export.test.ts --cache=false
./node_modules/.bin/vitest run --cache=false
./node_modules/.bin/tsc --noEmit --project /private/tmp/ret-task6-fixround1/tsconfig.focused.json
./node_modules/.bin/tsc --noEmit
```

The sandbox initially prevented Chromium from launching; approved elevated runs supplied the real-browser RED/GREEN evidence. An initial whole-file jsdom environment caused an esbuild TextEncoder invariant failure; the final tests use a local jsdom instance and the real browser test passes. Initial full typecheck also observed two unrelated nullable `rich.html` errors at `clipboard.test.ts:91`; their owner fixed them during this round, and the final full typecheck passes. A temporary focused tsconfig initially lacked type roots; its final version explicitly resolves the repository's Node type definitions.

The first cross-task coordination message was rejected by automatic approval review as conflicting with “no subagents” and having an unverified destination. A reduced request citing the user's express main-coordination authorization was accepted; main then supplied Parfit's exact task ID and confirmed the final helper contract. No agents were spawned and Task6 never concurrently wrote the renderer file.

Fresh Chromium evidence establishes browser source localization and preflight behavior, not WKWebView pagination or native PDF geometry. Those native paths were outside this scoped fix and were not rerun.
