import AppKit
import WebKit
import UniformTypeIdentifiers

@MainActor
struct PreparedDocumentSave {
    let snapshot: Snapshot
    var didWrite: @MainActor () async throws -> Void = {}
    var didFail: @MainActor () async -> Void = {}
}

/// Only immutable captured bytes cross into NSDocument's nonisolated write APIs.
private final class CapturedWriteState: @unchecked Sendable {
    private let lock = NSLock()
    private var request: SaveRequest?
    func set(_ value: SaveRequest?) { lock.withLock { request = value } }
    func get() -> SaveRequest? { lock.withLock { request } }
}

@MainActor
class MarkdownDocument: NSDocument {
    static let typeName = "net.ret-markdown.markdown"
    private(set) var documentID = UUID()
    private(set) lazy var mirror = try! CommittedMirror(snapshot: Snapshot(), documentID: documentID.uuidString, sessionID: UUID().uuidString)
    private(set) lazy var bridge: EditorBridge = makeBridge()
    var prepareResources: ((Snapshot, URL, NSDocument.SaveOperationType) async throws -> PreparedDocumentSave)?
    var persistDraft: ((Snapshot, UUID) async throws -> Void)?
    var exportPDF: ((Snapshot, URL) async throws -> Void)?
    var configureWebView: ((WKWebViewConfiguration) -> Void)?
    var assetRequest: ((String, String) async throws -> Void)?
    var assetBase = "ret-resource://"
    var refreshAssets: ((Snapshot) async throws -> [String: String])?
    var handleDrop: ((NSPasteboard) -> Bool)?
    var restoreDraft: ((UUID) async throws -> Snapshot?)?
    var onIdentityRestored: ((UUID) -> Void)?
    var onRecoverySessionReset: (() -> Void)?
    private var restorationTask: Task<Void, Error>?
    func prepareEditorLoad() async throws {
        try await restorationTask?.value
        if let refreshAssets { bridge.assetMap = try await refreshAssets(mirror.snapshot) }
    }
    private var diskFingerprint: DiskFingerprint?
    private var saveTail: Task<Void, Never>?
    private var pendingNativeSaves = 0
    private struct AutosavePreparation {
        let prepared: PreparedDocumentSave
        let tokens: [NSDocument.SaveOperationType: Any]
        let sessionID: String
    }
    private var autosavePreparation: AutosavePreparation?
    private var capturedChangeToken: Any?
    private var revisionTokens: [Revision: [NSDocument.SaveOperationType: Any]] = [:]
    private var saveOperation: NSDocument.SaveOperationType = .saveOperation
    private var saveType = typeName
    private struct PendingFinalization {
        let request: SaveRequest
        let receipt: SaveReceipt
        let prepared: PreparedDocumentSave
        let operation: NSDocument.SaveOperationType
        let fingerprint: DiskFingerprint
        let requiresEditorLock: Bool
    }
    private var pendingFinalization: PendingFinalization?
    private var finalizationFailed = false
    private var restoredUnsaved = false
    private var autosavedHash: String?
    private var showingConflict = false
    nonisolated private let writeState = CapturedWriteState()
    private lazy var saveCoordinator = makeSaveCoordinator()
    private func makeSaveCoordinator() -> SaveCoordinator { SaveCoordinator { [weak self] request in
        guard let self else { throw NativeEditorError.unavailable }
        self.writeState.set(request)
        defer { self.writeState.set(nil) }
        try await self.writeUsingDocumentLifecycle(request)
    } }

    override init() {
        super.init()
        hasUndoManager = false
        fileType = Self.typeName
    }
    override nonisolated class var autosavesInPlace: Bool { true }
    override class var autosavesDrafts: Bool { true }
    override nonisolated class var preservesVersions: Bool { true }
    override nonisolated class func canConcurrentlyReadDocuments(ofType typeName: String) -> Bool { false }
    override var isDocumentEdited: Bool { mirror.isDirty || restoredUnsaved || finalizationFailed || pendingFinalization != nil }
    override func updateChangeCount(_ change: NSDocument.ChangeType) {
        if change == .changeReadOtherContents { restoredUnsaved = true }
        if change == .changeCleared { restoredUnsaved = false }
        super.updateChangeCount(change)
    }
    override var hasUnautosavedChanges: Bool { finalizationFailed || pendingFinalization != nil || (autosavedHash.map { $0 != mirror.currentHash } ?? mirror.isDirty) }

