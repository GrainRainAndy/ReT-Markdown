import Foundation

/// Bytes are frozen when native authorizes a resource, including for PDF export.
public struct AssetCapability: Codable, Sendable, Equatable {
    public let url: URL
    public let data: Data
    public let mimeType: String
    public init(url: URL, data: Data, mimeType: String) {
        self.url = url; self.data = data; self.mimeType = mimeType
    }
}

/// Durable provenance. Directory names alone never confer managed status.
public struct ManagedAsset: Codable, Sendable, Equatable {
    public let assetID: UUID
    public let destination: String
    public let fileURL: URL
    public let sha256: String
    public let aliases: [String]
    public init(assetID: UUID, destination: String, fileURL: URL, sha256: String, aliases: [String] = []) {
        self.assetID = assetID; self.destination = destination; self.fileURL = fileURL
        self.sha256 = sha256; self.aliases = aliases
    }
}

/// An immutable value: persistent provenance plus a native-authorized frozen view.
public struct AssetManifest: Codable, Sendable, Equatable {
    public let documentID: UUID
    public let documentURL: URL?
    public let resourceDirectoryURL: URL
    public let managedAssets: [ManagedAsset]
    public let capabilities: [String: AssetCapability]
    public init(documentID: UUID, documentURL: URL?, resourceDirectoryURL: URL,
                managedAssets: [ManagedAsset] = [], capabilities: [String: AssetCapability] = [:]) {
        self.documentID = documentID; self.documentURL = documentURL
        self.resourceDirectoryURL = resourceDirectoryURL; self.managedAssets = managedAssets
        self.capabilities = capabilities
    }
    public var capabilityMap: [String: String] { capabilities.mapValues { $0.url.absoluteString } }
    public func resolveImage(_ destination: String) -> String? { capabilityMap[destination] }
}

public struct ImportedAsset: Sendable, Equatable {
    public let assetID: UUID
    public let destination: String
    public let fileURL: URL
    public var markdownDestination: String { destination }
    public init(assetID: UUID, destination: String, fileURL: URL) {
        self.assetID = assetID; self.destination = destination; self.fileURL = fileURL
    }
}

/// UTF-16 range of a destination token only; native never rewrites the entire document.
public struct AssetReference: Sendable, Equatable {
    public let destination: String
    public let from: Int
    public let to: Int
    public init(destination: String, from: Int, to: Int) {
        self.destination = destination; self.from = from; self.to = to
    }
}

public struct AssetCopy: Sendable, Equatable {
    public let assetID: UUID
    public let source: URL
    public let destination: URL
    public let sha256: String
}

public struct UnmanagedAssetBreakage: Sendable, Equatable {
    public let destination: String
    public let originalURL: URL?
    public let proposedURL: URL?
}

/// Planning has no filesystem side effects. Stage resources before native writes candidateSnapshot.
public struct AssetMigration: Sendable {
    public let id: UUID
    public let documentID: UUID
    public let destination: URL
    public let copies: [AssetCopy]
    public let patches: [Patch]
    public let unmanagedBrokenReferences: [UnmanagedAssetBreakage]
    public let candidateSnapshot: Snapshot
    public let candidateManifest: AssetManifest
    public let baseManifest: AssetManifest
}

public struct StagedAssetMigration: Sendable {
    public let migration: AssetMigration
    public let manifest: AssetManifest
}

public enum AssetStorageError: Error, Equatable {
    case wrongDocument, unsupportedImage, invalidPath, unauthorizedResource, changedResource
    case staleMigration, unmanagedBreakageRequiresAcceptance, invalidReference, incompleteDraft, staleDraft
}

import CryptoKit
import ImageIO
import UniformTypeIdentifiers
import Darwin

