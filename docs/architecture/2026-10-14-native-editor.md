# ReT Markdown native editor architecture

2026-10-14. Implementation contract for the full agreed v1 in [the spec](../specs/2026-10-14-markdown-editor-design.md) and [visual baseline](../references/typora-github-visual-baseline.md). Decisions below are fixed for task handoff; proof gates are not claims of tested behavior.

## Ownership and build

- Native: Swift 6.4, AppKit `NSDocument`, one `WKWebView` editor per document window. SwiftPM builds the executable and copies bundled web resources; `scripts/build-app.sh` assembles `build/ReT Markdown.app` with Info.plist, executable and SwiftPM resource bundle. Xcode 27/current arm64 Mac is the initial acceptance environment.
- Web: TypeScript, CodeMirror 6, npm/esbuild. Renderer task exclusively owns root npm/TS/test configuration, `scripts/build-web.mjs`, `web/index.html`, `web/src/render/**`, `web/styles/**`; editor owns `web/src/main.ts`. Coordinate dependency/script changes through that owner. Use `--cache /private/tmp/ret-markdown-npm`; dependency downloads may require network escalation.
- Controller exclusively owns `scripts/generate-fixtures.py`, `tests/fixtures/**`, `docs/testing/**`; generated inputs are in `build/fixtures`. No source implementation is included in this architecture task. No Git or commits assumed.

```text
Package.swift, Resources/Info.plist, scripts/build-app.sh
Sources/ReTMarkdown/App/{AppMain,AppDelegate,MenuController}.swift
Sources/ReTMarkdown/Documents/{MarkdownDocument,DocumentController,DocumentWindowController}.swift
Sources/ReTMarkdown/Bridge/{BridgeTypes,EditorBridge,EditorWebView,AssetSchemeHandler}.swift
Sources/ReTMarkdown/Storage/{SourceCodec,SaveCoordinator,DraftStore,AssetStore,ExternalChanges}.swift
Sources/ReTMarkdown/Export/{PDFExporter,PrintProfile}.swift
Sources/ReTMarkdown/Resources/Web/                  # generated; do not hand edit
Tests/ReTMarkdownTests/{SourceCodec,Bridge,Save,Assets,PDF}Tests.swift
web/src/protocol.ts
web/src/editor/{source,history,session,commands,clipboard,search}.ts
web/src/live/{syntax,decorations,composition,tables}.ts
web/src/{main,export}.ts
web/src/render/**, web/styles/**                    # renderer-owned
web/test/{source,session,live,tables,clipboard,export}.test.ts
web/test/editor.spec.ts                            # browser integration
```

## Source representation and sole history

The editor owns content transactions and the only undo history. Native holds an acknowledged committed mirror for persistence, not another editor. Never save HTML, reserialize the whole Markdown AST, normalize Unicode, or infer original EOLs from CodeMirror `Text`.

```ts
type EOL = '\n' | '\r\n' | '\r';
type Revision = number; // nonnegative safe integer, increases on every committed edit including undo
type Range = { from: number; to: number }; // half-open UTF-16 in LF-normalized text
type Selection = { anchor: number; head: number };
type Source = { text: string; eols: EOL[]; bom: boolean };
type Snapshot = Source & { revision: Revision };
type Patch = Range & { insert: string; eols: EOL[] }; // insert is LF-normalized
type Commit = { base: Revision; revision: Revision; patches: Patch[];
  selection: Selection; reason: 'edit' | 'undo' | 'redo' | 'assets' };
type Mode = 'live' | 'source';
```

`eols[i]` is the original terminator of the ith LF in `text`; count must equal LF count. Decode strict UTF-8, extract only the leading UTF-8 BOM, retain every CRLF/LF/CR and trailing-newline decision. Encode by substituting each LF with its matching EOL then adding the BOM. Invalid UTF-8 is rejected without overwriting the original. New files are empty UTF-8/no BOM/no added final newline. Wire/native offsets always use normalized UTF-16, never Swift grapheme indices or raw byte offsets. Reject split surrogate pairs and malformed patches; preserve composed/decomposed Unicode as distinct bytes.

