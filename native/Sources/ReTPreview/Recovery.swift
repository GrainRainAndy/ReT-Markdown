import Foundation
import CryptoKit
struct RecoveryRecord: Codable, Equatable {
 let documentID: String
 let fileURL: URL?
 let snapshot: Snapshot
 let date: Date
 let recoveryDraft: RecoveryDraft?
 init(documentID: String, fileURL: URL?, snapshot: Snapshot, date: Date, recoveryDraft: RecoveryDraft? = nil) {
  self.documentID = documentID; self.fileURL = fileURL; self.snapshot = snapshot; self.date = date; self.recoveryDraft = recoveryDraft
 }
}
struct RecoveryStore {
 let directory: URL
 private struct CheckedRecord: Codable { let record: RecoveryRecord; let digest: String; var version: Int? = 2 }
 private func path(_ id: String, _ generation: String) -> URL { directory.appendingPathComponent("\(id).\(generation).json") }
 private func validID(_ id: String) -> Bool { !id.isEmpty && id.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 } }
 private func read(_ url: URL) -> RecoveryRecord? {
  guard let data = try? Data(contentsOf: url), let checked = try? JSONDecoder().decode(CheckedRecord.self, from: data), validRecord(checked.record) else { return nil }
  if checked.version == 2 {
   guard let bytes = try? recordBytes(checked.record), checked.digest == digest(bytes) else { return nil }
  } else {
   // The previous format had no drafts and hashed only committed source.
   guard checked.version == nil, checked.record.recoveryDraft == nil, checked.digest == digest(Data(checked.record.snapshot.source.utf8)) else { return nil }
  }
  return checked.record
 }
 private func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
 func write(_ record: RecoveryRecord) throws {
  guard validID(record.documentID), validRecord(record) else { throw CocoaError(.fileWriteInvalidFileName) }
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  let current = path(record.documentID, "current")
  if let previous = read(current) { try encoded(previous).write(to: path(record.documentID, "previous"), options: .atomic) }
  try encoded(record).write(to: current, options: .atomic)
 }
 private func recordBytes(_ record: RecoveryRecord) throws -> Data {
  let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
  return try encoder.encode(record)
 }
 private func validRecord(_ record: RecoveryRecord) -> Bool {
  guard record.snapshot.revision >= 0 else { return false }
  guard let draft = record.recoveryDraft else { return true }
  return draft.isValid && draft.baseRevision == record.snapshot.revision
 }
 private func encoded(_ record: RecoveryRecord) throws -> Data { try JSONEncoder().encode(CheckedRecord(record: record, digest: digest(try recordBytes(record)))) }
 func latest(documentID: String) -> RecoveryRecord? {
  guard validID(documentID) else { return nil }
  return read(path(documentID, "current")) ?? read(path(documentID, "previous"))
 }
 func records() -> [RecoveryRecord] {
  let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
  let ids = Set(names.compactMap { $0.hasSuffix(".json") ? $0.components(separatedBy: ".").first : nil })
  return ids.compactMap { latest(documentID: $0) }.sorted { $0.date < $1.date }
 }
 func remove(documentID: String) {
  guard validID(documentID) else { return }
  for generation in ["current", "previous"] { try? FileManager.default.removeItem(at: path(documentID, generation)) }
 }
 static var applicationStore: RecoveryStore {
  let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
  return RecoveryStore(directory: root.appendingPathComponent("com.retmarkdown.rewrite.preview/Recovery", isDirectory: true))
 }
}

struct RecoveryDraft: Codable, Equatable {
 let baseRevision: Int
 let owner: String
 let format: String
 let content: String
 let recoverySource: String?
 let reason: String
 var isValid: Bool {
  baseRevision >= 0 && !owner.isEmpty && owner.utf8.count <= 128 && ["text", "prosemirror-json"].contains(format) && content.utf8.count <= 32 * 1024 * 1024 && reason.utf8.count <= 2048 && (recoverySource?.utf8.count ?? 0) <= 32 * 1024 * 1024
 }
 var payload: [String: Any] {
  var result: [String: Any] = ["baseRevision":baseRevision,"owner":owner,"format":format,"content":content,"reason":reason]
  if let recoverySource { result["recoverySource"] = recoverySource }
  return result
 }
 static func parse(_ object: Any) -> RecoveryDraft? {
  guard let fields = object as? [String: Any], Set(fields.keys).isSubset(of: ["baseRevision", "owner", "format", "content", "recoverySource", "reason"]),
   let base = BridgeEnvelope.integer(fields["baseRevision"]), let owner = fields["owner"] as? String,
   let format = fields["format"] as? String, let content = fields["content"] as? String, let reason = fields["reason"] as? String else { return nil }
  if let recovery = fields["recoverySource"], !(recovery is String) { return nil }
  let draft = Self(baseRevision: base, owner: owner, format: format, content: content, recoverySource: fields["recoverySource"] as? String, reason: reason)
  return draft.isValid ? draft : nil
 }
}
enum CheckpointStage: String { case received, durable }
final class RecoveryJournal {
 let store: RecoveryStore
 private let queue: DispatchQueue
 init(store: RecoveryStore, queue: DispatchQueue = DispatchQueue(label: "com.retmarkdown.rewrite.preview.recovery-journal")) { self.store = store; self.queue = queue }
 func write(_ record: RecoveryRecord, acknowledge: @escaping (CheckpointStage) -> Void, completion: @escaping (Result<Void, Error>) -> Void) {
  acknowledge(.received)
  queue.async { [store] in
   do {
    try store.write(record)
    DispatchQueue.main.async { acknowledge(.durable); completion(.success(())) }
   } catch { DispatchQueue.main.async { completion(.failure(error)) } }
  }
 }
}
