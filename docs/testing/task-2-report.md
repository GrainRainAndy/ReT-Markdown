# Task 2 — native shell, ordered bridge and revision-safe saving

Updated 2026-10-15. Scope: `docs/testing/briefs/task-2.md` and `docs/architecture/2026-10-14-native-editor.md`. Implementation is present; native bridge/save focused tests pass. This report does not mark the complete application or the remaining system acceptance gates as passed.

## Implemented contracts

- SwiftPM executable, test target, bundled Web resources and Markdown document UTI. `scripts/build-app.sh` runs the renderer-owned `npm run build:web`, copies generated resources, builds Release, and assembles/ad-hoc signs `build/ReT Markdown.app`. Clang module caches and SwiftPM caches use `/private/tmp`; compiler outputs use `build/swift`.
- `AppMain`/`AppDelegate` create the custom document controller before document operations. Native menus provide file operations, versions, source mode, formatting, find/replace, clipboard variants, zoom and PDF. Windows disable automatic tabbing and contain one editor. File identity uses canonical paths and filesystem identity; concurrent opens are coalesced.
- `EditorBridge.snapshot(purpose:)` and `send(command:)` use the fixed `window.retEditorBootstrap={documentID,sessionID}` and `return await window.retEditor.receive(envelope)` contract, with `callAsyncJavaScript` structured arguments in `.page`. Source text is never interpolated into JavaScript. The bootstrap contains JSON-encoded native UUID strings only.
- Main-frame/page URL, protocol version, IDs, allowlisted message kinds and source/revision/selection validity are checked. Outbound requests are ordered. Acknowledgements bypass that queue so clipboard and barrier responses cannot deadlock the request they unblock. Duplicate commit IDs return the previous acknowledgement without another mutation. Gaps freeze persistence until a validated committed snapshot is reconciled; snapshot acknowledgements release JS's retained commits.
- `CommittedMirror` holds source bytes independently from the web editor's sole undo history. Dirty and same-revision comparisons use `SourceCodec.encode` plus SHA-256, preserving composed/decomposed Unicode differences, BOM, EOL metadata and trailing-newline state.
- A barrier snapshot r10 remains usable when r11 has already arrived, provided r10 matches the recorded byte hash. It does not replace the newer mirror. Revision hashes and native token history retain 2,048 revisions; an older evicted boundary fails safely rather than guessing.
- `SaveCoordinator.save(_:)` serializes immutable snapshot/byte writes and rejects delayed writes older than the latest completed write. `MarkdownDocument.save(to:ofType:for:completionHandler:)` takes the JS barrier before entering the native write phase. `data(ofType:)` returns captured bytes synchronously. The native writer preserves `super.save` and `super.writeSafely`, with fingerprint validation under `NSFileCoordinator`.
- AppKit change-count tokens are recorded per acknowledged revision and save operation. The exact captured token is supplied to the superclass; superclass completion performs its accounting once. No asynchronous completion calls `.changeCleared`. Native content undo registration is disabled; Undo/Redo route to the JS history.
- Autosaves-in-place, versions and draft hooks are enabled. An autosave-elsewhere receipt updates the autosaved content identity without clearing the untitled document's formal dirty identity. AppKit remains responsible for system close preference behavior. Close barriers refuse active composition; process loss retains the acknowledged mirror and offers recovery.
- External changes are checked against byte-derived fingerprints. Clean reloads use a fresh web session; dirty conflicts offer Save Local Copy, Load External Version, or Cancel. Revert/version restoration reloads the editor. Reading and receipt fingerprints derive from the actual captured bytes, avoiding a second content read that could silently accept an intervening external edit.
- First-save/Save As migration uses `setReadOnly {value:true}`, then a barrier; composing sessions refuse the lock. Resource preparation precedes Markdown writing. `PreparedDocumentSave.didWrite` runs only after the write, `didFail` handles failures, and unlocking is attempted on every failure/cancellation path. Finalization failure keeps the document dirty.
- Real Task 5/6 integration is installed in `AppDelegate`: `NativeAssetIntegration.install`, then `PDFExporter.install` with the adapter's frozen authorized manifest. Native drops pass actual pasteboard values to Task 5. The bridge carries opaque asset maps through load/setAssets.
- Named reopen uses Task 5's durable `AssetStore.documentIdentity` lookup and `MarkdownDocument.adoptPersistentIdentity(_:)` before window creation. UUID adoption preserves source bytes and saved hash. System restoration rebuilds session identity, rebinds the resource adapter and awaits complete draft recovery before constructing the WebView. A clean named restore does not replace the current disk content with an older retained draft.

## RED/GREEN evidence

All paths below are repository-relative generated logs.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Initial authored bridge/save tests before implementation | Compile RED: missing Snapshot/Commit and native implementation dependencies; this is scaffold/dependency evidence, not proof of behavioral failures | `build/task2/red.log` |
| Barrier r10 response after r11 commit | Behavioral RED: `testBarrierCapturedBeforeNewerCommitSavesCapturedBytesWithoutRegressingMirror` threw `staleSnapshot` | `build/task2/isolated-race-red.log` |
| Same barrier test after recorded-byte boundary validation | GREEN along with the other bridge invariants | `build/task2/final-focused.log` |
| Native types against installed Swift 6.4/AppKit/WebKit SDK | Independent typecheck completed without errors at that checkpoint | `build/task2/native-typecheck.log` |
| Final shared `swift test --filter 'BridgeTests|SaveTests'` | **15 tests, 0 failures**: BridgeTests 7, SaveTests 8 | `build/task2/final-focused.log` |
| Production-source copy plus Task 2 tests, used while another owner's new tests were not yet implemented | **15 tests, 0 failures**; isolated copy in `/private/tmp/ret-task2-isolated` | `build/task2/final-isolated.log` |
| Final unfiltered shared `swift test` | **60 tests; 1 failure, 1 skipped**. Task 2 remained green | `build/task2/final-all-swift.log` |
| Build script syntax / Info.plist | `bash -n scripts/build-app.sh` passed; `plutil -lint Resources/Info.plist`: OK | Executed 2026-10-15 |
| Current assembled app signature | `codesign --verify --deep --strict 'build/ReT Markdown.app'` exited 0 | Read-only verification executed 2026-10-15; publication belongs to main controller |

