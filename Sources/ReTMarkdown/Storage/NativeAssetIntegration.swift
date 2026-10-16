import AppKit
import WebKit
import UniformTypeIdentifiers

/// The only AppKit adapter owned by Task 5. NSDocument and the editor retain their lifecycle/history.
/// Hooks retain this adapter; it weakly references its document, so no document cycle is introduced.
@MainActor
final class NativeAssetIntegration {
    private weak var document: MarkdownDocument?
    private let rootURL: URL
    private var identity: UUID
    private var store: AssetStore
    private var drafts: DraftStore
    private var handler: AssetSchemeHandler
    private var bindingError: Error?
    private var liveDestinations: Set<String>?
    private var liveMap: [String: String] = [:]
    private var bindingToken = UUID()
    private var recoveryPath: String?
    private var sessionTask: Task<UUID, Error>?

    @discardableResult
    static func install(on document: MarkdownDocument, rootURL: URL? = nil) throws -> NativeAssetIntegration {
        let root = rootURL ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ReTMarkdown", isDirectory: true)
        if let url = document.fileURL, let id = try AssetStore.documentIdentity(for: url, rootURL: root.appendingPathComponent("provenance")) {
            try document.adoptPersistentIdentity(id)
        }
        let adapter = try NativeAssetIntegration(document: document, rootURL: root)
        document.assetBase = "ret-resource://asset/"
        document.configureWebView = { [adapter] configuration in
            configuration.setURLSchemeHandler(adapter.handler, forURLScheme: AssetSchemeHandler.scheme)
        }
        document.refreshAssets = { [adapter] snapshot in try await adapter.refreshLiveAssets(snapshot: snapshot, send: false) }
        document.prepareResources = { [adapter] snapshot, url, operation in
            try await adapter.prepare(snapshot: snapshot, to: url, operation: operation)
        }
        adapter.rotateRecoverySession()
        document.onRecoverySessionReset = { [adapter] in
            do {
                adapter.store = try AssetStore(documentID: adapter.identity,
                    rootURL: adapter.rootURL.appendingPathComponent("provenance"), documentURL: adapter.document?.fileURL)
                adapter.rotateRecoverySession()
            } catch { adapter.bindingError = error }
        }
        document.restoreDraft = { [adapter] id in
            try adapter.requireIdentity(id)
            let token = adapter.bindingToken, drafts = adapter.drafts
            guard let recovery = try await drafts.recover(), token == adapter.bindingToken else { return nil }
            adapter.store = try AssetStore(documentID: id, rootURL: adapter.rootURL.appendingPathComponent("provenance"),
                documentURL: adapter.document?.fileURL, recoveredManifest: recovery.manifest)
            adapter.handler.update(manifest: recovery.manifest)
            adapter.rotateRecoverySession()
            return recovery.snapshot
        }
        document.onIdentityRestored = { [adapter] id in
            do { try adapter.requireIdentity(id) } catch { adapter.bindingError = error }
        }
        document.assetRequest = { [adapter] action, _ in
            if action == "choose" { try await adapter.chooseImages() }
            else if action == "paste" {
                let images = adapter.images(from: .general)
                guard !images.isEmpty else { throw AssetStorageError.unsupportedImage }
                try await adapter.insert(images)
            }
            // Actual drag bytes come exclusively from handleDrop, never a web-provided path.
            else if action != "drop" { throw AssetStorageError.invalidPath }
        }
        document.handleDrop = { [adapter] pasteboard in
            let images = adapter.images(from: pasteboard)
            guard !images.isEmpty else { return false }
            Task { do { try await adapter.insert(images) } catch { adapter.document?.presentError(error) } }
            return true
        }
        return adapter
    }

    private init(document: MarkdownDocument, rootURL: URL) throws {
        self.document = document; self.rootURL = rootURL; identity = document.documentID
        store = try AssetStore(documentID: document.documentID, rootURL: rootURL.appendingPathComponent("provenance"), documentURL: document.fileURL)
        drafts = DraftStore(rootURL: rootURL.appendingPathComponent("drafts"), documentID: document.documentID, documentURL: document.fileURL)
        handler = AssetSchemeHandler(manifest: AssetManifest(documentID: document.documentID, documentURL: document.fileURL,
            resourceDirectoryURL: rootURL.appendingPathComponent("provenance/\(document.documentID.uuidString)/assets")))
    }

    private func requireIdentity(_ id: UUID) throws {
        if let bindingError { throw bindingError }
        guard id != identity else { return }
        store = try AssetStore(documentID: id, rootURL: rootURL.appendingPathComponent("provenance"), documentURL: document?.fileURL)
        drafts = DraftStore(rootURL: rootURL.appendingPathComponent("drafts"), documentID: id, documentURL: document?.fileURL)
        identity = id
        liveDestinations = nil
        liveMap = [:]
        bindingError = nil
        rotateRecoverySession()
    }