    private func makeBridge() -> EditorBridge {
        let value = EditorBridge(mirror: mirror)
        value.assetBase = assetBase
        value.onCommit = { [weak self] in
            guard let self else { return }
            self.updateChangeCount(.changeDone)
            self.rememberChangeTokens()
            self.windowControllers.forEach { $0.setDocumentEdited(self.isDocumentEdited) }
            if let persistDraft = self.persistDraft {
                let snapshot = self.mirror.snapshot
                Task { do { try await persistDraft(snapshot, self.documentID) } catch { self.presentError(error) } }
            }
        }
        value.onError = { [weak self] error in self?.presentEditorError(error) }
        value.onAssetRequest = { [weak self] action, requestID in
            guard let handler = self?.assetRequest else { throw NativeEditorError.unavailable }
            try await handler(action, requestID)
        }
        return value
    }
    /// Call before constructing a web session when durable provenance identifies a named file.
    func adoptPersistentIdentity(_ identity: UUID) throws {
        guard identity != documentID else { return }
        guard windowControllers.isEmpty else { throw NativeEditorError.wrongSession }
        let previous = mirror
        documentID = identity
        mirror = try CommittedMirror(snapshot: previous.snapshot, documentID: identity.uuidString, sessionID: UUID().uuidString, savedHash: previous.savedHash)
        bridge = makeBridge()
        onIdentityRestored?(identity)
    }
    override func makeWindowControllers() {
        guard windowControllers.isEmpty else { return }
        do { addWindowController(try DocumentWindowController(document: self)) }
        catch { presentError(error) }
    }
    override nonisolated func read(from data: Data, ofType typeName: String) throws {
        let source = try SourceCodec.decode(data)
        try MainActor.assumeIsolated {
            mirror = try CommittedMirror(snapshot: Snapshot(source: source), documentID: documentID.uuidString, sessionID: UUID().uuidString)
            bridge = makeBridge()
            onRecoverySessionReset?()
            revisionTokens.removeAll()
            saveCoordinator = makeSaveCoordinator()
            pendingFinalization = nil
            finalizationFailed = false
            autosavedHash = nil
        }
    }
    override nonisolated func read(from url: URL, ofType typeName: String) throws {
        let coordinator = NSFileCoordinator(filePresenter: self)
        var coordinationError: NSError?
        var result: Result<Void, Error> = .failure(NativeEditorError.unavailable)
        coordinator.coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinatedURL in
            result = Result {
                let bytes = try Data(contentsOf: coordinatedURL)
                let fingerprint = try DiskFingerprint.fromBytes(bytes, at: coordinatedURL)
                try read(from: bytes, ofType: typeName)
                MainActor.assumeIsolated { diskFingerprint = fingerprint }
            }
        }
        if let coordinationError { throw coordinationError }
        try result.get()
    }
    override nonisolated func data(ofType typeName: String) throws -> Data {
        guard let request = writeState.get() else {
            // Versions/duplication may request data outside save(to:); this is acknowledged source only.
            return try MainActor.assumeIsolated { try SourceCodec.encode(mirror.snapshot.source) }
        }
        return request.bytes
    }
    override func canAsynchronouslyWrite(to url: URL, ofType typeName: String, for saveOperation: NSDocument.SaveOperationType) -> Bool { false }
    override func changeCountToken(for saveOperation: NSDocument.SaveOperationType) -> Any {
        capturedChangeToken ?? super.changeCountToken(for: saveOperation)
    }
    override nonisolated func writeSafely(to url: URL, ofType typeName: String, for saveOperation: NSDocument.SaveOperationType) throws {
        guard let request = writeState.get() else {
            throw NativeEditorError.unavailable
        }
        let coordinator = NSFileCoordinator(filePresenter: self)
        var coordinationError: NSError?
        var result: Result<Void, Error> = .failure(NativeEditorError.unavailable)
        coordinator.coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { coordinatedURL in
            result = Result {
                try ExternalChanges.requireUnchanged(coordinatedURL, expected: request.expectedDisk)
                try super.writeSafely(to: coordinatedURL, ofType: typeName, for: saveOperation)
            }
        }
        if let coordinationError { throw coordinationError }
        try result.get()
    }
    /// A new synchronous AppKit activity must not block the executor needed by the pending JS barrier.
    /// Delay the public entry point before AppKit creates that activity; retain its delegate until resumed.
    @discardableResult
    private func deferActivityWhileSaving(_ action: @escaping @MainActor () -> Void) -> Bool {
        guard pendingNativeSaves > 0, let previous = saveTail else { return false }
        Task { @MainActor in
            await previous.value
            if !deferActivityWhileSaving(action) { continueActivity(action) }
        }
        return true
    }
    override func save(withDelegate delegate: Any?, didSave selector: Selector?, contextInfo: UnsafeMutableRawPointer?) {
        if deferActivityWhileSaving({ [self] in
            save(withDelegate: delegate, didSave: selector, contextInfo: contextInfo)
        }) { return }
        super.save(withDelegate: delegate, didSave: selector, contextInfo: contextInfo)
    }
    override func saveAs(_ sender: Any?) {
        if deferActivityWhileSaving({ [self] in saveAs(sender) }) { return }
        super.saveAs(sender)
    }
    override func revertToSaved(_ sender: Any?) {
        if deferActivityWhileSaving({ [self] in revertToSaved(sender) }) { return }
        super.revertToSaved(sender)
    }
    override func browseVersions(_ sender: Any?) {
        if deferActivityWhileSaving({ [self] in browseVersions(sender) }) { return }
        super.browseVersions(sender)
    }
    override func autosave(withImplicitCancellability cancellable: Bool, completionHandler: @escaping (Error?) -> Void) {
        let previous = saveTail
        pendingNativeSaves += 1
        let work = Task { @MainActor in
            defer { pendingNativeSaves -= 1; autosavePreparation = nil }
            await previous?.value
            do {
                try await retryPendingFinalization()
                rememberChangeTokens()
                let sessionID = mirror.sessionID
                let snapshot = bridge.isReady ? try await bridge.snapshot(purpose: .save) : try acknowledgedSnapshotForSave()
                guard let tokens = revisionTokens[snapshot.revision] else { throw NativeEditorError.staleSnapshot }
                let prepared: PreparedDocumentSave
                if let url = fileURL, let prepareResources {
                    prepared = try await prepareResources(snapshot, url, .autosaveInPlaceOperation)
                } else {
                    // Untitled autosave is a draft generation; AppKit chooses the Markdown autosave URL later.
                    try await persistDraft?(snapshot, documentID)
                    prepared = PreparedDocumentSave(snapshot: snapshot)
                }
                autosavePreparation = AutosavePreparation(prepared: prepared, tokens: tokens, sessionID: sessionID)
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                    continueAsynchronousWorkOnMainThread { [self] in
                        MainActor.assumeIsolated {
                            beginPreparedAutosave(cancellable: cancellable) { error in
                                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                            }
                        }
                    }
                }
                if let unused = autosavePreparation { await unused.prepared.didFail(); autosavePreparation = nil }
                await completeNativeSave(completionHandler, error: nil)
            } catch {
                if let unused = autosavePreparation { await unused.prepared.didFail(); autosavePreparation = nil }
                await completeNativeSave(completionHandler, error: error)
            }
        }
        saveTail = work
    }
    private func beginPreparedAutosave(cancellable: Bool, completion: @escaping (Error?) -> Void) {
        continueActivity {
            super.autosave(withImplicitCancellability: cancellable, completionHandler: completion)
        }
    }
    private func writePreparedAutosave(_ capture: AutosavePreparation, to url: URL, typeName: String,
                                       operation: NSDocument.SaveOperationType, completion: @escaping (Error?) -> Void) {
        do {
            guard capture.sessionID == mirror.sessionID, let token = capture.tokens[operation] else { throw NativeEditorError.wrongSession }
            let expected = fileURL?.standardizedFileURL == url.standardizedFileURL ? diskFingerprint : try DiskFingerprint.read(url)
            let request = try SaveRequest(snapshot: capture.prepared.snapshot, destination: url, operation: .autosave, expectedDisk: expected)
            try saveCoordinator.validateCapturedRequest(request)
            capturedChangeToken = token
            saveType = typeName; saveOperation = operation
            writeState.set(request)
            // Do not dispatch this call: autosave's native asynchronous file-access nesting is still active here.
            performCapturedNativeSave(request) { [self] error in
                writeState.set(nil)
                capturedChangeToken = nil
                Task { @MainActor in
                    var wrote = false
                    do {
                        if let error { throw error }
                        wrote = true
                        let receipt = saveCoordinator.receiptForCompletedWrite(request)
                        let pending = try recordCommittedWrite(request, receipt: receipt, prepared: capture.prepared, operation: operation, requiresEditorLock: false)
                        try await finishFinalization(pending)
                        await completeNativeSave(completion, error: nil)
                    } catch {
                        if wrote { finalizationFailed = true; updateChangeCount(.changeDone) }
                        else { await capture.prepared.didFail() }
                        await completeNativeSave(completion, error: error)
                    }
                }
            }
        } catch {
            Task { @MainActor in
                await capture.prepared.didFail()
                await completeNativeSave(completion, error: error)
            }
        }
    }
    override func save(to url: URL, ofType typeName: String, for operation: NSDocument.SaveOperationType,
                       completionHandler: @escaping (Error?) -> Void) {
        if [.autosaveInPlaceOperation, .autosaveElsewhereOperation, .autosaveAsOperation].contains(operation), let capture = autosavePreparation {
            autosavePreparation = nil
            writePreparedAutosave(capture, to: url, typeName: typeName, operation: operation, completion: completionHandler)
            return
        }
        let previous = saveTail
        pendingNativeSaves += 1
        let work = Task { @MainActor in
            defer { pendingNativeSaves -= 1 }
            await previous?.value
            var locked = false
            var preparedForFailure: PreparedDocumentSave?
            do {
                try await retryPendingFinalization()
                let migrates = bridge.isReady && prepareResources != nil && (fileURL == nil || fileURL?.standardizedFileURL != url.standardizedFileURL) && operation != .autosaveElsewhereOperation
                if migrates {
                    try await bridge.send(command: EditorCommand(name: "setReadOnly", args: .object(["value": .bool(true)])))
                    locked = true
                }
                let sessionID = mirror.sessionID
                rememberChangeTokens()
                let snapshot = bridge.isReady ? try await bridge.snapshot(purpose: .save) : try acknowledgedSnapshotForSave()
                // Capture precisely at the snapshot boundary, before resource staging can suspend.
                guard let token = revisionTokens[snapshot.revision]?[operation] else { throw NativeEditorError.staleSnapshot }
                capturedChangeToken = token
                defer { capturedChangeToken = nil }
                let prepared: PreparedDocumentSave
                if let prepareResources { prepared = try await prepareResources(snapshot, url, operation) }
                else { prepared = PreparedDocumentSave(snapshot: snapshot) }
                preparedForFailure = prepared
                guard sessionID == mirror.sessionID else { throw NativeEditorError.wrongSession }
                let expected = fileURL?.standardizedFileURL == url.standardizedFileURL ? diskFingerprint : try DiskFingerprint.read(url)
                saveOperation = operation; saveType = typeName
                let request = try SaveRequest(snapshot: prepared.snapshot, destination: url,
                    operation: operation == .saveAsOperation ? .saveAs : (operation == .saveOperation ? .save : .autosave), expectedDisk: expected)
                let receipt = try await saveCoordinator.save(request)
                preparedForFailure = nil
                let pending = try recordCommittedWrite(request, receipt: receipt, prepared: prepared,
                    operation: operation, requiresEditorLock: locked)
                try await finishFinalization(pending)
                if locked { try await bridge.send(command: EditorCommand(name: "setReadOnly", args: .object(["value": .bool(false)]))); locked = false }
                await completeNativeSave(completionHandler, error: nil)
            } catch {
                if pendingFinalization != nil {
                    finalizationFailed = true
                    updateChangeCount(.changeDone)
                }
                await preparedForFailure?.didFail()
                if locked { try? await bridge.send(command: EditorCommand(name: "setReadOnly", args: .object(["value": .bool(false)]))) }
                await completeNativeSave(completionHandler, error: error)
            }
        }
        saveTail = work
    }
    private func recordCommittedWrite(_ request: SaveRequest, receipt: SaveReceipt, prepared: PreparedDocumentSave,
                                      operation: NSDocument.SaveOperationType, requiresEditorLock: Bool) throws -> PendingFinalization {
        // A disk commit precedes asynchronous resource/JS acknowledgement and cannot be rolled back by its failure.
        let fingerprint = try DiskFingerprint.fromBytes(request.bytes, at: request.destination)
        if operation != .saveToOperation && operation != .autosaveElsewhereOperation { diskFingerprint = fingerprint }
        let pending = PendingFinalization(request: request, receipt: receipt, prepared: prepared, operation: operation,
            fingerprint: fingerprint, requiresEditorLock: requiresEditorLock)
        pendingFinalization = pending
        return pending
    }
    private func retryPendingFinalization() async throws {
        guard let pending = pendingFinalization else { return }
        var locked = false
        do {
            if pending.requiresEditorLock && bridge.isReady {
                try await bridge.send(command: EditorCommand(name: "setReadOnly", args: .object(["value": .bool(true)])))
                locked = true
            }
            try ExternalChanges.requireUnchanged(pending.request.destination, expected: pending.fingerprint)
            try await finishFinalization(pending)
            if locked { try await bridge.send(command: EditorCommand(name: "setReadOnly", args: .object(["value": .bool(false)]))) }
        } catch {
            if locked { try? await bridge.send(command: EditorCommand(name: "setReadOnly", args: .object(["value": .bool(false)]))) }
            throw error
        }
    }
    private func finishFinalization(_ pending: PendingFinalization) async throws {
        try await pending.prepared.didWrite()
        if pending.operation != .saveToOperation {
            autosavedHash = pending.receipt.contentHash
            if pending.operation != .autosaveElsewhereOperation {
                mirror.markSaved(pending.receipt)
                restoredUnsaved = false
            }
        }
        finalizationFailed = false
        pendingFinalization = nil
        windowControllers.forEach { $0.setDocumentEdited(isDocumentEdited) }
        // saved is informational; a missing receipt never invalidates a successful disk commit.
        if bridge.isReady { try? await bridge.saved(pending.receipt) }
    }
    private func rememberChangeTokens() {
        let operations: [NSDocument.SaveOperationType] = [.saveOperation, .saveAsOperation, .saveToOperation, .autosaveInPlaceOperation, .autosaveElsewhereOperation, .autosaveAsOperation]
        revisionTokens[mirror.snapshot.revision] = Dictionary(uniqueKeysWithValues: operations.map { ($0, super.changeCountToken(for: $0)) })
        if revisionTokens.count > 2048 {
            for revision in revisionTokens.keys.sorted().prefix(revisionTokens.count - 2048) { revisionTokens.removeValue(forKey: revision) }
        }
    }
    private func acknowledgedSnapshotForSave() throws -> Snapshot {
        // Before a web session exists (restoration), the acknowledged mirror is authoritative.
        guard windowControllers.isEmpty else {
            throw NativeEditorError.unavailable
        }
        return mirror.snapshot
    }
    private func writeUsingDocumentLifecycle(_ request: SaveRequest) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            continueAsynchronousWorkOnMainThread { [self] in
                MainActor.assumeIsolated {
                    performCapturedNativeSave(request) { error in
                        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                    }
                }
            }
        }
    }
    private func performCapturedNativeSave(_ request: SaveRequest, completion: @escaping (Error?) -> Void) {
        continueActivity {
            super.save(to: request.destination, ofType: saveType, for: saveOperation, completionHandler: completion)
        }
    }
    private func completeNativeSave(_ completion: @escaping (Error?) -> Void, error: Error?) async {
        await withCheckedContinuation { continuation in
            continueAsynchronousWorkOnMainThread { [self] in
                MainActor.assumeIsolated {
                    continueActivity {
                        completion(error)
                        continuation.resume()
                    }
                }
            }
        }
    }
    override func canClose(withDelegate delegate: Any, shouldClose shouldCloseSelector: Selector?, contextInfo: UnsafeMutableRawPointer?) {
        if deferActivityWhileSaving({ [self] in
            canClose(withDelegate: delegate, shouldClose: shouldCloseSelector, contextInfo: contextInfo)
        }) { return }
        Task { @MainActor in
            do {
                if bridge.isReady { _ = try await bridge.snapshot(purpose: .close) }
                else if !windowControllers.isEmpty { throw NativeEditorError.unavailable }
                // AppKit owns close preference handling, save prompts, drafts and restoration.
                let close: @MainActor () -> Void = { [self] in
                    continueNativeClose(withDelegate: delegate, shouldClose: shouldCloseSelector, contextInfo: contextInfo)
                }
                if !deferActivityWhileSaving(close) { close() }
            } catch {
                presentError(error)
                if let selector = shouldCloseSelector, let object = delegate as? NSObject {
                    typealias Callback = @convention(c) (AnyObject, Selector, NSDocument, Bool, UnsafeMutableRawPointer?) -> Void
                    let callback = unsafeBitCast(object.method(for: selector), to: Callback.self)
                    callback(object, selector, self, false, contextInfo)
                }
            }
        }
    }
    private func continueNativeClose(withDelegate delegate: Any, shouldClose selector: Selector?, contextInfo: UnsafeMutableRawPointer?) {
        continueActivity {
            super.canClose(withDelegate: delegate, shouldClose: selector, contextInfo: contextInfo)
        }
    }
    override func revert(toContentsOf url: URL, ofType typeName: String) throws {
        try super.revert(toContentsOf: url, ofType: typeName)
        finalizationFailed = false
        if !windowControllers.isEmpty { try reloadEditor() }
    }
    override func encodeRestorableState(with coder: NSCoder) {
        super.encodeRestorableState(with: coder)
        coder.encode(documentID.uuidString, forKey: "ReT.documentID")
    }
    override func restoreState(with coder: NSCoder) {
        if let id = coder.decodeObject(of: NSString.self, forKey: "ReT.documentID") as String?, let uuid = UUID(uuidString: id) {
            let previous = mirror
            documentID = uuid
            do {
                mirror = try CommittedMirror(snapshot: previous.snapshot, documentID: uuid.uuidString, sessionID: UUID().uuidString, savedHash: previous.savedHash)
                bridge = makeBridge()
                onIdentityRestored?(uuid)
                let needsRecovery = fileURL == nil || autosavedContentsFileURL != nil || restoredUnsaved
                restorationTask = Task { @MainActor in
                    if needsRecovery, let recovered = try await restoreDraft?(uuid) {
                        mirror = try CommittedMirror(snapshot: recovered, documentID: uuid.uuidString, sessionID: UUID().uuidString, savedHash: previous.savedHash)
                        bridge = makeBridge()
                        updateChangeCount(.changeReadOtherContents)
                    }
                }
            } catch { presentError(error) }
        }
        super.restoreState(with: coder)
    }
    override nonisolated func presentedItemDidChange() {
        Task { @MainActor [weak self] in await self?.checkExternalChange() }
    }
    private func checkExternalChange() async {
        guard let url = fileURL, writeState.get() == nil else { return }
        do {
            guard try DiskFingerprint.read(url) != diskFingerprint else { return }
            if bridge.isReady { _ = try await bridge.snapshot(purpose: .save) }
            else if !windowControllers.isEmpty { throw NativeEditorError.unavailable }
            if !isDocumentEdited {
                try revert(toContentsOf: url, ofType: fileType ?? Self.typeName)
            } else { showExternalConflict() }
        } catch { presentError(error) }
    }
    private func showExternalConflict() {
        guard !showingConflict, let window = windowForSheet else { return }
        showingConflict = true
        let alert = NSAlert()
        alert.messageText = "This file changed outside ReT Markdown."
        alert.informativeText = "Keep your edits in a separate file, load the external version, or cancel."
        alert.addButton(withTitle: "Save Local Copy…"); alert.addButton(withTitle: "Load External Version"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }; showingConflict = false
            if response == .alertFirstButtonReturn { saveAs(nil) }
            else if response == .alertSecondButtonReturn, let url = fileURL {
                do { try revert(toContentsOf: url, ofType: fileType ?? Self.typeName) } catch { presentError(error) }
            }
        }
    }
    func reloadEditor() throws {
        mirror.restartSession(UUID().uuidString)
        bridge = makeBridge()
        for controller in windowControllers { try (controller as? DocumentWindowController)?.reloadEditor() }
    }
    func presentEditorError(_ error: Error) {
        if case NativeEditorError.externalConflict = error { showExternalConflict(); return }
        if case NativeEditorError.processLost = error, let window = windowForSheet {
            let alert = NSAlert(); alert.messageText = "The editor stopped."
            alert.informativeText = "Recover the last acknowledged text. Unacknowledged keystrokes may not be recoverable."
            alert.addButton(withTitle: "Recover Editor"); alert.addButton(withTitle: "Cancel")
            alert.beginSheetModal(for: window) { [weak self] response in
                if response == .alertFirstButtonReturn { do { try self?.reloadEditor() } catch { self?.presentError(error) } }
            }
        } else { presentError(error) }
    }
    @objc func exportPDFDocument(_ sender: Any?) {
        guard let exportPDF else { presentError(NativeEditorError.unavailable); return }
        let panel = NSSavePanel(); panel.allowedContentTypes = [.pdf]; panel.nameFieldStringValue = (fileURL?.deletingPathExtension().lastPathComponent ?? "Untitled") + ".pdf"
        guard let window = windowForSheet else { return }
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url, let self else { return }
            Task { do { try await exportPDF(bridge.snapshot(purpose: .export), url) } catch { presentError(error) } }
        }
    }
}