Patches are sorted, nonoverlapping and refer to the same pre-transaction document; apply simultaneously. Unchanged EOL entries survive. A typed newline inherits its containing line's terminator, then nearest preceding terminator, then LF. Pasted text preserves its own terminators. Table structure changes follow affected rows' terminators. A CodeMirror StateField carries EOL metadata; `invertedEffects` restores removed terminators on undo/redo. Mode/appearance/zoom use compartment reconfiguration without replacing EditorState or adding history. Dirty status compares encoded content identity to saved identity, not revision equality (undo can return to saved bytes with a newer revision).

## Version 1 bridge contract

JSON messages use `{ v:1, documentID:string, sessionID:string, id:string, type:string, payload:object }`. IDs are unique per session; responses use `replyTo`. Native creates document identity and a fresh session for each WebView load. Validate version, identity, main-frame origin, payload sizes, integer ranges and allowlisted types. Send structured arguments with `callAsyncJavaScript`; never interpolate document text into JS. JS posts to `window.webkit.messageHandlers.ret.postMessage`.

| Direction/type | Payload and response |
| --- | --- |
| Web → `ready` | `{}`; native sends `load` with `{snapshot, mode, selection, assetBase, appearance, zoom}` |
| Native → `load` | Initializes a new session only; reply `loaded {revision}`. Not used for mode changes |
| Web → `commit` | `Commit`; native validates base, applies mirror, replies `ack {revision}`; gap replies `resyncRequired {expected}` |
| Native → `barrier` | `{purpose:'save'|'export'|'close'}`; reply `snapshot {snapshot, selection, composing}` after all prior committed messages have been posted |
| Native → `command` | `{name, args?}`; names: undo, redo, format, find, replace, replaceAll, copySource, copyPlain, copyRich, insertImage, setMode, setAppearance, setZoom, revealRange; reply `result {ok,error?}` |
| Native → `applyPatches` | `{base, patches, reason:'assets'}`; editor dispatches one history event and emits commit; rejects stale base |
| Native → `saved` | `{revision, contentHash}`; informational receipt for exact bytes written; never discards later edits |
| Web → `state` | `{revision, selection, canUndo, canRedo, composing, mode}`; drives native menu validation |
| Web → `clipboardWrite` | `{text, html?}`; native writes plain text and optional HTML together; reply result |
| Web → `openLink` / `assetRequest` | `{url}` / `{action:'paste'|'choose'|'drop', requestID}`; native validates and handles OS capability; asset insertion returns through applyPatches |
| Either → `error` | `{code, message, range?}`; recoverable status, no silent replacement of content |

Commits are ordered and retained by JS until acknowledged; duplicate IDs receive the prior ack without reapplying. On a gap, freeze persistence and request a full committed snapshot, never overwrite newer JS content with native's stale mirror. Web process loss offers recovery from the last acknowledged native snapshot/draft; do not claim recovery of unacknowledged keystrokes. During IME preedit, barrier returns the last committed snapshot and `composing:true`; save/export may persist that committed state, while close must let composition finish or cancel explicitly.

## Editor and render APIs

```ts
// web/src/editor/source.ts — pure, independently testable
decodeSource(bytes: Uint8Array): Source;
encodeSource(source: Source): Uint8Array;
applyPatches(source: Source, patches: readonly Patch[]): Source;
// web/src/editor/session.ts
createEditor(parent: HTMLElement, initial: Snapshot, emit: (c: Commit) => void): EditorSession;
interface EditorSession {
  snapshot(): Snapshot; // committed content only
  command(name: string, args?: unknown): Promise<void>;
  apply(base: Revision, patches: readonly Patch[], reason: 'assets'): void;
  setMode(mode: Mode): void;
  destroy(): void;
}
// web/src/live/tables.ts; TableAction is editCell | insertRow | deleteRow | insertColumn | deleteColumn
tablePatches(source: Source, table: Range, action: TableAction): Patch[];
// web/src/export.ts; AssetMap is Record<originalDestination, capabilityURL>
prepareExport(snapshot: Snapshot, assets: AssetMap): Promise<ExportReady>;
// ExportReady = {revision:number, issues: RenderIssue[], overflow: Range[], ready:boolean}
```

