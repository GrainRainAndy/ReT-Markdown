# Task 2 fix round 1 — native save activities and post-write recovery

2026-10-15. Addresses native review R2-1 and R2-3, and supplies the Task 2 hook for Task 5's R2-2 fix. Read alongside `docs/testing/reviews/task-2-review.md`. This follow-up supersedes the historical test totals in `task-2-report.md`.

## Result

- Shared bridge/save suite: **18 tests, 0 failures** (7 BridgeTests, 11 SaveTests), `build/task2/fix-focused-final.log`, 21:58:11.
- Shared full Swift suite: **79 tests, 1 skipped, 0 failures**, `build/task2/fix-all-swift.log`, 21:59:02. The skipped test is `PDFTests.testRealWebKitPaginatedPrintWhenOptedIn`, which requires `RET_PDF_RUNTIME=1` and graphical WebKit printing; it was not rerun here.
- The actual native activity regression runs real `NSDocument.save(withDelegate:didSave:contextInfo:)` and `autosave(withImplicitCancellability:completionHandler:)` entry points, not a fake SaveCoordinator. Each scenario has an external eight-second process deadline and asserts a main-run-loop heartbeat during suspended preparation. Menu/menu and autosave/menu scenarios both pass; their combined parent test completed in 0.565 seconds in the final focused run.
- No shared web build, app assembly or app publication was performed in this fix round. Main remains the sole publisher and owns the final packaged GUI retest.

## R2-1: two native contexts must survive the async boundary

The original GUI sample `build/native-save-sample.txt` records PID 80819 blocked on the main thread in `_saveDocumentWithDelegate:` → `performActivityWithSynchronousWaiting:` → `_performActivity:` → `_NSDocumentSerializationSemaphore.wait`. The stack establishes a real failed GUI gate; it does not by itself prove every cause of the wait.

The new menu/menu regression reproduced the failure against the original implementation. Its first resource preparation suspends for 100 ms while another real public Save is dispatched. Before the fix, the dedicated child exceeded its external eight-second deadline (`build/task2/activity-red.log`, 8.128-second failure). This exercises the native activity that the original direct `save(to:...)` tests omitted.

The correction queues new Save, Save As, Revert, Versions and Close entry points before they would begin a synchronous native activity while an asynchronous save is still pending. Captured superclass saving and final native completion re-enter through `continueAsynchronousWorkOnMainThread` and `continueActivity`. AppKit continues to own the actual save, safe writing, coordination, change-count accounting and panels.

The first correction passed menu/menu (`build/task2/activity-green.log`, 0.214 seconds). Extending the regression to native autosave uncovered a second context loss: autosave already holds an asynchronous native file-access scope when it invokes `save(to:...)`. Dispatching `super.save` later queues that write behind the same autosave's unfinished file access. The main loop stayed responsive, but neither save completed; the temporary autosave probe and `build/task2/autosave-activity-sample.txt` establish that this was a different wait from the original blocked main thread.

The final implementation prepares the JS barrier, immutable source, revision-specific tokens and resource/draft work **before** invoking `super.autosave`. When AppKit invokes the prepared autosave's `save(to:...)`, the captured `super.save` starts inline in that original native callback stack. It does not suspend or dispatch before entering the superclass write. Async resource acknowledgement follows the completed disk write; native completion is delivered using the document continuation API. Untitled autosave still lets AppKit choose its autosave URL and persists its draft manifest through the installed draft hook.

`SaveCoordinator` shares revision validation and completed-write receipt accounting with this inline native autosave path. The document's existing save queue serializes autosave and manual saves together. The final code continues to return immutable encoded Markdown bytes synchronously from `data(ofType:)`, uses the standard safe writer, checks external fingerprints under coordination, preserves the exact captured change-count token, and leaves the web editor's undo history intact.

The public APIs and their context/nesting semantics were checked in the installed macOS 27 SDK `NSDocument.h`, lines 157–216, and Apple's documentation: [continueActivity](https://developer.apple.com/documentation/appkit/nsdocument/continueactivity(_:)), [continueAsynchronousWorkOnMainThread](https://developer.apple.com/documentation/appkit/nsdocument/continueasynchronousworkonmainthread(_:)).

## R2-3: a committed disk write is independent of final acknowledgement

