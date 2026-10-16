# Offline renderer task report

Date: 2026-10-14. Scope: Task 1 of `docs/plans/2026-10-14-rendering.md`, with the linked requirements and visual baseline read first. Renderer work is ready for main's separate review. No subagents, Git initialization, or commits. No fixture generator, fixture data, architecture, editor, or native source was edited.

## Delivered behavior

- Pure `renderMarkdown`, `plainText`, and `richClipboard` exports with the specified TypeScript interfaces. Rendering reads no files or network and never rewrites source. Issues use original UTF-16 offsets, including CRLF input, astral Unicode, repeated formulas, nested blocks, reference images, and escaped-pipe table cells.
- CommonMark headings/paragraphs/lists/quotes, GFM tables/alignment/tasks/strikethrough, reference links/images, escaped unsupported HTML, known-language highlight.js highlighting and safely escaped unknown languages.
- Inline/display KaTeX with `trust:false`, finite expansion/size limits, literal source and understandable diagnostics for invalid/unclosed formulas. Math and image syntax inside raw HTML stays inert. Code spans/fences and escaped dollars are not math.
- Remote image placeholders retain the URL without `<img>` or export-blocking issues. Local images require the supplied resolver; Chinese and percent-encoded space paths are decoded. Missing/resolver-failed images retain paths and exact source ranges. Resolved HTTP(S), protocol-relative, and network-authority `file://host` URLs are rejected. Local `file:///`, `file://localhost/`, `ret-resource://`, local-origin blob URLs, and raster image data URLs are accepted. Host capability and SVG validation remain native responsibilities.
- Plain text preserves readable block/list/table structure and unclosed formula source. Rich HTML embeds independently authored typography/palette CSS and a light-colored inline wrapper; formulas use self-contained MathML, with TeX text fallback. The caller may supply portable local image data URLs through the existing resolver interface.
- Independent typography, palette, print and font CSS. F19 declarations include 16px/1.6, the exact font stack, border-box 860/1024/1200px container breakpoints at 1400/1800px, 30px padding and 100px bottom space, heading sizes/line heights/borders, block spacing, list indentation, quote/table/code declarations. Dark mode changes colors while retaining geometry. Print is 13px and white, with zero container padding, A4 portrait, wrapping code/table cells, repeated table headers, heading break constraints and short-code preservation hints. Native owns the physical 20mm margins.
- Pinned npm manifest/lockfile includes the later CodeMirror dependencies and requested jsdom. `npm run build:web` chooses `web/src/main.ts` when it exists, otherwise `render-entry.ts`, and emits reusable `renderer.js` plus offline resources in `build/web`. `copyRendererResources(outdir)`, `selectEntry(directory)` and `buildWeb({outdir,entry})` are exported from the build script and typed in its declaration file. The build does not erase the output directory or touch `build/fixtures`.
- Four offline Open Sans Latin WOFF2 faces (400/700, normal/italic), all upstream KaTeX font formats, and full upstream license notices are copied from the pinned npm packages. No Typora implementation or theme source was copied. Chinese uses system fallback. Generated web resources occupied about 6.0 MiB at verification.

## RED → GREEN evidence

Tests assert real rendered output, source slices, copied build artifacts and browser computed layout; no renderer mocks.

| Stage | Observed RED | Observed GREEN |
| --- | --- | --- |
| Initial renderer behaviors | 21:28:43, empty interface scaffold: **16/16 failed**, including headings, GFM, highlighter, inert HTML, links/images, math, offsets and clipboard styling | Initial 16/16 passed at 21:34:34 |
| Build/resources and entry selection | 21:35:23, no-op build scaffold: **2/2 failed**, missing artifacts and main-entry preference | 18/18 combined tests passed at 21:36:15 |
| Raw HTML and unfinished formula copy | 21:38:06: **2 failed**, HTML attribute formula produced a spurious issue; plain copy dropped `$` | 21/21 combined tests passed at 21:38:55 |
| Local file image policy | 21:40:26: **2 failed**, explicit local file image stayed literal; network file authority became `<img>` | 23/23 combined tests passed at 21:40:57 |
| Short-code pagination | Isolated Chromium check: `breakInside` was `auto`, expected `avoid-page` | After conservative short-code hint, final browser run passed; long-code/table checks still passed |