Reproducible focused command:

```sh
CLANG_MODULE_CACHE_PATH=/private/tmp/ret-clang \
SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/ret-clang \
swift test --disable-sandbox --scratch-path build/swift \
  --cache-path /private/tmp/ret-swiftpm --filter 'BridgeTests|SaveTests'
```

The real NSDocument tests required the execution tool's approved escalation to reach AppKit safe-write/file-coordination services. Restricted runs produced Cocoa write failures; the same tests passed with system services available. Test documents and outputs are temporary. This was not an approval rejection.

The 15 focused tests cover duplicate commit application, wrong session/base rejection, stale and inconsistent snapshots, Unicode byte identity, undo to saved bytes, the late barrier response race, serialized writes across suspension, delayed old write rejection, failure retaining dirty state, external conflict preserving disk, r10/r11 dirty preservation, real NSDocument save during resource preparation, untitled autosave identity, and persistent UUID adoption.

The full-suite failure is **AssetsTests.testMigrationResourcesFirstAndReferencePatchLocality**, line 141: an old relative image reference was missing after migration (`assets/图 一-<UUID>.svg`), so plain Markdown undo aliases were not preserved in that run. It was sent to Task 5 through main; Task 2 did not edit Task 5 files. The skipped test is **PDFTests.testRealWebKitPaginatedPrintWhenOptedIn**, requiring `RET_PDF_RUNTIME=1` in a graphical session. The full suite is therefore not reported as globally green.

## Build evidence and publication ownership

Task 2 invoked `bash scripts/build-app.sh`. The restricted Release build reached compilation/linking and failed at `dsymutil: Operation not permitted`. The approved rerun completed Release compilation in 17.72 seconds, then exposed an unsigned duplicate SwiftPM resource bundle in `Contents/MacOS`. The script was corrected to retain the bundle in `Contents/Resources`, remove only the previously generated duplicate, and sign nested bundles with `codesign --deep`.

`build/task2/build-app.log` records those historical failures; it is not a successful final publication log. Main subsequently reserved sole ownership of `build/web`/app publication to prevent concurrent rsync truncation. Task 2 stopped all web/app build commands, notified main that the script fix was ready, and performed the successful read-only signature verification noted above. The final publication run and GUI launch evidence belong in the controller's report. Bundle lookup uses `Bundle.module`, not the working directory.

## Exact Task 2 authored files

1. `Package.swift`
2. `Resources/Info.plist`
3. `scripts/build-app.sh`
4. `Sources/ReTMarkdown/App/AppMain.swift`
5. `Sources/ReTMarkdown/App/AppDelegate.swift`
6. `Sources/ReTMarkdown/App/MenuController.swift`
7. `Sources/ReTMarkdown/Documents/MarkdownDocument.swift`
8. `Sources/ReTMarkdown/Documents/DocumentController.swift`
9. `Sources/ReTMarkdown/Documents/DocumentWindowController.swift`
10. `Sources/ReTMarkdown/Bridge/EditorBridge.swift`
11. `Sources/ReTMarkdown/Bridge/EditorWebView.swift`
12. `Sources/ReTMarkdown/Storage/SaveCoordinator.swift`
13. `Sources/ReTMarkdown/Storage/ExternalChanges.swift`
14. `Tests/ReTMarkdownTests/BridgeTests.swift`
15. `Tests/ReTMarkdownTests/SaveTests.swift`
16. `docs/testing/task-2-report.md`

The build also copies renderer output into generated `Sources/ReTMarkdown/Resources/Web/` and writes `build/` artifacts. Task 1 types/codec/schema, Task 3 web code, Task 5 resources/drafts and Task 6 PDF files were consumed but not edited. No Git operations or subagents were used.

## Remaining system acceptance

| Gate | Current proof and remaining work |
| --- | --- |
| T07 | Canonical/resource identity dedup and coalescing implemented. Controller must verify real Finder/open-panel same-file activation, symlink aliases, and independent windows for two files. |
| T08 | Real untitled autosave test passes; AppKit owns close/quit policy. Controller must exercise both system close-confirmation settings, termination, restoration and active Chinese preedit close. No system preference was changed by Task 2. |
| T09 | Fake-writer invariants and real NSDocument captured-save tests pass. Remaining: real WebView typing during saves, injected disk-full/permission failures with Retry/Save As, version browsing, failed migration finalization and recovery UI. |
| T10 | Fingerprint conflict unit test passes and coordinated native checking/reload/conflict UI is implemented. Remaining: two-process external clean/dirty changes with actual windows, queued save/external edit interaction, and user choices in the conflict sheet. |
| Task 5 / T11–T12 | Resource/draft hooks and persistent identity are connected. Remaining: crash/relaunch with draft images, Save As cancellation/failure, plain-file undo aliases (known full-suite failure above), rename/reopen provenance and version asset restoration. |
| Task 6 / T14–T17 | Real PDF installer is connected. Pagination, searchable text, cancellation and live-document isolation require the PDF owner's graphical proof. |
| T04/T18/T19 | Real WKWebView IME, offline packaged resource behavior, and 20-run Release performance/memory/bundle measurements remain controller/system tests. |

These remaining gates are explicit handoff items, not claims of completed runtime acceptance.
