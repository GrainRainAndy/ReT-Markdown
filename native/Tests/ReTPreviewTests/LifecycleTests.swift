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
   document.prepareAssetsForSave = nil
   releaseAssets?(.success(()))
  }
  await fulfillment(of: [firstSave, secondSave], timeout: 3)
  for attempt in 0..<2 {
   let cancelled = expectation(description: "close \(attempt) cancel callback")
   await MainActor.run {
    observer.completed = { cancelled.fulfill() }
    if attempt == 1 { document.canClose(withDelegate: observer, shouldClose: #selector(CloseObserver.document(_:shouldClose:contextInfo:)), contextInfo: nil) }
    let sheet = document.windowControllers.first?.window?.attachedSheet
    XCTAssertNotNil(sheet, "close continuation must run after rejected save")
    if let sheet { document.windowControllers.first?.window?.endSheet(sheet, returnCode: .alertFirstButtonReturn) }
   }
   await fulfillment(of: [cancelled], timeout: 1)
  }
  await MainActor.run { XCTAssertEqual(observer.responses, [false, false]); environment.close(document) }
 }
 func testDelayedReloadCannotDiscardNewCheckpointAndDraft() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let url = root.appendingPathComponent("external.md")
  try Data("external".utf8).write(to: url)
  let queue = environment.recoveryQueue
  queue.suspend()
  let document = await MainActor.run { () -> MarkdownDocument in
   let document = environment.makeDocument()
   _ = document.accept(Snapshot(source: "revision N", revision: 1))
   document.reloadExternal(url)
   _ = document.accept(Snapshot(source: "revision N+1", revision: 2))
   _ = document.acceptRecoveryDraft(RecoveryDraft(baseRevision: 2, owner: "prose", format: "text", content: "pending input", recoverySource: nil, reason: "conversion"))
   return document
  }
  let drained = expectation(description: "recovery queue finishes")
  queue.async { DispatchQueue.main.async { drained.fulfill() } }
  queue.resume()
  await fulfillment(of: [drained], timeout: 3)
  await MainActor.run {
   XCTAssertEqual(document.state.received.source, "revision N+1")
   XCTAssertEqual(document.state.recoveryDraft?.content, "pending input")
   XCTAssertTrue(document.isDocumentEdited)
   let durable = environment.recoveryStore.latest(documentID: document.state.documentID)
   XCTAssertEqual(durable?.snapshot.source, "revision N+1")
   XCTAssertEqual(durable?.recoveryDraft?.content, "pending input")
   environment.close(document)
  }
 }
 func testDelayedReloadRejectsEpochOrDraftChangesAtSameRevision() async throws {
  for changeEpoch in [true, false] {
   let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
   try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
   defer { try? FileManager.default.removeItem(at: root) }
   let url = root.appendingPathComponent("external.md")
   try Data("external".utf8).write(to: url)
   let queue = environment.recoveryQueue
   queue.suspend()
   let document = await MainActor.run { () -> MarkdownDocument in
    let document = environment.makeDocument()
    _ = document.accept(Snapshot(source: "local", revision: 1))
    document.reloadExternal(url)
    if changeEpoch { document.rendererWillRestart() }
    else { _ = document.acceptRecoveryDraft(RecoveryDraft(baseRevision: 1, owner: "prose", format: "text", content: "pending", recoverySource: nil, reason: "conversion")) }
    return document
   }
   let drained = expectation(description: "delayed reload finished")
   queue.async { DispatchQueue.main.async { drained.fulfill() } }
   queue.resume()
   await fulfillment(of: [drained], timeout: 3)
   await MainActor.run {
    XCTAssertEqual(document.state.received.source, "local")
    if !changeEpoch { XCTAssertEqual(document.state.recoveryDraft?.content, "pending") }
    environment.close(document)
   }
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
