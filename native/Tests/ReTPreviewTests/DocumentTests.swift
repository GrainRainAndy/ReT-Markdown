import XCTest
import AppKit
@testable import ReTPreview
final class DocumentTests: RecoveryIsolatedTestCase {
 func testSavingFrozenRevisionWhileNewInputArrivesKeepsNewInputDirty() async throws {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".md")
  defer { try? FileManager.default.removeItem(at: url) }
  let document = await MainActor.run {
   let doc = environment.makeDocument()
   _ = doc.accept(Snapshot(source: "revision one", revision: 1))
   doc.prepareAssetsForSave = { _, snapshot, completion in
    XCTAssertEqual(snapshot.source, "revision one")
    _ = doc.accept(Snapshot(source: "revision two", revision: 2))
    completion(.success(()))
   }
   return doc
  }
  let error: Error? = await withCheckedContinuation { continuation in
   Task { @MainActor in
    document.save(to: url, ofType: "net.daringfireball.markdown", for: .autosaveInPlaceOperation) { continuation.resume(returning: $0) }
   }
  }
  XCTAssertNil(error)
  XCTAssertEqual(try Data(contentsOf: url), Data("revision one".utf8))
  await MainActor.run {
   XCTAssertEqual(document.state.received.source, "revision two")
   XCTAssertTrue(document.state.isDirty)
   XCTAssertTrue(document.isDocumentEdited)
   document.prepareAssetsForSave = nil
   environment.close(document)
  }
 }
 func testSharedFidelityFixtureRoundTripsThroughNSDocument() async throws {
  var root = URL(fileURLWithPath: #filePath)
  for _ in 0..<4 { root.deleteLastPathComponent() }
  let data = try Data(contentsOf: root.appendingPathComponent("fixtures/fidelity.md"))
  try await MainActor.run {
   let document = environment.makeDocument()
   try document.read(from: data, ofType: "net.daringfireball.markdown")
   XCTAssertEqual(try document.data(ofType: "net.daringfireball.markdown"), data)
   environment.close(document)
  }
 }

 func testAutosavePersistsExactSourceWithoutEditorAndRejectsExternalChange() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let url = root.appendingPathComponent("document.md")
  let original = Data([0xEF,0xBB,0xBF] + Array("original\r\n".utf8))
  try original.write(to: url)
  let document = try await MainActor.run {
   _ = NSApplication.shared
   let doc = environment.makeDocument()
   try doc.read(from: original, ofType: "net.daringfireball.markdown")
   doc.fileURL = url
   _ = doc.accept(Snapshot(source: "\u{FEFF}edited\r\n", revision: 1))
   return doc
  }
  let error: Error? = await withCheckedContinuation { continuation in
   Task { @MainActor in
    document.save(to: url, ofType: "net.daringfireball.markdown", for: .autosaveInPlaceOperation) { continuation.resume(returning: $0) }
   }
  }
  XCTAssertNil(error)
  XCTAssertEqual(try Data(contentsOf: url), Data([0xEF,0xBB,0xBF] + Array("edited\r\n".utf8)))
  await MainActor.run { XCTAssertFalse(document.state.isDirty) }
  try Data("external".utf8).write(to: url)
  await MainActor.run { _ = document.accept(Snapshot(source: "local", revision: 2)) }
  let conflict: Error? = await withCheckedContinuation { continuation in
   Task { @MainActor in
    document.save(to: url, ofType: "net.daringfireball.markdown", for: .autosaveInPlaceOperation) { continuation.resume(returning: $0) }
   }
  }
  XCTAssertNotNil(conflict)
  XCTAssertEqual(try Data(contentsOf: url), Data("external".utf8))
  await MainActor.run { XCTAssertTrue(document.state.isDirty); environment.close(document) }
 }
 func testManualSaveWithoutFlushCannotWriteOldCheckpoint() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let document = await MainActor.run { environment.makeDocument() }
  let error: Error? = await withCheckedContinuation { continuation in
   Task { @MainActor in
    document.save(to: root, ofType: "net.daringfireball.markdown", for: .saveAsOperation) { continuation.resume(returning: $0) }
   }
  }
  XCTAssertNotNil(error)
  XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
  await MainActor.run { environment.close(document) }
 }
}
