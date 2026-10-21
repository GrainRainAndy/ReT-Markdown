# Task 2 — minimal native integration checkpoint

Status: **partial Task 2, runnable vertical checkpoint**, not the completed E01–E45 task. Controller explicitly requested a commit and pause here to implement/review native lifecycle fixes and run actual WKWebView/IME QA before continuing structural workflows. Product code commit: **6516701** (`feat: connect structured editor to source transactions and native host`). No native, core, syntax, fixture or controller document files were edited.

## Run / integrate

- `npm run build` produces `dist/web/index.html`, `main.js`, `main.css`, KaTeX CSS/fonts and source maps. Offline application entry is exactly `dist/web/index.html`.
- `npm run dev` serves the browser fallback at `http://127.0.0.1:4173`.
- Existing `scripts/build-app.sh` consumes `npm run build`; controller can now build/open the isolated `ReT Markdown Preview.app` and perform real WKWebView QA. This checkpoint did not itself build/sign or launch the native app.
- `npm run test:browser` uses fresh Playwright 1.64.1 + matching Chromium 1248. The initial cached Chromium 1228 was not silently substituted. Browser install used standard approved network escalation.

## Actual implemented behavior

- Genuine ProseMirror document schema and editable view: paragraphs/headings, inline strong/emphasis/strike/code/link presentation, lists/quotes, table cells, literal and raw nodes, gap positions. Typing goes through local source patches, never whole-document Markdown serialization. Plain candidate `*` remains editable while typing; completing `**bold**` renders strong. Text-only PM changes within a textblock are registered; unsupported structure changes enter explicit RecoveryDraft.
- CodeMirror 6 full source and embedded code/math/raw literal editors, standard navigation commands, no component history extension. Literal Enter inserts the current EOL; explicit two-space Tab; closed-fence tail typing preserves a required closing-fence separator. Code/math Cmd+Enter requires empty selection, true tail and closed fence; unclosed syntax displays a message without content/history mutation. Source preserves BOM and CRLF and remembers its initial newline style even after all old newlines are removed.
- Root undo/redo, initial paragraph Enter/Backspace/Shift+Enter, editable gap Enter, basic list/quote continuation and top-level empty-item exit. Source-mode switches retain logical source offsets and do not generate content revisions. Literal/source changes use the same DocumentSession root history.
- Initial Chinese status bar, lightweight mode button, system/light/dark colors; 16px/1.6 body, 860px maximum width with 30px padding and 1024/1200 responsive widths. No sidebar/tabs/format toolbar.
- Host ready/load, checkpoint, checkpointAck, flush/flushResult, saved, command, appearance, error, prepareExport/exportContent. Outgoing revision is `load.revision + session.revision`, including flush/export/recovery baseRevision. Optional load.savedSource is consumed to keep recovered dirty source dirty. No initial checkpoint is emitted merely for loading/switching modes.
- `window.retNative.receive` is the sole production entry point. Browser tests simulate WebKit's real message handler using addInitScript and inspect its emitted envelopes; no privileged test-only application API exists.
- RecoveryDraft persists actual visible JSON/text and optional recovery source, blocks flush/commands and editing behind its panel, provides editable full-source recovery and explicit discard, and resolves changed content through `checkpoint.resolvesRecoveryDraft=true` without clearing first. Explicit no-op resolution/discard sends `recoveryDraft(null)`.
- Composition defers root edits/commands and protects the active input DOM until end; pending flush returns a reason. This is a **browser-level preliminary lifecycle**, not proof of real macOS IME correctness. Microtask settlement after actual compositionend requires native observation for final input ordering.
- Independent source-snapshot export renderer escapes raw HTML, excludes remote images, allows only safe external link schemes, encodes local `ret-asset://document/` image paths, includes print CSS/A4 rules and trusted-off bounded KaTeX. prepareExport echoes requestId and honors an explicitly supplied source/revision, never reads editor DOM. Native must freeze local resources/fonts using its export job. Live math rendering and image presentation are not yet complete.
- Browser-only fallback starts with an empty memory document; open/download actions are development fallbacks and do not mark content saved merely because a download was requested.

## Interfaces / implementation notes

- `surfaces/editing.ts`: `logical`, `newlineAt`, grapheme-safe `minimalPatch`, `replaceIntent`, `enterIntent`, `backspaceIntent`; `Intent = {patches,selection}`. Offsets remain source UTF-16.
- `surfaces/projection.ts`: `schema`, `RichProjection(source,previous?,patch?)`; `doc`, `projection`, `records`, `sourceAt`, `positionAt`, `literalAt`. Semantic inline leaves carry PM-to-source mapping; hidden source offsets clamp only for presentation, while root bookmarks retain their exact offset. Display IDs reconcile same-type mapped source ranges and unchanged raw content or the active affected range; this is an initial reconciler, **not yet a fully reviewed parent/subtree split/merge identity algorithm**.
- `surfaces/literal.ts`: `LiteralEditor` owns a CM view with source/range callbacks, root change/selection/command callbacks, composition/failure callbacks and optional literal boundary key handler. Its view lifecycle is owned by mode switching or PM node views. CM update-loop refresh is deferred by microtask, not a fixed composition timeout.
- `surfaces/rich.ts`: `RichSurface` owns PM and literal node views, local conversion and recover hooks. Structural key handling reads the live DOM selection before using source coordinates, fixing the observed native selectionchange scheduling gap in fast browser key sequences.
- `protocol/host.ts`: `Envelope`, `RecoveryDraft`, `HostBridge`. Incoming method/payload envelopes get basic version/type/identity validation; detailed per-command schemas and pending-load policy need the next pass.
- `render/document.ts`: `escapeHTML`, `assetURL`, `mathHTML`, `printCSS`, `renderDocument(source)`.