The repeated-reference/escaped-table-pipe offset test passed immediately because existing mapping already handled it; it is additional regression coverage, not claimed as a new RED cycle. An early negative-only KaTeX safety test also passed on the empty scaffold; a positive KaTeX-output assertion was added and the full 16-test RED run repeated before implementation.

The first test invocation happened during dependency extraction and failed at runner startup with an incomplete native binding; this was an environment/setup error, not RED behavior evidence. Two initially overlapping npm installs caused runtime dependencies to be removed; serialized restoration from the cache restored all exact versions. npm 12 reported blocked esbuild/fsevents lifecycle scripts; esbuild's installed platform binary worked and all build checks passed without approving scripts.

## Final verification

Verified after the last renderer/style changes, approximately 21:42 CST; focused tests/typecheck were repeated successfully at 21:44:22:

- `npm run test:render` — **23/23 pass**, 2 files (`render.test.ts`, `build.test.ts`).
- `npm run typecheck:render` — **exit 0**, includes renderer, renderer entry, focused tests and Vitest configuration.
- `npm run build:web` — **exit 0**, generated `build/web` resources.
- `npm run test:browser` — **exit 0**, cached Chromium 1228, separate `web/test/renderer-check.html`. No application entry or CodeMirror root is loaded/overwritten. Checks widths 1000/1399/1400/1799/1800, exact font/padding/heading geometry, offline Open Sans and KaTeX loading, dark screen/white print colors, short-code preservation, long-code/table wrapping and fragmentation, and PDF generation with A4/20mm/no header/footer options. **Zero external requests, failed resource responses, or page errors**. PDF: `/private/tmp/ret-renderer-checks/overflow.pdf`.

The browser harness's loopback server initially failed in the sandbox with `listen EPERM: operation not permitted 127.0.0.1`. Running the same command through `tools.exec_command` with `require_escalated` succeeded. No runtime blocker remains for the renderer checks.

The resulting stress PDF was inspected directly: **121 page objects**, MediaBox `0 0 595.91998 842.88` points. Chromium quantizes its A4 output; this is not proof of the native requirement's exact A4 page box. Native output must be checked separately against 595.276 × 841.890pt. No assertion about PDF text extraction was made.

Root checks deliberately include all owners' files per controller request. The full-suite snapshot at 21:41:33 was **105 passing tests, 6 passing files, 1 failed suite**, not a full green result:

- `web/test/transport.test.ts`: unresolved `../src/main`; main.ts had not landed at that snapshot.

The full `npm run typecheck` snapshot reported:

- `web/src/export.ts:130` — nullable image issue array incompatible with `RenderIssue[]` (TS2322).
- `web/src/export.ts:139` — `RenderIssue` predicate broader than the inferred image-only element (TS2677).
- `web/test/transport.test.ts:3` — unresolved `../src/main` (TS2307).
- `web/test/transport.test.ts:10` — implicit-any callback parameter (TS7006).

Earlier broad snapshots also caught unfinished clipboard/session/source imports and a source-test tuple typing error. Those earlier failures were superseded by the above snapshot as other owners implemented their files. These are recorded, not suppressed or modified by this task. Root `npm test` and `npm run typecheck` retain broad includes (`web/test/*.test.ts` and `web/**/*.ts`); focused scripts isolate renderer verification while parallel owners finish. Main must rerun broad checks after integration.

## Versions

