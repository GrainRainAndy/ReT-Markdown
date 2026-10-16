# Task 3 implementation report

Date: 2026-10-15. Scope: source-first root CodeMirror session, commands, clipboard, native transport, and editor/export build entry integration. No subagents, Git operations, renderer/style edits, or native implementation edits.

## Delivered

- One persistent CodeMirror state/history. Mode, appearance, zoom, read-only lock, and image capability updates preserve source and do not add undo events. Screen zoom uses 16px at 100%, 20px at 125%; 13px remains export CSS's responsibility.
- EOL StateField plus `invertedEffects` restores mixed CRLF/CR/LF metadata through grouped typing, atomic commands, undo and redo. BOM and absent final newline survive. Formatting inserts delimiters around existing source instead of rewriting multiline selections.
- Ordered committed revision stream including undo/redo; unacknowledged commits retained until acknowledged. Snapshots are defensive copies. During composition the barrier returns the last committed source/selection with `composing:true`; provisional CM text remains separate and emits one net commit on composition end. Mode/live reconfiguration waits for composition.
- Source-based formatting, three unordered list symbols, ordered/task-list continuation, indentation, find/reveal, replace and one-undo replace-all.
- Default source copy expands complete live inline selections to hidden delimiters; source mode copies exact selected source including original EOLs. Plain/rich copy uses renderer helpers, rich includes HTML and text fallback. Paste uses plain text and its original EOLs; image-only paste requests native assets.
- `setReadOnly {value:boolean}` blocks user/root/live edits and paste during Save As, rejects locking during composition, allows native `applyPatches` with `reason:'assets'`, and unlocks without a history event.
- `insertImage {destinations?:string[],destination?:string,alt?:string}` inserts supplied native destinations in one root transaction. Plural takes precedence; single is fallback; neither present requests the native chooser. Angle-quoted relative destinations preserve Unicode and encode spaces/control/angle characters; image separators inherit insertion-line EOL. Browser verification confirms supplied destinations never reopen chooser.
- Optional `load.payload.assets` and `command setAssets {assets:Record<string,string>}` replace the capability map only. Decoded destinations resolve through opaque `ret-resource://asset/...` entries; no `assetBase` concatenation. Asset refresh reinjects live extensions after composition.
- Stable live adapter in `editor/live-contract.ts`: `LiveExtensionFactory=(options:LiveOptions)=>Extension`; callbacks `getSource()`, `apply(patches,{selection?,userEvent?}?)`, `resolveImage(destination)`, `getMode()`, `composition():{composing,range}`. `createEditor` accepts optional fourth `EditorOptions`; `session.liveExtensions(factory)` and `window.retEditor.installLiveExtensions(factory)` inject the factory. Controller owns connecting Task4's completed factory; Task3 does not import an unfinished factory.

## Definitive native transport

Bootstrap before app script: `window.retEditorBootstrap={documentID,sessionID}`.

Call with structured arguments, never source interpolation:

```swift
try await webView.callAsyncJavaScript(
    "return await window.retEditor.receive(envelope)",
    arguments: ["envelope": object], in: nil, contentWorld: .page)
```

`receive(envelope):Promise<Envelope>` returns a version-1 reply with matching identities, a fresh web ID, and `replyTo` equal to the incoming ID. Messages have `{v:1,documentID,sessionID,id,type,payload,replyTo?}`. JS posts ready/commit/state/clipboardWrite/assetRequest/openLink through `window.webkit.messageHandlers.ret.postMessage`. `ready` posts after receiver installation. `load` initializes once; barriers respond with committed snapshots. Duplicate IDs share the original execution/reply; changed payload reuse, identity/version mismatches, stale asset bases, malformed source and unsupported types/commands are rejected.

Clipboard commands wait for the native result. Asset chooser/paste/drop requests return immediately after posting so native may enqueue a later insertion/asset patch without deadlocking its command queue. Native `resyncRequired` gets a committed snapshot reply; JS never adopts an older native mirror. Native's reconciliation barrier and acknowledgement of the returned snapshot ID release retained commits.

The offline browser fallback creates an empty source editor with the same receiver and standard clipboard capability. There are no tabs, sidebars, or toolbars.

## RED / GREEN evidence