    /// Install a new closure synchronously, so a Task captured at commit keeps its old binding.
    /// Epoch creation is serialized before writes, without blocking MainActor on filesystem work.
    private func rotateRecoverySession() {
        let token = UUID(), id = identity, store = self.store
        bindingToken = token
        recoveryPath = document?.fileURL.map(AssetIO.canonicalPath)
        let drafts = DraftStore(rootURL: rootURL.appendingPathComponent("drafts"), documentID: id,
            documentURL: document?.fileURL)
        self.drafts = drafts
        let previous = sessionTask
        let epoch = Task { _ = try? await previous?.value; return try await drafts.beginSession() }
        sessionTask = epoch
        liveDestinations = nil
        liveMap = [:]
        document?.persistDraft = { [self, drafts, store, epoch] snapshot, suppliedID in
            guard token == bindingToken, let document,
                  snapshot == document.mirror.snapshot else { return }
            guard suppliedID == id else { throw AssetStorageError.wrongDocument }
            if let bindingError { throw bindingError }
            let session = try await epoch.value
            guard token == bindingToken, snapshot == document.mirror.snapshot else { return }
            let manifest = await store.manifest
            guard token == bindingToken, snapshot == document.mirror.snapshot else { return }
            do { try await drafts.persist(snapshot: snapshot, manifest: manifest, sessionID: session) }
            catch AssetStorageError.staleDraft { return }
            guard token == bindingToken, snapshot == document.mirror.snapshot else { return }
            _ = try await refreshLiveAssets(snapshot: snapshot, send: true)
        }
    }

    /// PDF receives a frozen independent value. Live views keep old capability tokens for undo/versions.
    func authorizedManifest(for snapshot: Snapshot) async throws -> AssetManifest {
        if let bindingError { throw bindingError }
        let manifest = try await store.authorizedManifest(destinations: AssetReferences.scan(snapshot.text).map(\.destination))
        handler.update(manifest: manifest)
        return manifest
    }

    private func refreshLiveAssets(snapshot: Snapshot, send: Bool) async throws -> [String: String] {
        let token = bindingToken
        let destinations = Set(AssetReferences.scan(snapshot.text).map(\.destination))
        if destinations != liveDestinations {
            let frozen = try await store.authorizedManifest(destinations: Array(destinations))
            guard token == bindingToken, document?.mirror.snapshot == snapshot else { return liveMap }
            handler.update(manifest: frozen)
            liveDestinations = destinations
            liveMap = frozen.capabilityMap
        }
        if let document {
            document.bridge.assetMap = liveMap
            if send && document.bridge.isReady {
                try await document.bridge.send(command: EditorCommand(name: "setAssets", args: .object(["assets": try .encoded(liveMap)])))
            }
        }
        return liveMap
    }

    private func prepare(snapshot: Snapshot, to url: URL, operation: NSDocument.SaveOperationType) async throws -> PreparedDocumentSave {
        guard let document else { throw NativeEditorError.unavailable }
        if let bindingError { throw bindingError }
        // Untitled autosave is recovery storage, not the user's first formal save location.
        if operation == .autosaveElsewhereOperation {
            let drafts = self.drafts, store = self.store, token = bindingToken
            guard let sessionTask else { throw NativeEditorError.unavailable }
            let session = try await sessionTask.value
            guard token == bindingToken else { throw AssetStorageError.staleDraft }
            try await drafts.persist(snapshot: snapshot, manifest: store.manifest, sessionID: session)
            return PreparedDocumentSave(snapshot: snapshot)
        }
        // An in-place save after Finder/NSDocument rename keeps the original resource directory.
        if document.fileURL?.standardizedFileURL == url.standardizedFileURL {
            let store = self.store
            return PreparedDocumentSave(snapshot: snapshot, didWrite: { [self] in
                try await store.documentDidRename(to: url)
                if recoveryPath != AssetIO.canonicalPath(url) { rotateRecoverySession() }
            })
        }
        guard operation == .saveOperation || operation == .saveAsOperation || operation == .saveToOperation else {
            return PreparedDocumentSave(snapshot: snapshot)
        }
        let store: AssetStore
        if operation == .saveToOperation {
            store = try AssetStore(documentID: identity, rootURL: rootURL.appendingPathComponent("provenance"),
                documentURL: document.fileURL, recoveredManifest: await self.store.manifest)
        } else { store = self.store }
        let migration = try await store.planMigration(snapshot: snapshot, to: url)
        if !migration.unmanagedBrokenReferences.isEmpty {
            guard await acceptBreakage(migration.unmanagedBrokenReferences) else { throw CocoaError(.userCancelled) }
        }
        let staged = try await store.stageMigration(migration, acceptingUnmanagedBreakage: true)
        var adopted = false, patchesApplied = migration.patches.isEmpty
        return PreparedDocumentSave(snapshot: migration.candidateSnapshot, didWrite: { [self, weak document] in
            guard let document else { throw NativeEditorError.unavailable }
            // Save To publishes the independent copy's provenance but leaves the live document alone.
            if !adopted {
                _ = try await store.adoptMigration(staged)
                adopted = true
                if operation != .saveToOperation { rotateRecoverySession() }
            }
            if operation == .saveToOperation { return }
            if !patchesApplied {
                if document.mirror.snapshot.source == migration.candidateSnapshot.source {
                    patchesApplied = true // Commit arrived but its command acknowledgement was lost.
                } else {
                    guard document.bridge.isReady else { throw NativeEditorError.unavailable }
                    do {
                        try await document.bridge.applyPatches(base: snapshot.revision, patches: migration.patches)
                        patchesApplied = true
                    } catch {
                        if document.mirror.snapshot.source == migration.candidateSnapshot.source { patchesApplied = true }
                        throw error
                    }
                }
            }
            let frozen = try await authorizedManifest(for: document.mirror.snapshot)
            document.bridge.assetMap = frozen.capabilityMap
            liveDestinations = Set(AssetReferences.scan(document.mirror.snapshot.text).map(\.destination))
            liveMap = frozen.capabilityMap
            if document.bridge.isReady {
                try await document.bridge.send(command: EditorCommand(name: "setAssets", args: .object(["assets": try .encoded(frozen.capabilityMap)])))
            }
        }, didFail: { [weak document] in
            do { try await store.cancelMigration(staged) }
            catch { document?.presentError(error) }
        })
    }

