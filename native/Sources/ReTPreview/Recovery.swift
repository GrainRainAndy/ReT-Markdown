import Foundation
import CryptoKit
struct RecoveryRecord: Codable, Equatable {
 let documentID: String
 let fileURL: URL?
 let snapshot: Snapshot
 let date: Date
}
struct RecoveryStore {
 let directory: URL
 private struct CheckedRecord: Codable { let record: RecoveryRecord; let digest: String }
 private func path(_ id: String, _ generation: String) -> URL { directory.appendingPathComponent("\(id).\(generation).json") }
 private func validID(_ id: String) -> Bool { !id.isEmpty && id.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 } }
 private func read(_ url: URL) -> RecoveryRecord? {
  guard let data = try? Data(contentsOf: url), let checked = try? JSONDecoder().decode(CheckedRecord.self, from: data), checked.digest == digest(checked.record.snapshot.source) else { return nil }
  return checked.record
 }
 private func digest(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }
 func write(_ record: RecoveryRecord) throws {
  guard validID(record.documentID) else { throw CocoaError(.fileWriteInvalidFileName) }
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  let current = path(record.documentID, "current")
  if let previous = read(current) { try encoded(previous).write(to: path(record.documentID, "previous"), options: .atomic) }
  try encoded(record).write(to: current, options: .atomic)
 }
 private func encoded(_ record: RecoveryRecord) throws -> Data { try JSONEncoder().encode(CheckedRecord(record: record, digest: digest(record.snapshot.source))) }
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