Initial requested run `npx vitest run web/test/session.test.ts web/test/clipboard.test.ts` failed because the assigned session/clipboard modules did not yet exist. Subsequent behavioral RED/GREEN cycles:

1. Multiline bold formatting reproduced EOL corruption (`b\rc\n` became CRLF throughout). Replaced whole-selection rewrite with delimiter-only patches; exact raw-source and undo assertions now pass.
2. Computed zoom assertion reproduced 13px screen text at 100%. Changed screen base to 16px; 100%/125% assertions now pass at 16px/20px.
3. Native plural image test reproduced no insertion because the original command always requested the chooser. Added native destination insertion; plural precedence, Unicode/space encoding, inherited EOL, single fallback, alt escaping and one-step undo now pass.

The BOM test helper initially decoded with default `TextDecoder`, stripping the BOM in its assertion. Corrected the helper to `ignoreBOM:true`; byte comparisons remain strict and the production source codec was not changed.

Latest focused run:

```text
npx vitest run web/test/session.test.ts web/test/clipboard.test.ts web/test/transport.test.ts
3 files passed; 25 tests passed (session 14, clipboard 5, transport 6).
npm run typecheck: PASS.
npm run build:web: PASS (before controller's shared-output ownership restriction).
node web/test/session-browser.mjs: PASS with cached Chromium, local file:// bundle.
```

Chromium verifies classic app script boot, native bootstrap/ready, real keyboard input, shared undo with mixed EOL/BOM, pure-text paste, identical focused content DOM across settings, 16px/20px screen zoom, synthetic DOM composition barriers, atomic native plural image insertion with zero chooser requests, and zero HTTP(S) requests. Chromium required a sandbox escalation to launch; the approved rerun passed.

Latest full `npm test`: **128 passed, 1 failed, 1 skipped** across 9 files. The remaining failure belongs to Task4: `web/test/tables.test.ts > mapped table transactions > retains surrounding padding when an emptied cell is typed into again` (produces `|  x| right |` instead of `| x | right |`). Task3 does not modify Task4-owned table code. An earlier full-suite snapshot was 126 passed/1 skipped before that new regression test landed; the latest result supersedes it.

## Exact Task3-authored files

- `web/src/main.ts`
- `web/src/editor/history.ts`
- `web/src/editor/session.ts`
- `web/src/editor/commands.ts`
- `web/src/editor/clipboard.ts`
- `web/src/editor/search.ts`
- `web/src/editor/live-contract.ts` (explicitly added to scope for Task4's adapter)
- `web/src/protocol.ts` (only authorized post-Task1 amendments: internal `setAssets`, optional load assets map)
- `web/test/session.test.ts`
- `web/test/clipboard.test.ts`
- `web/test/transport.test.ts`
- `web/test/session-browser.mjs`
- `web/index.html` (classic deferred app script)
- `scripts/build-web.mjs` (classic IIFE editor/export bundles, generated `export.html`; renderer.js remains ESM)
- `docs/testing/task-3-report.md`

Renderer owner supplied jsdom and broader Vitest/TypeScript discovery before ownership transfer; Task3 did not modify those dependency/config files.

Build outputs: editor `app.js` + `index.html`; export `export.js` + generated `export.html` with shared CSS/fonts and restricted CSP; independent renderer `renderer.js` remains ESM. No further Task3 publishing to shared `build/web`: controller is the sole publisher following the reported concurrent-output issue. Focused browser reruns consume existing output; build tests use private temporary output directories.

## Boundaries and handoff

This proves the Task3 foundations for T03/T05/T06/T13/T22/T24, not completed live rendering/table acceptance or v1 acceptance. Real macOS WKWebView Chinese IME/candidate selection, native clipboard/image OS integration, Save As failure/cancel orchestration, PDF pagination and release performance gates require their owners/controller. Synthetic browser composition is not a native IME proof.

Controller can connect the completed Task4 factory via `window.retEditor.installLiveExtensions` or pass it in `EditorOptions`; no shared session writes are necessary. Native shell's structured receiver, bootstrap IDs, menu format argument shape, read-only object argument, capability map and snapshot acknowledgements were coordinated through the main controller. Task3 is ready for review and releases its thread slot without waiting for Task4 completion.