/// Storage work is serialized independently of AppKit. Keep a staged migration short:
/// native must lock asset/content commands until adoptMigration or cancelMigration.
public actor AssetStore {
    public private(set) var manifest: AssetManifest
    private let metadataDirectory: URL
    private var pending: StagedAssetMigration?

    public init(documentID: UUID, rootURL: URL, documentURL: URL? = nil, recoveredManifest: AssetManifest? = nil) throws {
        let metadataDirectory = rootURL.appendingPathComponent(documentID.uuidString, isDirectory: true)
        self.metadataDirectory = metadataDirectory
        try AssetIO.ensureDirectory(metadataDirectory)
        let metadata = try Self.selectedMetadata(in: metadataDirectory, documentURL: documentURL)
        if let recoveredManifest {
            guard recoveredManifest.documentID == documentID else { throw AssetStorageError.wrongDocument }
            // Completed recovery generations are immutable. Read their historical bytes, but
            // direct new imports to the document's working resource directory.
            let prior = try? JSONDecoder().decode(AssetManifest.self, from: AssetIO.read(metadata))
            let activeURL = documentURL ?? recoveredManifest.documentURL
            let workingDirectory = prior?.resourceDirectoryURL ?? activeURL.map {
                $0.deletingLastPathComponent().appendingPathComponent($0.deletingPathExtension().lastPathComponent + ".assets", isDirectory: true)
            } ?? metadataDirectory.appendingPathComponent("assets", isDirectory: true)
            manifest = AssetManifest(documentID: documentID, documentURL: activeURL,
                resourceDirectoryURL: workingDirectory, managedAssets: recoveredManifest.managedAssets,
                capabilities: recoveredManifest.capabilities)
        } else if FileManager.default.fileExists(atPath: metadata.path) {
            let stored = try JSONDecoder().decode(AssetManifest.self, from: AssetIO.read(metadata))
            guard stored.documentID == documentID else { throw AssetStorageError.wrongDocument }
            manifest = stored
        } else {
            let directory = documentURL.map {
                $0.deletingLastPathComponent().appendingPathComponent($0.deletingPathExtension().lastPathComponent + ".assets", isDirectory: true)
            } ?? metadataDirectory.appendingPathComponent("assets", isDirectory: true)
            manifest = AssetManifest(documentID: documentID, documentURL: documentURL, resourceDirectoryURL: directory)
        }
    }

    public func importImage(data: Data, suggestedName: String, documentID: UUID) async throws -> ImportedAsset {
        guard documentID == manifest.documentID else { throw AssetStorageError.wrongDocument }
        guard pending == nil else { throw AssetStorageError.staleMigration }
        let image = try AssetIO.image(data)
        try AssetIO.ensureDirectory(manifest.resourceDirectoryURL)
        let assetID = UUID()
        // A UUID suffix is immutable and avoids races, normalization/case collisions and overwriting originals.
        let stem = AssetIO.safeStem(suggestedName)
        let filename = stem + "-" + assetID.uuidString + "." + image.ext
        let fileURL = manifest.resourceDirectoryURL.appendingPathComponent(filename)
        try AssetIO.writeImmutable(data, to: fileURL)
        let base = manifest.documentURL?.deletingLastPathComponent() ?? metadataDirectory
        let destination = AssetIO.relativeDestination(fileURL, base: base)
        let record = ManagedAsset(assetID: assetID, destination: destination, fileURL: fileURL, sha256: AssetIO.hash(data))
        let updated = AssetManifest(documentID: documentID, documentURL: manifest.documentURL,
            resourceDirectoryURL: manifest.resourceDirectoryURL, managedAssets: manifest.managedAssets + [record],
            capabilities: manifest.capabilities)
        // A metadata failure does not insert a reference or alter the old manifest; keep the immutable orphan.
        try persistProvenance(updated)
        manifest = updated
        return ImportedAsset(assetID: assetID, destination: destination, fileURL: fileURL)
    }

    /// Missing/unsafe/remote references intentionally receive no capability. Only native calls this API.
    public func authorizedManifest(destinations: [String]) throws -> AssetManifest {
        try Self.authorize(manifest, destinations: destinations)
    }

    public static func authorize(_ manifest: AssetManifest, destinations: [String]) throws -> AssetManifest {
        var map: [String: AssetCapability] = [:]
        let base = manifest.documentURL?.deletingLastPathComponent() ?? manifest.resourceDirectoryURL.deletingLastPathComponent()
        for destination in Set(destinations) {
            guard AssetIO.isLocal(destination) else { continue }
            let record = manifest.managedAssets.first { $0.destination == destination || $0.aliases.contains(destination) }
            let url = record?.fileURL ?? AssetIO.localURL(destination, base: base)
            let diskBytes = url.flatMap { try? AssetIO.read($0) }
            let frozenBytes = manifest.capabilities[destination]?.data ?? manifest.capabilities[AssetIO.decodedDestination(destination)]?.data
            guard let bytes = diskBytes ?? frozenBytes,
                  record == nil || record?.sha256 == AssetIO.hash(bytes),
                  let image = try? AssetIO.image(bytes) else { continue }
            let capability = AssetCapability(url: URL(string: "ret-resource://asset/" + UUID().uuidString)!, data: bytes, mimeType: image.mime)
            map[destination] = capability
            map[AssetIO.decodedDestination(destination)] = capability
        }
        return AssetManifest(documentID: manifest.documentID, documentURL: manifest.documentURL,
            resourceDirectoryURL: manifest.resourceDirectoryURL, managedAssets: manifest.managedAssets, capabilities: map)
    }

    public func planMigration(snapshot: Snapshot, to destination: URL) async throws -> AssetMigration {
        try planMigration(snapshot: snapshot, to: destination, references: AssetReferences.scan(snapshot.text))
    }

    /// The editor may supply exact syntax destination ranges; ranges are verified against the frozen source.
    public func planMigration(snapshot: Snapshot, to destination: URL, references: [AssetReference]) throws -> AssetMigration {
        guard pending == nil else { throw AssetStorageError.staleMigration }
        guard destination.isFileURL else { throw AssetStorageError.invalidPath }
        _ = try SourceCodec.encode(snapshot.source)
        let base = manifest.documentURL?.deletingLastPathComponent() ?? metadataDirectory
        let newBase = destination.deletingLastPathComponent()
        let isSame = destination.standardizedFileURL == manifest.documentURL?.standardizedFileURL
        var directory = isSame ? manifest.resourceDirectoryURL : newBase.appendingPathComponent(destination.deletingPathExtension().lastPathComponent + ".assets", isDirectory: true)
        // A pre-existing unrelated directory is never claimed as managed provenance.
        if !isSame && FileManager.default.fileExists(atPath: directory.path) {
            directory = newBase.appendingPathComponent(directory.lastPathComponent + "-" + UUID().uuidString, isDirectory: true)
        }
        var copies: [AssetCopy] = [], records: [ManagedAsset] = [], replacements: [String: String] = [:]
        for record in manifest.managedAssets {
            let target = isSame ? record.fileURL : directory.appendingPathComponent(record.fileURL.lastPathComponent)
            let newDestination = AssetIO.relativeDestination(target, base: newBase)
            if target != record.fileURL {
                copies.append(AssetCopy(assetID: record.assetID, source: record.fileURL, destination: target, sha256: record.sha256))
            }
            for previous in [record.destination] + record.aliases {
                replacements[previous] = newDestination
                // Preserve history references as ordinary files at the new location, too. Never
                // follow parent references outside the selected document's directory or overwrite.
                if !isSame, let alias = AssetIO.localURL(previous, base: newBase),
                   AssetIO.canonicalPath(alias).hasPrefix(AssetIO.canonicalPath(newBase) + "/"),
                   AssetIO.canonicalPath(alias) != AssetIO.canonicalPath(record.fileURL),
                   AssetIO.canonicalPath(alias) != AssetIO.canonicalPath(target),
                   !copies.contains(where: { AssetIO.canonicalPath($0.destination) == AssetIO.canonicalPath(alias) }) {
                    copies.append(AssetCopy(assetID: record.assetID, source: record.fileURL, destination: alias, sha256: record.sha256))
                }
            }
            records.append(ManagedAsset(assetID: record.assetID, destination: newDestination, fileURL: target,
                sha256: record.sha256, aliases: Array(Set(record.aliases + [record.destination])).filter { $0 != newDestination }.sorted()))
        }
        var patches: [Patch] = [], broken: [UnmanagedAssetBreakage] = []
        let text = snapshot.text as NSString
        for reference in references.sorted(by: { $0.from < $1.from }) {
            guard reference.from >= 0, reference.to >= reference.from, reference.to <= text.length,
                  text.substring(with: NSRange(location: reference.from, length: reference.to - reference.from)) == reference.destination,
                  patches.last.map({ $0.to <= reference.from }) ?? true else { throw AssetStorageError.invalidReference }
            let key = replacements.keys.first { AssetIO.decodedDestination($0) == AssetIO.decodedDestination(reference.destination) }
            if let key, let replacement = replacements[key] {
                if replacement != reference.destination {
                    patches.append(Patch(from: reference.from, to: reference.to, insert: replacement))
                }
            } else if AssetIO.isLocal(reference.destination), base.standardizedFileURL != newBase.standardizedFileURL {
                let original = AssetIO.localURL(reference.destination, base: base)
                let proposed = AssetIO.localURL(reference.destination, base: newBase)
                // Even a different existing image is a semantic break; require explicit host acceptance.
                if original?.standardizedFileURL != proposed?.standardizedFileURL {
                    broken.append(UnmanagedAssetBreakage(destination: reference.destination, originalURL: original, proposedURL: proposed))
                }
            }
        }
        let candidate = Snapshot(source: try SourceCodec.applying(patches, to: snapshot.source), revision: snapshot.revision)
        let candidateManifest = AssetManifest(documentID: manifest.documentID, documentURL: destination,
            resourceDirectoryURL: directory, managedAssets: records, capabilities: manifest.capabilities)
        return AssetMigration(id: UUID(), documentID: manifest.documentID, destination: destination, copies: copies,
            patches: patches, unmanagedBrokenReferences: broken, candidateSnapshot: candidate,
            candidateManifest: candidateManifest, baseManifest: manifest)
    }

    public func stageMigration(_ migration: AssetMigration, acceptingUnmanagedBreakage: Bool = false) throws -> StagedAssetMigration {
        guard pending == nil, migration.documentID == manifest.documentID, migration.baseManifest == manifest else {
            throw AssetStorageError.staleMigration
        }
        guard acceptingUnmanagedBreakage || migration.unmanagedBrokenReferences.isEmpty else {
            throw AssetStorageError.unmanagedBreakageRequiresAcceptance
        }
        for copy in migration.copies {
            let bytes = try AssetIO.read(copy.source)
            guard AssetIO.hash(bytes) == copy.sha256 else { throw AssetStorageError.changedResource }
            _ = try AssetIO.image(bytes)
            try AssetIO.ensureDirectory(copy.destination.deletingLastPathComponent())
            if FileManager.default.fileExists(atPath: copy.destination.path) {
                guard AssetIO.hash(try AssetIO.read(copy.destination)) == copy.sha256 else { throw AssetStorageError.changedResource }
            } else { try AssetIO.writeImmutable(bytes, to: copy.destination) }
        }
        // Candidate provenance is immutable and cannot overwrite an existing target's manifest.
        let generation = "migration-" + migration.id.uuidString + ".json"
        try AssetIO.writeImmutable(try JSONEncoder().encode(migration.candidateManifest),
            to: metadataDirectory.appendingPathComponent(generation))
        try AssetIO.syncDirectory(metadataDirectory)
        let indexURL = Self.identityURL(for: migration.destination, rootURL: metadataDirectory.deletingLastPathComponent())
        try AssetIO.ensureDirectory(indexURL.deletingLastPathComponent())
        var index = try Self.readIndex(for: migration.destination, rootURL: metadataDirectory.deletingLastPathComponent())
        index.candidates.append(IdentityCandidate(documentID: migration.documentID,
            markdownHash: AssetIO.hash(try SourceCodec.encode(migration.candidateSnapshot.source)),
            generation: generation, previousDisk: try Self.diskVersion(migration.destination)))
        try AssetIO.atomicWrite(try JSONEncoder().encode(index), to: indexURL)
        let staged = StagedAssetMigration(migration: migration, manifest: migration.candidateManifest)
        pending = staged
        return staged
    }

    /// Publish only after the coordinated Markdown write. Failure is retryable: the immutable
    /// candidate remains eligible for crash recovery and the host retains its didWrite closure.
    @discardableResult
    public func adoptMigration(_ staged: StagedAssetMigration) throws -> AssetManifest {
        guard pending?.migration.id == staged.migration.id else { return manifest }
        try persistProvenance(staged.manifest)
        manifest = staged.manifest
        pending = nil
        return manifest
    }
    public func cancelMigration(_ staged: StagedAssetMigration) throws {
        guard pending?.migration.id == staged.migration.id else { return }
        let root = metadataDirectory.deletingLastPathComponent(), url = staged.migration.destination
        var index = try Self.readIndex(for: url, rootURL: root)
        index.candidates.removeAll { $0.generation == "migration-" + staged.migration.id.uuidString + ".json" }
        try AssetIO.atomicWrite(try JSONEncoder().encode(index), to: Self.identityURL(for: url, rootURL: root))
        pending = nil
        // Original and staged image bytes remain available for history and versions.
    }
    public func documentDidRename(to url: URL) throws {
        guard pending == nil else { throw AssetStorageError.staleMigration }
        let updated = AssetManifest(documentID: manifest.documentID, documentURL: url,
            resourceDirectoryURL: manifest.resourceDirectoryURL, managedAssets: manifest.managedAssets,
            capabilities: manifest.capabilities)
        try persistProvenance(updated)
        manifest = updated
    }
    /// URL index is independent of UUID directories. Each URL has its own atomically replaced
    /// record, so unrelated documents never race on a shared read/modify/write dictionary.
    public static func documentIdentity(for documentURL: URL, rootURL: URL) throws -> UUID? {
        guard documentURL.isFileURL else { throw AssetStorageError.invalidPath }
        let index = try readIndex(for: documentURL, rootURL: rootURL)
        if let candidate = try activeCandidate(index, for: documentURL, rootURL: rootURL) { return candidate.documentID }
        if let id = index.committedID {
            let metadata = metadataURL(in: rootURL.appendingPathComponent(id.uuidString), documentURL: documentURL)
            if try validManifest(at: metadata, id: id, url: documentURL) { return id }
        }
        return nil
    }
    private struct IdentityCandidate: Codable {
        let documentID: UUID
        let markdownHash: String
        var generation: String? = nil
        var previousDisk: String? = nil
    }
    private struct IdentityIndex: Codable {
        let canonicalPath: String
        var committedID: UUID?
        var candidates: [IdentityCandidate]
    }
    private static func readIndex(for url: URL, rootURL: URL) throws -> IdentityIndex {
        let path = identityURL(for: url, rootURL: rootURL)
        guard FileManager.default.fileExists(atPath: path.path) else {
            return IdentityIndex(canonicalPath: AssetIO.canonicalPath(url), committedID: nil, candidates: [])
        }
        let index = try JSONDecoder().decode(IdentityIndex.self, from: AssetIO.read(path))
        guard index.canonicalPath == AssetIO.canonicalPath(url) else { throw AssetStorageError.invalidPath }
        return index
    }
    // Hash alone is insufficient when a staged candidate equals the preexisting Markdown.
    // NSDocument safe replacement changes inode; timestamps also cover direct in-place writes.
    private static func diskVersion(_ url: URL) throws -> String? {
        var info = stat()
        guard lstat(url.path, &info) == 0 else {
            if errno == ENOENT { return nil }
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        return "\(info.st_dev):\(info.st_ino):\(info.st_size):\(info.st_mtimespec.tv_sec):\(info.st_mtimespec.tv_nsec):\(info.st_ctimespec.tv_sec):\(info.st_ctimespec.tv_nsec)"
    }
    private static func validManifest(at metadata: URL, id: UUID, url: URL) throws -> Bool {
        guard FileManager.default.fileExists(atPath: metadata.path) else { return false }
        let value = try JSONDecoder().decode(AssetManifest.self, from: AssetIO.read(metadata))
        return value.documentID == id && value.documentURL.map(AssetIO.canonicalPath) == AssetIO.canonicalPath(url)
    }
    private static func candidateURL(_ candidate: IdentityCandidate, for url: URL, rootURL: URL) -> URL? {
        let directory = rootURL.appendingPathComponent(candidate.documentID.uuidString)
        guard let generation = candidate.generation else { return metadataURL(in: directory, documentURL: url) }
        guard generation.hasPrefix("migration-"), generation.hasSuffix(".json"), !generation.contains("/") else { return nil }
        return directory.appendingPathComponent(generation)
    }
    private static func activeCandidate(_ index: IdentityIndex, for url: URL, rootURL: URL) throws -> IdentityCandidate? {
        guard let bytes = try? AssetIO.read(url) else { return nil }
        let hash = AssetIO.hash(bytes), version = try diskVersion(url)
        for candidate in index.candidates.reversed() where candidate.markdownHash == hash {
            // Legacy candidates retain their historical hash-based behavior; new candidates
            // additionally require proof that the target changed after staging.
            guard candidate.generation == nil || candidate.previousDisk != version,
                  let metadata = candidateURL(candidate, for: url, rootURL: rootURL),
                  try validManifest(at: metadata, id: candidate.documentID, url: url) else { continue }
            return candidate
        }
        return nil
    }
    private static func selectedMetadata(in directory: URL, documentURL: URL?) throws -> URL {
        if let url = documentURL {
            let root = directory.deletingLastPathComponent()
            let index = try readIndex(for: url, rootURL: root)
            if let candidate = try activeCandidate(index, for: url, rootURL: root),
               candidate.documentID.uuidString == directory.lastPathComponent,
               let selected = candidateURL(candidate, for: url, rootURL: root) { return selected }
        }
        return metadataURL(in: directory, documentURL: documentURL)
    }
    private static func identityURL(for url: URL, rootURL: URL) -> URL {
        rootURL.appendingPathComponent("identities", isDirectory: true)
            .appendingPathComponent(AssetIO.hash(Data(AssetIO.canonicalPath(url).utf8)) + ".json")
    }
    private func persistProvenance(_ value: AssetManifest) throws {
        try AssetIO.atomicWrite(try JSONEncoder().encode(value), to: Self.metadataURL(in: metadataDirectory, documentURL: value.documentURL))
        guard let documentURL = value.documentURL else { return }
        let indexURL = Self.identityURL(for: documentURL, rootURL: metadataDirectory.deletingLastPathComponent())
        try AssetIO.ensureDirectory(indexURL.deletingLastPathComponent())
        let index = IdentityIndex(canonicalPath: AssetIO.canonicalPath(documentURL), committedID: value.documentID, candidates: [])
        try AssetIO.atomicWrite(try JSONEncoder().encode(index), to: indexURL)
    }
    private static func metadataURL(in directory: URL, documentURL: URL?) -> URL {
        let key = documentURL.map { AssetIO.hash(Data(AssetIO.canonicalPath($0).utf8)) } ?? "untitled"
        return directory.appendingPathComponent("manifest-" + key + ".json")
    }
}

// Shared only by the three storage/serving files. Do not use path-prefix checks as authorization.
enum AssetIO {
    /// Foundation standardization changes /private/tmp to /tmp after a file is created.
    /// realpath + a canonical existing ancestor gives a stable key on both sides of that boundary.
    static func canonicalPath(_ url: URL) -> String {
        if let resolved = realpath(url.path, nil) {
            defer { free(resolved) }
            return String(cString: resolved).precomposedStringWithCanonicalMapping
        }
        let parent = url.deletingLastPathComponent()
        guard parent.path != url.path else { return url.path.precomposedStringWithCanonicalMapping }
        return canonicalPath(parent) + "/" + url.lastPathComponent.precomposedStringWithCanonicalMapping
    }
    static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    static func safeStem(_ name: String) -> String {
        let stem = (name as NSString).deletingPathExtension
        let cleaned = stem.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && !"/\\:<>\"|?*".unicodeScalars.contains($0) }
        let result = String(String.UnicodeScalarView(cleaned)).trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty || result == "." || result == ".." ? "image" : String(result.prefix(80))
    }
    static func decodedDestination(_ string: String) -> String {
        let unescaped = string.replacingOccurrences(of: ##"\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])"##, with: "$1", options: .regularExpression)
        return unescaped.removingPercentEncoding ?? unescaped
    }
    static func isLocal(_ destination: String) -> Bool {
        let decoded = decodedDestination(destination)
        return !decoded.isEmpty && !decoded.hasPrefix("/") && !decoded.hasPrefix("\\") &&
            !decoded.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) &&
            URLComponents(string: decoded)?.scheme == nil
    }
    static func localURL(_ destination: String, base: URL) -> URL? {
        guard isLocal(destination) else { return nil }
        let path = destination.components(separatedBy: "#")[0].components(separatedBy: "?")[0]
        return base.appendingPathComponent(decodedDestination(path)).standardizedFileURL
    }
    static func relativeDestination(_ url: URL, base: URL) -> String {
        let target = URL(fileURLWithPath: canonicalPath(url)).pathComponents, origin = URL(fileURLWithPath: canonicalPath(base)).pathComponents
        var common = 0
        while common < min(target.count, origin.count), target[common] == origin[common] { common += 1 }
        let components = Array(repeating: "..", count: origin.count - common) + target.dropFirst(common)
        // Escape Markdown delimiters as URL bytes; keep Unicode spelling, including decomposed forms.
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: " %()[]<>#?\\\"'`")
        return components.map { $0.addingPercentEncoding(withAllowedCharacters: allowed) ?? $0 }.joined(separator: "/")
    }
    static func ensureDirectory(_ url: URL) throws {
        let canonicalParent = url.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL
        guard canonicalParent == url.deletingLastPathComponent().standardizedFileURL else { throw AssetStorageError.invalidPath }
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        guard url.standardizedFileURL == url.resolvingSymlinksInPath().standardizedFileURL,
              try url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else { throw AssetStorageError.invalidPath }
    }
    static func read(_ url: URL) throws -> Data {
        let expected = url.standardizedFileURL
        guard expected == expected.resolvingSymlinksInPath().standardizedFileURL else { throw AssetStorageError.invalidPath }
        let fd = open(expected.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? handle.close() }
        var before = stat(), after = stat()
        guard fstat(fd, &before) == 0, (before.st_mode & S_IFMT) == S_IFREG else { throw AssetStorageError.invalidPath }
        var actualPath = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        guard fcntl(fd, F_GETPATH, &actualPath) == 0,
              URL(fileURLWithPath: String(decoding: actualPath.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)).standardizedFileURL == expected else { throw AssetStorageError.invalidPath }
        let data = try handle.readToEnd() ?? Data()
        guard fstat(fd, &after) == 0, before.st_size == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec else { throw AssetStorageError.changedResource }
        return data
    }
    static func writeImmutable(_ bytes: Data, to url: URL) throws {
        guard url.deletingLastPathComponent().standardizedFileURL == url.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL else {
            throw AssetStorageError.invalidPath
        }
        let fd = open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? handle.close() }
        try handle.write(contentsOf: bytes)
        try handle.synchronize()
    }
    static func atomicWrite(_ bytes: Data, to url: URL) throws {
        let temporary = url.deletingLastPathComponent().appendingPathComponent(".writing-" + UUID().uuidString)
        try writeImmutable(bytes, to: temporary)
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard rename(temporary.path, url.path) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        try syncDirectory(url.deletingLastPathComponent())
    }
    static func syncDirectory(_ url: URL) throws {
        let fd = open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { close(fd) }
        guard fsync(fd) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    }
    static func image(_ data: Data) throws -> (mime: String, ext: String) {
        if let source = CGImageSourceCreateWithData(data as CFData, nil),
           let type = CGImageSourceGetType(source) as String?,
           let uti = UTType(type), uti.conforms(to: .image), uti != .svg,
           let mime = uti.preferredMIMEType, let ext = uti.preferredFilenameExtension,
           CGImageSourceGetCount(source) > 0, CGImageSourceCreateImageAtIndex(source, 0, nil) != nil {
            return (mime, ext)
        }
        let validator = SafeSVG()
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = validator
        guard let text = String(data: data, encoding: .utf8),
              !text.contains("<!"), parser.parse(), validator.valid, validator.sawRoot else { throw AssetStorageError.unsupportedImage }
        return ("image/svg+xml", "svg")
    }
}

