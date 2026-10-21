import AppKit
import WebKit

// These values are transport controls, not source text or a second history.
enum SnapshotPurpose: String, Sendable { case save, export, close }
struct EditorCommand: Sendable {
    let name: String
    let args: NativeJSON?
    init(name: String, args: NativeJSON? = nil) { self.name = name; self.args = args }
}
enum NativeEditorError: LocalizedError {
    case invalidMessage, wrongSession, revisionGap, staleSnapshot, inconsistentSnapshot
    case unavailable, composing, externalConflict, timeout, processLost, commandFailed(String)
    var errorDescription: String? {
        switch self {
        case .invalidMessage: "Invalid editor message."
        case .wrongSession: "The editor session has changed. Please retry."
        case .revisionGap: "Waiting for an ordered editor snapshot before saving."
        case .staleSnapshot: "An older snapshot cannot replace newer changes."
        case .inconsistentSnapshot: "Editor snapshot does not match acknowledged source bytes."
        case .unavailable: "This editor service is not available yet."
        case .composing: "Finish or cancel text composition, then try again."
        case .externalConflict: "The file was changed by another application. Save a local copy or load the external version."
        case .timeout: "The editor did not respond. Your acknowledged changes are retained."
        case .processLost: "The editor process stopped. Recover the last acknowledged text to continue."
        case .commandFailed(let message): message
        }
    }
}

