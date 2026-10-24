import XCTest
import AppKit
import WebKit
@testable import ReTPreview

final class WebKitRenderTests: RecoveryIsolatedTestCase {
 @MainActor func testSourceCaretUsesActualWebKitAppearance() async throws {
  let document = try await attachEditor(source: "中文 caret")
  defer { environment.close(document) }
  document.host!.command("toggleSource")
  try await eventually { (try? await self.evaluateEditor(document, "return !!document.querySelector('.source-surface .cm-content')")) as? Bool == true }
  for mode in ["dark", "light", "system"] {
   document.host!.send("appearance", payload:["mode":mode])
   try await eventually { (try? await self.evaluateEditor(document, "return document.documentElement.dataset.appearance", arguments:[:])) as? String == mode }
   let colors = try await evaluateEditor(document, """
   const content = document.querySelector('.cm-content'); content.focus();
   return {caret:getComputedStyle(content).caretColor, text:getComputedStyle(document.body).color};
   """) as! [String:String]
   XCTAssertEqual(colors["caret"], colors["text"], "Appearance: " + mode)
  }
  XCTAssertEqual(document.state.received.source, "中文 caret")
 }
 static var entry: URL {
  if let path = ProcessInfo.processInfo.environment["RET_TEST_WEB_ENTRY"] { return URL(fileURLWithPath: path) }
  return URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("dist/web/index.html")
 }
 func testBundledFileWorkerActuallyTypesetsKaTeX() async throws {
  let web = await MainActor.run { () -> WKWebView in
   _ = NSApplication.shared
   let config = WKWebViewConfiguration()
   config.websiteDataStore = .nonPersistent()
   EditorHost.installBundledWorker(in: config, entryURL: Self.entry)
   let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
   web.loadFileURL(Self.entry, allowingReadAccessTo: Self.entry.deletingLastPathComponent())
   return web
  }
  try await Task.sleep(nanoseconds: 3_000_000_000)

  let value: Any? = try await withCheckedThrowingContinuation { continuation in
   Task { @MainActor in web.callAsyncJavaScript("""
   return await new Promise((resolve,reject)=>{
    const worker = new Worker(URL.createObjectURL(new Blob([window.retRenderWorkerSource], {type:'text/javascript'})));
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('worker timeout'))},5000);
    worker.onerror=(e)=>{clearTimeout(timer);worker.terminate();reject(new Error('worker error: '+e.message))};
    worker.onmessage=(e)=>{clearTimeout(timer);worker.terminate();resolve(e.data.html)};
    worker.postMessage({id:1,job:{kind:'document',source}});
   })
   """, arguments: ["source":"# 冻结 WKWebView\n\n$$\n\\frac{a}{b}\n$$"], in: nil, in: .page) { continuation.resume(with: $0) } }
  }
  let html = value as? String
  XCTAssertTrue(html?.contains("class=\"katex\"") == true, html ?? "no HTML")
  XCTAssertTrue(html?.contains("冻结 WKWebView") == true)
  XCTAssertFalse(html?.contains("data-render-state") == true)
  await MainActor.run { web.stopLoading() }
 }
}