/// Conservative static SVG subset. Reject active content rather than passing untrusted XML to WebKit.
private final class SafeSVG: NSObject, XMLParserDelegate {
    var valid = true, sawRoot = false
    private let elements: Set<String> = ["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "desc", "defs", "linearGradient", "radialGradient", "stop", "clipPath"]
    private let attributes: Set<String> = ["xmlns", "width", "height", "viewBox", "preserveAspectRatio", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "opacity", "transform", "font-size", "font-family", "font-weight", "font-style", "text-anchor", "dominant-baseline", "dx", "dy", "id", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "clip-path"]
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName: String?, attributes values: [String: String]) {
        if !sawRoot { sawRoot = elementName == "svg"; valid = sawRoot && values["xmlns"] == "http://www.w3.org/2000/svg" }
        guard elements.contains(elementName), valid else { valid = false; parser.abortParsing(); return }
        for (name, value) in values {
            guard attributes.contains(name), !value.lowercased().contains("javascript:"),
                  !value.lowercased().contains("data:"), !value.contains("://" ) || name == "xmlns" else {
                valid = false; parser.abortParsing(); return
            }
            if value.lowercased().contains("url"), value.range(of: #"^url\(#[A-Za-z_][A-Za-z0-9_.-]*\)$"#, options: .regularExpression) == nil {
                valid = false; parser.abortParsing(); return
            }
        }
    }
    func parser(_ parser: XMLParser, foundProcessingInstructionWithTarget target: String, data: String?) { valid = false; parser.abortParsing() }
}

