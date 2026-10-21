import XCTest
@testable import ReTPreview
final class ProtocolTests: XCTestCase {
 func testTrustIdentityAndSchemaAreRequired() {
  let valid: [String: Any] = ["v":1,"documentId":"doc","epoch":"epoch","requestId":"id","method":"checkpoint","payload":["source":"hi","revision":1,"dirty":true]]
  XCTAssertNotNil(BridgeEnvelope.parse(valid, trusted: true, documentID: "doc", epoch: "epoch"))
  XCTAssertNil(BridgeEnvelope.parse(valid, trusted: false, documentID: "doc", epoch: "epoch"))
  XCTAssertNil(BridgeEnvelope.parse(valid, trusted: true, documentID: "doc", epoch: "old"))
  var bad = valid; bad["v"] = 2
  XCTAssertNil(BridgeEnvelope.parse(bad, trusted: true, documentID: "doc", epoch: "epoch"))
  bad = valid; bad["payload"] = ["source":"hi","revision":1.5,"dirty":true]
  XCTAssertNil(BridgeEnvelope.parse(bad, trusted: true, documentID: "doc", epoch: "epoch"))
  bad = valid; bad["requestId"] = ""
  XCTAssertNil(BridgeEnvelope.parse(bad, trusted: true, documentID: "doc", epoch: "epoch"))
 }
 func testReadyOnlyAllowsEmptyOrMatchingIdentity() {
  var ready: [String: Any] = ["v":1,"documentId":"","epoch":"","requestId":"ready","method":"ready","payload":[:]]
  XCTAssertNotNil(BridgeEnvelope.parse(ready, trusted: true, documentID: "doc", epoch: "epoch"))
  ready["documentId"] = "other"
  XCTAssertNil(BridgeEnvelope.parse(ready, trusted: true, documentID: "doc", epoch: "epoch"))
 }
 func testByteDifferentUnicodeRemainsDirty() {
  var state = DocumentState(documentID: "d", epoch: "e", source: "\u{E9}")
  _ = state.receive(Snapshot(source: "e\u{301}", revision: 1), documentID: "d", epoch: "e")
  XCTAssertTrue(state.isDirty)
 }
}
