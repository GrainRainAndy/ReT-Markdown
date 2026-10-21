import XCTest
import Foundation
@testable import ReTPreview

/// Test-owned storage and work queue. No document fixture uses the application store.
final class DocumentTestEnvironment {
 let root: URL
 let recoveryStore: RecoveryStore
 let recoveryQueue: DispatchQueue
 private var documentIDs = Set<String>()
 init() throws {
  root = FileManager.default.temporaryDirectory.appendingPathComponent("ReTNativeTests-" + UUID().uuidString, isDirectory: true)
  recoveryStore = RecoveryStore(directory: root.appendingPathComponent("Recovery", isDirectory: true))
  recoveryQueue = DispatchQueue(label: "test.ret.recovery." + UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
 }
 @MainActor func makeDocument() -> MarkdownDocument {
  let document = MarkdownDocument(recoveryStore: recoveryStore, recoveryQueue: recoveryQueue)
  documentIDs.insert(document.state.documentID)
  return document
 }
 @MainActor func close(_ document: MarkdownDocument) {
  documentIDs.insert(document.state.documentID)
  document.close()
 }
 func remove() throws {
  // Documents close before teardown. Drain their queued writes/removals before deleting
  // the test root, so asynchronous work cannot recreate a removed temporary directory.
  recoveryQueue.sync {}
  // Include recovery-only IDs created when preserving a prior revision.
  let names = (try? FileManager.default.contentsOfDirectory(atPath: recoveryStore.directory.path)) ?? []
  documentIDs.formUnion(names.compactMap { $0.split(separator: ".").first.map(String.init) })
  for id in documentIDs {
   for generation in ["current", "previous"] {
    let path = RecoveryStore.applicationStore.directory.appendingPathComponent("\(id).\(generation).json")
    XCTAssertFalse(FileManager.default.fileExists(atPath: path.path), "Test recovery ID leaked into the production store: \(id)")
   }
  }
  try FileManager.default.removeItem(at: root)
 }
}

class RecoveryIsolatedTestCase: XCTestCase {
 var environment: DocumentTestEnvironment!
 override func setUpWithError() throws {
  try super.setUpWithError()
  environment = try DocumentTestEnvironment()
 }
 override func tearDownWithError() throws {
  defer { environment = nil }
  if let environment { try environment.remove() }
  try super.tearDownWithError()
 }
}