The new native regression first reproduced the false conflict: inject `processLost` only in `PreparedDocumentSave.didWrite`, then retry. The first write reached disk; retry failed with an underlying `externalConflict` (`build/task2/finalization-red.log`).

After every successful native write, `recordCommittedWrite` records its byte-derived disk fingerprint immediately, before awaiting resource/JS acknowledgement. A `PendingFinalization` retains the original prepared callback, request, receipt, operation and lock requirement. Failure keeps the document dirty and retains staged resources; `didFail` is reserved for failures before a disk commit. Retry finishes that retained acknowledgement before preparing the next save. Finalization retries reacquire a live migration lock when necessary and check that the committed target has not genuinely changed.

`testPostWriteFinalizationFailureAllowsRetryAndSaveAs` exercises actual NSDocument safe writes for both an initial in-place save and initial Save As, each with an injected post-write failure. It checks disk bytes, dirty/unautosaved state, no resource cancellation after commit, a second invocation of the **original retained finalizer**, successful retry, and a subsequent successful Save As. These tests use documents with no window; there is no live editor to lock. In a windowed document, the existing bridge barrier and migration lock remain mandatory.

`testFinalizationRetryDoesNotOverwriteSubsequentExternalEdit` adds a real atomic external replacement after the failed acknowledgement. Retry rejects the changed fingerprint before invoking the finalizer again, preserves the external bytes, and retains local dirty state. Thus the fingerprint correction does not disable external conflict protection.

Task 5 coordinated its finalizer with this contract: adoption and patch application are idempotent across retry/lost acknowledgement, and recovery namespace rebinding occurs once. Task 2 did not edit Task 5's resource or draft implementations.

## R2-2: native recovery-session handoff

Added `MarkdownDocument.onRecoverySessionReset: (() -> Void)?`. `read(from:ofType:)` invokes it synchronously immediately after replacing the committed mirror and bridge, before the new session can emit commits. Clean read, revert and external reload all use that path. Save As and persistent UUID adoption do not invoke it; they do not reload the web editor or reset its wire revision/undo history.

Task 5 installs the hook and owns durable draft epochs/namespaces and the corresponding reopen/revert tests. Its current integrated tests were included in the 79-test full-suite run. This report does not claim that Task 2 independently implemented durable draft storage or ran a separate crash/relaunch GUI proof.

## Commands and test bounds

```sh
CLANG_MODULE_CACHE_PATH=/private/tmp/ret-clang \
SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/ret-clang \
swift test --disable-sandbox --scratch-path build/swift-task2-fix \
  --cache-path /private/tmp/ret-swiftpm --filter 'BridgeTests|SaveTests'
```

The unfiltered run used the same command without `--filter`. These commands required approved execution outside the tool's filesystem sandbox to exercise AppKit's file-coordination services. No approval rejection occurred.

The activity test launches only its dedicated XCTest child with `xcrun xctest`. Its parent enforces eight seconds using a monotonic clock, then terminates only that child if necessary. In-process waits are also bounded at four seconds. The test asserts two successful native completion callbacks, correct disk bytes, clean final state, and a main-loop heartbeat during preparation. This prevents a blocked main thread from also blocking the timeout mechanism.

The original acceptance app was neither terminated nor modified by this agent; main reported preserving its test text and later terminating PID 80819. All regression documents use unique temporary directories. No subagents or Git operations were used.

## Exact files changed in this round

- `Sources/ReTMarkdown/Documents/MarkdownDocument.swift`
- `Sources/ReTMarkdown/Storage/SaveCoordinator.swift`
- `Tests/ReTMarkdownTests/SaveTests.swift`
- `docs/testing/task-2-fix-report.md`

Generated evidence is under `build/task2/`; diagnostic dependency snapshots were confined to `/private/tmp/ret-task2-isolated` while Task 5 was transitioning its APIs. Final results above are from the shared repository source, not that snapshot.

## Remaining GUI acceptance

Main should publish the current code and repeat the original sample/no-edit Cmd-S, newly typed untitled document Cmd-S, repeated Cmd-S during autosave, and actual Save As panel acceptance/cancellation with the real WebView. The automated native delegate entry test proves activity responsiveness but does not itself synthesize keyboard events into WKWebView or operate the Save As panel.

Also retain the controller's outstanding two-window/Finder activation, both system close settings, quit/relaunch restoration, version browsing, Chinese composition during close/save, and crash recovery with images. These are system acceptance gates, not asserted complete by the native regression suite.
