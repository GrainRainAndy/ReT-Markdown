import XCTest
import AppKit
@testable import ReTPreview

@MainActor private final class CloseObserver: NSObject {
 var responses: [Bool] = []
 var completed: (() -> Void)?
 @objc func document(_ document: NSDocument, shouldClose: Bool, contextInfo: UnsafeMutableRawPointer?) {
  responses.append(shouldClose); completed?()
 }
}
final class LifecycleTests: RecoveryIsolatedTestCase {
 func testRejectedQueuedSaveDrainsCloseAndCancelAllowsAnotherClose() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let firstSave = expectation(description: "save A completes")
  let secondSave = expectation(description: "save B rejects")
  let document = await MainActor.run { () -> MarkdownDocument in
   _ = NSApplication.shared
   let document = environment.makeDocument()
   let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
   document.addWindowController(NSWindowController(window: window))
   _ = document.accept(Snapshot(source: "save A", revision: 1))
   return document
  }
  let observer = await MainActor.run { CloseObserver() }
  await MainActor.run {
   var releaseAssets: ((Result<Void, Error>) -> Void)?
   document.prepareAssetsForSave = { _, _, completion in releaseAssets = completion }
   document.save(to: root.appendingPathComponent("draft.md"), ofType: "net.daringfireball.markdown", for: .autosaveInPlaceOperation) { error in
    XCTAssertNil(error); firstSave.fulfill()
   }
   document.save(to: root.appendingPathComponent("draft.md"), ofType: "net.daringfireball.markdown", for: .autosaveInPlaceOperation) { error in
    XCTAssertEqual((error as? CocoaError)?.code, .userCancelled); secondSave.fulfill()
   }
   document.canClose(withDelegate: observer, shouldClose: #selector(CloseObserver.document(_:shouldClose:contextInfo:)), contextInfo: nil)
   document.canClose(withDelegate: observer, shouldClose: #selector(CloseObserver.document(_:shouldClose:contextInfo:)), contextInfo: nil)
   document.prepareAssetsForSave = nil
   releaseAssets?(.success(()))
  }
  await fulfillment(of: [firstSave, secondSave], timeout: 3)
  for attempt in 0..<2 {
   let cancelled = expectation(description: "close \(attempt) cancel callback")
   await MainActor.run {
    observer.completed = { if observer.responses.count == (attempt == 0 ? 2 : 3) { cancelled.fulfill() } }
    if attempt == 1 { document.canClose(withDelegate: observer, shouldClose: #selector(CloseObserver.document(_:shouldClose:contextInfo:)), contextInfo: nil) }
    let sheet = document.windowControllers.first?.window?.attachedSheet
    XCTAssertNotNil(sheet, "close continuation must run after rejected save")
    if let sheet { document.windowControllers.first?.window?.endSheet(sheet, returnCode: .alertFirstButtonReturn) }
   }
   await fulfillment(of: [cancelled], timeout: 1)
  }
  await MainActor.run { XCTAssertEqual(observer.responses, [false, false, false]); environment.close(document) }
 }
 @MainActor func testStalledPrepareCloseTimeoutCompletesBothDelegatesAndLateCommitCannotWrite() async throws {
  let document = environment.makeDocument()
  let target = environment.root.appendingPathComponent("late.md")
  var release: ((Result<Void,Error>) -> Void)?
  document.prepareAssetsForSave = { _,_,completion in release = completion }
  var saveResults = 0
  document.save(to:target,ofType:"net.daringfireball.markdown",for:.autosaveInPlaceOperation) { error in
   XCTAssertNotNil(error); saveResults += 1
  }
  let observer = CloseObserver()
  let cancelled = expectation(description:"both overlapping requests time out")
  observer.completed = { if observer.responses.count == 2 { cancelled.fulfill() } }
  for _ in 0..<2 { document.canClose(withDelegate:observer,shouldClose:#selector(CloseObserver.document(_:shouldClose:contextInfo:)),contextInfo:nil) }
  await fulfillment(of:[cancelled],timeout:11)
  XCTAssertEqual(observer.responses,[false,false])
  XCTAssertTrue(document.accept(Snapshot(source:"editing survives cancellation",revision:1)))
  document.save(to:target,ofType:"net.daringfireball.markdown",for:.autosaveInPlaceOperation) { error in
   XCTAssertNotNil(error); saveResults += 1
  }
  document.close()
  release?(.success(())); release?(.success(()))
  XCTAssertEqual(saveResults,2)
  XCTAssertFalse(FileManager.default.fileExists(atPath:target.path))
  let drained = expectation(description:"cleanup queue drained")
  environment.recoveryQueue.async { drained.fulfill() }
  await fulfillment(of:[drained],timeout:3)
  XCTAssertNil(environment.recoveryStore.latest(documentID:document.state.documentID))
 }
 @MainActor func testDelayedReloadCannotDiscardNewCheckpointAndDraft() async throws {
  let url = environment.root.appendingPathComponent("external.md")
  try Data("external".utf8).write(to: url)
  let document = try await attachEditor(source: "revision N")
  document.state.saved = Snapshot(source:"baseline",revision:0)
  environment.recoveryQueue.suspend()
  document.reloadExternal(url)
  // This is the actual host's reloadReady acknowledgement, before the delayed
  // preservation callback. Removing host/prepareReload makes this assertion fail.
  try await eventually { document.host?.hasReloadBarrier == true }
  XCTAssertNotNil(document.host?.reloadToken)
  let inert = try await evaluateEditor(document,"return document.querySelector('#workspace').inert")
  XCTAssertEqual(inert as? Bool,true)
  _ = document.accept(Snapshot(source:"revision N+1",revision:1))
  _ = document.acceptRecoveryDraft(RecoveryDraft(baseRevision:1,owner:"prose",format:"text",content:"pending input",recoverySource:nil,reason:"conversion"))
  environment.recoveryQueue.resume()
  try await eventually { document.host?.isReplacing == false }
  XCTAssertEqual(document.state.received.source,"revision N+1")
  XCTAssertEqual(document.state.recoveryDraft?.content,"pending input")
  XCTAssertTrue(document.isDocumentEdited)
  let drained = expectation(description:"recovery drains")
  environment.recoveryQueue.async { drained.fulfill() }
  await fulfillment(of:[drained],timeout:3)
  XCTAssertEqual(environment.recoveryStore.latest(documentID:document.state.documentID)?.recoveryDraft?.content,"pending input")
  environment.close(document)
 }
 @MainActor func testDelayedReloadRejectsEpochOrDraftChangesAtSameRevision() async throws {
  for changeEpoch in [true,false] {
   let url = environment.root.appendingPathComponent("external.md")
   try Data("external".utf8).write(to:url)
   let document = try await attachEditor(source:"local")
   document.state.saved = Snapshot(source:"baseline",revision:0)
   environment.recoveryQueue.suspend()
   document.reloadExternal(url)
   try await eventually { document.host?.hasReloadBarrier == true }
   XCTAssertNotNil(document.host?.reloadToken)
   if changeEpoch { document.rendererWillRestart() }
   else { _ = document.acceptRecoveryDraft(RecoveryDraft(baseRevision:0,owner:"prose",format:"text",content:"pending",recoverySource:nil,reason:"conversion")) }
   environment.recoveryQueue.resume()
   try await eventually { document.host?.isReplacing == false }
   XCTAssertEqual(document.state.received.source,"local")
   if !changeEpoch { XCTAssertEqual(document.state.recoveryDraft?.content,"pending") }
   environment.close(document)
  }
 }
 func testLoadCarriesSavedBaselineAcrossRestartAndRecoveredCopy() async throws {
  try await MainActor.run {
   let document = environment.makeDocument()
   try document.read(from: Data("\u{FEFF}saved\r\n".utf8), ofType: "net.daringfireball.markdown")
   _ = document.accept(Snapshot(source: "edited", revision: 1))
   document.rendererWillRestart()
   XCTAssertEqual(document.loadPayload["savedSource"] as? String, "\u{FEFF}saved\r\n")
   XCTAssertEqual(document.loadPayload["source"] as? String, "edited")
   document.restore(RecoveryRecord(documentID: UUID().uuidString, fileURL: nil, snapshot: Snapshot(source: "recovered", revision: 7), date: Date()))
   XCTAssertEqual(document.loadPayload["savedSource"] as? String, "")
   XCTAssertEqual(document.loadPayload["source"] as? String, "recovered")
   environment.close(document)
  }
 }
}
