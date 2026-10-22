import XCTest
import AppKit
@testable import ReTPreview

@MainActor private final class ReviewObserver: NSObject {
 var responses: [Bool] = []
 @objc func reviewed(_ controller: NSDocumentController, result: Bool, contextInfo: UnsafeMutableRawPointer?) { responses.append(result) }
}
final class TerminationTests: RecoveryIsolatedTestCase {
 @MainActor func testReviewEntryIncludesNativeCleanWebPendingAndCoalescesRetry() async throws {
  let controller = DocumentTestEnvironment.controller
  let document = try await attachEditor(source: "saved")
  let window = NSWindow(contentRect: NSRect(x: 0,y: 0,width: 400,height: 300), styleMask: [.titled], backing: .buffered, defer: false)
  document.addWindowController(NSWindowController(window: window))
  controller.addDocument(document)
  defer { environment.close(document); controller.removeDocument(document) }
  _ = try await evaluateEditor(document, "document.querySelector('.ProseMirror').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));")
  XCTAssertFalse(document.isDocumentEdited)
  XCTAssertTrue(controller.hasEditedDocuments, "AppKit must enter review even when only Web has pending input")
  let observer = ReviewObserver()
  for _ in 0..<2 { controller.reviewUnsavedDocuments(withAlertTitle: nil, cancellable: true, delegate: observer, didReviewAllSelector: #selector(ReviewObserver.reviewed(_:result:contextInfo:)), contextInfo: nil) }
  try await Task.sleep(nanoseconds: 100_000_000)
  XCTAssertEqual(observer.responses, [], "review must await pending composition")
  _ = try await evaluateEditor(document, "document.querySelector('.ProseMirror p').textContent='late input';")
  try await Task.sleep(nanoseconds:100_000_000)
  _ = try await evaluateEditor(document, "document.querySelector('.ProseMirror').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));")
  try await eventually { window.attachedSheet != nil }
  window.endSheet(window.attachedSheet!, returnCode: .alertSecondButtonReturn)
  try await eventually { observer.responses.count == 2 }
  XCTAssertEqual(observer.responses, [false, false])
  XCTAssertFalse(document.closed)
  XCTAssertEqual(document.state.received.source, "late input")
  let held = try await evaluateEditor(document,"return document.querySelector('#workspace').inert")
  XCTAssertEqual(held as? Bool,false)
  controller.closeAllDocuments(withDelegate: observer, didCloseAllSelector: #selector(ReviewObserver.reviewed(_:result:contextInfo:)), contextInfo: nil)
  try await eventually { window.attachedSheet != nil }
  window.endSheet(window.attachedSheet!, returnCode: .alertThirdButtonReturn)
  try await eventually { observer.responses.count == 3 }
  XCTAssertEqual(observer.responses, [false, false, true])
  XCTAssertTrue(controller.documents.isEmpty)
  XCTAssertNil(environment.recoveryStore.latest(documentID: document.state.documentID))
 }
 @MainActor func testReviewAndCloseAllOverlapWhileSaveIsInFlight() async throws {
  let controller = DocumentTestEnvironment.controller
  let document = try await attachEditor(source:"saved snapshot")
  controller.addDocument(document)
  defer { environment.close(document); controller.removeDocument(document) }
  let target = environment.root.appendingPathComponent("in-flight.md")
  var release: ((Result<Void,Error>) -> Void)?
  document.prepareAssetsForSave = { _,_,completion in release = completion }
  var saved = false
  document.save(to:target,ofType:"net.daringfireball.markdown",for:.autosaveInPlaceOperation) { error in XCTAssertNil(error); saved = true }
  let observer = ReviewObserver()
  controller.reviewUnsavedDocuments(withAlertTitle:nil,cancellable:true,delegate:observer,didReviewAllSelector:#selector(ReviewObserver.reviewed(_:result:contextInfo:)),contextInfo:nil)
  controller.closeAllDocuments(withDelegate:observer,didCloseAllSelector:#selector(ReviewObserver.reviewed(_:result:contextInfo:)),contextInfo:nil)
  XCTAssertEqual(observer.responses,[])
  release?(.success(()))
  try await eventually { observer.responses.count == 2 }
  XCTAssertTrue(saved)
  XCTAssertEqual(observer.responses,[true,true])
  XCTAssertEqual(try String(contentsOf:target,encoding:.utf8),"saved snapshot")
  XCTAssertTrue(controller.documents.isEmpty)
  XCTAssertNil(environment.recoveryStore.latest(documentID:document.state.documentID))
 }
 @MainActor func testReviewIncludesMultipleCleanDocumentsAndNewDocumentDuringFlush() async throws {
  let controller = DocumentTestEnvironment.controller
  let first = try await attachEditor(source: "one")
  let second = try await attachEditor(source: "two")
  let late = try await attachEditor(source: "late")
  for d in [first,second] { controller.addDocument(d) }
  defer { for d in [first,second,late] { environment.close(d); controller.removeDocument(d) } }
  // Suspend the first flush in the real renderer while another window is added.
  for d in [first,second] { _ = try await evaluateEditor(d, "const receive=window.retNative.receive;window.originalReceive=receive;window.retNative.receive=m=>{if(m.method==='flush'){window.heldFlush=m;window.resumeFlush=()=>receive(m)}else receive(m)}") }
  let observer = ReviewObserver()
  controller.reviewUnsavedDocuments(withAlertTitle: nil, cancellable: true, delegate: observer, didReviewAllSelector: #selector(ReviewObserver.reviewed(_:result:contextInfo:)), contextInfo: nil)
  try await eventually { for d in [first,second] { if (try? await self.evaluateEditor(d,"return !!window.heldFlush")) as? Bool == true { return true } }; return false }
  controller.addDocument(late)
  for d in [first,second] { _ = try await evaluateEditor(d, "window.retNative.receive=window.originalReceive; if(window.resumeFlush) window.resumeFlush();") }
  // Restore the receive wrapper in the still-open second document as it is visited.
  try await eventually {
   for d in [first,second] where !d.closed { _ = try? await self.evaluateEditor(d,"if(window.resumeFlush) window.resumeFlush();") }
   return !observer.responses.isEmpty
  }
  XCTAssertEqual(observer.responses,[true])
  XCTAssertTrue(controller.documents.isEmpty)
 }
}