    private func acceptBreakage(_ references: [UnmanagedAssetBreakage]) async -> Bool {
        guard let window = document?.windowForSheet else { return false }
        let alert = NSAlert()
        alert.messageText = "Some local image references will change location."
        alert.informativeText = references.map(\.destination).joined(separator: "\n") + "\n\nSave As keeps these unmanaged references unchanged. Continue with these broken references?"
        alert.addButton(withTitle: "Save with Broken References"); alert.addButton(withTitle: "Cancel")
        return await withCheckedContinuation { continuation in
            alert.beginSheetModal(for: window) { continuation.resume(returning: $0 == .alertFirstButtonReturn) }
        }
    }

    private enum ImageInput {
        case bytes(Data, String)
        case file(URL)
    }
    // Capture pasteboard values synchronously; drag pasteboards are not valid after the callback returns.
    private func images(from pasteboard: NSPasteboard) -> [ImageInput] {
        let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        let files = urls.filter { $0.isFileURL && UTType(filenameExtension: $0.pathExtension)?.conforms(to: .image) == true }
        if !files.isEmpty { return files.map(ImageInput.file) }
        if let data = pasteboard.data(forType: .png), (try? AssetIO.image(data)) != nil { return [.bytes(data, "pasted.png")] }
        if let data = pasteboard.data(forType: .tiff), (try? AssetIO.image(data)) != nil { return [.bytes(data, "pasted.tiff")] }
        return []
    }
    private func chooseImages() async throws {
        guard let window = document?.windowForSheet else { throw NativeEditorError.unavailable }
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.image]; panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        let response = await withCheckedContinuation { continuation in
            panel.beginSheetModal(for: window) { continuation.resume(returning: $0) }
        }
        if response == .OK { try await insert(panel.urls.map(ImageInput.file)) }
    }
    private func insert(_ images: [ImageInput]) async throws {
        guard let document, document.bridge.isReady else { throw NativeEditorError.unavailable }
        var destinations: [String] = []
        for image in images {
            let bytes: Data, name: String
            switch image {
            case .bytes(let data, let suggestedName): bytes = data; name = suggestedName
            case .file(let url): bytes = try AssetIO.read(url); name = url.lastPathComponent
            }
            let imported = try await store.importImage(data: bytes, suggestedName: name, documentID: identity)
            destinations.append(imported.destination)
        }
        let current = try await document.bridge.snapshot(purpose: .save)
        // Authorize before inserting, so render never briefly loads an arbitrary relative file URL.
        let manifest = try await store.authorizedManifest(destinations: AssetReferences.scan(current.text).map(\.destination) + destinations)
        handler.update(manifest: manifest)
        document.bridge.assetMap = manifest.capabilityMap
        try await document.bridge.send(command: EditorCommand(name: "setAssets", args: .object(["assets": try .encoded(manifest.capabilityMap)])))
        try await document.bridge.send(command: EditorCommand(name: "insertImage", args: .object([
            "destinations": try .encoded(destinations), "destination": .string(destinations[0]), "alt": .string("")
        ])))
    }
}