/// Small destination scanner, not a Markdown serializer. Consumers with syntax ranges may use
/// planMigration(...references:). Code spans, fenced/indented code and unrelated link/text are excluded.
public enum AssetReferences {
    public static func scan(_ text: String) -> [AssetReference] {
        let chars = Array(text.utf16), ns = text as NSString
        var excluded = [Bool](repeating: false, count: chars.count)
        var lineStart = 0, fence: UInt16?, fenceCount = 0
        var listIndents: [Int] = [], quoteDepth = 0, paragraph = false
        var definitions: [Definition] = []
        while lineStart < chars.count {
            var end = lineStart
            while end < chars.count && chars[end] != 10 { end += 1 }
            var base = lineStart, quotes = 0
            // Blockquote markers are container prefixes, not part of code indentation.
            while base < end {
                var marker = base
                while marker < end && chars[marker] == 32 && marker - base < 3 { marker += 1 }
                guard marker < end && chars[marker] == 62 else { break }
                base = marker + 1
                if base < end && (chars[base] == 32 || chars[base] == 9) { base += 1 }
                quotes += 1
            }
            if quotes != quoteDepth { listIndents = []; fence = nil; paragraph = false; quoteDepth = quotes }
            var start = base, indent = 0
            while start < end && (chars[start] == 32 || chars[start] == 9) {
                indent += chars[start] == 9 ? 4 - indent % 4 : 1
                start += 1
            }
            if start == end { paragraph = false; lineStart = end + 1; continue }
            while let last = listIndents.last, indent < last { listIndents.removeLast() }
            var containerIndent = listIndents.last ?? 0
            if fence == nil && indent - containerIndent < 4 {
                // List marker width and its 1...4 columns of padding set the continuation column.
                // Repeat for compact nested markers ("- - item").
                while start < end {
                    var markerEnd = start
                    if [45, 43, 42].contains(chars[start]) { markerEnd += 1 }
                    else {
                        while markerEnd < end && (48...57).contains(chars[markerEnd]) && markerEnd - start < 9 { markerEnd += 1 }
                        if markerEnd > start && markerEnd < end && [46, 41].contains(chars[markerEnd]) { markerEnd += 1 }
                        else { break }
                    }
                    guard markerEnd == end || chars[markerEnd] == 32 || chars[markerEnd] == 9 else { break }
                    var next = markerEnd, padding = 0
                    while next < end && (chars[next] == 32 || chars[next] == 9) {
                        padding += chars[next] == 9 ? 4 - (indent + markerEnd - start + padding) % 4 : 1
                        next += 1
                    }
                    if padding > 4 { padding = 1; next = min(markerEnd + 1, end) }
                    indent += markerEnd - start + max(padding, 1)
                    listIndents.append(indent); containerIndent = indent
                    start = next
                    paragraph = false
                }
            }
            // A blockquote can also begin inside a list item: "- > [pic]:".
            // Keep its prefix out of the mapped definition, just as for outer quotes.
            while fence == nil && start < end && chars[start] == 62 {
                start += 1
                if start < end && (chars[start] == 32 || chars[start] == 9) { start += 1 }
                var quoteIndent = 0
                while start < end && (chars[start] == 32 || chars[start] == 9) {
                    quoteIndent += chars[start] == 9 ? 4 - quoteIndent % 4 : 1
                    start += 1
                }
                indent = containerIndent + quoteIndent
                quotes += 1
                quoteDepth = quotes
                paragraph = false
                if quoteIndent >= 4 { break }
            }
            var count = 0
            if start < end, chars[start] == 96 || chars[start] == 126 {
                while start + count < end && chars[start + count] == chars[start] { count += 1 }
            }
            let trailingWhitespace = (start + count..<end).allSatisfy { chars[$0] == 32 || chars[$0] == 9 }
            let closes = fence != nil && start < end && chars[start] == fence && count >= fenceCount && trailingWhitespace && indent - containerIndent <= 3
            let opens = fence == nil && indent - containerIndent <= 3 && count >= 3
            let code = fence != nil || opens || (indent - containerIndent >= 4 && !paragraph)
            if code {
                for index in lineStart..<end { excluded[index] = true }
                paragraph = false
                if closes { fence = nil }
                else if opens { fence = chars[start]; fenceCount = count }
            } else {
                // Parse the complete block before accepting it. Continuation destinations may
                // be indented code in isolation, and invalid definitions remain paragraph text.
                if !paragraph, let definition = definition(in: chars, start: start, end: end,
                    quoteDepth: quotes, listIndent: containerIndent) {
                    definitions.append(definition)
                    for index in lineStart..<min(definition.nextLine, chars.count) { excluded[index] = true }
                    lineStart = definition.nextLine
                    paragraph = false
                    continue
                }
                paragraph = true
            }
            lineStart = end + 1
        }
        func escaped(_ at: Int) -> Bool {
            var index = at - 1, slashes = 0
            while index >= 0 && chars[index] == 92 { slashes += 1; index -= 1 }
            return slashes % 2 == 1
        }
        var i = 0
        while i < chars.count {
            if chars[i] == 96 && !excluded[i] && !escaped(i) {
                var width = 1
                while i + width < chars.count && chars[i + width] == 96 { width += 1 }
                var j = i + width, found: Int?
                while j < chars.count {
                    if chars[j] == 96 && !excluded[j] {
                        var closing = 1
                        while j + closing < chars.count && chars[j + closing] == 96 { closing += 1 }
                        if closing == width { found = j + width; break }
                        j += closing
                    } else { j += 1 }
                }
                if let found { for index in i..<found { excluded[index] = true }; i = found; continue }
                i += width
            } else { i += 1 }
        }
        func substring(_ start: Int, _ end: Int) -> String { ns.substring(with: NSRange(location: start, length: end - start)) }
        func label(_ string: String) -> String { normalizedLabel(string) }
        var references: [AssetReference] = [], labels = Set<String>()
        i = 0
        while i + 1 < chars.count {
            guard chars[i] == 33, chars[i + 1] == 91, !excluded[i], !escaped(i) else { i += 1; continue }
            let altStart = i + 2
            var end = altStart, brackets = 1
            while end < chars.count && brackets > 0 {
                if !escaped(end) {
                    if chars[end] == 91 { brackets += 1 }
                    if chars[end] == 93 { brackets -= 1 }
                }
                end += 1
            }
            guard brackets == 0 else { i += 1; continue }
            let alt = substring(altStart, end - 1)
            var next = end
            if next < chars.count, chars[next] == 40 {
                next += 1
                while next < chars.count && [9, 10, 32].contains(chars[next]) { next += 1 }
                let angled = next < chars.count && chars[next] == 60
                if angled { next += 1 }
                let start = next
                var depth = 0
                while next < chars.count {
                    let char = chars[next]
                    if !escaped(next) {
                        if angled && char == 62 { break }
                        if !angled {
                            if char == 40 { depth += 1 }
                            if char == 41 { if depth == 0 { break }; depth -= 1 }
                            if [9, 10, 32].contains(char) && depth == 0 { break }
                        }
                    }
                    next += 1
                }
                if next > start, next < chars.count {
                    references.append(AssetReference(destination: substring(start, next), from: start, to: next))
                }
            } else if next < chars.count, chars[next] == 91 {
                let start = next + 1
                next = start
                while next < chars.count && (chars[next] != 93 || escaped(next)) { next += 1 }
                if next < chars.count { labels.insert(label(next == start ? alt : substring(start, next))) }
            } else { labels.insert(label(alt)) }
            i = end
        }
        var seen = Set<String>()
        for definition in definitions where seen.insert(definition.label).inserted {
            if labels.contains(definition.label), definition.reference.from < definition.reference.to {
                references.append(definition.reference)
            }
        }
        return references.sorted { $0.from < $1.from }
    }

