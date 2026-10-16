# Native Save As shortcut follow-up

2026-10-15. This round addresses the packaged Cmd-Shift-S unavailable alert. The previous native save-activity and post-write recovery corrections remain documented in `task-2-fix-report.md`.

## Confirmed failure and correction

Controller reproduced the alert in diagnostic process **94700** with a fresh, empty Untitled document: cancel Save, switch mode, then Cmd-Shift-S. Neither a named document nor dirty content was required. The last record in `build/native-save-as-trace.jsonl` at Unix time **1792078641.494062** records:

```text
writeSafely.missingCapture operation=3
NSDocument duplicateAndReturnError:
NSDocument duplicateDocumentWithDelegate:didDuplicateSelector:contextInfo:
NSApplication sendAction:to:from:
NSMenuItem _corePerformAction:
NSMenu _performKeyEquivalentForItemAtIndex:
```

There was **no `saveAs.public` entry** for this shortcut. AppKit's automatically supplied Duplicate action was receiving Cmd-Shift-S. Duplication calls the synchronous safe writer directly with autosave-elsewhere operation 3, outside the document's acknowledged snapshot/captured-write lifecycle; the writer correctly rejected the missing capture. This was not evidence of a failed Save As resource migration or a stale editor bridge.

`MenuController` now owns Save As through an explicit custom action and target. That action calls the current document's public `saveAs(nil)`. AppKit no longer sees the standard Save As selector on this menu item to rewrite into its automatic Duplicate menu action. The actual Save As panel, native save activity, snapshot barrier, safe writing, resource migration, change-count tokens and editor history remain under the existing document implementation. No raw-write fallback, event swizzle or autosave opt-out was introduced.

**Packaged keyboard verification passed.** Controller used CUA with process **95835**: fresh blank Untitled → Cmd-/ → Cmd-Shift-S opened Save As without the unavailable alert. Archived evidence is `build/verification/native-save-as-routing-green.json`. At Unix time **1792078945.165981**, the stack shows native key-equivalent dispatch → `MenuController.saveCurrentDocumentAs` → `MarkdownDocument.saveAs`; `ready=true`, `mode=source`, `revision=0`, and the view still matches the bridge. `panel.prepared` followed at **1792078945.309118** with super=true. There was no missing-capture write or Duplicate path. The wrapper deliberately forwards nil as the document action's sender, as reflected in the archived record.

All temporary production tracing, environment/Info.plist trace switches, trace calls and the diagnostic `prepareSavePanel` override have now been removed. The test helper's temporary stack/source collectors and debug prints were also removed. `MarkdownDocument` remains subclassable for the native panel/error-observation test; its persistence implementation is unchanged by this shortcut correction.

## RED / GREEN evidence

- The actual packaged keyboard failure above is the behavioral RED evidence for AppKit's automatic menu augmentation.
- `testSaveAsShortcutKeepsUniqueExplicitRoutingAfterNativeMenuUpdates` installs the real `MenuController`, runs native menu updates, and checks unique Cmd-Shift-S ownership, an explicit responding target, and absence of the standard Save As/Duplicate selector on that shortcut. Before the change it failed three routing assertions (`build/task2/save-as-routing-red.log`, 23:39:43). After the change it passes.
- This headless test **does not reproduce AppKit's application-launch-time automatic Duplicate insertion**. Earlier direct `NSDocument.validateUserInterfaceItem` and `NSMenu.update` probes passed against the original selector. No synthetic Duplicate item was inserted to manufacture a reproduction. The packaged trace and upcoming CUA check cover that runtime behavior.
- `testPublicSaveAsReachesNativePanelWithoutUncapturedWrite` runs a separate real XCTest process with an external 15-second deadline. It installs the real asset adapter, loads a real hidden WKWebView, performs an initial native save, switches to SOURCE, applies an undoable edit, and invokes public `document.saveAs(nil)`. Cancellation through the documented `prepareSavePanel` hook preserves original disk bytes, edited mirror bytes, mode, bridge identity, session, dirty state and undo availability. This test passed before the routing correction; it does not exercise keyboard routing or accepted panel completion. Its type overrides compensate for XCTest's missing application document-type plist and do not prove packaged type discovery.
- Focused suite with the menu correction and temporary tracing: **20 tests, 0 failures**, `build/task2/save-as-routing-green.log`, 23:40:02.
- Final source after removing all diagnostics: **20 focused tests, 0 failures**, `build/task2/save-as-clean-focused.log`, 23:43:35. This includes the native installed-menu route, externally bounded real public Save As, activity overlap, revision/token, byte identity and post-write recovery regressions.
- Full shared Swift suite before diagnostic removal: **84 tests, 1 skipped, 0 failures**, `build/task2/save-as-all-swift.log`, 23:40:20. The skipped test is the opt-in graphical PDF runtime test; it was not run in this round. Controller owns the full final run and final app publication after cleanup.

```sh
CLANG_MODULE_CACHE_PATH=/private/tmp/ret-clang \
SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/ret-clang \
swift test --disable-sandbox --scratch-path build/swift-task2-fix \
  --cache-path /private/tmp/ret-swiftpm --filter 'BridgeTests|SaveTests'
```

The full run used the same command without `--filter`. AppKit tests required approved execution outside the filesystem sandbox. Only dedicated XCTest children were launched by this agent; GUI launches and computer actions remained with the controller through CUA. No shared Web build or app publication was performed here.

## Separate panel observation remains incomplete

Controller observed Open/Save panels closing after CUA clicks or default-button attempts without `read`/`save.to` or output files. CUA focus/binding behavior was unstable, including inspection relaunching a new process. These observations are retained as incomplete manual acceptance; they are not attributed to this shortcut correction or claimed fixed.

Packaged type diagnostics for process 94700 show `prepareSavePanel` super returned true; runtime class was `ReTMarkdown.MarkdownDocument`; fileType was `net.ret-markdown.markdown`. Class readable/writable types, Save As operation writable types and panel allowed content types all contained `net.ret-markdown.markdown` and `net.daringfireball.markdown`. Both were native types. The accessory view was absent at this hook. This does not support an empty writable list or runtime class mismatch; no speculative type configuration change was made.

Process 91025 exited through controller UI; a subsequently inspected empty Untitled belonged to new process 94336. It is not evidence of source loss. Controller preserved its diagnostic input separately in `build/native-save-as-diagnostic-input.md`.

## Files changed in this round

- `Sources/ReTMarkdown/App/MenuController.swift`: explicit Save As action/target.
- `Sources/ReTMarkdown/Documents/MarkdownDocument.swift`: class made subclassable for the native panel test; temporary diagnostic code removed after GUI confirmation.
- `Tests/ReTMarkdownTests/SaveTests.swift`: native routing and externally bounded public Save As coverage.
- `docs/testing/native-save-as-fix-report.md`: this evidence and remaining acceptance.

No web, asset-storage or PDF source was changed. No Git operations or subagents were used.

## Remaining acceptance

The formerly failing fresh-untitled SOURCE keyboard route is verified. Controller still owns final app publication without the injected diagnostic Info.plist key and final full tests. Keep successful panel completion, dirty-SOURCE Save As, and undo/redo continuity after accepted Save As in manual acceptance. The separate panel-confirmation/tool-routing observation remains unresolved, with no established product defect; a real `save.to` callback and exact output bytes should establish completion. No speculative panel/type fix was introduced.
