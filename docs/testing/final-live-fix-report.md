# Final live integration fixes — FR-1 / FR-2 / FR-4

Date: 2026-10-15. Review: `docs/testing/reviews/final-review.md`. The three assigned live integration findings are fixed with focused RED/GREEN evidence. FR-3/native resource discovery remains controller-owned and was not edited here.

## Files changed in this round

- `web/src/live/decorations.ts`: contextual inline/link projection; link destinations attached to original source spans; image widgets consume document-context HTML and include that HTML in equality; parsed contexts cached by CM document identity and invalidated by definition-only edits.
- `web/src/live/links.ts` (new): scoped root-view capture handlers for explicit Cmd-click, including anchors inside rendered table widgets; matching native HTTP/HTTPS/mailto policy; no WebContent navigation; ordinary clicks retain caret/cell editing.
- `web/src/live/code-highlighting.ts` (new): bundled JavaScript/Python/JSON language selection, language-scoped syntax token classes and actual palette-variable colors; unknown languages have plain fallback.
- `web/src/editor/session.ts`: **authorized highlighting/link-handler scope only**. Configured existing Markdown fenced-code support with the new language selector, installed syntax highlighting, and replaced the old unconditional anchor-click handler with the scoped link-opening plugin. Source/history, composition, commands, persistence, modes and session APIs were not rewritten.
- `web/src/render/markdown.ts`: **new pure context helper only**, documented below; existing renderer/table/block/clipboard APIs and grammar rules remain intact.
- `web/test/final-live-context.test.ts` (new): shared context/reference/UTF-16 issue-offset and unsupported-destination unit regressions.
- `web/test/final-live.spec.ts` (new): ten focused Chromium/real-CM/production-transport regressions.
- `web/test/final-live-browser-harness.ts` (new): production `createTransport` + existing factory, captured protocol envelopes, exact encoded-byte inspection and supplied browser image capabilities.
- `docs/testing/final-live-fix-report.md`: this report.

`web/test/editor.spec.ts` and all closed L1–L4 tests were retained unchanged and run with the new suite. No main, native, root configuration, renderer CSS, shared `build/web`, app publication, dependencies, Git or subagents were changed/used. Browser bundling uses esbuild `write:false`; the full suite's build tests use their existing private temporary outdirs. The controller alone publishes the updated sources.

## FR-1 — actual live link opening

Link spans now resolve destinations using the renderer's complete document reference context. Source positions still come from normalized UTF-16 spans; no rendered DOM is used to infer source coordinates. Inline and reference destinations are stored on the marked span, including after a reference-definition-only edit.

The session's root-view link plugin captures Cmd-left-click before CM/cell selection handling, prevents navigation and selection side effects, and calls the existing `EditorOptions.openLink` path. This reaches production `createTransport` and emits the existing `{type:'openLink',payload:{url}}` envelope. The test checks protocol version, document/session identity and exact URL, including query ampersands, percent-encoded text and fragments. HTTP, HTTPS and mailto are allowed, matching the existing native `EditorBridge` allowlist; unsupported schemes and relative targets emit no open message. The native validator was read and left unchanged, and remains the final authority.

Ordinary clicks do not open URLs: body links reveal/edit source, and rendered table anchors focus the cell rather than navigating WebContent. Capture handles widget/nested-mini-editor anchors without relying on CM's parent event ownership. During root composition, opening is blocked. Link interaction adds no content/history event; the root view is retained.

## FR-2 — body image reference context

Images use the original configured parser's image tokens in their complete document environment. This covers full `![x][pic]`, collapsed `![pic][]`, shortcut `![pic]`, and continued definitions. The original image token preserves source mapping through stripped container prefixes and reference resolution.

Widget equality includes rendered contextual HTML, so changing a definition outside the image span replaces the inactive projection appropriately. The state field caches contexts only while the immutable CM document remains identical; selection-only changes reuse them. Existing composition mapping keeps marked DOM intact. Capability reconfiguration reinstalls the factory through the existing integration.

Each reference form is tested against full-document renderer output with a supplied local raster capability, then a missing-local definition, then a remote definition. The remote result is a placeholder with zero image elements and no HTTP(S) request. Definition undo restores exact original BOM/mixed-EOL bytes. Reveal/re-hide selection changes add no source edits or revision/history events.

The continued-definition browser case verifies the live renderer consumer with a supplied browser capability; it is not a native scanner/capability-discovery proof and does not claim to close FR-3.

## New pure context helper

Added to the already configured renderer module without changing existing APIs:

```ts
interface InlineContextResult extends RenderResult {
  href: string | null;
}

renderInlineContexts(
  source: string,
  ranges: readonly { from: number; to: number }[],
  options?: RenderOptions,
): InlineContextResult[];
```

Ranges use original UTF-16 coordinates. The helper parses the document once with the same private configured `md` and `createEnv`, retaining reference definitions. For an exact original image range it renders the already parsed image token. Other requested inline fragments use the same `md.inline` grammar with the document references and explicit original offset mapping, rather than a second Markdown grammar. Results contain inline HTML, exact original issue ranges, and an outer link destination where the renderer retains a usable href. The existing file-link rule removes file hrefs before extraction; native-scheme filtering is additionally enforced by the link handler. Invalid range bounds are rejected. The helper does not load files/network or write/serialize source.

The unit proof includes an astral prefix, CRLF source, a reference link with ampersands, a continued image definition and its exact original error range. Existing `renderTableCells`, `blockSourceRanges`, render/clipboard APIs and R1–R3 mapping/security/math behavior are unchanged.

## FR-4 — real code tokens and visible colors

The existing root Markdown language now selects eager bundled JS (`javascript`, `js`, `jsx`, `mjs`, `cjs`), Python (`python`, `py`) and JSON (`json`) parsers for fence info. No dynamic language download or second CM view/history is introduced. Unknown fence info returns null and retains plain code.

Language-scoped highlighting differentiates keywords, strings, numbers/literals, properties and comments. A scoped CM base theme supplies the renderer palette variables with matching fallbacks; token classes alone were not accepted as visible highlighting. Existing source editor state/history and mode compartments remain the same.

Real CM proofs for JavaScript/Python/JSON check number/string/keyword token DOM, actual computed number/string colors, typing `42` → `43`, source/live mode changes and exact byte undo. The transport emits one edit then one undo. A separate `js`/unknown-language control checks plain fallback, then synthetic composition in a highlighted code line: the marked text node is retained, committed source remains unchanged until the barrier ends, and one root commit/undo restores the source.

## RED / GREEN evidence

1. `npx vitest run web/test/final-live-context.test.ts`: initially **2 failed / 2** because the required context export did not exist. After implementation both passed with actual HTML, href and original issue-range assertions.
2. `npx playwright test web/test/final-live.spec.ts --workers=1 --reporter=line --timeout=12000`: initially **10 failed / 10** against the unchanged implementation. Both link tests produced no real transport open message; all four reference-image forms had no image; the three language tests and unknown-language control had no syntax tokens.
3. After contextual consumers, capture handlers and language support were connected, the ten browser tests passed.
4. An added visible-color regression then failed on JavaScript `42`: actual `rgb(36, 41, 47)` body color versus expected number color `rgb(152, 104, 1)`. Local CM implementation inspection confirmed explicit HighlightStyle classes bypass color generation in the same spec. Token colors were moved into a scoped base theme; the computed-color checks then passed for all three languages. This failure was not hidden behind the earlier token-class pass.

## Final verification

- `npx vitest run web/test/live.test.ts web/test/tables.test.ts web/test/final-live-context.test.ts` — **26 passed**, 3 files.
- `npx playwright test web/test/editor.spec.ts web/test/final-live.spec.ts --workers=1 --reporter=line --timeout=15000` — **32 passed (13.0 s)**, including all original 22 live/table/F19/L1–L4 tests and the new 10 integration tests.
- `npm test` — **189 passed, 1 skipped (190)**, 10 files, exit 0. Renderer, export mapping, source, clipboard, session and transport tests remain green.
- `npm run typecheck` — passed with no diagnostics, exit 0.

All new browser tests fail on captured page/console errors or unexpected HTTP(S) resource requests. They import and use the production `createTransport`; the openLink assertion is on its actual v1 messages, not a replacement `openLink` mock. Their image capability fallback is supplied test data and is not a native asset-discovery simulation counted as native success. Existing root integration in `main.ts` is sufficient; no main changes are required.

## Limits retained

- Actual `NSWorkspace` external-browser opening and native scheme rejection remain controller GUI/native acceptance. The web tests prove the exact existing transport boundary, not an OS browser launch.
- FR-3/native continued-definition resource discovery is outside this patch. No native files were edited.
- Real WKWebView Chinese candidate selection/deletion/cancellation, Cmd-S during preedit and native T04/T05/T21 remain outstanding acceptance work. Synthetic composition in real CM is **not native IME proof**.
- The controller must publish/rebuild the app before checking these changes in its GUI. No shared bundle/app publication or native Release/visual/performance pass is claimed here.