    private struct Definition {
        let label: String
        let reference: AssetReference
        let nextLine: Int
    }
    private static func normalizedLabel(_ string: String) -> String {
        // markdown-it normalizes twice so Unicode case expansion (e.g. ß / SS) agrees.
        string.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").lowercased().uppercased()
    }

    /// A source-mapped version of markdown-it's reference/destination/title rules. Lines are
    /// appended lazily: speculative title lookahead must not consume a following paragraph.
    private static func definition(in source: [UInt16], start: Int, end: Int,
                                   quoteDepth: Int, listIndent: Int) -> Definition? {
        guard start < end, source[start] == 91 else { return nil }
        var input: [UInt16] = [], offsets: [Int] = []
        var lines: [(end: Int, next: Int)] = []
        var nextLine = end + 1
        func appendLine(_ start: Int, _ end: Int) {
            input.append(contentsOf: source[start..<end]); offsets.append(contentsOf: start..<end)
            lines.append((input.count, end + 1))
            input.append(10); offsets.append(end)
        }
        appendLine(start, end)
        func appendNext() -> Bool {
            guard nextLine < source.count else { return false }
            var end = nextLine
            while end < source.count && source[end] != 10 { end += 1 }
            var base = nextLine, quotes = 0
            while base < end {
                var marker = base, spaces = 0
                while marker < end && source[marker] == 32 && spaces < 3 + (quotes == 0 ? listIndent : 0) {
                    marker += 1; spaces += 1
                }
                guard marker < end, source[marker] == 62 else { break }
                base = marker + 1
                if base < end && (source[base] == 32 || source[base] == 9) { base += 1 }
                quotes += 1
            }
            // Missing quote/list prefixes can be lazy paragraph continuations; new containers
            // and block starters terminate a reference unless the continuation is indented.
            guard quotes <= quoteDepth else { return false }
            var content = base, indent = 0
            while content < end && (source[content] == 32 || source[content] == 9) {
                indent += source[content] == 9 ? 4 - indent % 4 : 1; content += 1
            }
            guard content < end else { return false }
            if indent - listIndent < 4 {
                let text = String(decoding: source[content..<end], as: UTF16.self)
                let block = #"^(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|(?:[-+*]|[0-9]{1,9}[.)])(?:[ \t]|$)|(?:[-*_][ \t]*){3,}$|>|\$\$|<!--|<\?|<![A-Z]|<!\[CDATA\[|</?(?:script|pre|style|textarea|address|article|aside|blockquote|div|table|ul|ol|li|section)(?:[ \t/>]|$))"#
                if text.range(of: block, options: [.regularExpression, .caseInsensitive]) != nil { return false }
            }
            appendLine(content, end); nextLine = end + 1
            return true
        }
        func skipSpace(_ position: inout Int) {
            while position < input.count {
                let char = input[position]
                guard char == 32 || char == 9 || char == 10 else { return }
                if char == 10 && position == input.count - 1 { _ = appendNext() }
                position += 1
            }
        }
        func lineAfter(_ position: Int) -> Int {
            lines.first { position <= $0.end }?.next ?? nextLine
        }
        func onlySpaceToEOL(_ position: Int) -> Bool {
            var index = position
            while index < input.count && (input[index] == 32 || input[index] == 9) { index += 1 }
            return index == input.count || input[index] == 10
        }
        var position = 1, labelEnd: Int?
        while position < input.count {
            let char = input[position]
            if char == 91 { return nil }
            if char == 93 { labelEnd = position; break }
            if char == 10 && position == input.count - 1 { _ = appendNext() }
            if char == 92, position + 1 < input.count {
                position += 1
                if input[position] == 10 && position == input.count - 1 { _ = appendNext() }
            }
            position += 1
        }
        guard let labelEnd, labelEnd + 1 < input.count, input[labelEnd + 1] == 58 else { return nil }
        let label = normalizedLabel(String(decoding: input[1..<labelEnd], as: UTF16.self))
        guard !label.isEmpty else { return nil }
        position = labelEnd + 2
        skipSpace(&position)
        guard position < input.count else { return nil }
        let angled = input[position] == 60
        if angled { position += 1 }
        let destinationStart = position
        var depth = 0
        while position < input.count {
            let char = input[position]
            if angled {
                if char == 10 || char == 60 { return nil }
                if char == 62 { break }
            } else {
                if char <= 32 || char == 127 { break }
                if char == 40 { depth += 1; if depth > 32 { return nil } }
                if char == 41 { if depth == 0 { break }; depth -= 1 }
            }
            if char == 92, position + 1 < input.count {
                // A backslash before a space does not escape the destination terminator.
                if input[position + 1] != 32 { position += 1 }
            }
            position += 1
        }
        let destinationEnd = position
        guard depth == 0, angled || position > destinationStart else { return nil }
        if angled {
            guard position < input.count, input[position] == 62 else { return nil }
            position += 1
        }
        let destination = String(decoding: input[destinationStart..<destinationEnd], as: UTF16.self)
        guard validDefinitionDestination(destination) else { return nil }
        let destinationEndPosition = position
        var consumed = lineAfter(position)
        skipSpace(&position)
        if position > destinationEndPosition, position < input.count, [34, 39, 40].contains(input[position]) {
            let close: UInt16 = input[position] == 40 ? 41 : input[position]
            let titleStart = position + 1
            position += 1
            var closed = false
            while position < input.count {
                let char = input[position]
                if char == close { closed = true; break }
                if char == 40 && close == 41 { break }
                if char == 10 && position == input.count - 1 { _ = appendNext() }
                if char == 92 && position + 1 < input.count { position += 1 }
                position += 1
            }
            if closed, onlySpaceToEOL(position + 1) { consumed = lineAfter(position + 1) }
            else {
                // A bad title on the following line leaves a valid destination-only definition;
                // a bad title on the destination line invalidates the definition as a whole.
                if closed && position == titleStart { return nil }
                guard onlySpaceToEOL(destinationEndPosition) else { return nil }
            }
        } else {
            guard onlySpaceToEOL(destinationEndPosition) else { return nil }
        }
        return Definition(label: label,
            reference: AssetReference(destination: destination, from: offsets[destinationStart],
                to: destinationEnd > destinationStart ? offsets[destinationEnd - 1] + 1 : offsets[destinationStart]),
            nextLine: consumed)
    }

