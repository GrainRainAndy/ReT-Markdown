import Foundation
struct Snapshot: Codable, Equatable {
 let source: String
 let revision: Int
 static func == (lhs: Self, rhs: Self) -> Bool { lhs.revision == rhs.revision && lhs.source.utf8.elementsEqual(rhs.source.utf8) }
}
struct DocumentState {
 let documentID: String
 let epoch: String
 var received: Snapshot
 var durable: Snapshot?
 var saved: Snapshot
 init(documentID: String = UUID().uuidString, epoch: String = UUID().uuidString, source: String = "") {
  self.documentID = documentID; self.epoch = epoch
  received = Snapshot(source: source, revision: 0); saved = received
 }
 var isDirty: Bool { !received.source.utf8.elementsEqual(saved.source.utf8) }
 mutating func receive(_ snapshot: Snapshot, documentID: String, epoch: String) -> Bool {
  guard documentID == self.documentID, epoch == self.epoch, snapshot.revision > received.revision else { return false }
  received = snapshot; return true
 }
 mutating func markDurable(_ snapshot: Snapshot) {
  guard snapshot.revision <= received.revision, snapshot.revision >= (durable?.revision ?? -1) else { return }
  durable = snapshot
 }
 mutating func markSaved(_ snapshot: Snapshot) { saved = snapshot }
}
enum UTF8File {
 static func decode(_ data: Data) throws -> String {
  guard let text = String(data: data, encoding: .utf8) else { throw CocoaError(.fileReadInapplicableStringEncoding) }
  // Foundation strips a leading BOM while decoding; retain it in the source contract.
  return data.starts(with: [0xEF, 0xBB, 0xBF]) ? "\u{FEFF}" + text : text
 }
 static func encode(_ source: String) -> Data { Data(source.utf8) }
 static func write(_ source: String, to url: URL) throws { try encode(source).write(to: url, options: .atomic) }
}
