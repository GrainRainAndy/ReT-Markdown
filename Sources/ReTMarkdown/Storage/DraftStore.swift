import Foundation
import Darwin

public struct RecoveredDraft: Sendable {
    public let snapshot: Snapshot
    public let manifest: AssetManifest
    public let generationURL: URL
    public let sessionID: UUID?
}

/// Each visible generation is complete: snapshot, provenance, frozen capabilities and copied images.
/// No current-pointer is needed, so a crash cannot expose half a transaction. Old generations remain.
public actor DraftStore {
    public let generationsURL: URL
    private let documentID: UUID
    private let documentPath: String?
    private let scoped: Bool
    private let legacyGenerationsURL: URL
    private var sequence: UInt64 = 0
    private var lastSnapshot: Snapshot?
    private var checkedExisting = false
    private struct Completion: Codable {
        let snapshotHash: String
        let manifestHash: String
        var sessionID: UUID? = nil
    }
    /// Compatibility API for callers continuing an old UUID-only revision stream.
    public init(rootURL: URL, documentID: UUID) {
        self.init(rootURL: rootURL, documentID: documentID, documentURL: nil, scoped: false)
    }
    /// Explicit nil means the untitled namespace, not a wildcard over named documents.
    public init(rootURL: URL, documentID: UUID, documentURL: URL?) {
        self.init(rootURL: rootURL, documentID: documentID, documentURL: documentURL, scoped: true)
    }
    private init(rootURL: URL, documentID: UUID, documentURL: URL?, scoped: Bool) {
        self.documentID = documentID
        self.scoped = scoped
        documentPath = documentURL.map(AssetIO.canonicalPath)
        let identityRoot = rootURL.appendingPathComponent(documentID.uuidString, isDirectory: true)
        legacyGenerationsURL = identityRoot.appendingPathComponent("generations", isDirectory: true)
        let key = documentPath.map { AssetIO.hash(Data($0.utf8)) } ?? "untitled"
        let namespace = scoped ? identityRoot.appendingPathComponent(key, isDirectory: true) : identityRoot
        generationsURL = namespace.appendingPathComponent("generations", isDirectory: true)
    }
    /// Rotate write eligibility, never delete or hide completed recovery data.
    public func beginSession() throws -> UUID {
        try withNamespaceLock {
            let session = UUID()
            try AssetIO.atomicWrite(Data(session.uuidString.utf8), to: sessionURL)
            lastSnapshot = nil
            checkedExisting = true
            return session
        }
    }
    private var sessionURL: URL { generationsURL.deletingLastPathComponent().appendingPathComponent("session") }
    private func withNamespaceLock<T>(_ body: () throws -> T) throws -> T {
        try AssetIO.ensureDirectory(generationsURL)
        let lock = generationsURL.deletingLastPathComponent().appendingPathComponent("writer.lock")
        let fd = open(lock.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { close(fd) }
        // Never block an executor on another process; a busy writer is a retryable I/O error.
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { flock(fd, LOCK_UN) }
        return try body()
    }
    public func persist(snapshot: Snapshot, manifest: AssetManifest, sessionID: UUID? = nil) async throws {
        try withNamespaceLock { try writeGeneration(snapshot: snapshot, manifest: manifest, sessionID: sessionID) }
    }
    private func writeGeneration(snapshot: Snapshot, manifest: AssetManifest, sessionID: UUID?) throws {
        guard manifest.documentID == documentID,
              !scoped || manifest.documentURL.map(AssetIO.canonicalPath) == documentPath else { throw AssetStorageError.wrongDocument }
        _ = try SourceCodec.encode(snapshot.source)
        if let sessionID {
            guard (try? AssetIO.read(sessionURL)) == Data(sessionID.uuidString.utf8) else { throw AssetStorageError.staleDraft }
            let recovered = try recover()
            lastSnapshot = recovered?.sessionID == sessionID ? recovered?.snapshot : nil
        } else {
            // The legacy API continues an existing revision stream; it cannot bypass an epoch.
            guard !FileManager.default.fileExists(atPath: sessionURL.path) else { throw AssetStorageError.staleDraft }
            if !checkedExisting { lastSnapshot = try recover()?.snapshot; checkedExisting = true }
        }
        if let lastSnapshot {
            guard snapshot.revision >= lastSnapshot.revision,
                  snapshot.revision != lastSnapshot.revision || snapshot == lastSnapshot else { throw AssetStorageError.staleDraft }
        }
        try AssetIO.ensureDirectory(generationsURL)
        // Fixed-width monotonically ordered names survive restarts and wall-clock adjustments.
        let existing = try FileManager.default.contentsOfDirectory(at: generationsURL, includingPropertiesForKeys: nil)
            .compactMap { UInt64($0.lastPathComponent.split(separator: "-").first ?? "") }.max() ?? 0
        sequence = max(sequence, existing) + 1
        let name = String(format: "%020llu", sequence) + "-" + UUID().uuidString
        let staging = generationsURL.appendingPathComponent(".staging-" + name, isDirectory: true)
        let final = generationsURL.appendingPathComponent(name, isDirectory: true)
        try AssetIO.ensureDirectory(staging)
        defer { try? FileManager.default.removeItem(at: staging) }
        let resourceDirectory = staging.appendingPathComponent("assets", isDirectory: true)
        try AssetIO.ensureDirectory(resourceDirectory)
        var records: [ManagedAsset] = []
        for record in manifest.managedAssets {
            let bytes = try AssetIO.read(record.fileURL)
            guard AssetIO.hash(bytes) == record.sha256 else { throw AssetStorageError.changedResource }
            _ = try AssetIO.image(bytes)
            let name = record.assetID.uuidString + "." + record.fileURL.pathExtension
            try AssetIO.writeImmutable(bytes, to: resourceDirectory.appendingPathComponent(name))
            records.append(ManagedAsset(assetID: record.assetID, destination: record.destination,
                fileURL: final.appendingPathComponent("assets").appendingPathComponent(name),
                sha256: record.sha256, aliases: record.aliases))
        }
        let destinations = AssetReferences.scan(snapshot.text).map(\.destination) + records.flatMap { [$0.destination] + $0.aliases }
        let frozen = try AssetStore.authorize(manifest, destinations: destinations)
        let recovered = AssetManifest(documentID: documentID, documentURL: manifest.documentURL,
            resourceDirectoryURL: final.appendingPathComponent("assets", isDirectory: true),
            managedAssets: records, capabilities: frozen.capabilities)
        let encoder = JSONEncoder()
        let sourceBytes = try encoder.encode(snapshot), manifestBytes = try encoder.encode(recovered)
        try AssetIO.writeImmutable(sourceBytes, to: staging.appendingPathComponent("snapshot.json"))
        try AssetIO.writeImmutable(manifestBytes, to: staging.appendingPathComponent("manifest.json"))
        let complete = Completion(snapshotHash: AssetIO.hash(sourceBytes), manifestHash: AssetIO.hash(manifestBytes), sessionID: sessionID)
        try AssetIO.writeImmutable(try encoder.encode(complete), to: staging.appendingPathComponent("complete.json"))
        try AssetIO.syncDirectory(resourceDirectory)
        try AssetIO.syncDirectory(staging)
        try FileManager.default.moveItem(at: staging, to: final)
        try AssetIO.syncDirectory(generationsURL)
        lastSnapshot = snapshot
    }
    public func recover() throws -> RecoveredDraft? {
        // New complete generations win. Old UUID-only data is read-only fallback and must
        // match the requested canonical URL (including nil for an untitled document).
        let directories = scoped ? [generationsURL, legacyGenerationsURL] : [generationsURL]
        for directory in directories where FileManager.default.fileExists(atPath: directory.path) {
            let candidates = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                .filter { !$0.lastPathComponent.hasPrefix(".") }.sorted { $0.lastPathComponent > $1.lastPathComponent }
            for candidate in candidates {
                if let recovered = try? readGeneration(candidate) { return recovered }
            }
        }
        return nil
    }
    private func readGeneration(_ directory: URL) throws -> RecoveredDraft {
        let decoder = JSONDecoder()
        let complete = try decoder.decode(Completion.self, from: AssetIO.read(directory.appendingPathComponent("complete.json")))
        let sourceBytes = try AssetIO.read(directory.appendingPathComponent("snapshot.json"))
        let manifestBytes = try AssetIO.read(directory.appendingPathComponent("manifest.json"))
        guard AssetIO.hash(sourceBytes) == complete.snapshotHash, AssetIO.hash(manifestBytes) == complete.manifestHash else {
            throw AssetStorageError.incompleteDraft
        }
        let snapshot = try decoder.decode(Snapshot.self, from: sourceBytes)
        let manifest = try decoder.decode(AssetManifest.self, from: manifestBytes)
        guard manifest.documentID == documentID,
              !scoped || manifest.documentURL.map(AssetIO.canonicalPath) == documentPath else { throw AssetStorageError.wrongDocument }
        _ = try SourceCodec.encode(snapshot.source)
        for record in manifest.managedAssets {
            guard record.fileURL.deletingLastPathComponent().standardizedFileURL == directory.appendingPathComponent("assets").standardizedFileURL,
                  AssetIO.hash(try AssetIO.read(record.fileURL)) == record.sha256 else { throw AssetStorageError.incompleteDraft }
        }
        return RecoveredDraft(snapshot: snapshot, manifest: manifest, generationURL: directory, sessionID: complete.sessionID)
    }
}
