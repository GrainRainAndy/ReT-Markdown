import XCTest
import AppKit
@testable import ReTPreview

final class AssetsTests: RecoveryIsolatedTestCase {
 let svg = Data("<svg xmlns='http://www.w3.org/2000/svg' width='80' height='40'><rect width='80' height='40' fill='red'/></svg>".utf8)
 func store(_ id: String = "doc") throws -> AssetStore { try AssetStore(directory: environment.root.appendingPathComponent("Assets"), documentID: id) }
 func testImportUniqueIdempotentEscapedAndNoSourceOverwrite() throws {
  let assets = try store()
  let a = try assets.importImage(svg, fileName: "图 像 (1) #%.svg", operationID: "one", documentURL: nil)
  let b = try assets.importImage(svg, fileName: "图 像 (1) #%.svg", operationID: "two", documentURL: nil)
  XCTAssertNotEqual(a, b)
  XCTAssertEqual(try assets.importImage(svg, fileName: "ignored.svg", operationID: "one", documentURL: nil), a)
  XCTAssertThrowsError(try assets.importImage(Data("other".utf8), fileName: "bad.png", operationID: "one", documentURL: nil))
  XCTAssertEqual(try assets.resolve(path: a, documentURL: nil).data, svg)
  let resumed = try store()
  XCTAssertEqual(try resumed.importImage(svg, fileName: "ignored.svg", operationID: "one", documentURL: nil), a)
 }
 func testPrepareAndCommitKeepNPlusOneRecoverableWithoutMixingItIntoN() throws {
  let assets = try store()
  let a = try assets.importImage(svg, fileName: "a.svg", operationID: "one", documentURL: nil)
  let target = environment.root.appendingPathComponent("first/doc.md")
  try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
  let transaction = try assets.prepareSave(to: target, snapshot: Snapshot(source: "![a](\(a))", revision: 1), references: [a], documentURL: nil)
  let b = try assets.importImage(svg, fileName: "b.svg", operationID: "two", documentURL: nil)
  XCTAssertTrue(FileManager.default.fileExists(atPath: target.deletingLastPathComponent().appendingPathComponent(a).path))
  XCTAssertFalse(FileManager.default.fileExists(atPath: target.deletingLastPathComponent().appendingPathComponent(b).path))
  try assets.commit(transaction)
  XCTAssertEqual(try assets.resolve(path: b, documentURL: target).data, svg)
  let recovered = try store("recovered")
  try recovered.recover(from: "doc", originalURL: target)
  XCTAssertEqual(try recovered.resolve(path: a, documentURL: nil).data, svg)
  XCTAssertEqual(try recovered.resolve(path: b, documentURL: nil).data, svg)
  let second = environment.root.appendingPathComponent("second/new.md")
  try FileManager.default.createDirectory(at: second.deletingLastPathComponent(), withIntermediateDirectories: true)
  let retry = try recovered.prepareSave(to: second, snapshot: Snapshot(source: "N+1", revision: 2), references: [a,b], documentURL: nil)
  try recovered.commit(retry)
  XCTAssertEqual(try Data(contentsOf: second.deletingLastPathComponent().appendingPathComponent(b)), svg)
 }
 func testSaveCollisionAndUnsafePathsPreserveExistingBytesAndJournalForRetry() throws {
  let assets = try store()
  let a = try assets.importImage(svg, fileName: "a.svg", operationID: "one", documentURL: nil)
  let target = environment.root.appendingPathComponent("next/doc.md")
  let collision = target.deletingLastPathComponent().appendingPathComponent(a)
  try FileManager.default.createDirectory(at: collision.deletingLastPathComponent(), withIntermediateDirectories: true)
  try Data("old".utf8).write(to: collision)
  XCTAssertThrowsError(try assets.prepareSave(to: target, snapshot: Snapshot(source: "N", revision: 1), references: [a], documentURL: nil))
  XCTAssertEqual(try Data(contentsOf: collision), Data("old".utf8))
  XCTAssertEqual(try assets.resolve(path: a, documentURL: nil).data, svg)
  for path in ["../secret.svg", "%2e%2e/secret.svg", "/secret.svg", "x/../../secret.svg", "x\\secret.svg"] {
   XCTAssertThrowsError(try assets.resolve(path: path, documentURL: target))
  }
  let symlink = target.deletingLastPathComponent().appendingPathComponent("link")
  try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: environment.root)
  XCTAssertThrowsError(try assets.resolve(path: "link/next/" + a, documentURL: target))
 }
 func testUnmanagedSaveAsRequiresExplicitAcceptanceAndDoesNotCopy() throws {
  let assets = try store()
  let original = environment.root.appendingPathComponent("old/doc.md")
  try FileManager.default.createDirectory(at: original.deletingLastPathComponent(), withIntermediateDirectories: true)
  try svg.write(to: original.deletingLastPathComponent().appendingPathComponent("ordinary.svg"))
  let target = environment.root.appendingPathComponent("new/doc.md")
  try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
  XCTAssertThrowsError(try assets.prepareSave(to: target, snapshot: Snapshot(source:"N",revision:1), references:["ordinary.svg"], documentURL: original))
  _ = try assets.prepareSave(to: target, snapshot: Snapshot(source:"N",revision:1), references:["ordinary.svg"], documentURL: original, acceptUnmanaged: true)
  XCTAssertFalse(FileManager.default.fileExists(atPath: target.deletingLastPathComponent().appendingPathComponent("ordinary.svg").path))
 }
 func testClipboardPrefersImageWithMixedTextAndRejectsUnsafeSVG() throws {
  let clipboard = NSPasteboard.withUniqueName()
  defer { clipboard.releaseGlobally() }
  clipboard.setString("mixed text", forType: .string)
  clipboard.setData(svg, forType: NSPasteboard.PasteboardType("public.svg-image"))
  let image = try ImageValidation.clipboard(clipboard)
  XCTAssertEqual(image.data, svg)
  for xml in ["<svg><script>alert(1)</script></svg>", "<svg onload='x()'/>", "<svg><image href='https://evil'/></svg>", "<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><svg>&x;</svg>", "<svg><rect fill='url(https://evil)'/></svg>"] {
   XCTAssertThrowsError(try ImageValidation.validate(Data(xml.utf8)))
  }
 }
 func testReopeningSavedDocumentRetainsManagedOwnershipAcrossNewDocumentID() throws {
  let old = try store("old-open")
  let path = try old.importImage(svg,fileName:"draft.svg",operationID:"op",documentURL:nil)
  let first = environment.root.appendingPathComponent("one/saved.md")
  try FileManager.default.createDirectory(at:first.deletingLastPathComponent(),withIntermediateDirectories:true)
  try old.commit(old.prepareSave(to:first,snapshot:Snapshot(source:"N",revision:1),references:[path],documentURL:nil))
  let reopened = try store("new-open")
  try reopened.adopt(documentURL:first)
  let target = environment.root.appendingPathComponent("two/copy.md")
  try FileManager.default.createDirectory(at:target.deletingLastPathComponent(),withIntermediateDirectories:true)
  _ = try reopened.prepareSave(to:target,snapshot:Snapshot(source:"N",revision:0),references:[path],documentURL:first)
  XCTAssertEqual(try Data(contentsOf:target.deletingLastPathComponent().appendingPathComponent(path)),svg)
 }
 func testPreparedPartialJournalRestartsAndRetriesWithoutDuplicates() throws {
  let assets = try store()
  let a = try assets.importImage(svg,fileName:"a.svg",operationID:"a",documentURL:nil)
  let b = try assets.importImage(svg,fileName:"b.svg",operationID:"b",documentURL:nil)
  let target = environment.root.appendingPathComponent("target/doc.md")
  let collision = target.deletingLastPathComponent().appendingPathComponent(b)
  try FileManager.default.createDirectory(at:collision.deletingLastPathComponent(),withIntermediateDirectories:true)
  try Data("old asset".utf8).write(to:collision)
  try Data("old document".utf8).write(to:target)
  let snapshot = Snapshot(source:"![a](\(a))\n![b](\(b))",revision:4)
  XCTAssertThrowsError(try assets.prepareSave(to:target,snapshot:snapshot,references:[a,b],documentURL:nil))
  XCTAssertTrue(FileManager.default.fileExists(atPath:target.deletingLastPathComponent().appendingPathComponent(a).path))
  XCTAssertEqual(try Data(contentsOf:target),Data("old document".utf8))
  let restarted = try store()
  try FileManager.default.removeItem(at:collision)
  let retry = try restarted.prepareSave(to:target,snapshot:snapshot,references:[a,b],documentURL:nil)
  let again = try restarted.prepareSave(to:target,snapshot:snapshot,references:[a,b],documentURL:nil)
  XCTAssertEqual(retry.id,again.id)
  XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath:collision.deletingLastPathComponent().path).count,2)
  XCTAssertEqual(try restarted.resolve(path:b,documentURL:nil).data,svg)
 }
 func testClosedFileRenameRetainsManagedAssetDirectoryAndOwnership() throws {
  let assets = try store()
  let path = try assets.importImage(svg,fileName:"a.svg",operationID:"a",documentURL:nil)
  let old = environment.root.appendingPathComponent("old.md")
  try assets.commit(assets.prepareSave(to:old,snapshot:Snapshot(source:"N",revision:0),references:[path],documentURL:nil))
  let renamed = environment.root.appendingPathComponent("renamed.md")
  let reopened = try store("renamed")
  try reopened.adopt(documentURL:renamed)
  let target = environment.root.appendingPathComponent("another/new.md")
  try FileManager.default.createDirectory(at:target.deletingLastPathComponent(),withIntermediateDirectories:true)
  _ = try reopened.prepareSave(to:target,snapshot:Snapshot(source:"N",revision:0),references:[path],documentURL:renamed)
  XCTAssertTrue(path.hasPrefix("doc.assets/"))
  XCTAssertEqual(try Data(contentsOf:target.deletingLastPathComponent().appendingPathComponent(path)),svg)
 }
 func testRasterTypesAndTIFFClipboardNormalizeToSupportedImage() throws {
  let bitmap = try XCTUnwrap(NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:2,pixelsHigh:2,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0))
  for type in [NSBitmapImageRep.FileType.png,.jpeg,.gif] {
   let data = try XCTUnwrap(bitmap.representation(using:type,properties:[:]))
   XCTAssertNoThrow(try ImageValidation.validate(data))
  }
  let board = NSPasteboard.withUniqueName(); defer {board.releaseGlobally()}
  board.setData(bitmap.tiffRepresentation,forType:.tiff)
  let extracted = try ImageValidation.clipboard(board)
  XCTAssertEqual(try ImageValidation.validate(extracted.data).mime,"image/png")
 }
 func testOnlyCurrentNativeCapabilityResolvesEncodedSpecialPath() throws {
  let assets = try store()
  let path = try assets.importImage(svg,fileName:"图 #%.svg",operationID:"special",documentURL:nil)
  let safe = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn:"%#?"))
  let encoded = try XCTUnwrap(path.addingPercentEncoding(withAllowedCharacters:safe))
  let url = try XCTUnwrap(URL(string:"ret-asset://" + assets.token + "/" + encoded))
  XCTAssertEqual(try assets.resolve(url:url,documentURL:nil).data,svg)
  XCTAssertThrowsError(try assets.resolve(url:URL(string:"ret-asset://document/" + encoded)!,documentURL:nil))
  XCTAssertThrowsError(try assets.resolve(url:URL(string:"ret-asset://" + assets.token + "/" + encoded + "?root=/etc")!,documentURL:nil))
 }
 func testPercentLookingImportedNamesDecodeOnlyAtReferenceBoundary() throws {
  for name in ["literal%20.svg","literal%2F.svg","literal%2e%2e.svg"] {
   let directory = environment.root.appendingPathComponent(UUID().uuidString)
   let assets = try AssetStore(directory:directory,documentID:"percent")
   let raw = try assets.importImage(svg,fileName:name,operationID:name,documentURL:nil)
   let safe = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn:"%#?"))
   let reference = try XCTUnwrap(raw.addingPercentEncoding(withAllowedCharacters:safe))
   let live = try XCTUnwrap(URL(string:"ret-asset://" + assets.token + "/" + reference))
   XCTAssertEqual(try assets.resolve(url:live,documentURL:nil).data,svg)
   XCTAssertEqual(try assets.freeze(references:[reference],documentURL:nil)[raw]?.data,svg,"frozen lookup changed literal percent bytes")
   let first = directory.appendingPathComponent("first/doc.md")
   try FileManager.default.createDirectory(at:first.deletingLastPathComponent(),withIntermediateDirectories:true)
   let snapshot = Snapshot(source:"![image](\(reference))",revision:1)
   let prepared = try assets.prepareSave(to:first,snapshot:snapshot,references:[reference],documentURL:nil)
   try assets.commit(prepared)
   XCTAssertEqual(try Data(contentsOf:first.deletingLastPathComponent().appendingPathComponent(raw)),svg)
   if name == "literal%20.svg" {
    let impostor = raw.replacingOccurrences(of:"%20",with:" ")
    let other = Data("<svg xmlns='http://www.w3.org/2000/svg'><circle r='9' fill='blue'/></svg>".utf8)
    try other.write(to:first.deletingLastPathComponent().appendingPathComponent(impostor))
    XCTAssertEqual(try assets.freeze(references:[reference],documentURL:first)[raw]?.data,svg,"literal percent selected similarly named space file")
   }
   let second = directory.appendingPathComponent("second/copy.md")
   try FileManager.default.createDirectory(at:second.deletingLastPathComponent(),withIntermediateDirectories:true)
   let migrated = try assets.prepareSave(to:second,snapshot:snapshot,references:[reference],documentURL:first)
   try assets.commit(migrated)
   XCTAssertEqual(try Data(contentsOf:second.deletingLastPathComponent().appendingPathComponent(raw)),svg)
   XCTAssertEqual(try assets.resolve(url:live,documentURL:second).data,svg)
  }
 }
 func testFrozenImageBytesSurviveExternalChange() throws {
  let assets = try store()
  let doc = environment.root.appendingPathComponent("doc.md")
  let url = environment.root.appendingPathComponent("local.svg")
  try svg.write(to: url)
  let frozen = try assets.freeze(references: ["local.svg","missing.svg","https://remote/image.png"], documentURL: doc)
  try Data("changed".utf8).write(to: url)
  XCTAssertEqual(frozen["local.svg"]?.data, svg)
  XCTAssertNil(frozen["missing.svg"])
  XCTAssertNil(frozen["https://remote/image.png"])
 }
}