Node 26.11.1, npm 12.2.0; markdown-it 15.0.2, KaTeX 0.19.0, highlight.js 11.12.0, markdown-it-task-lists 2.1.1, Fontsource Open Sans 5.3.0; TypeScript 7.0.2, Vitest 5.0.4, esbuild 0.28.2, Playwright 1.64.1, jsdom 30.1.2. All direct dependencies are exact and integrity-pinned by `package-lock.json`; CodeMirror package versions are recorded there. npm external requests used explicit escalation and `/private/tmp/ret-markdown-npm`.

## Exact authored paths

Root/configuration: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.render.json`, `vitest.config.ts`.

Renderer/entry: `web/src/render/markdown.ts`, `web/src/render/math.ts`, `web/src/render/positions.ts`, `web/src/render/assets.d.ts`, `web/src/render-entry.ts`, `web/index.html`.

Styles: `web/styles/typography.css`, `web/styles/palette.css`, `web/styles/print.css`, `web/styles/fonts.css`.

Build: `scripts/build-web.mjs`, `scripts/build-web.d.mts`.

Tests: `web/test/render.test.ts`, `web/test/build.test.ts`, `web/test/render-browser.mjs`, `web/test/renderer-check.html`.

Report: `docs/testing/rendering-report.md`.

Generated paths: `build/web/index.html`, `build/web/app.js`, `build/web/app.js.LEGAL.txt`, `build/web/app.css`, `build/web/renderer.js`, `build/web/renderer.js.LEGAL.txt`, `build/web/styles/{typography,palette,print,fonts,katex}.css`, `build/web/fonts/open-sans-latin-{400,700}-{normal,italic}.woff2`, `build/web/fonts/KaTeX_*` (all files from pinned `katex/dist/fonts`), `build/web/licenses/{Open-Sans-OFL,KaTeX-LICENSE,markdown-it-LICENSE,markdown-it-task-lists-LICENSE,highlight.js-LICENSE}.txt`. Test-run build directories are temporary and cleaned up. Existing files owned by concurrent tasks are excluded from this authorship list.

## Rulings and remaining limits

- Direct shared-workspace edits, no Git/subagents, and a self-review replace the plan's generic subagent/worktree/commit machinery, as explicitly instructed. Main supplies the independent review.
- CSS is implemented from observed numeric declarations, not copied from Typora. Border-box interpretation gives net text widths 800/964/1140px at the tested breakpoints. If runtime Typora uses a different effective box model, visual comparison may require adjusting that interpretation.
- Rich clipboard uses embedded CSS, light inline body styles and MathML rather than relative KaTeX font URLs. Actual destination applications may discard stylesheet rules or MathML and may not resolve native image capability URLs. The caller can supply raster data URLs; text fallback always remains. No Word/Pages clipboard acceptance test is claimed.
- A dollar followed by whitespace is literal text to avoid treating ordinary currency spacing as an unfinished formula. Other unclosed inline formulas are located to the line end; unclosed display blocks extend to their parsed block end. Changing this delimiter policy would alter currency/partial-input feedback.
- Small code blocks are conservatively identified by at most 30 lines, at most 120 UTF-16 units per line, and at most 2400 units total; print requests `avoid-page` for these, while larger blocks allow fragmentation. This is a layout hint, not a native page-height measurement.
- Only supplied absolute offline image URL forms are accepted; arbitrary application schemes/relative resolver results require an intentional whitelist change. This protects against inheriting an HTTP base URL or loading a network file authority; native capability mapping should use `ret-resource://` or raster data URLs.
- Browser verification proves Chromium layout/resource behavior and PDF creation, not WKWebView pagination, native export cancellation/atomic replacement, Chinese PDF text extraction, or exact visual matching against Typora at runtime. Very wide indivisible formulas or single oversized table rows still require native export layout validation; pure rendering cannot measure page overflow. Native export must wait for resources and use returned local-image/math issues as blocking errors.

Final review: author self-review only, no independent reviewer dispatched. Main's separate review and native acceptance remain required.
