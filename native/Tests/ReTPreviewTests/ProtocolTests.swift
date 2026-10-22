import XCTest
@testable import ReTPreview
final class ProtocolTests: RecoveryIsolatedTestCase {
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
 func testClipboardImageSourceIsExplicitAndUnambiguous() {
  func parse(_ payload: [String: Any]) -> BridgeEnvelope? {
   BridgeEnvelope.parse(["v":1,"documentId":"doc","epoch":"epoch","requestId":"image","method":"importImage","payload":payload], trusted:true, documentID:"doc", epoch:"epoch")
  }
  XCTAssertNotNil(parse([:]))
  XCTAssertNotNil(parse(["dataURL":"data:image/png;base64,AA==","fileName":"clip.png"]))
  XCTAssertNotNil(parse(["source":"clipboard"]))
  XCTAssertNil(parse(["source":"clipboard","dataURL":"data:image/png;base64,AA=="]))
  XCTAssertNil(parse(["source":"picker"]))
  XCTAssertNil(parse(["source":1]))
 }
 func testAssetManifestRequiresBoundedPathsAndFrozenIntegerRevision() {
  func parse(_ payload: [String:Any]) -> BridgeEnvelope? {
   BridgeEnvelope.parse(["v":1,"documentId":"doc","epoch":"epoch","requestId":"manifest","method":"assetManifest","payload":payload],trusted:true,documentID:"doc",epoch:"epoch")
  }
  XCTAssertNotNil(parse(["paths":["图%20片.svg"],"revision":4]))
  XCTAssertNil(parse(["paths":[42],"revision":4]))
  XCTAssertNil(parse(["paths":["safe.svg"],"revision":true]))
  XCTAssertNil(parse(["paths":[String(repeating:"x",count:8193)],"revision":4]))
  XCTAssertNil(parse(["paths":["safe.svg"],"revision":4,"root":"/etc"]))
 }
 func testByteDifferentUnicodeRemainsDirty() {
  var state = DocumentState(documentID: "d", epoch: "e", source: "\u{E9}")
  _ = state.receive(Snapshot(source: "e\u{301}", revision: 1), documentID: "d", epoch: "e")
  XCTAssertTrue(state.isDirty)
 }
}