Renderer contracts remain exactly as [the fixed renderer plan](../plans/2026-10-14-rendering.md): `renderMarkdown(source:string, options?:RenderOptions):RenderResult`; `RenderOptions {resolveImage?:(destination:string)=>string|null}`; `RenderResult {html:string;issues:RenderIssue[]}`; `RenderIssue {kind:'math'|'image';message:string;from:number;to:number}`; `plainText(source):string`; `richClipboard(source,options?):{html:string;text:string}`. Pass normalized text so returned UTF-16 ranges match editor coordinates. Renderer never reads files/network; native assembles local capability maps. Remote placeholders are not blocking issues.

Live editing uses CodeMirror syntax ranges/decorations, not the renderer HTML as an editable DOM. `syntax.ts` adapts CommonMark/GFM/math spans with explicit source positions; fixtures assert agreement with markdown-it render semantics. Reveal delimiters around active selections, search hits and composition; unknown syntax remains text. Never recreate a focused DOM node or replace the marked-text range while composing. Defer intersecting decorations until composition ends; emit its net committed patches once, retaining the existing CM composition history grouping.

Tables remain rendered. A focused cell uses a small CM view without its own history, projecting edits into the root session with offset/escape mapping. Parent history owns all cell edits; intercept undo/redo at the cell. Stable cell DOM survives composition and parent updates. Edit only cell content spans, preserving surrounding pipes/padding; escape literal pipes, map displayed cell text back to raw spans, and keep inline syntax editable. Reject multiline cell insertion with visible guidance to source mode rather than silently dropping characters. Tab/Shift+Tab navigate existing cells and leave at boundaries; context row/column actions are one parent transaction. Irregular/incomplete tables remain editable source until valid; deleting the last body row or column must produce a defined valid table or explicit table removal transaction. Structural commands wait for active composition.

Default copy derives Markdown from mapped selection, expanding fully selected rendered inline elements to include hidden delimiters; source mode uses exact selected source. Plain/rich copy uses renderer helpers; rich copy writes HTML plus text fallback and local image representations when available, without remote requests. Paste prefers plain text, including its raw EOLs; image-only paste routes native asset import. Find/replace uses all source text, reveals hidden hits, and groups replace-all into one history event. Menus provide all F06 formats, list continuation/indent commands, zoom and Cmd-/ mode switching.

## Native interfaces, persistence and assets

Swift Codable counterparts of Source/Snapshot/Patch/Commit live in `BridgeTypes.swift` (UTF-16 Int offsets; revisions within JS safe range). `SourceCodec.decode(_ data:Data) throws -> Source`, `encode(_ source:Source) throws -> Data`, and `applying(_ patches:[Patch],to:Source) throws -> Source` must agree with TS fixtures. `@MainActor EditorBridge.snapshot(purpose:SnapshotPurpose) async throws -> Snapshot` establishes a message barrier; `send(command:EditorCommand) async throws` routes menu actions. Keep AppKit/WebKit objects on MainActor; pass immutable Sendable byte snapshots to storage work.

`@MainActor MarkdownDocument:NSDocument` owns bridge, committed mirror, saved content hash and document identity. Enable autosavesInPlace; route standard Save, Save As, versions, restoration and untitled autosaving through NSDocument. Disable native content undo registration and route menu Undo/Redo to the root editor. Track content dirty state separately from pending autosave state; bridge transactions notify NSDocument changes, while successful saves clear only the captured change-count token. Verify the override interaction instead of calling `.changeCleared` on arbitrary async completion.