indirect enum NativeJSON: Codable, Sendable {
    case object([String: NativeJSON]), array([NativeJSON]), string(String), number(Double), bool(Bool), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode([String: NativeJSON].self) { self = .object(v) }
        else { self = .array(try c.decode([NativeJSON].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    static func encoded<T: Encodable>(_ value: T) throws -> NativeJSON {
        try JSONDecoder().decode(Self.self, from: JSONEncoder().encode(value))
    }
    func decoded<T: Decodable>(_ type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: JSONEncoder().encode(self))
    }
}

@MainActor
final class CommittedMirror {
    private(set) var snapshot: Snapshot
    let documentID: String
    private(set) var sessionID: String
    private(set) var requiresResync = false
    private var acknowledgements: [String: (Data, Revision)] = [:]
    private var revisionHashes: [Revision: String] = [:]
    private(set) var savedHash: String
    private(set) var currentHash: String
    var isDirty: Bool { currentHash != savedHash }
    init(snapshot: Snapshot, documentID: String, sessionID: String, savedHash: String? = nil) throws {
        self.snapshot = snapshot; self.documentID = documentID; self.sessionID = sessionID
        currentHash = contentHash(try SourceCodec.encode(snapshot.source)); self.savedHash = savedHash ?? currentHash
        revisionHashes[snapshot.revision] = currentHash
    }
    func accept(_ commit: Commit, id: String, documentID: String, sessionID: String) throws -> Revision {
        guard documentID == self.documentID, sessionID == self.sessionID else { throw NativeEditorError.wrongSession }
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        let signature = try encoder.encode(commit)
        if let prior = acknowledgements[id] {
            guard prior.0 == signature else { throw NativeEditorError.invalidMessage }
            return prior.1
        }
        guard !requiresResync, commit.base == snapshot.revision else {
            requiresResync = true; throw NativeEditorError.revisionGap
        }
        guard commit.revision > commit.base, commit.revision <= 9_007_199_254_740_991 else { throw NativeEditorError.invalidMessage }
        let source = try SourceCodec.applying(commit.patches, to: snapshot.source)
        guard (0...source.text.utf16.count).contains(commit.selection.anchor),
              (0...source.text.utf16.count).contains(commit.selection.head) else { throw NativeEditorError.invalidMessage }
        snapshot = Snapshot(source: source, revision: commit.revision)
        currentHash = contentHash(try SourceCodec.encode(source))
        acknowledgements[id] = (signature, commit.revision)
        rememberRevision()
        return commit.revision
    }
    func reconcile(_ candidate: Snapshot) throws {
        guard candidate.revision >= snapshot.revision, candidate.revision <= 9_007_199_254_740_991 else { throw NativeEditorError.staleSnapshot }
        let hash = contentHash(try SourceCodec.encode(candidate.source))
        if candidate.revision == snapshot.revision, hash != currentHash { throw NativeEditorError.inconsistentSnapshot }
        snapshot = candidate; currentHash = hash; requiresResync = false
        rememberRevision()
    }
    private func rememberRevision() {
        revisionHashes[snapshot.revision] = currentHash
        if revisionHashes.count > 2048 {
            for key in revisionHashes.keys.sorted().prefix(revisionHashes.count - 2048) { revisionHashes.removeValue(forKey: key) }
        }
    }
    func acceptCapturedSnapshot(_ candidate: Snapshot) throws {
        if candidate.revision < snapshot.revision {
            guard !requiresResync, revisionHashes[candidate.revision] == contentHash(try SourceCodec.encode(candidate.source)) else { throw NativeEditorError.staleSnapshot }
        } else { try reconcile(candidate) }
    }
    func markSaved(_ receipt: SaveReceipt) { savedHash = receipt.contentHash }
    func restartSession(_ id: String) { sessionID = id; acknowledgements.removeAll(); requiresResync = false }
}

struct EditorState: Codable, Sendable {
    var revision: Revision = 0
    var selection = Selection()
    var canUndo = false
    var canRedo = false
    var composing = false
    var mode: Mode = .live
}
private struct SnapshotReply: Codable { let snapshot: Snapshot; let selection: Selection; let composing: Bool }

@MainActor
final class EditorBridge: NSObject, WKScriptMessageHandler {
    typealias Envelope = BridgeEnvelope<NativeJSON>
    typealias Transport = @MainActor (Envelope) async throws -> Envelope?
    let mirror: CommittedMirror
    private(set) var state = EditorState()
    private(set) var isReady = false
    private var isLoading = false
    var onCommit: (() -> Void)?
    var onError: ((Error) -> Void)?
    var onAssetRequest: ((String, String) async throws -> Void)?
    var assetBase = "ret-resource://"
    var assetMap: [String: String] = [:]
    private var transport: Transport?
    private var outboundTail: Task<Void, Never>?
    private var timeoutTasks: [String: Task<Void, Never>] = [:]
    private var pending: [String: CheckedContinuation<Envelope?, Error>] = [:]
    private var validPageURL: URL?
    private weak var webView: WKWebView?

    init(mirror: CommittedMirror, transport: Transport? = nil) { self.mirror = mirror; self.transport = transport }
    func attach(_ webView: WKWebView, pageURL: URL) {
        self.webView = webView; validPageURL = pageURL
        transport = { [weak webView] envelope in
            guard let webView else { throw NativeEditorError.processLost }
            let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(envelope))
            let result = try await webView.callAsyncJavaScript("return await window.retEditor.receive(envelope)",
                arguments: ["envelope": object], in: nil, contentWorld: .page)
            guard let result, !(result is NSNull) else { return nil }
            return try JSONDecoder().decode(Envelope.self, from: JSONSerialization.data(withJSONObject: result))
        }
    }
    private func envelope(_ type: BridgeMessageType, payload: NativeJSON, replyTo: String? = nil) -> Envelope {
        Envelope(documentID: mirror.documentID, sessionID: mirror.sessionID, id: UUID().uuidString, replyTo: replyTo, type: type, payload: payload)
    }
    private func validate(_ message: Envelope) throws {
        guard message.v == 1, !message.id.isEmpty, message.id.utf8.count <= 256 else { throw NativeEditorError.invalidMessage }
        guard message.documentID == mirror.documentID, message.sessionID == mirror.sessionID else { throw NativeEditorError.wrongSession }
    }
    private func invoke(_ message: Envelope) async throws -> Envelope? {
        guard let transport else { throw NativeEditorError.unavailable }
        return try await withCheckedThrowingContinuation { continuation in
            pending[message.id] = continuation
            timeoutTasks[message.id] = Task { [weak self] in
                try? await Task.sleep(for: .seconds(15))
                guard !Task.isCancelled else { return }
                self?.finish(message.id, .failure(NativeEditorError.timeout))
            }
            Task { [weak self] in
                do {
                    let reply = try await transport(message)
                    if let reply {
                        try self?.validate(reply)
                        guard reply.replyTo == message.id else { throw NativeEditorError.invalidMessage }
                    }
                    self?.finish(message.id, .success(reply))
                } catch { self?.finish(message.id, .failure(error)) }
            }
        }
    }
    private func finish(_ id: String, _ result: Result<Envelope?, Error>) {
        timeoutTasks.removeValue(forKey: id)?.cancel()
        pending.removeValue(forKey: id)?.resume(with: result)
    }
    private func request(_ type: BridgeMessageType, payload: NativeJSON) async throws -> Envelope {
        let message = envelope(type, payload: payload)
        let previous = outboundTail
        let work = Task { @MainActor in
            await previous?.value
            guard let reply = try await self.invoke(message) else { throw NativeEditorError.invalidMessage }
            if reply.type == .error { throw NativeEditorError.commandFailed(String(describing: reply.payload)) }
            return reply
        }
        outboundTail = Task { _ = try? await work.value }
        return try await work.value
    }
    func snapshot(purpose: SnapshotPurpose) async throws -> Snapshot {
        guard isReady else { throw NativeEditorError.unavailable }
        let reply = try await request(.barrier, payload: .object(["purpose": .string(purpose.rawValue)]))
        guard reply.type == .snapshot else { throw NativeEditorError.invalidMessage }
        let captured = try reply.payload.decoded(SnapshotReply.self)
        if purpose == .close && captured.composing { throw NativeEditorError.composing }
        let before = mirror.snapshot.revision
        try mirror.acceptCapturedSnapshot(captured.snapshot)
        state.composing = captured.composing
        if before != mirror.snapshot.revision { onCommit?() }
        let acknowledgement: NativeJSON = .object(["revision": .number(Double(captured.snapshot.revision))])
        if purpose == .close {
            // Closing may tear down the WebView as soon as this snapshot returns.
            // Await its ACK directly; acknowledgements must bypass the request queue.
            let result = try await invoke(envelope(.ack, payload: acknowledgement, replyTo: reply.id))
            guard let result else { throw NativeEditorError.invalidMessage }
            if result.type == .error {
                throw NativeEditorError.commandFailed(String(describing: result.payload))
            }
            struct ACKResult: Decodable { let ok: Bool; let error: String? }
            guard result.type == .result else { throw NativeEditorError.invalidMessage }
            let confirmation = try result.payload.decoded(ACKResult.self)
            guard confirmation.ok else { throw NativeEditorError.commandFailed(confirmation.error ?? "Close acknowledgement failed.") }
        } else {
            respond(to: reply, type: .ack, payload: acknowledgement)
        }
        return captured.snapshot
    }
    func send(command: EditorCommand) async throws {
        let allowlist = ["undo", "redo", "format", "find", "replace", "replaceAll", "copySource", "copyPlain", "copyRich", "insertImage", "setMode", "setAppearance", "setZoom", "revealRange", "setReadOnly", "setAssets"]
        guard isReady, allowlist.contains(command.name) else { throw NativeEditorError.unavailable }
        var payload: [String: NativeJSON] = ["name": .string(command.name)]
        payload["args"] = command.args
        let reply = try await request(.command, payload: .object(payload))
        struct ResultPayload: Decodable { let ok: Bool; let error: String? }
        guard reply.type == .result else { throw NativeEditorError.invalidMessage }
        let result = try reply.payload.decoded(ResultPayload.self)
        guard result.ok else { throw NativeEditorError.commandFailed(result.error ?? "Editor command failed.") }
    }
    func applyPatches(base: Revision, patches: [Patch]) async throws {
        let reply = try await request(.applyPatches, payload: .object(["base": .number(Double(base)), "patches": try .encoded(patches), "reason": .string("assets")]))
        struct ResultPayload: Decodable { let ok: Bool; let error: String? }
        guard reply.type == .result else { throw NativeEditorError.invalidMessage }
        let result = try reply.payload.decoded(ResultPayload.self)
        guard result.ok else { throw NativeEditorError.commandFailed(result.error ?? "Asset references were not applied.") }
    }
    func saved(_ receipt: SaveReceipt) async throws {
        _ = try await request(.saved, payload: .object(["revision": .number(Double(receipt.revision)), "contentHash": .string(receipt.contentHash)]))
    }
    func processTerminated() {
        isReady = false
        for id in Array(pending.keys) { finish(id, .failure(NativeEditorError.processLost)) }
        onError?(NativeEditorError.processLost)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url == validPageURL else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: message.body)
            // This bounds individual IPC payloads, not the size of a document accepted by the app.
            guard data.count <= 64 * 1024 * 1024 else { throw NativeEditorError.invalidMessage }
            let envelope = try JSONDecoder().decode(Envelope.self, from: data)
            try receive(envelope)
        } catch { onError?(error) }
    }
    func receive(_ message: Envelope) throws {
        try validate(message)
        switch message.type {
        case .ready:
            guard !isReady, !isLoading else { return }
            isLoading = true
            Task {
                defer { isLoading = false }
                do {
                    let reply = try await request(.load, payload: .object([
                        "snapshot": try .encoded(mirror.snapshot), "mode": .string(state.mode.rawValue),
                        "selection": try .encoded(state.selection), "assetBase": .string(assetBase),
                        "appearance": .string("system"), "zoom": .number(1), "assets": try .encoded(assetMap)]))
                    struct Loaded: Decodable { let revision: Revision }
                    guard reply.type == .loaded, try reply.payload.decoded(Loaded.self).revision == mirror.snapshot.revision else { throw NativeEditorError.invalidMessage }
                    isReady = true
                } catch { onError?(error) }
            }
        case .commit:
            let before = mirror.snapshot.revision
            do {
                let revision = try mirror.accept(message.payload.decoded(Commit.self), id: message.id, documentID: message.documentID, sessionID: message.sessionID)
                if before != revision { onCommit?() }
                respond(to: message, type: .ack, payload: .object(["revision": .number(Double(revision))]))
            } catch NativeEditorError.revisionGap {
                respond(to: message, type: .resyncRequired, payload: .object(["expected": .number(Double(mirror.snapshot.revision))]))
                Task { do { _ = try await snapshot(purpose: .save) } catch { onError?(error) } }
            }
        case .state:
            let next = try message.payload.decoded(EditorState.self)
            guard next.revision == mirror.snapshot.revision, next.selection.anchor >= 0, next.selection.head >= 0,
                  next.selection.anchor <= mirror.snapshot.text.utf16.count, next.selection.head <= mirror.snapshot.text.utf16.count else { throw NativeEditorError.invalidMessage }
            state = next
        case .clipboardWrite:
            struct Clipboard: Decodable { let text: String; let html: String? }
            let value = try message.payload.decoded(Clipboard.self)
            let item = NSPasteboardItem(); item.setString(value.text, forType: .string)
            if let html = value.html { item.setString(html, forType: .html) }
            NSPasteboard.general.clearContents(); NSPasteboard.general.writeObjects([item])
            respond(to: message, type: .result, payload: .object(["ok": .bool(true)]))
        case .openLink:
            struct Link: Decodable { let url: String }
            guard let url = URL(string: try message.payload.decoded(Link.self).url), ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") else { throw NativeEditorError.invalidMessage }
            NSWorkspace.shared.open(url)
        case .assetRequest:
            struct Asset: Decodable { let action: String; let requestID: String }
            let asset = try message.payload.decoded(Asset.self)
            guard ["paste", "choose", "drop"].contains(asset.action) else { throw NativeEditorError.invalidMessage }
            Task {
                do {
                    guard let onAssetRequest else { throw NativeEditorError.unavailable }
                    try await onAssetRequest(asset.action, asset.requestID)
                    respond(to: message, type: .result, payload: .object(["ok": .bool(true)]))
                } catch { respond(to: message, type: .result, payload: .object(["ok": .bool(false), "error": .string(error.localizedDescription)])); onError?(error) }
            }
        case .error: onError?(NativeEditorError.commandFailed(String(describing: message.payload)))
        default: throw NativeEditorError.invalidMessage
        }
    }
    private func respond(to message: Envelope, type: BridgeMessageType, payload: NativeJSON) {
        // Acknowledgements cannot queue behind the barrier they unblock.
        let reply = envelope(type, payload: payload, replyTo: message.id)
        Task { do { _ = try await invoke(reply) } catch { onError?(error) } }
    }
}