## RED → GREEN and validation

1. Initial `npm run test:browser` could not bind the sandbox port; standard escalation resolved it. Next run could not find Chromium1248; matching browser installation resolved it. These environment failures are **not** counted as feature RED.
2. Actual empty-shell browser RED: 5/5 tests failed because no PM surface, CM literal or RecoveryDraft dialog existed. Captured command: `npm run test:browser` (exit 1).
3. Pure intent/render tests initially failed module import before implementation (recorded separately as missing-module RED, not behavioral assertion failures). They then passed with literal hand-checked expectations.
4. Connected browser pass first exposed a hidden-source bookmark out-of-range error, candidate-marker rendering failure, live selection synchronization failure and absent CM navigation keymap. Source mapping clamp/candidate representation, live DOM key synchronization and the standard CM command keymap fixed these. A stronger source test observed LF instead of expected CRLF after all original newlines were replaced; initial EOL preference fixed that. Standard CM Mod+Enter initially overrode the unclosed-fence refusal (unexpected source newline); high-precedence literal boundary handling fixed it.
5. Final checks at 2026-10-21 17:35 local:
   - `npm test`: **89/89 passed**, 4 files, exit 0 (includes all 82 existing core tests).
   - `npm run typecheck`: exit 0.
   - `npm run build`: exit 0, offline assets produced (6.7 MiB including fonts/maps).
   - `npm run test:browser`: **8/8 passed**, exit 0, including strengthened exact original code bytes after cross-mode root undo.
   - `npm ls --depth=0`: exit 0; exact versions resolve.
   - `git diff --check`: exit 0.
   - Fresh install/audit after override: **0 vulnerabilities**. Optional fsevents/esbuild install scripts remained blocked; esbuild's packaged platform binary built successfully.

Browser coverage: paragraph split/merge+undo/redo and untouched neighbor; 20 no-edit mode switches preserving BOM/CRLF/loaded revision and dirty baseline; typed bold Markdown; literal CRLF Enter/text with exact root undo across source mode; loaded RecoveryDraft flush barrier/atomic resolution; full-source CRLF edit+undo; unclosed fence CmdEnter refusal; synthetic composition pending, frozen export/request ID and wrong-document command refusal. These tests do not establish actual disk bytes or real IME.

Exact additions: PM model1.25.12/state1.4.4/view1.42.6; CM state6.7.6/view6.43.15/commands6.11.1; KaTeX0.19.0 and global override; esbuild0.28.2; Playwright1.64.1; @types/katex0.16.8; Prettier3.9.10. Existing core pins remain. Official KaTeX option docs were checked; PM/CM reference fetches returned403, so exact installed package types/source governed adapter API use.

## Remaining before final Task 2

Do not treat this checkpoint as E01–E45/G1 completion. Remaining implementation includes full list subtree indent/dedent and selection validation, Setext/heading commands, robust mark toggles and full/partial structural clipboard, grapheme deletion across all projections, literal cross-block direction/selection and empty-code details, live math source/render bookmark lifecycle, table navigation/row-column/rectangle/clipboard commands, image import/cancellation, find/replace, explicit source-recovery extraction for arbitrary PM JSON, robust structural patch validation and identity reconciliation. Current unsupported menu commands report a message. Tables render/edit simple text but their full workflow is pending.

Known integration points to assess while paused:

- Real WKWebView compositionend versus last input ordering, cancel/Esc, manual flush and mode-switch queue. No real IME success is claimed.
- Embedded CM input DOM/selection stability, paragraph rich input, root undo focus and native command delivery.
- Incoming load during composition/recovery is rejected by the app, but HostBridge currently adopts an otherwise valid new epoch before that app-level rejection; queued/rejected-load identity coordination needs correction in the resumed protocol pass. Native should not issue an unsolicited replacement while its flush barrier is pending.
- Source/PM conversion fallback retains a draft, but arbitrary JSON draft recovery currently presents the saved full source plus exact JSON evidence for explicit recovery; automatic raw-patch extraction is pending.
- Indented-code terminal-LF ownership and nested literal-prefix edits need additional tests before capability claims.
- Export references bundled `katex.css` and its fonts by relative URL; native export must load with the proper bundled base URL or inline/freeze them.

Paused at controller's requested sequential native integration boundary. Resume this same Task 2 work after native fixes and actual QA evidence.
