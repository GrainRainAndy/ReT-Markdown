import XCTest
@testable import ReTPreview
final class RecoveryDraftTests: XCTestCase {
 private func draft(_ revision: Int = 0) -> RecoveryDraft {
  RecoveryDraft(baseRevision: revision, owner: "prose", format: "prosemirror-json", content: "{\"text\":\"未提交的中文\"}", recoverySource: "可恢复源文\r\n", reason: "unsupported step")
 }
 func testDraftActualContentRoundTripsAndExplicitClearPersists() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = RecoveryStore(directory: directory)
  let record = RecoveryRecord(documentID: "draft-doc", fileURL: nil, snapshot: Snapshot(source: "\u{FEFF}committed\r\n", revision: 0), date: Date(), recoveryDraft: draft())
  try store.write(record)
  XCTAssertEqual(store.latest(documentID: "draft-doc")?.recoveryDraft?.content, "{\"text\":\"未提交的中文\"}")
  XCTAssertEqual(store.latest(documentID: "draft-doc")?.recoveryDraft?.recoverySource, "可恢复源文\r\n")
  try store.write(RecoveryRecord(documentID: "draft-doc", fileURL: nil, snapshot: record.snapshot, date: Date()))
  XCTAssertNil(store.latest(documentID: "draft-doc")?.recoveryDraft)
 }
 func testDraftRequiresCurrentBaseAndResolutionIsAtomic() {
  var state = DocumentState()
  XCTAssertFalse(state.receiveDraft(draft(1)))
  XCTAssertTrue(state.receiveDraft(draft()))
  XCTAssertEqual(state.recoveryDraft?.content, "{\"text\":\"未提交的中文\"}")
  XCTAssertFalse(state.receive(Snapshot(source: "unrelated", revision: 1), documentID: state.documentID, epoch: state.epoch))
  XCTAssertFalse(state.resolveDraft(with: Snapshot(source: "old", revision: 0)))
  XCTAssertNotNil(state.recoveryDraft)
  XCTAssertTrue(state.resolveDraft(with: Snapshot(source: "resolved", revision: 1)))
  XCTAssertNil(state.recoveryDraft)
  XCTAssertEqual(state.received.source, "resolved")
  XCTAssertFalse(state.resolveDraft(with: Snapshot(source: "duplicate", revision: 1)))
  XCTAssertTrue(state.receiveDraft(draft(1)))
  XCTAssertTrue(state.receiveDraft(nil))
  XCTAssertNil(state.recoveryDraft)
 }
 func testRecoveredCopyRetainsRevisionZeroAndDraft() async {
  let record = RecoveryRecord(documentID: "doc", fileURL: nil, snapshot: Snapshot(source: "baseline", revision: 0), date: Date(), recoveryDraft: draft())
  await MainActor.run {
   let document = MarkdownDocument()
   document.restore(record)
   XCTAssertEqual(document.state.received.revision, 0)
   XCTAssertEqual(document.state.received.source, "baseline")
   XCTAssertEqual(document.state.recoveryDraft?.content, "{\"text\":\"未提交的中文\"}")
   XCTAssertTrue(document.isDocumentEdited)
   let loaded = document.loadPayload["recoveryDraft"] as? [String: Any]
   XCTAssertEqual(loaded?["content"] as? String, "{\"text\":\"未提交的中文\"}")
   XCTAssertEqual(loaded?["baseRevision"] as? Int, 0)
   let oldEpoch = document.state.epoch
   document.rendererWillRestart()
   XCTAssertNotEqual(oldEpoch, document.state.epoch)
   XCTAssertEqual((document.loadPayload["recoveryDraft"] as? [String: Any])?["content"] as? String, "{\"text\":\"未提交的中文\"}")
   document.close()
  }
 }
 func testProtocolAcceptsDraftDataAndRejectsMalformedResolutionFlag() {
  let envelope: [String: Any] = ["v":1,"documentId":"doc","epoch":"epoch","requestId":"draft","method":"recoveryDraft","payload":["draft":draft().payload]]
  XCTAssertNotNil(BridgeEnvelope.parse(envelope, trusted: true, documentID: "doc", epoch: "epoch"))
  var clear = envelope; clear["payload"] = ["draft":NSNull()]
  XCTAssertNotNil(BridgeEnvelope.parse(clear, trusted: true, documentID: "doc", epoch: "epoch"))
  var checkpoint = envelope; checkpoint["method"] = "checkpoint"
  checkpoint["payload"] = ["source":"resolved","revision":1,"dirty":true,"resolvesRecoveryDraft":"yes"]
  XCTAssertNil(BridgeEnvelope.parse(checkpoint, trusted: true, documentID: "doc", epoch: "epoch"))
 }
 func testDraftSchemaRejectsWrongTypesAndAllowsOpaqueContent() {
  let payload: [String: Any] = ["baseRevision":0,"owner":"prose","format":"prosemirror-json","content":"{opaque data}","reason":"conversion"]
  XCTAssertNotNil(RecoveryDraft.parse(payload))
  var invalid = payload; invalid["baseRevision"] = -1
  XCTAssertNil(RecoveryDraft.parse(invalid))
  invalid = payload; invalid["content"] = ["text":"nested"]
  XCTAssertNil(RecoveryDraft.parse(invalid))
  invalid = payload; invalid["format"] = "html"
  XCTAssertNil(RecoveryDraft.parse(invalid))
 }
 func testFailedDiskWriteNeverAcknowledgesDurable() {
  let impossible = URL(fileURLWithPath: "/dev/null/cannot-create-recovery")
  let journal = RecoveryJournal(store: RecoveryStore(directory: impossible))
  let done = expectation(description: "write result")
  var stages: [CheckpointStage] = []
  let record = RecoveryRecord(documentID: "doc", fileURL: nil, snapshot: Snapshot(source: "keep", revision: 1), date: Date())
  journal.write(record, acknowledge: { stages.append($0) }) { result in
   if case .success = result { XCTFail("unwritable recovery must fail") }
   XCTAssertEqual(stages, [.received])
   done.fulfill()
  }
  wait(for: [done], timeout: 5)
 }
 func testDurableAcknowledgementFollowsRealDiskRecord() {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = RecoveryStore(directory: directory)
  let journal = RecoveryJournal(store: store)
  let record = RecoveryRecord(documentID: "doc", fileURL: nil, snapshot: Snapshot(source: "committed", revision: 0), date: Date(), recoveryDraft: draft())
  let done = expectation(description: "write result")
  var stages: [CheckpointStage] = []
  journal.write(record, acknowledge: { stage in
   stages.append(stage)
   if stage == .durable { XCTAssertEqual(store.latest(documentID: "doc")?.recoveryDraft?.content, "{\"text\":\"未提交的中文\"}") }
  }) { result in
   if case .failure(let error) = result { XCTFail(error.localizedDescription) }
   XCTAssertEqual(stages, [.received, .durable]); done.fulfill()
  }
  wait(for: [done], timeout: 5)
 }
}