`SaveCoordinator.save(_ request:SaveRequest) async throws -> SaveReceipt` serializes writes per document. Request contains immutable snapshot/bytes, destination, operation (save/saveAs/autosave), expected disk fingerprint and resource migration plan; receipt contains revision/contentHash/destination. Acquire the bridge barrier before entering NSDocument's write phase; `data(ofType:)` returns the captured bytes synchronously, never waits on JS. Preserve NSDocument safe-write/file-coordination lifecycle. Capture the AppKit change-count token at the same save boundary and let superclass completion account for it once. Later typing remains dirty. Recheck disk identity under coordination; external clean updates reload through a new session, dirty conflicts offer keep-local-copy/load-external/cancel. No last-writer-wins overwrite.

`AssetStore.importImage(data:Data,suggestedName:String,documentID:UUID) async throws -> ImportedAsset`; `planMigration(snapshot:Snapshot,to:URL) async throws -> AssetMigration`. ImportedAsset contains immutable assetID and relative Markdown destination; AssetMigration contains copies, reference patches, and unmanaged broken references. Named documents use `<name>.assets/`; untitled documents use per-draft storage. Stage resources first, then Markdown, then acknowledge path changes; failures retain original/draft assets. Save As pauses content commands briefly after a barrier, copies managed assets, writes the patched candidate snapshot, then commits matching reference patches and changes identity only on success. Cancel/failure leaves the original session intact; unmanaged broken references require the specified user acceptance. Preserve old assets for undo and document versions, including aliases needed after Save As. Renaming alone does not rename assets.

`DraftStore.persist(snapshot:Snapshot,manifest:AssetManifest) async throws` writes an atomic recovery generation and asset manifest keyed by stable document UUID; NSDocument restoration records that UUID. Only completed generations recover. Resource provenance is durable application metadata, never inferred from a matching directory name alone. `AssetSchemeHandler` serves bundled files and authorized local image capabilities, validates canonical paths/symlinks, and supports legitimate existing relative paths including parent-directory references. SVG scripts/external fetches are blocked; sanitize SVG resources. CSP disallows remote image/font/script/connect loads; delegate permits external links only through system browser actions.

## PDF path and proof gates

`@MainActor PDFExporter.export(snapshot:Snapshot,assets:AssetManifest,to:URL) async throws` uses a separate retained WKWebView and `prepareExport`; live state is untouched. Await fonts, local image decode and math; block on missing-local/math issues or unresolved overflow and reveal their ranges. Freeze asset bytes/capabilities for the export duration. Remote images stay URL placeholders.

Use `webView.printOperation(with: printInfo)`, `jobDisposition = .save`, `.jobSavingURL` to a temporary sibling PDF, and no print/settings panel. A4 is 595.276 × 841.890 pt; margins 56.693 pt (20 mm), scale 1. Native print info owns margins; print CSS has no extra page/container padding, white background, 13 px root, no headers/footers. Keep headings with following content; avoid splitting blocks that fit; permit long code/table fragmentation and wrap long code. Validate completed PDF page boxes/text before atomic replacement; cancel/error deletes temp only. Do not use createPDF rectangle capture as paginated export.

API existence verified in [Apple WKWebView printing](https://developer.apple.com/documentation/webkit/wkwebview/printoperation(with:)), [save disposition](https://developer.apple.com/documentation/appkit/nsprintinfo/jobdisposition-swift.struct/save), and [jobSavingURL](https://developer.apple.com/documentation/appkit/nsprintinfo/attributekey/jobsavingurl). The controller also verified the installed SDK declaration. This verifies the API route, not pagination or text quality. [NSDocument save](https://developer.apple.com/documentation/appkit/nsdocument/save(to:oftype:for:completionhandler:)) and [change-count tokens](https://developer.apple.com/documentation/appkit/nsdocument/updatechangecount(withtoken:for:)) underpin save integration; [CM reference](https://codemirror.net/docs/ref/) documents metadata inversion.

Required proofs before declaring v1: mixed-EOL/BOM bytes survive edit+undo in both languages; save races/failed writes/versions recover exact committed source and assets; real WKWebView Chinese IME works around hidden spans and cells; table edits produce only local diffs; multi-page A4 PDF has searchable Chinese/code and complete pagination. Browser synthetic tests cannot prove native IME. If any proof fails, repair that subsystem and retain source access; a permanent source-only editor, read-only tables or single-page PDF does not satisfy v1.
