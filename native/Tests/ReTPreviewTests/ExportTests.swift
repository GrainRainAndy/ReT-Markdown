import XCTest
import AppKit
import PDFKit
@testable import ReTPreview

final class ExportTests: RecoveryIsolatedTestCase {
 func testCancelBeforeReplacePreservesOldOutputAndCommitThenCancelReportsCompleted() throws {
  let target = environment.root.appendingPathComponent("out.pdf")
  let temp = environment.root.appendingPathComponent("temp.pdf")
  try Data("old".utf8).write(to:target); try Data("new".utf8).write(to:temp)
  let cancelled = PDFCommitCoordinator()
  XCTAssertEqual(cancelled.cancel(), .cancelled)
  XCTAssertThrowsError(try cancelled.commit(temporary:temp,target:target))
  XCTAssertEqual(try Data(contentsOf:target),Data("old".utf8))
  let completed = PDFCommitCoordinator()
  try completed.commit(temporary:temp,target:target)
  XCTAssertEqual(completed.cancel(),.completed)
  XCTAssertEqual(try Data(contentsOf:target),Data("new".utf8))
 }
 func testCancelRacesActualAtomicReplacementWithOneHonestOutcome() throws {
  for attempt in 0..<30 {
   let folder = environment.root.appendingPathComponent("race-\(attempt)")
   try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
   let target = folder.appendingPathComponent("old.pdf"), temp = folder.appendingPathComponent("temp.pdf")
   try Data("old".utf8).write(to:target); try Data("new".utf8).write(to:temp)
   let coordinator = PDFCommitCoordinator()
   let group = DispatchGroup(); group.enter()
   DispatchQueue.global().async { defer {group.leave()}; try? coordinator.commit(temporary:temp,target:target) }
   let outcome = coordinator.cancel(); group.wait()
   XCTAssertEqual(try Data(contentsOf:target),Data((outcome == .completed ? "new" : "old").utf8))
  }
 }
 func testCancelledRealPrintJobPreservesExistingOutputAndRemovesTemporary() async throws {
  let target = environment.root.appendingPathComponent("cancelled.pdf")
  try Data("original PDF".utf8).write(to:target)
  let cancelled = expectation(description:"cancelled native job")
  let job = try await MainActor.run { try PDFPrintJob(html:"<html><body>never commit</body></html>",resources:PDFResources(webDirectory:WebKitRenderTests.entry.deletingLastPathComponent(),images:[:],assetToken:"document"),target:target) }
  await MainActor.run {
   job.start { result in
    if case .success = result { XCTFail("cancelled job succeeded") }; cancelled.fulfill()
   }
   XCTAssertEqual(job.cancel(),.cancelled)
  }
  await fulfillment(of:[cancelled],timeout:5)
  XCTAssertEqual(try Data(contentsOf:target),Data("original PDF".utf8))
  XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath:environment.root.path).contains(where:{$0.hasPrefix(".ret-pdf-")}))
 }
 func testFailureFallbackDOMDoesNotReplaceOutputButEscapedMarkerIsAllowed() async throws {
  let target = environment.root.appendingPathComponent("failed.pdf")
  try Data("old PDF".utf8).write(to:target)
  for status in ["timeout","unavailable","error"] {
   let finished = expectation(description:"render failure")
   let job = try await MainActor.run { try PDFPrintJob(html:"<html><body><pre data-render-state='\(status)'>frozen</pre></body></html>",resources:PDFResources(webDirectory:WebKitRenderTests.entry.deletingLastPathComponent(),images:[:],assetToken:"document"),target:target) }
   await MainActor.run { job.start { result in if case .success = result { XCTFail("fallback must fail") }; finished.fulfill() } }
   await fulfillment(of:[finished],timeout:15)
   XCTAssertEqual(try Data(contentsOf:target),Data("old PDF".utf8))
  }
 }
 func testFormulaBeyondScalingLimitFailsWithoutReplacingOldPDF() async throws {
  let target = environment.root.appendingPathComponent("too-wide.pdf")
  try Data("old PDF".utf8).write(to:target)
  let failed = expectation(description:"too-wide formula reports failure")
  let job = try await MainActor.run { try PDFPrintJob(html:"<html><body><div class='katex-display'><span class='katex' style='width:10000px'>wide formula</span></div></body></html>",resources:PDFResources(webDirectory:WebKitRenderTests.entry.deletingLastPathComponent(),images:[:],assetToken:"document"),target:target) }
  await MainActor.run { job.start { result in if case .success = result { XCTFail("too-wide formula must not clip silently") }; failed.fulfill() } }
  await fulfillment(of:[failed],timeout:5)
  XCTAssertEqual(try Data(contentsOf:target),Data("old PDF".utf8))
 }
 func testProductionPDFPrintsA4SearchableChineseLongCodeAndFrozenSnapshot() async throws {
  let finished = expectation(description:"real print output")
  let target = environment.root.appendingPathComponent("actual.pdf")
  let code = (1...80).map { "CODE-\($0) long line 中英 mixed text \(String(repeating:"x",count:140))" }.joined(separator:"\n")
  let rows = (1...80).map { "<tr><td>TABLE-\($0)</td><td>中文分页</td></tr>" }.joined()
  let html = """
  <!doctype html><html><head><style>@page{size:A4}body{margin:0;color:black;background:white;font:11pt "Hiragino Sans GB"}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:9pt Menlo}table{border-collapse:collapse}td{border:1px solid #aaa}h2{break-after:avoid}</style></head><body><h1>ReT-PDF-2026 中文固定快照</h1><p>&lt;pre data-render-state='timeout'&gt; is user text</p><pre>\(code)</pre><table>\(rows)</table><p>ReT-PDF-END</p></body></html>
  """
  let job = try await MainActor.run { try PDFPrintJob(html:html,resources:PDFResources(webDirectory:WebKitRenderTests.entry.deletingLastPathComponent(),images:[:],assetToken:"document"),target:target) }
  await MainActor.run { job.start { result in if case .failure(let error) = result { XCTFail("\(error)") }; finished.fulfill() } }
  await fulfillment(of:[finished],timeout:30)
  await MainActor.run { XCTAssertEqual(job.cancel(),.completed) }
  let pdf = try XCTUnwrap(PDFDocument(url:target))
  XCTAssertGreaterThan(pdf.pageCount,2)
  let text = pdf.string ?? ""
  for marker in ["ReT-PDF-2026","中文固定快照","CODE-1","CODE-80","TABLE-80","ReT-PDF-END"] { XCTAssertTrue(text.contains(marker), "missing \(marker)") }
  let firstPage = try XCTUnwrap(pdf.page(at:0))
  let title = try XCTUnwrap(pdf.findString("ReT-PDF-2026",withOptions:[]).first)
  XCTAssertEqual(title.bounds(for:firstPage).minX,56.69,accuracy:2)
  for i in 0..<pdf.pageCount {
   let page = try XCTUnwrap(pdf.page(at:i)); let bounds = page.bounds(for:.mediaBox)
   XCTAssertEqual(bounds.width,595.276,accuracy:1); XCTAssertEqual(bounds.height,841.89,accuracy:1)
  }
 }
}
