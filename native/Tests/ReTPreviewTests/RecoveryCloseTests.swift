import XCTest
import AppKit
import Darwin
@testable import ReTPreview

final class RecoveryCloseTests: RecoveryIsolatedTestCase {
 @MainActor func testChildExitAndReopen() async throws {
  let env = ProcessInfo.processInfo.environment
  if let root = env["RET_LIFECYCLE_CHILD_ROOT"], let phase = env["RET_LIFECYCLE_CHILD_PHASE"] {
   let root = URL(fileURLWithPath:root)
   let store = RecoveryStore(directory:root.appendingPathComponent("Recovery"))
   if phase == "reopen" {
    let records = store.records()
    try Data("reopened records=\(records.count)".utf8).write(to:root.appendingPathComponent("reopen.txt"))
    try environment.remove(); environment = nil
    Darwin._exit(records.isEmpty ? 0 : 2)
   }
   let queue = DispatchQueue(label:"child.isolated.recovery")
   let controller = DocumentTestEnvironment.controller
   let document = MarkdownDocument(recoveryStore:store,recoveryQueue:queue)
   controller.addDocument(document)
   let id = document.state.documentID
   try store.write(RecoveryRecord(documentID:id,fileURL:nil,snapshot:Snapshot(source:"old generation",revision:0),date:Date()))
   queue.suspend()
   _ = document.accept(Snapshot(source:"queued discard",revision:1))
   document.closeDurably { success in
    let clean = store.latest(documentID:id) == nil && !controller.documents.contains(document)
    try? Data("cleanup=\(success) records=\(store.records().count) controllerRemoved=\(!controller.documents.contains(document))".utf8).write(to:root.appendingPathComponent("exit.txt"))
    try? self.environment.remove(); self.environment = nil
    // Exit directly at the production close completion boundary. No run-loop
    // draining or orderly XCTest teardown can hide a queued late deletion.
    Darwin._exit(success && clean ? 0 : 3)
   }
   XCTAssertTrue(controller.documents.contains(document))
   queue.resume()
   try await Task.sleep(nanoseconds:15_000_000_000)
   Darwin._exit(4)
  }
  let root = environment.root.appendingPathComponent("exit-reopen")
  try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
  for phase in ["exit","reopen"] {
   let process = Process()
   process.executableURL = URL(fileURLWithPath:CommandLine.arguments[0])
   process.arguments = ["-XCTest","ReTPreviewTests.RecoveryCloseTests/testChildExitAndReopen",Bundle(for:Self.self).bundleURL.path]
   var childEnvironment = env
   childEnvironment["RET_LIFECYCLE_CHILD_ROOT"] = root.path
   childEnvironment["RET_LIFECYCLE_CHILD_PHASE"] = phase
   process.environment = childEnvironment
   let output = root.appendingPathComponent(phase + ".log")
   FileManager.default.createFile(atPath:output.path,contents:nil)
   let handle = try FileHandle(forWritingTo:output)
   process.standardOutput = handle; process.standardError = handle
   try process.run()
   try await eventually { !process.isRunning }
   try handle.close()
   let log = try String(contentsOf:output,encoding:.utf8)
   XCTAssertEqual(process.terminationStatus,0,log)
  }
  XCTAssertEqual(try String(contentsOf:root.appendingPathComponent("exit.txt"),encoding:.utf8),"cleanup=true records=0 controllerRemoved=true")
  XCTAssertEqual(try String(contentsOf:root.appendingPathComponent("reopen.txt"),encoding:.utf8),"reopened records=0")
  if let evidence = env["RET_LIFECYCLE_EVIDENCE"] {
   let target = URL(fileURLWithPath:evidence).appendingPathComponent("child-exit-reopen-" + UUID().uuidString)
   try FileManager.default.copyItem(at:root,to:target)
   print("Child-process evidence: \(target.path)")
  }
 }
 @MainActor func testCloseWaitsForQueuedRecoveryBeforeRemovingDocument() async throws {
  let controller = DocumentTestEnvironment.controller
  let document = environment.makeDocument()
  controller.addDocument(document)
  environment.recoveryQueue.suspend()
  _ = document.accept(Snapshot(source:"discard",revision:1))
  document.close()
  XCTAssertTrue(controller.documents.contains(document), "normal termination must still see the document until cleanup completes")
  XCTAssertFalse(document.accept(Snapshot(source:"late",revision:2)))
  environment.recoveryQueue.resume()
  try await eventually { !controller.documents.contains(document) }
  XCTAssertNil(environment.recoveryStore.latest(documentID:document.state.documentID))
 }
 @MainActor func testInaccessibleRecoveryDirectoryCancelsClose() async throws {
  let controller = DocumentTestEnvironment.controller
  let document = environment.makeDocument()
  controller.addDocument(document)
  try environment.recoveryStore.write(RecoveryRecord(documentID:document.state.documentID,fileURL:nil,snapshot:Snapshot(source:"keep recovery",revision:1),date:Date()))
  let root = environment.root.path
  XCTAssertEqual(chmod(root,0),0)
  defer { _ = chmod(root,0o700); environment.close(document); controller.removeDocument(document) }
  document.close()
  try await Task.sleep(nanoseconds:100_000_000)
  XCTAssertTrue(controller.documents.contains(document))
  XCTAssertFalse(document.closed,"inaccessible storage must not be treated as absent storage")
  XCTAssertEqual(chmod(root,0o700),0)
  XCTAssertNotNil(environment.recoveryStore.latest(documentID:document.state.documentID))
 }
 @MainActor func testCleanupFailureRetainsDocumentAndAllowsEditing() async throws {
  let controller = DocumentTestEnvironment.controller
  let document = environment.makeDocument()
  controller.addDocument(document)
  try Data("not a directory".utf8).write(to:environment.recoveryStore.directory)
  document.close()
  try await Task.sleep(nanoseconds:100_000_000)
  XCTAssertTrue(controller.documents.contains(document))
  XCTAssertFalse(document.closed)
  XCTAssertTrue(document.accept(Snapshot(source:"can edit",revision:1)))
  try FileManager.default.removeItem(at:environment.recoveryStore.directory)
  document.close()
  try await eventually { !controller.documents.contains(document) }
 }
}
