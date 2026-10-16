import XCTest
import AppKit
@testable import ReTMarkdown

@MainActor
private final class ActivitySaveObserver: NSObject {
    var completions = 0
    var allSucceeded = true
    @objc func document(_ document: NSDocument, didSave: Bool, contextInfo: UnsafeMutableRawPointer?) {
        completions += 1
        allSucceeded = allSucceeded && didSave
    }
}

@MainActor
private final class PublicSaveAsProbe: MarkdownDocument {
    var preparedPanel = false
    var presentedErrors: [Error] = []
    static var nativeReadCount = 0
    override nonisolated func writableTypes(for operation: NSDocument.SaveOperationType) -> [String] { ["net.ret-markdown.markdown"] }
    override nonisolated func fileNameExtension(forType typeName: String, saveOperation operation: NSDocument.SaveOperationType) -> String? { "md" }
    override func prepareSavePanel(_ panel: NSSavePanel) -> Bool {
        preparedPanel = true
        return false // Cancel through the documented hook; no UI interaction or panel automation.
    }
    override func presentError(_ error: Error) -> Bool {
        presentedErrors.append(error)
        return false
    }
    override func presentError(_ error: Error, modalFor window: NSWindow, delegate: Any?, didPresent selector: Selector?, contextInfo: UnsafeMutableRawPointer?) {
        presentedErrors.append(error)
        if let object = delegate as? NSObject, let selector {
            typealias Callback = @convention(c) (AnyObject, Selector, Bool, UnsafeMutableRawPointer?) -> Void
            unsafeBitCast(object.method(for: selector), to: Callback.self)(object, selector, false, contextInfo)
        }
    }
    override nonisolated func read(from data: Data, ofType typeName: String) throws {
        MainActor.assumeIsolated { PublicSaveAsProbe.nativeReadCount += 1 }
        try super.read(from: data, ofType: typeName)
    }
}

