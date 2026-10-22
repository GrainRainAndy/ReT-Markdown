import XCTest
import Foundation
import AppKit
@testable import ReTPreview

/// Test-owned storage and work queue. No document fixture uses the application store.
final class DocumentTestEnvironment {
 @MainActor static let controller = PreviewDocumentController()
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
  _ = Self.controller
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
  let productionAssets = RecoveryStore.applicationStore.directory.deletingLastPathComponent().appendingPathComponent("Assets")
  for id in documentIDs {
   XCTAssertFalse(FileManager.default.fileExists(atPath:productionAssets.appendingPathComponent(id + ".json").path),"Test asset journal leaked into production")
   XCTAssertFalse(FileManager.default.fileExists(atPath:productionAssets.appendingPathComponent(id).path),"Test draft assets leaked into production")
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

@MainActor extension RecoveryIsolatedTestCase {
 func attachEditor(source: String = "") async throws -> MarkdownDocument {
  _ = NSApplication.shared
  XCTAssertTrue(FileManager.default.fileExists(atPath: WebKitRenderTests.entry.path), "Build the web assets before native tests: \(WebKitRenderTests.entry.path)")
  let document = environment.makeDocument()
  try document.read(from: Data(source.utf8), ofType: "net.daringfireball.markdown")
  let host = EditorHost(document: document, entryURL: WebKitRenderTests.entry)
  document.host = host
  try await eventually { (try? await self.evaluateEditor(document, "return !!document.querySelector('.ProseMirror')")) as? Bool == true }
  // A native flush proves the ready/load handshake, not only DOM construction.
  _ = try await withCheckedThrowingContinuation { (c: CheckedContinuation<Snapshot, Error>) in host.flush { c.resume(with: $0) } }
  return document
 }
 func evaluateEditor(_ document: MarkdownDocument, _ code: String, arguments: [String:Any] = [:]) async throws -> Any? {
  try await withCheckedThrowingContinuation { c in document.host!.webView.callAsyncJavaScript(code, arguments: arguments, in: nil, in: .page) { c.resume(with: $0) } }
 }
 func eventually(file: StaticString = #filePath, line: UInt = #line, _ condition: () async throws -> Bool) async throws {
  for _ in 0..<250 {
   if try await condition() { return }
   try await Task.sleep(nanoseconds: 20_000_000)
  }
  XCTFail("Condition never became true", file: file, line: line)
  throw CocoaError(.coderValueNotFound)
 }
}