    private static func validDefinitionDestination(_ raw: String) -> Bool {
        // Keep the renderer's configured scheme policy when deciding which duplicate definition
        // is first valid. Native capability authorization remains a separate, stricter boundary.
        var value = raw.replacingOccurrences(of: ##"\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])"##,
            with: "$1", options: .regularExpression)
        value = value.replacingOccurrences(of: "&colon;", with: ":")
        if let regex = try? NSRegularExpression(pattern: #"&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?"#) {
            let original = value as NSString
            for match in regex.matches(in: value, range: NSRange(location: 0, length: original.length)).reversed() {
                let hex = match.range(at: 1).location != NSNotFound
                let range = match.range(at: hex ? 1 : 2)
                if let number = UInt32(original.substring(with: range), radix: hex ? 16 : 10), let scalar = UnicodeScalar(number) {
                    value = (value as NSString).replacingCharacters(in: match.range, with: String(scalar))
                }
            }
        }
        guard let scheme = value.range(of: #"^[A-Za-z][A-Za-z0-9+.-]*:"#, options: .regularExpression) else { return true }
        let name = value[scheme].lowercased()
        return ["http:", "https:", "mailto:"].contains(name) ||
            (name == "file:" && value.range(of: #"^file://(?:/|localhost/)"#, options: [.regularExpression, .caseInsensitive]) != nil)
    }

}