final class SaveTests: XCTestCase {
    @MainActor func testSaveAsShortcutKeepsUniqueExplicitRoutingAfterNativeMenuUpdates() {
        _ = NSApplication.shared
        let controller = DocumentController()
        let previousMenu = NSApp.mainMenu
        defer { NSApp.mainMenu = previousMenu }
        let document = MarkdownDocument()
        controller.addDocument(document)
        let menus = MenuController()
        menus.install()
        let menu = NSApp.mainMenu!.items.first { $0.title == "File" }!.submenu!
        let item = menu.items.first { $0.title == "Save As…" }!
        _ = document.validateUserInterfaceItem(item)
        NSApp.mainMenu!.update()
        menu.update()
        menu.update()
        let shortcutItems = menu.items.filter { $0.keyEquivalent.lowercased() == "s" && $0.keyEquivalentModifierMask == [.command, .shift] }
        XCTAssertEqual(shortcutItems.count, 1, "Save As must be the only CmdShiftS item after native menu updates")
        XCTAssertTrue(shortcutItems.first === item)
        XCTAssertTrue(item.target === menus, "Save As must have an explicit command owner so AppKit cannot remap the standard selector to Duplicate")
        XCTAssertNotEqual(item.action, #selector(NSDocument.saveAs(_:)))
        XCTAssertNotEqual(item.action, #selector(NSDocument.duplicate(_:)))
        XCTAssertTrue(item.target?.responds(to: item.action!) == true)
        XCTAssertEqual(item.keyEquivalent, "s")
        XCTAssertEqual(item.keyEquivalentModifierMask, [.command, .shift])
        document.close()
    }
    func testPublicSaveAsReachesNativePanelWithoutUncapturedWrite() async throws {
        if ProcessInfo.processInfo.environment["RET_PUBLIC_SAVE_AS_CHILD"] == "1" {
            try await Self.exercisePublicSaveAs()
            return
        }
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        child.arguments = ["xctest", "-XCTest", "ReTMarkdownTests.SaveTests/testPublicSaveAsReachesNativePanelWithoutUncapturedWrite", Bundle(for: SaveTests.self).bundleURL.path]
        var environment = ProcessInfo.processInfo.environment
        environment["RET_PUBLIC_SAVE_AS_CHILD"] = "1"
        child.environment = environment
        let output = Pipe(); child.standardOutput = output; child.standardError = output
        try child.run()
        let deadline = ContinuousClock.now.advanced(by: .seconds(15))
        while child.isRunning && ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(50)) }
        if child.isRunning {
            child.terminate()
            for _ in 0..<20 where child.isRunning { try await Task.sleep(for: .milliseconds(25)) }
            if child.isRunning { kill(child.processIdentifier, SIGKILL) }
            child.waitUntilExit()
            XCTFail("Public Save As child exceeded the external fifteen-second deadline")
        }
        let log = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        XCTAssertEqual(child.terminationStatus, 0, log)
    }
    @MainActor private static func exercisePublicSaveAs() async throws {
        let controller = DocumentController()
        _ = NSApplication.shared
        let directory = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("ret-public-save-as-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("original.md")
        let original = Data("# 笔记\n".utf8)
        try original.write(to: url)
        let document = PublicSaveAsProbe()
        try document.read(from: original, ofType: MarkdownDocument.typeName)
        let stateRoot = directory.appendingPathComponent("state", isDirectory: true)
        try FileManager.default.createDirectory(at: stateRoot.appendingPathComponent("provenance", isDirectory: true), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: stateRoot.appendingPathComponent("drafts", isDirectory: true), withIntermediateDirectories: true)
        let adapter = try NativeAssetIntegration.install(on: document, rootURL: stateRoot)
        document.makeWindowControllers()
        let readyDeadline = ContinuousClock.now.advanced(by: .seconds(5))
        while !document.bridge.isReady && ContinuousClock.now < readyDeadline { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(document.bridge.isReady, "The real editor must be ready before Save As")
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            document.save(to: url, ofType: MarkdownDocument.typeName, for: .saveAsOperation) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
        try await document.bridge.send(command: EditorCommand(name: "setMode", args: .object(["mode": .string("source")])))
        try await document.bridge.applyPatches(base: document.mirror.snapshot.revision,
            patches: [Patch(from: document.mirror.snapshot.text.utf16.count, to: document.mirror.snapshot.text.utf16.count,
                insert: "\n另存为历史验证\n", eols: ["\n", "\n"])])
        _ = try await document.bridge.snapshot(purpose: .save)
        let editedBytes = try SourceCodec.encode(document.mirror.snapshot.source)
        let readyBridge = document.bridge
        let readsBeforeSaveAs = PublicSaveAsProbe.nativeReadCount
        let sessionID = document.mirror.sessionID
        document.saveAs(nil) // The actual public action, including AppKit's pre-panel preservation.
        let deadline = ContinuousClock.now.advanced(by: .seconds(3))
        while !document.preparedPanel && document.presentedErrors.isEmpty && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(document.preparedPanel, "Public Save As must reach native panel preparation; errors=\(document.presentedErrors)")
        XCTAssertTrue(document.presentedErrors.isEmpty, "Public Save As raised an error before its panel")
        XCTAssertEqual(try Data(contentsOf: url), original, "Cancelling Save As must preserve the named file")
        XCTAssertEqual(PublicSaveAsProbe.nativeReadCount, readsBeforeSaveAs, "Cancelling Save As must not reread/reset the live document")
        XCTAssertTrue(document.bridge === readyBridge, "Public Save As must keep the bridge attached to its editor")
        XCTAssertTrue(document.bridge.isReady)
        XCTAssertEqual(document.bridge.state.mode, .source)
        XCTAssertTrue(document.bridge.state.canUndo)
        XCTAssertEqual(try SourceCodec.encode(document.mirror.snapshot.source), editedBytes)
        XCTAssertEqual(document.mirror.sessionID, sessionID, "Save As must preserve the editor session/history")
        XCTAssertTrue(document.isDocumentEdited)
        withExtendedLifetime((controller, adapter)) { document.close() }
    }

    /// A separate xctest process is essential: XCTest's own timeout cannot fire on a blocked main thread.
    func testMenuSaveDuringPendingNativeActivityDoesNotDeadlock() async throws {
        if let mode = ProcessInfo.processInfo.environment["RET_ACTIVITY_SAVE_CHILD"] {
            try await Self.exerciseMenuSaveOverlap(startWithAutosave: mode == "autosave")
            return
        }
        for mode in ["menu", "autosave"] {
            let child = Process()
            child.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
            child.arguments = ["xctest", "-XCTest", "ReTMarkdownTests.SaveTests/testMenuSaveDuringPendingNativeActivityDoesNotDeadlock", Bundle(for: SaveTests.self).bundleURL.path]
            var environment = ProcessInfo.processInfo.environment
            environment["RET_ACTIVITY_SAVE_CHILD"] = mode
            child.environment = environment
            let output = Pipe(); child.standardOutput = output; child.standardError = output
            try child.run()
            let deadline = ContinuousClock.now.advanced(by: .seconds(8))
            while child.isRunning && ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(50)) }
            if child.isRunning {
                child.terminate()
                for _ in 0..<20 where child.isRunning { try await Task.sleep(for: .milliseconds(25)) }
                if child.isRunning { kill(child.processIdentifier, SIGKILL) }
                child.waitUntilExit()
                let log = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                XCTFail("AppKit menu-save child exceeded external 8s deadline; native activity deadlock.\n" + log)
                return
            }
            let log = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            XCTAssertEqual(child.terminationStatus, 0, mode + ": " + log)
        }
    }
    @MainActor private static func exerciseMenuSaveOverlap(startWithAutosave: Bool) async throws {
        _ = NSApplication.shared
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ret-menu-save-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("sample.md")
        try Data("original".utf8).write(to: url)
        let document = try MarkdownDocument(contentsOf: url, ofType: MarkdownDocument.typeName)
        let observer = ActivitySaveObserver()
        try document.mirror.reconcile(sampleSnapshot("edited", revision: 1))
        document.updateChangeCount(.changeDone)
        var heartbeatDuringPreparation = false
        var preparations = 0
        document.prepareResources = { snapshot, _, _ in
            preparations += 1
            if preparations == 1 {
                // Simulate a second Cmd-S arriving while the first save's async preparation is pending.
                DispatchQueue.main.async {
                    document.save(withDelegate: observer, didSave: #selector(ActivitySaveObserver.document(_:didSave:contextInfo:)), contextInfo: nil)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(20)) { heartbeatDuringPreparation = true }
                try await Task.sleep(for: .milliseconds(100))
                XCTAssertTrue(heartbeatDuringPreparation, "The main run loop must stay responsive while preparation is suspended")
            }
            return PreparedDocumentSave(snapshot: snapshot)
        }
        if startWithAutosave {
            document.autosave(withImplicitCancellability: false) { error in
                observer.completions += 1
                observer.allSucceeded = observer.allSucceeded && error == nil
            }
        } else {
            document.save(withDelegate: observer, didSave: #selector(ActivitySaveObserver.document(_:didSave:contextInfo:)), contextInfo: nil)
        }
        let deadline = ContinuousClock.now.advanced(by: .seconds(4))
        while observer.completions < 2 && ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(observer.completions, 2, "Both real NSDocument menu-save delegates must complete; autosave=\(startWithAutosave), preparations=\(preparations), dirty=\(document.hasUnautosavedChanges)")
        XCTAssertTrue(observer.allSucceeded)
        XCTAssertEqual(try Data(contentsOf: url), Data("edited".utf8))
        XCTAssertFalse(document.isDocumentEdited)
        document.close()
    }

    @MainActor func testPostWriteFinalizationFailureAllowsRetryAndSaveAs() async throws {
        for firstOperation in [NSDocument.SaveOperationType.saveOperation, .saveAsOperation] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ret-finalization-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: directory) }
            let original = directory.appendingPathComponent("original.md")
            let destination = firstOperation == .saveAsOperation ? directory.appendingPathComponent("saved-as.md") : original
            try Data("original".utf8).write(to: original)
            let document = try MarkdownDocument(contentsOf: original, ofType: MarkdownDocument.typeName)
            try document.mirror.reconcile(sampleSnapshot("written", revision: 1))
            document.updateChangeCount(.changeDone)
            var preparations = 0
            var firstFinalizerAttempts = 0
            var cancellations = 0
            document.prepareResources = { snapshot, _, _ in
                preparations += 1
                let first = preparations == 1
                return PreparedDocumentSave(snapshot: snapshot, didWrite: {
                    if first {
                        firstFinalizerAttempts += 1
                        if firstFinalizerAttempts == 1 { throw NativeEditorError.processLost }
                    }
                }, didFail: { cancellations += 1 })
            }
            do {
                try await saveDocument(document, to: destination, operation: firstOperation)
                XCTFail("Injected post-write failure was swallowed")
            } catch { }
            XCTAssertEqual(try Data(contentsOf: destination), Data("written".utf8))
            XCTAssertTrue(document.isDocumentEdited)
            XCTAssertTrue(document.hasUnautosavedChanges)
            XCTAssertEqual(cancellations, 0, "Committed staged resources must remain available for finalization retry")
            try await saveDocument(document, to: destination, operation: .saveOperation)
            XCTAssertFalse(document.isDocumentEdited)
            XCTAssertFalse(document.hasUnautosavedChanges)
            XCTAssertEqual(firstFinalizerAttempts, 2, "Retry must finish the retained acknowledgement, rather than silently abandon it")
            XCTAssertEqual(try Data(contentsOf: destination), Data("written".utf8))
            let copy = directory.appendingPathComponent("recovered-copy.md")
            try await saveDocument(document, to: copy, operation: .saveAsOperation)
            XCTAssertEqual(try Data(contentsOf: copy), Data("written".utf8))
            document.close()
        }
    }
    @MainActor func testFinalizationRetryDoesNotOverwriteSubsequentExternalEdit() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ret-finalization-conflict-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("sample.md")
        try Data("original".utf8).write(to: url)
        let document = try MarkdownDocument(contentsOf: url, ofType: MarkdownDocument.typeName)
        try document.mirror.reconcile(sampleSnapshot("local", revision: 1))
        document.updateChangeCount(.changeDone)
        var attempts = 0
        document.prepareResources = { snapshot, _, _ in
            PreparedDocumentSave(snapshot: snapshot, didWrite: {
                attempts += 1
                if attempts == 1 { throw NativeEditorError.processLost }
            })
        }
        do { try await saveDocument(document, to: url, operation: .saveOperation); XCTFail("Expected injected finalization failure") } catch { }
        XCTAssertEqual(try Data(contentsOf: url), Data("local".utf8))
        try Data("external".utf8).write(to: url, options: .atomic)
        do { try await saveDocument(document, to: url, operation: .saveOperation); XCTFail("Expected a genuine external conflict") } catch { }
        XCTAssertEqual(try Data(contentsOf: url), Data("external".utf8))
        XCTAssertEqual(attempts, 1, "Conflicting disk identity must be checked before finalization retry")
        XCTAssertTrue(document.isDocumentEdited)
        document.close()
    }
    @MainActor private func saveDocument(_ document: MarkdownDocument, to url: URL, operation: NSDocument.SaveOperationType) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            document.save(to: url, ofType: MarkdownDocument.typeName, for: operation) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }
    @MainActor func testNativeSaveCapturesTokenBeforeResourcePreparationSuspends() async throws {
        let document = MarkdownDocument()
        try document.read(from: Data("nine".utf8), ofType: MarkdownDocument.typeName)
        try document.mirror.reconcile(sampleSnapshot("ten", revision: 10))
        document.updateChangeCount(.changeDone)
        document.prepareResources = { snapshot, _, _ in
            let commit = try sampleCommit(base: 10, revision: 11, insert: "later ")
            try document.bridge.receive(EditorBridge.Envelope(documentID: document.mirror.documentID, sessionID: document.mirror.sessionID,
                id: "during-save", type: .commit, payload: try .encoded(commit)))
            await Task.yield()
            return PreparedDocumentSave(snapshot: snapshot)
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".md")
        defer { try? FileManager.default.removeItem(at: url) }
        // Save to the same named destination to exercise the editable normal-save path.
        try Data("nine".utf8).write(to: url)
        try document.read(from: url, ofType: MarkdownDocument.typeName)
        document.fileURL = url
        try document.mirror.reconcile(sampleSnapshot("ten", revision: 10))
        document.updateChangeCount(.changeDone)
        document.bridge.onError = { _ in } // no web transport in this NSDocument lifecycle test
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            document.save(to: url, ofType: MarkdownDocument.typeName, for: .saveOperation) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
        XCTAssertEqual(try Data(contentsOf: url), Data("ten".utf8))
        XCTAssertEqual(document.mirror.snapshot.text, "later ten")
        XCTAssertTrue(document.isDocumentEdited)
        XCTAssertTrue(document.hasUnautosavedChanges)
        XCTAssertFalse(document.hasUndoManager)
    }
    @MainActor func testPersistentIdentityAdoptionPreservesBytesAndDirtyState() throws {
        let document = MarkdownDocument()
        try document.read(from: Data("original".utf8), ofType: MarkdownDocument.typeName)
        try document.mirror.reconcile(sampleSnapshot("edited", revision: 1))
        let identity = UUID()
        try document.adoptPersistentIdentity(identity)
        XCTAssertEqual(document.documentID, identity)
        XCTAssertEqual(document.mirror.documentID, identity.uuidString)
        XCTAssertEqual(try SourceCodec.encode(document.mirror.snapshot.source), Data("edited".utf8))
        XCTAssertTrue(document.isDocumentEdited)
    }

    @MainActor func testUntitledAutosaveRetainsFormalDirtyButClearsAutosaveNeed() async throws {
        let document = MarkdownDocument()
        try document.mirror.reconcile(sampleSnapshot("draft", revision: 1))
        document.updateChangeCount(.changeDone)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".md")
        defer { try? FileManager.default.removeItem(at: url) }
        // AppKit reserves an autosave destination before invoking the low-level save API.
        try Data().write(to: url)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            document.save(to: url, ofType: MarkdownDocument.typeName, for: .autosaveElsewhereOperation) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
        XCTAssertEqual(try Data(contentsOf: url), Data("draft".utf8))
        XCTAssertTrue(document.isDocumentEdited)
        XCTAssertFalse(document.hasUnautosavedChanges)
        XCTAssertNil(document.fileURL)
    }

    @MainActor func testSave10While11ArrivesWrites10AndKeepsDirty() async throws {
        let mirror = try CommittedMirror(snapshot: sampleSnapshot("r9", revision: 9), documentID: "doc", sessionID: "session")
        try mirror.reconcile(sampleSnapshot("r10", revision: 10))
        var written = Data()
        let coordinator = SaveCoordinator { request in
            try mirror.reconcile(sampleSnapshot("r11", revision: 11))
            written = request.bytes
        }
        let receipt = try await coordinator.save(SaveRequest(snapshot: mirror.snapshot, destination: URL(fileURLWithPath: "/tmp/task2.md")))
        mirror.markSaved(receipt)
        XCTAssertEqual(written, Data("r10".utf8))
        XCTAssertEqual(mirror.snapshot.text, "r11")
        XCTAssertTrue(mirror.isDirty)
    }
    @MainActor func testDelayedOlderRequestNeverOverwritesNewerWrite() async throws {
        var written = Data()
        let coordinator = SaveCoordinator { written = $0.bytes }
        let url = URL(fileURLWithPath: "/tmp/task2.md")
        _ = try await coordinator.save(SaveRequest(snapshot: sampleSnapshot("new", revision: 11), destination: url))
        do {
            _ = try await coordinator.save(SaveRequest(snapshot: sampleSnapshot("old", revision: 10), destination: url))
            XCTFail("stale write accepted")
        } catch { }
        XCTAssertEqual(written, Data("new".utf8))
    }
    @MainActor func testFailureRetainsDirtyMirror() async throws {
        let mirror = try CommittedMirror(snapshot: sampleSnapshot(), documentID: "doc", sessionID: "session")
        try mirror.reconcile(sampleSnapshot("unsaved", revision: 1))
        let coordinator = SaveCoordinator { _ in throw CocoaError(.fileWriteNoPermission) }
        do {
            _ = try await coordinator.save(SaveRequest(snapshot: mirror.snapshot, destination: URL(fileURLWithPath: "/tmp/task2.md")))
            XCTFail("failure swallowed")
        } catch { }
        XCTAssertEqual(mirror.snapshot.text, "unsaved")
        XCTAssertTrue(mirror.isDirty)
    }
    @MainActor func testExternalConflictNeverOverwritesDisk() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("original".utf8).write(to: url)
        let expected = try DiskFingerprint.read(url)
        try Data("external".utf8).write(to: url)
        let coordinator = SaveCoordinator { request in
            try ExternalChanges.requireUnchanged(request.destination, expected: request.expectedDisk)
            try request.bytes.write(to: request.destination)
        }
        do {
            _ = try await coordinator.save(SaveRequest(snapshot: sampleSnapshot("local", revision: 1), destination: url, expectedDisk: expected))
            XCTFail("external change overwritten")
        } catch { }
        XCTAssertEqual(try Data(contentsOf: url), Data("external".utf8))
    }
    @MainActor func testConcurrentRequestsSerializeThroughSuspension() async throws {
        var order: [Int] = []
        let coordinator = SaveCoordinator { request in
            order.append(request.snapshot.revision)
            await Task.yield()
            order.append(request.snapshot.revision)
        }
        let url = URL(fileURLWithPath: "/tmp/task2.md")
        let first = Task { try await coordinator.save(SaveRequest(snapshot: sampleSnapshot("one", revision: 1), destination: url)) }
        await Task.yield()
        let second = Task { try await coordinator.save(SaveRequest(snapshot: sampleSnapshot("two", revision: 2), destination: url)) }
        _ = try await first.value
        _ = try await second.value
        XCTAssertEqual(order, [1, 1, 2, 2])
    }
}
