import Foundation
import CryptoKit

func contentHash(_ bytes: Data) -> String {
    SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
}

struct DiskFingerprint: Equatable, Sendable {
    let hash: String
    let fileID: UInt64
    static func read(_ url: URL) throws -> DiskFingerprint? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let bytes = try Data(contentsOf: url)
        return try fromBytes(bytes, at: url)
    }
    static func fromBytes(_ bytes: Data, at url: URL) throws -> DiskFingerprint {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return DiskFingerprint(hash: contentHash(bytes), fileID: (attributes[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0)
    }
}

enum ExternalChanges {
    static func requireUnchanged(_ url: URL, expected: DiskFingerprint?) throws {
        guard try DiskFingerprint.read(url) == expected else { throw NativeEditorError.externalConflict }
    }
    static func identity(_ url: URL) -> String {
        let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
        if let attributes = try? FileManager.default.attributesOfItem(atPath: canonical.path),
           let device = attributes[.systemNumber] as? NSNumber,
           let inode = attributes[.systemFileNumber] as? NSNumber {
            return "\(device):\(inode)"
        }
        return canonical.path
    }
}
