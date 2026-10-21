import XCTest
@testable import ReTPreview
final class PersistenceTests: RecoveryIsolatedTestCase {
 func testUTF8BOMAndCRLFRoundTrip() throws {
  let bytes = Data([0xEF,0xBB,0xBF] + Array("中文\r\n\r\nlast  \n".utf8))
  XCTAssertEqual(UTF8File.encode(try UTF8File.decode(bytes)), bytes)
  XCTAssertThrowsError(try UTF8File.decode(Data([0xFF,0xFE])))
 }
 func testReceivedDoesNotClaimDurableAndRejectsStaleIdentity() {
  var state = DocumentState(documentID: "doc", epoch: "epoch")
  let one = Snapshot(source: "one", revision: 1)
  XCTAssertTrue(state.receive(one, documentID: "doc", epoch: "epoch"))
  XCTAssertNil(state.durable)
  XCTAssertFalse(state.receive(Snapshot(source: "old", revision: 0), documentID: "doc", epoch: "epoch"))
  XCTAssertFalse(state.receive(Snapshot(source: "other", revision: 2), documentID: "other", epoch: "epoch"))
  XCTAssertFalse(state.receive(Snapshot(source: "stale", revision: 2), documentID: "doc", epoch: "old"))
  XCTAssertEqual(state.received, one)
  state.markDurable(one)
  XCTAssertEqual(state.durable, one)
 }
 func testSavingOlderSnapshotKeepsNewInputDirtyAndUndoToSavedIsClean() {
  var state = DocumentState(documentID: "doc", epoch: "epoch")
  let one = Snapshot(source: "one", revision: 1)
  _ = state.receive(one, documentID: "doc", epoch: "epoch")
  _ = state.receive(Snapshot(source: "two", revision: 2), documentID: "doc", epoch: "epoch")
  state.markSaved(one)
  XCTAssertTrue(state.isDirty)
  _ = state.receive(Snapshot(source: "one", revision: 3), documentID: "doc", epoch: "epoch")
  XCTAssertFalse(state.isDirty)
 }
 func testWriteFailurePreservesOriginal() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let original = root.appendingPathComponent("original.md")
  try Data("original".utf8).write(to: original)
  XCTAssertThrowsError(try UTF8File.write("changed", to: original.appendingPathComponent("invalid")))
  XCTAssertEqual(try Data(contentsOf: original), Data("original".utf8))
  try UTF8File.write("\u{FEFF}new\r\n", to: original)
  XCTAssertEqual(try Data(contentsOf: original), Data([0xEF,0xBB,0xBF,0x6E,0x65,0x77,0x0D,0x0A]))
 }
 func testCorruptRecoveryFallsBackToPreviousGeneration() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let store = RecoveryStore(directory: root)
  let first = RecoveryRecord(documentID: "doc", fileURL: nil, snapshot: Snapshot(source: "first", revision: 1), date: Date())
  let second = RecoveryRecord(documentID: "doc", fileURL: nil, snapshot: Snapshot(source: "second", revision: 2), date: Date())
  try store.write(first); try store.write(second)
  XCTAssertEqual(store.latest(documentID: "doc"), second)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  try Data("corrupt".utf8).write(to: root.appendingPathComponent("doc.current.json"))
  XCTAssertEqual(store.latest(documentID: "doc"), first)
 }
}
