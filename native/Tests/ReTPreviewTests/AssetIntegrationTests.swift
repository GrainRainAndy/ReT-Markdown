import XCTest
import AppKit
import WebKit
import PDFKit
@testable import ReTPreview

@MainActor private final class LaterAssetPath { var value = "" }

final class AssetIntegrationTests: RecoveryIsolatedTestCase {
 private func attach(_ source: String, url: URL? = nil) async throws -> MarkdownDocument {
  let document = try await MainActor.run { () throws -> MarkdownDocument in
   _ = NSApplication.shared
   let document = environment.makeDocument()
   try document.read(from:Data(source.utf8),ofType:"net.daringfireball.markdown")
   document.fileURL = url
   let host = EditorHost(document:document,entryURL:WebKitRenderTests.entry)
   document.host = host; document.installAssetServices(host)
   return document
  }
  try await Task.sleep(nanoseconds:1_000_000_000)
  return document
 }
 func testNativeImageImportInsertsAfterCopyAndSavesReferencedAsset() async throws {
  let document = try await attach("start\n")
  let imported = expectation(description:"image insert flush")
  let svg = Data("<svg xmlns='http://www.w3.org/2000/svg' width='80' height='40'><rect width='80' height='40' fill='red'/></svg>".utf8)
  await MainActor.run {
   document.host!.webView.callAsyncJavaScript("const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'图 #%.svg',{type:'image/svg+xml'}));document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));",arguments:["data":svg.base64EncodedString()],in:nil,in:.page) { result in if case .failure(let error)=result { XCTFail("\(error)") } }
  }
  try await Task.sleep(nanoseconds:300_000_000)
  await MainActor.run {
   document.host!.flush { result in
    do {
     let snapshot = try result.get(); XCTAssertTrue(snapshot.source.contains("![图片]("))
     XCTAssertTrue(snapshot.source.contains("%23%25")); XCTAssertTrue(document.state.isDirty)
    } catch { XCTFail("\(error)") }
    imported.fulfill()
   }
  }
  await fulfillment(of:[imported],timeout:5)
  let target = environment.root.appendingPathComponent("new.md")
  let saved = expectation(description:"resource first native save")
  await MainActor.run {
   document.save(to:target,ofType:"net.daringfireball.markdown",for:.saveAsOperation) { error in XCTAssertNil(error); saved.fulfill() }
  }
  await fulfillment(of:[saved],timeout:5)
  let bytes = try String(contentsOf:target,encoding:.utf8)
  XCTAssertTrue(bytes.contains("![图片]("))
  await MainActor.run { XCTAssertFalse(document.state.isDirty); XCTAssertEqual(document.fileURL,target); environment.close(document) }
 }
 @MainActor private func flush(_ document: MarkdownDocument) async throws -> Snapshot {
  try await withCheckedThrowingContinuation { continuation in document.host!.flush { continuation.resume(with:$0) } }
 }
 @MainActor private func manifest(_ document: MarkdownDocument, snapshot: Snapshot) async throws -> [String] {
  try await withCheckedThrowingContinuation { continuation in document.host!.collectAssets(for:snapshot) { continuation.resume(with:$0) } }
 }
 @MainActor private func evaluate(_ document: MarkdownDocument, _ code: String, arguments: [String:Any] = [:]) async throws -> Any? {
  try await withCheckedThrowingContinuation { continuation in document.host!.webView.callAsyncJavaScript(code,arguments:arguments,in:nil,in:.page) { continuation.resume(with:$0) } }
 }
 @MainActor private func save(_ document: MarkdownDocument, to target: URL) async throws {
  try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void,Error>) in
   document.save(to:target,ofType:"net.daringfireball.markdown",for:.saveAsOperation) { error in
    if let error { continuation.resume(throwing:error) } else { continuation.resume() }
   }
  }
 }
 func testImportedLiteralPercentNameSurvivesLiveFreezeFirstSaveAndSaveAs() async throws {
  let document = try await attach("start\n")
  do {
   let svg = Data("<svg xmlns='http://www.w3.org/2000/svg' width='80' height='40'><rect width='80' height='40' fill='red'/></svg>".utf8)
   _ = try await evaluate(document,"const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'literal%20.svg',{type:'image/svg+xml'}));document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));",arguments:["data":svg.base64EncodedString()])
   try await Task.sleep(nanoseconds:300_000_000)
   let snapshot = try await flush(document)
   XCTAssertTrue(snapshot.source.contains("literal%2520-"))
   let paths = try await manifest(document,snapshot:snapshot)
   XCTAssertEqual(paths.count,1)
   let reference = try XCTUnwrap(paths.first)
   let raw = try AssetStore.relative(reference)
   let width = try await evaluate(document,"return document.querySelector('.image-object img')?.naturalWidth ?? 0") as? Int
   XCTAssertEqual(width,80,"actual live capability image failed to load")
   try await MainActor.run {
    XCTAssertEqual(try document.assets().freeze(references:paths,documentURL:nil)[raw]?.data,svg)
   }
   let first = environment.root.appendingPathComponent("first/doc.md")
   try FileManager.default.createDirectory(at:first.deletingLastPathComponent(),withIntermediateDirectories:true)
   try await save(document,to:first)
   XCTAssertEqual(try String(contentsOf:first,encoding:.utf8),snapshot.source)
   XCTAssertEqual(try Data(contentsOf:first.deletingLastPathComponent().appendingPathComponent(raw)),svg)
   let spacePath = first.deletingLastPathComponent().appendingPathComponent(raw.replacingOccurrences(of:"%20",with:" "))
   try Data("<svg xmlns='http://www.w3.org/2000/svg'><circle r='9' fill='blue'/></svg>".utf8).write(to:spacePath)
   try await MainActor.run { XCTAssertEqual(try document.assets().freeze(references:paths,documentURL:first)[raw]?.data,svg) }
   let second = environment.root.appendingPathComponent("second/copy.md")
   try FileManager.default.createDirectory(at:second.deletingLastPathComponent(),withIntermediateDirectories:true)
   try await save(document,to:second)
   XCTAssertEqual(try String(contentsOf:second,encoding:.utf8),snapshot.source)
   XCTAssertEqual(try Data(contentsOf:second.deletingLastPathComponent().appendingPathComponent(raw)),svg)
   try await MainActor.run {
    XCTAssertEqual(document.fileURL,second); XCTAssertFalse(document.state.isDirty)
    XCTAssertEqual(try document.assets().freeze(references:paths,documentURL:second)[raw]?.data,svg)
   }
  } catch { await MainActor.run { environment.close(document) }; throw error }
  await MainActor.run { environment.close(document) }
 }
 func testSaveAsNThenNPlusOnePreservesDirtyAndInstallsLaterAssetOnNextSave() async throws {
  let document = try await MainActor.run { () throws -> MarkdownDocument in
   let document = environment.makeDocument()
   let image = Data("<svg xmlns='http://www.w3.org/2000/svg'><circle r='2'/></svg>".utf8)
   let path = try document.assets().importImage(image,fileName:"a.svg",operationID:"a",documentURL:nil)
   try document.read(from:Data("![a](\(path))".utf8),ofType:"net.daringfireball.markdown")
   let host = EditorHost(document:document,entryURL:WebKitRenderTests.entry)
   document.host = host; document.installAssetServices(host)
   return document
  }
  try await Task.sleep(nanoseconds:1_000_000_000)
  let savedN = expectation(description:"frozen N saved")
  let target = environment.root.appendingPathComponent("one.md")
  let later = await MainActor.run { LaterAssetPath() }
  await MainActor.run {
   let prepare = document.prepareAssetsForSave!
   document.prepareAssetsForSave = { url,snapshot,complete in
    prepare(url,snapshot) { result in
     do {
      let path = try document.assets().importImage(Data("<svg xmlns='http://www.w3.org/2000/svg'><circle r='4'/></svg>".utf8),fileName:"b.svg",operationID:"b",documentURL:nil)
      later.value = path
      _ = document.accept(Snapshot(source:snapshot.source + "\n![b](\(path))",revision:snapshot.revision+1))
     } catch { XCTFail("\(error)") }
     complete(result)
    }
   }
   document.save(to:target,ofType:"net.daringfireball.markdown",for:.saveAsOperation) { error in XCTAssertNil(error); savedN.fulfill() }
  }
  await fulfillment(of:[savedN],timeout:5)
  let laterPath = await MainActor.run { later.value }
  XCTAssertFalse(try String(contentsOf:target,encoding:.utf8).contains("![b]"))
  XCTAssertFalse(FileManager.default.fileExists(atPath:environment.root.appendingPathComponent(laterPath).path))
  let savedNext = expectation(description:"N+1 assets prepared before save")
  await MainActor.run {
   XCTAssertTrue(document.state.isDirty); XCTAssertEqual(document.state.received.revision,1)
   document.installAssetServices(document.host!)
   document.save(to:target,ofType:"net.daringfireball.markdown",for:.autosaveInPlaceOperation) { error in XCTAssertNil(error); savedNext.fulfill() }
  }
  await fulfillment(of:[savedNext],timeout:5)
  XCTAssertTrue(try String(contentsOf:target,encoding:.utf8).contains("![b]"))
  XCTAssertTrue(FileManager.default.fileExists(atPath:environment.root.appendingPathComponent(laterPath).path))
  await MainActor.run { XCTAssertFalse(document.state.isDirty); environment.close(document) }
 }
 func testProtectedReloadRecoveryPreservesNPlusOneStagingAndReferenceMigration() async throws {
  let document = try await attach("N")
  let target = environment.root.appendingPathComponent("original.md")
  let svg = Data("<svg xmlns='http://www.w3.org/2000/svg' width='80' height='40'><circle r='4'/></svg>".utf8)
  let later = await MainActor.run { LaterAssetPath() }
  let saved = expectation(description:"N saves while N+1 image is staged")
  await MainActor.run {
   let prepare = document.prepareAssetsForSave!
   document.prepareAssetsForSave = { url,snapshot,complete in
    prepare(url,snapshot) { result in
     do {
      later.value = try document.assets().importImage(svg,fileName:"later.svg",operationID:"later",documentURL:nil)
      let source = "N+1\n\n![logo][Asset]\n\n> [ASSET]: \(later.value)\n\n[asset]: missing.svg"
      document.host!.webView.callAsyncJavaScript("const el=document.querySelector('.ProseMirror');const d=new DataTransfer();d.setData('text/markdown',source);el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));",arguments:["source":source],in:nil,in:.page) { _ in
       document.host!.flush { response in
        if case .failure(let error) = response { XCTFail("\(error)") }
        complete(result)
       }
      }
     } catch { XCTFail("\(error)"); complete(.failure(error)) }
    }
   }
   document.save(to:target,ofType:"net.daringfireball.markdown",for:.saveAsOperation) { error in XCTAssertNil(error); saved.fulfill() }
  }
  await fulfillment(of:[saved],timeout:8)
  let snapshot = try await flush(document)
  let references = try await manifest(document,snapshot:snapshot)
  let path = await MainActor.run { later.value }
  XCTAssertEqual(references,[path]); XCTAssertEqual(try String(contentsOf:target,encoding:.utf8),"N")
  XCTAssertFalse(FileManager.default.fileExists(atPath:target.deletingLastPathComponent().appendingPathComponent(path).path))
  let oldID = await MainActor.run { document.state.documentID }
  await MainActor.run { document.reloadExternal(target) }
  try await Task.sleep(nanoseconds:500_000_000)
  let reloadedN = try await flush(document); XCTAssertEqual(reloadedN.source,"N")
  let records = try FileManager.default.contentsOfDirectory(at:environment.recoveryStore.directory,includingPropertiesForKeys:nil).filter { $0.lastPathComponent.hasSuffix(".current.json") }.compactMap { url -> RecoveryRecord? in
   let id = url.lastPathComponent.replacingOccurrences(of:".current.json",with:"")
   return id == oldID ? nil : environment.recoveryStore.latest(documentID:id)
  }
  let record = try XCTUnwrap(records.first(where: { $0.snapshot.source == snapshot.source }))
  let restored = await MainActor.run { () -> MarkdownDocument in
   let copy = environment.makeDocument(); copy.restore(record)
   let host = EditorHost(document:copy,entryURL:WebKitRenderTests.entry); copy.host = host; copy.installAssetServices(host)
   return copy
  }
  try await Task.sleep(nanoseconds:1_000_000_000)
  try await MainActor.run { XCTAssertEqual(try restored.assets().resolve(path:path,documentURL:nil).data,svg) }
  let destination = environment.root.appendingPathComponent("restored.md")
  try await save(restored,to:destination)
  XCTAssertEqual(try String(contentsOf:destination,encoding:.utf8),snapshot.source)
  XCTAssertEqual(try Data(contentsOf:destination.deletingLastPathComponent().appendingPathComponent(path)),svg)
  await MainActor.run { environment.close(document); environment.close(restored) }
 }
 func testReloadBarrierHoldsBothIdentitiesThroughDelayedRecoveryAndCancellation() async throws {
  let document = try await attach("old")
  _ = try await evaluate(document,"const d=new DataTransfer();d.setData('text/markdown','dirty');document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));")
  let old = try await flush(document)
  let oldEpoch = await MainActor.run { document.state.epoch }
  let target = environment.root.appendingPathComponent("external.md"); try Data("external".utf8).write(to:target)
  let queue = environment.recoveryQueue
  queue.suspend()
  await MainActor.run { document.reloadExternal(target) }
  try await Task.sleep(nanoseconds:200_000_000)
  let locked = try await evaluate(document,"return document.querySelector('#workspace').inert") as? Bool
  XCTAssertEqual(locked,true)
  _ = try await evaluate(document,"document.querySelector('.ProseMirror').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'中'}));")
  await MainActor.run { XCTAssertEqual(document.state.epoch,oldEpoch); document.host!.cancelReload() }
  queue.resume()
  try await Task.sleep(nanoseconds:200_000_000)
  let cancelled = try await flush(document); XCTAssertEqual(cancelled,old)
  await MainActor.run { XCTAssertEqual(document.state.epoch,oldEpoch); document.reloadExternal(target) }
  try await Task.sleep(nanoseconds:400_000_000)
  let reloaded = try await flush(document); XCTAssertEqual(reloaded.source,"external")
  await MainActor.run { XCTAssertNotEqual(document.state.epoch,oldEpoch) }
  _ = try await evaluate(document,"const d=new DataTransfer();d.setData('text/markdown','after');document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));")
  let edited = try await flush(document)
  XCTAssertTrue(edited.source.contains("after"))
  try await save(document,to:environment.root.appendingPathComponent("saved.md"))
  XCTAssertEqual(try String(contentsOf:environment.root.appendingPathComponent("saved.md"),encoding:.utf8),edited.source)
  await MainActor.run { environment.close(document) }
 }
 func testReloadRetriesLostCommitWithoutReopeningOldInput() async throws {
  let document = try await attach("old")
  _ = try await evaluate(document,"""
  const receive=window.retNative.receive; let dropped=false;
  window.retNative.receive=e=>{if(e.method==='reloadCommit'&&!dropped){dropped=true;return;}receive(e);};
  """)
  let target = environment.root.appendingPathComponent("replacement.md"); try Data("new".utf8).write(to:target)
  await MainActor.run { document.reloadExternal(target) }
  try await Task.sleep(nanoseconds:300_000_000)
  await MainActor.run { XCTAssertEqual(document.state.received.source,"new"); XCTAssertTrue(document.host!.isReplacing) }
  let locked = try await evaluate(document,"return document.querySelector('#workspace').inert") as? Bool; XCTAssertEqual(locked,true)
  try await Task.sleep(nanoseconds:1_100_000_000)
  let snapshot = try await flush(document); XCTAssertEqual(snapshot.source,"new")
  await MainActor.run { XCTAssertFalse(document.host!.isReplacing); environment.close(document) }
 }
 func testReloadTimeoutAndLatePrepareKeepOldSessionAndVersionsCallbackRejectsSafely() async throws {
  let document = try await attach("old")
  _ = try await evaluate(document,"""
  const receive=window.retNative.receive;
  window.replayReload=()=>{if(window.delayedReload)receive(window.delayedReload);};
  window.retNative.receive=e=>{if(e.method==='reloadPrepare'){window.delayedReload=e;return;}receive(e);};
  """)
  let target = environment.root.appendingPathComponent("replacement.md"); try Data("new".utf8).write(to:target)
  let oldEpoch = await MainActor.run { document.state.epoch }
  await MainActor.run { document.reloadExternal(target) }
  try await Task.sleep(nanoseconds:10_300_000_000)
  _ = try await evaluate(document,"window.replayReload();")
  let snapshot = try await flush(document); XCTAssertEqual(snapshot.source,"old")
  let locked = try await evaluate(document,"return document.querySelector('#workspace').inert") as? Bool; XCTAssertEqual(locked,false)
  try await MainActor.run {
   XCTAssertEqual(document.state.epoch,oldEpoch)
   let originalURL = document.fileURL
   XCTAssertThrowsError(try document.revert(toContentsOf:target,ofType:"net.daringfireball.markdown"))
   XCTAssertEqual(document.fileURL,originalURL)
   XCTAssertEqual(document.state.epoch,oldEpoch); XCTAssertEqual(document.state.received.source,"old")
   environment.close(document)
  }
 }
 func testRendererTerminationWhileReloadBarrierIsHeldRestoresOldSnapshot() async throws {
  let document = try await attach("old")
  _ = try await evaluate(document,"const d=new DataTransfer();d.setData('text/markdown','dirty');document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));")
  let snapshot = try await flush(document)
  let target = environment.root.appendingPathComponent("replacement.md"); try Data("new".utf8).write(to:target)
  let queue = environment.recoveryQueue; queue.suspend()
  await MainActor.run { document.reloadExternal(target) }
  try await Task.sleep(nanoseconds:200_000_000)
  await MainActor.run { let host=document.host!; XCTAssertTrue(host.hasReloadBarrier); host.webViewWebContentProcessDidTerminate(host.webView) }
  queue.resume()
  try await Task.sleep(nanoseconds:1_000_000_000)
  let restored = try await flush(document); XCTAssertEqual(restored.source,snapshot.source)
  await MainActor.run { XCTAssertFalse(document.host!.isReplacing); environment.close(document) }
 }
 func testReloadRejectsDiskRechangeDuringHeldRecovery() async throws {
  let document = try await attach("old")
  _ = try await evaluate(document,"const d=new DataTransfer();d.setData('text/markdown','dirty');document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));")
  let snapshot = try await flush(document), oldEpoch = await MainActor.run { document.state.epoch }
  let target = environment.root.appendingPathComponent("changing.md"); try Data("candidate".utf8).write(to:target)
  let queue = environment.recoveryQueue; queue.suspend()
  await MainActor.run { document.reloadExternal(target) }
  try await Task.sleep(nanoseconds:200_000_000)
  await MainActor.run { XCTAssertTrue(document.host!.hasReloadBarrier) }
  try Data("newer external".utf8).write(to:target)
  queue.resume()
  try await Task.sleep(nanoseconds:300_000_000)
  let after = try await flush(document); XCTAssertEqual(after,snapshot)
  await MainActor.run { XCTAssertEqual(document.state.epoch,oldEpoch); XCTAssertFalse(document.host!.isReplacing); environment.close(document) }
  XCTAssertEqual(try String(contentsOf:target,encoding:.utf8),"newer external")
 }
 func testVeryTallImageKeepsBothEndsVisibleInActualPrintedPages() async throws {
  let local = environment.root.appendingPathComponent("tall")
  try FileManager.default.createDirectory(at:local,withIntermediateDirectories:true)
  let bands = ["#ff0000","#00ff00","#00ffff","#ff00ff","#ffff00","#0000ff"].enumerated().map { i,color in "<rect y='\(Double(i)*4000/6)' width='1000' height='\(4000.0/6)' fill='\(color)'/>" }.joined()
  let svg = "<svg xmlns='http://www.w3.org/2000/svg' width='1000' height='4000'>" + bands + "</svg>"
  try Data(svg.utf8).write(to:local.appendingPathComponent("tall.svg"))
  let source = "# ReT-TALL-START\n\n![tall](tall.svg)\n\nReT-TALL-END"
  let original = local.appendingPathComponent("doc.md"); try Data(source.utf8).write(to:original)
  let document = try await attach(source,url:original)
  let output = local.appendingPathComponent("tall.pdf")
  let printed = expectation(description:"tall image PDF")
  await MainActor.run { document.pdfExport!.export(to:output) { result in if case .failure(let error)=result {XCTFail("\(error)")}; printed.fulfill() } }
  await fulfillment(of:[printed],timeout:15)
  let pdf = try XCTUnwrap(PDFDocument(url:output))
  let colors = await MainActor.run { () -> [Int] in
   var red=0,blue=0,green=0,cyan=0,magenta=0,yellow=0
   for i in 0..<pdf.pageCount {
    guard let image = pdf.page(at:i)?.thumbnail(of:NSSize(width:595,height:842),for:.mediaBox), let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data:tiff) else { continue }
    for y in stride(from:0,to:bitmap.pixelsHigh,by:4) { for x in stride(from:0,to:bitmap.pixelsWide,by:4) {
     guard let c = bitmap.colorAt(x:x,y:y)?.usingColorSpace(.deviceRGB) else { continue }
     if c.redComponent > 0.6 && c.redComponent > c.blueComponent + 0.3 && c.redComponent > c.greenComponent + 0.3 { red += 1 }
     if c.blueComponent > 0.6 && c.blueComponent > c.redComponent + 0.3 && c.blueComponent > c.greenComponent + 0.3 { blue += 1 }
     if c.greenComponent > 0.6 && c.greenComponent > c.redComponent + 0.3 && c.greenComponent > c.blueComponent + 0.3 { green += 1 }
     if min(c.greenComponent,c.blueComponent) > c.redComponent + 0.25 { cyan += 1 }
     if min(c.redComponent,c.blueComponent) > c.greenComponent + 0.25 { magenta += 1 }
     if min(c.redComponent,c.greenComponent) > c.blueComponent + 0.25 { yellow += 1 }
    } }
   }
   return [red,green,cyan,magenta,yellow,blue]
  }
  for color in colors { XCTAssertGreaterThan(color,100,"one of six image bands is missing") }
  // 170 mm content width at 72 dpi, 4:1 intrinsic height/width, sampled every 4 px.
  let expectedSamples = pow(170.0*72/25.4,2)*4/16
  XCTAssertEqual(Double(colors.reduce(0,+)),expectedSamples,accuracy:expectedSamples*0.1,"image lost area or distorted its aspect ratio")
  if let path = ProcessInfo.processInfo.environment["RET_PDF_VERIFICATION_DIR"] {
   let target = URL(fileURLWithPath:path).appendingPathComponent("tall-image.pdf")
   try? FileManager.default.removeItem(at:target); try FileManager.default.copyItem(at:output,to:target)
   print("TALL IMAGE PDF",target.path,"pages",pdf.pageCount,"six color bands",colors)
  }
  await MainActor.run { environment.close(document) }
 }
 func testProductionFixtureExportIncludesFrozenContentAndAssetsWhileNativeStateAdvances() async throws {
  let root = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  let fixtureRoot = root.appendingPathComponent("fixtures")
  let source = try String(contentsOf:fixtureRoot.appendingPathComponent("print-layout.md"),encoding:.utf8)
  let local = environment.root.appendingPathComponent("fixture")
  try FileManager.default.createDirectory(at:local,withIntermediateDirectories:true)
  try FileManager.default.copyItem(at:fixtureRoot.appendingPathComponent("preview.assets"),to:local.appendingPathComponent("preview.assets"))
  let original = local.appendingPathComponent("print-layout.md"); try Data(source.utf8).write(to:original)
  let document = try await attach(source,url:original)
  let output = environment.root.appendingPathComponent("fixture.pdf")
  let completed = expectation(description:"actual production fixture PDF")
  let dirtyBefore = await MainActor.run { document.state.isDirty }
  await MainActor.run {
   let forward = document.host!.onExportContent
   document.host!.onExportContent = { envelope in
    _ = document.accept(Snapshot(source:source + "\nNPLUSONE-SHOULD-NOT-PRINT\n",revision:1))
    try? Data("externally replaced image".utf8).write(to:local.appendingPathComponent("preview.assets/图 像 (1) #%.svg"))
    forward?(envelope)
   }
   document.pdfExport!.export(to:output) { result in
    if case .failure(let error) = result { XCTFail("\(error)") }
    if case .success(let warnings) = result { print("FIXTURE PDF WARNINGS",warnings) }
    completed.fulfill()
   }
  }
  await fulfillment(of:[completed],timeout:30)
  let pdf = try XCTUnwrap(PDFDocument(url:output))
  let text = pdf.string ?? ""
  for marker in ["ReT-PDF-2026","ReT-PDF-END","ROW-080","中文"] { XCTAssertTrue(text.contains(marker),"missing \(marker)") }
  XCTAssertFalse(text.contains("NPLUSONE-SHOULD-NOT-PRINT"))
  XCTAssertGreaterThan(pdf.pageCount,2)
  XCTAssertFalse((pdf.page(at:pdf.pageCount-1)?.string ?? "").trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,"Fixture has no intentional trailing blank page")
  if let artifactDirectory = ProcessInfo.processInfo.environment["RET_PDF_VERIFICATION_DIR"] {
   let destination = URL(fileURLWithPath:artifactDirectory,isDirectory:true)
   try FileManager.default.createDirectory(at:destination,withIntermediateDirectories:true)
   let path = destination.appendingPathComponent("print-layout.pdf")
   try? FileManager.default.removeItem(at:path)
   try FileManager.default.copyItem(at:output,to:path)
   print("ACTUAL PRODUCT PDF",path.path,"pages",pdf.pageCount)
  }
  await MainActor.run {
   XCTAssertFalse(dirtyBefore); XCTAssertTrue(document.state.isDirty)
   XCTAssertEqual(document.fileURL,original); XCTAssertEqual(document.state.saved.source,source)
   environment.close(document)
  }
 }
}
