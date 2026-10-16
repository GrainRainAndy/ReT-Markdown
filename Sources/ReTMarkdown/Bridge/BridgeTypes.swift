import Foundation

public typealias EOL = String
public typealias Revision = Int

private let maxWireInteger = 9_007_199_254_740_991
private func requireWire(_ condition: Bool, _ decoder: Decoder, _ message: String) throws {
    guard condition else {
        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: message))
    }
}
private extension KeyedDecodingContainer {
    func wireInteger(_ key: Key) throws -> Int {
        let value = try decode(Int.self, forKey: key)
        guard value >= 0, value <= maxWireInteger else {
            throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "Expected nonnegative JS safe integer")
        }
        return value
    }
}

/// Text is LF-normalized. One original terminator is retained for every LF.
public struct Source: Codable, Equatable, Sendable {
    public var text: String
    public var eols: [EOL]
    public var bom: Bool
    public init(text: String = "", eols: [EOL] = [], bom: Bool = false) {
        self.text = text; self.eols = eols; self.bom = bom
    }
    public static func == (lhs: Source, rhs: Source) -> Bool {
        lhs.bom == rhs.bom && lhs.eols == rhs.eols && lhs.text.utf8.elementsEqual(rhs.text.utf8)
    }
    private enum CodingKeys: String, CodingKey { case text, eols, bom }
    public init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        text = try fields.decode(String.self, forKey: .text)
        eols = try fields.decode([EOL].self, forKey: .eols)
        bom = try fields.decode(Bool.self, forKey: .bom)
        try SourceCodec.validate(text: text, eols: eols)
    }
}

/// Flat wire shape: {text,eols,bom,revision}, never {source,revision}.
public struct Snapshot: Codable, Equatable, Sendable {
    public var text: String
    public var eols: [EOL]
    public var bom: Bool
    public var revision: Revision
    public var source: Source { Source(text: text, eols: eols, bom: bom) }
    public init(text: String = "", eols: [EOL] = [], bom: Bool = false, revision: Revision = 0) {
        self.text = text; self.eols = eols; self.bom = bom; self.revision = revision
    }
    public init(source: Source, revision: Revision = 0) {
        self.init(text: source.text, eols: source.eols, bom: source.bom, revision: revision)
    }
    public static func == (lhs: Snapshot, rhs: Snapshot) -> Bool {
        lhs.revision == rhs.revision && lhs.source == rhs.source
    }
    private enum CodingKeys: String, CodingKey { case text, eols, bom, revision }
    public init(from decoder: Decoder) throws {
        let source = try Source(from: decoder)
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        self.init(source: source, revision: try fields.wireInteger(.revision))
    }
}

public struct SourceRange: Codable, Equatable, Sendable {
    public var from: Int
    public var to: Int
    public init(from: Int, to: Int) { self.from = from; self.to = to }
    private enum CodingKeys: String, CodingKey { case from, to }
    public init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        from = try fields.wireInteger(.from)
        to = try fields.wireInteger(.to)
        try requireWire(from <= to, decoder, "Reversed range")
    }
}
public struct Selection: Codable, Equatable, Sendable {
    public var anchor: Int
    public var head: Int
    public init(anchor: Int = 0, head: Int = 0) { self.anchor = anchor; self.head = head }
    private enum CodingKeys: String, CodingKey { case anchor, head }
    public init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        anchor = try fields.wireInteger(.anchor)
        head = try fields.wireInteger(.head)
    }
}
public struct Patch: Codable, Equatable, Sendable {
    public var from: Int
    public var to: Int
    public var insert: String
    public var eols: [EOL]
    public init(from: Int, to: Int, insert: String = "", eols: [EOL] = []) {
        self.from = from; self.to = to; self.insert = insert; self.eols = eols
    }
    private enum CodingKeys: String, CodingKey { case from, to, insert, eols }
    public init(from decoder: Decoder) throws {
        let range = try SourceRange(from: decoder)
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        from = range.from; to = range.to
        insert = try fields.decode(String.self, forKey: .insert)
        eols = try fields.decode([EOL].self, forKey: .eols)
        try SourceCodec.validate(text: insert, eols: eols)
    }
}
public enum CommitReason: String, Codable, Sendable { case edit, undo, redo, assets }
public struct Commit: Codable, Equatable, Sendable {
    public var base: Revision
    public var revision: Revision
    public var patches: [Patch]
    public var selection: Selection
    public var reason: CommitReason
    public init(base: Revision, revision: Revision, patches: [Patch], selection: Selection, reason: CommitReason) {
        self.base = base; self.revision = revision; self.patches = patches; self.selection = selection; self.reason = reason
    }
    private enum CodingKeys: String, CodingKey { case base, revision, patches, selection, reason }
    public init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        base = try fields.wireInteger(.base)
        revision = try fields.wireInteger(.revision)
        patches = try fields.decode([Patch].self, forKey: .patches)
        selection = try fields.decode(Selection.self, forKey: .selection)
        reason = try fields.decode(CommitReason.self, forKey: .reason)
        try requireWire(revision > base, decoder, "Commit revision must increase")
    }
}
public enum Mode: String, Codable, Sendable { case live, source }
public enum Appearance: String, Codable, Sendable { case system, light, dark }
public enum BridgeMessageType: String, Codable, Sendable, CaseIterable {
    case ready, load, loaded, commit, ack, resyncRequired, barrier, snapshot, command, result
    case applyPatches, saved, state, clipboardWrite, openLink, assetRequest, error
}
/// Origin, session identity and payload size validation belongs to the native bridge.
public struct BridgeEnvelope<Payload: Codable & Sendable>: Codable, Sendable {
    public var v: Int
    public var documentID: String
    public var sessionID: String
    public var id: String
    public var replyTo: String?
    public var type: BridgeMessageType
    public var payload: Payload
    public init(v: Int = 1, documentID: String, sessionID: String, id: String, replyTo: String? = nil, type: BridgeMessageType, payload: Payload) {
        self.v = v; self.documentID = documentID; self.sessionID = sessionID; self.id = id
        self.replyTo = replyTo; self.type = type; self.payload = payload
    }
    private enum CodingKeys: String, CodingKey { case v, documentID, sessionID, id, replyTo, type, payload }
    public init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        v = try fields.decode(Int.self, forKey: .v)
        documentID = try fields.decode(String.self, forKey: .documentID)
        sessionID = try fields.decode(String.self, forKey: .sessionID)
        id = try fields.decode(String.self, forKey: .id)
        replyTo = try fields.decodeIfPresent(String.self, forKey: .replyTo)
        type = try fields.decode(BridgeMessageType.self, forKey: .type)
        payload = try fields.decode(Payload.self, forKey: .payload)
        try requireWire(v == 1, decoder, "Unsupported bridge version")
        try requireWire(!documentID.isEmpty && !sessionID.isEmpty && !id.isEmpty, decoder, "Empty bridge identity")
    }
}
