import AppKit
import WebKit
import PDFKit
import Darwin

/// Cancellation and atomic replacement share a single serialized disk decision.
/// A late cancellation observes completed; it cannot claim the old bytes survived.
final class PDFCommitCoordinator {
 enum Outcome { case pending, cancelled, completed }
 private let lock = NSLock()
 private var state: Outcome = .pending
 func cancel() -> Outcome {
  lock.lock(); defer { lock.unlock() }
  if state == .pending { state = .cancelled }
  return state
 }
 func commit(temporary: URL, target: URL) throws {
  let coordinator = NSFileCoordinator()
  var coordinationError: NSError?, writeError: Error?
  coordinator.coordinate(writingItemAt:target,options:.forReplacing,error:&coordinationError) { destination in
   lock.lock(); defer { lock.unlock() }
   guard state == .pending else { writeError = CocoaError(.userCancelled); return }
   if rename(temporary.path, destination.path) != 0 { writeError = POSIXError(POSIXErrorCode(rawValue:errno) ?? .EIO) }
   else { state = .completed }
  }
  if let error = coordinationError ?? (writeError as NSError?) { throw error }
  lock.lock(); let completed = state == .completed; lock.unlock()
  guard completed else { throw CocoaError(.fileWriteUnknown) }
 }
}

/// Value snapshot of app fonts/styles and validated local image bytes taken before
/// requesting asynchronous document rendering. No mutable resource is read later.
struct PDFResources {
 let files: [String:Data]
 let images: [String:ImageResource]
 let assetToken: String
 init(webDirectory: URL, images: [String:ImageResource], assetToken: String) throws {
  self.images = images; self.assetToken = assetToken
  var files: [String:Data] = ["katex.css":try Data(contentsOf:webDirectory.appendingPathComponent("katex.css"))]
  let fonts = webDirectory.appendingPathComponent("fonts")
  for url in (try FileManager.default.contentsOfDirectory(at:fonts,includingPropertiesForKeys:[.isRegularFileKey,.isSymbolicLinkKey])) {
   let values = try url.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey])
   guard values.isRegularFile == true, values.isSymbolicLink != true else { throw AssetFailure.invalid("字体资源无效。") }
   files["fonts/" + url.lastPathComponent] = try Data(contentsOf:url)
  }
  self.files = files
 }
}

@MainActor private final class FrozenImageScheme: NSObject, WKURLSchemeHandler {
 let resources: PDFResources
 init(_ resources: PDFResources) { self.resources = resources }
 func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
  do {
   guard let url = task.request.url, url.host == resources.assetToken, url.query == nil, url.fragment == nil,
    let encoded = URLComponents(url:url,resolvingAgainstBaseURL:false)?.percentEncodedPath,
    let path = try? AssetStore.relative(String(encoded.dropFirst())), let image = resources.images[path] else { throw CocoaError(.fileReadNoSuchFile) }
   task.didReceive(URLResponse(url:url,mimeType:image.mimeType,expectedContentLength:image.data.count,textEncodingName:nil)); task.didReceive(image.data); task.didFinish()
  } catch { task.didFailWithError(error) }
 }
 func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

@MainActor final class PDFPrintJob: NSObject, WKNavigationDelegate {
 let target: URL
 private let directory: URL
 private let temporary: URL
 private let resources: PDFResources
 private let coordinator = PDFCommitCoordinator()
 private let webView: WKWebView
 private var completion: ((Result<[String],Error>) -> Void)?
 private var finished = false
 private var printing = false
 private var printWindow: NSWindow?
 private var printOperation: NSPrintOperation?
 private var started = false
 private var warnings: [String] = []
 private var deferredFailure: Error?
 private var keepAlive: PDFPrintJob?
 init(html: String, resources: PDFResources, target: URL) throws {
  self.target = target; self.resources = resources
  let id = UUID().uuidString
  directory = FileManager.default.temporaryDirectory.appendingPathComponent("ReT-PDF-" + id,isDirectory:true)
  temporary = target.deletingLastPathComponent().appendingPathComponent(".ret-pdf-" + id + ".pdf")
  let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent()
  configuration.setURLSchemeHandler(FrozenImageScheme(resources),forURLScheme:"ret-asset")
  configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
  webView = WKWebView(frame:NSRect(x:0,y:0,width:481.89,height:728.50),configuration:configuration)
  super.init()
  try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
  do {
   for (path,bytes) in resources.files {
    let url = directory.appendingPathComponent(path)
    try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true)
    try bytes.write(to:url,options:.withoutOverwriting)
   }
   let policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src ret-asset:; connect-src 'none'\">"
   try Data(("<meta charset=\"utf-8\">" + policy + html).utf8).write(to:directory.appendingPathComponent("print.html"),options:.withoutOverwriting)
  } catch { try? FileManager.default.removeItem(at:directory); throw error }
  webView.navigationDelegate = self
  webView.underPageBackgroundColor = .white
 }
 func start(_ completion: @escaping (Result<[String],Error>) -> Void) {
  guard !started else { return }; started = true
  self.completion = completion; keepAlive = self
  let entry = directory.appendingPathComponent("print.html")
  webView.loadFileURL(entry,allowingReadAccessTo:directory)
  DispatchQueue.main.asyncAfter(deadline:.now() + 25) { [weak self] in
   guard let self, !self.finished, !self.printing else { return }
   _ = self.coordinator.cancel(); self.finish(.failure(HostFailure.unavailable("打印资源准备超时。")))
  }
 }
 @discardableResult func cancel() -> PDFCommitCoordinator.Outcome {
  let outcome = coordinator.cancel()
  if outcome == .cancelled, !printing { finish(.failure(CocoaError(.userCancelled))) }
  return outcome
 }
 private func finish(_ result: Result<[String],Error>) {
  guard !finished else { return }; finished = true
  webView.stopLoading(); webView.navigationDelegate = nil
  try? FileManager.default.removeItem(at:temporary)
  try? FileManager.default.removeItem(at:directory)
  printOperation = nil; printWindow?.contentView = nil; printWindow?.close(); printWindow = nil
  let callback = completion; completion = nil; callback?(result); keepAlive = nil
 }
 func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
  guard !finished else { return }
  webView.callAsyncJavaScript(Self.readiness,arguments:["token":resources.assetToken],in:nil,in:.page) { [weak self] result in
   guard let self, !self.finished else { return }
   switch result {
   case .failure(let error): self.finish(.failure(error))
   case .success(let value):
    self.warnings = value as? [String] ?? []
    self.printPDF()
   }
  }
 }
 func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
 func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
 func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
  let error = HostFailure.unavailable("打印进程已退出。")
  _ = coordinator.cancel()
  if printing { deferredFailure = error } else { finish(.failure(error)) }
 }
 func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy)->Void) {
  decisionHandler(action.request.url?.standardizedFileURL == directory.appendingPathComponent("print.html").standardizedFileURL ? .allow : .cancel)
 }
 private func printPDF() {
  guard !finished else { return }
  printing = true
  let info = NSPrintInfo(dictionary:[:])
  info.paperSize = NSSize(width:595.275590551,height:841.88976378)
  info.orientation = .portrait
  let margin = 20.0 * 72.0 / 25.4
  info.topMargin = margin; info.bottomMargin = margin; info.leftMargin = margin; info.rightMargin = margin
  info.isHorizontallyCentered = false; info.isVerticallyCentered = false
  info.horizontalPagination = .fit; info.verticalPagination = .automatic
  info.jobDisposition = .save
  info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = temporary
  info.dictionary()["NSPrintHeaderAndFooter"] = NSNumber(value:false)
  let operation = webView.printOperation(with:info)
  operation.showsPrintPanel = false; operation.showsProgressPanel = false
  operation.canSpawnSeparateThread = true
  let window = NSWindow(contentRect:webView.frame,styleMask:.borderless,backing:.buffered,defer:false)
  window.isReleasedWhenClosed = false; window.contentView = webView
  printWindow = window; printOperation = operation
  operation.runModal(for:window,delegate:self,didRun:#selector(didPrint(_:success:contextInfo:)),contextInfo:nil)
 }
 @objc nonisolated private func didPrint(_ operation: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
  Task { @MainActor [weak self] in self?.completePrint(success:success) }
 }
 private func completePrint(success: Bool) {
  printing = false
  if let deferredFailure { finish(.failure(deferredFailure)); return }
  do {
   guard success, let pdf = PDFDocument(url:temporary), pdf.pageCount > 0 else { throw HostFailure.unavailable("系统打印未生成有效 PDF。") }
   for i in 0..<pdf.pageCount {
    guard let page = pdf.page(at:i) else { throw HostFailure.unavailable("PDF 页面无效。") }
    let size = page.bounds(for:.mediaBox).size
    guard abs(size.width - 595.27559) < 1, abs(size.height - 841.88976) < 1 else { throw HostFailure.unavailable("系统打印纸张不是 A4。") }
   }
   try coordinator.commit(temporary:temporary,target:target)
   finish(.success(warnings))
  } catch { finish(.failure(error)) }
 }
 private static let readiness = """
 const fallback = document.querySelector('pre[data-render-state]');
 if(fallback && ['timeout','unavailable','error','cancelled'].includes(fallback.dataset.renderState)) throw new Error('公式渲染未完成：'+fallback.dataset.renderState);
 if(document.querySelector('.math-error')) throw new Error('公式包含错误，未导出 PDF。');
 const warnings=[];
 await document.fonts.ready;
 for(const font of document.fonts) if(font.status==='error') throw new Error('打印字体加载失败。');
 await Promise.all(Array.from(document.images).map(img=>new Promise(resolve=>{
  const done=()=>{
   if(!img.naturalWidth || !img.src.startsWith('ret-asset://'+token+'/')){
    const span=document.createElement('span');span.className='image-placeholder';
    span.textContent='[图片：'+(img.dataset.assetPath||img.getAttribute('src')||img.alt)+']';
    img.replaceWith(span);warnings.push(span.textContent);
   }
   resolve();
  };
  if(img.complete) done(); else {img.onload=done;img.onerror=done;}
 })));
 document.documentElement.style.colorScheme='light'; document.body.style.background='white';
 document.body.style.padding='0';document.body.style.margin='0';
 for(const formula of document.querySelectorAll('.katex-display > .katex')) {
  formula.style.display='inline-block';
  const available=formula.parentElement.clientWidth;
  const width=formula.getBoundingClientRect().width;
  if(width>available){const scale=available/width;if(scale<0.35)throw new Error('公式过宽，缩小至35%仍无法完整显示。');formula.style.zoom=String(scale);warnings.push('宽公式已缩小至'+Math.round(scale*100)+'%。');}
 }
 document.body.getBoundingClientRect();
 return warnings;
 """
}

@MainActor final class PDFExportController: NSObject {
 weak var document: MarkdownDocument?
 weak var host: EditorHost?
 private var requestID: String?
 private var snapshot: Snapshot?
 private var resources: PDFResources?
 private var target: URL?
 private var printJob: PDFPrintJob?
 private var progress: NSPanel?
 private var completed: ((Result<[String],Error>) -> Void)?
 init(document: MarkdownDocument, host: EditorHost) { self.document = document; self.host = host; super.init() }
 func chooseDestination() {
  guard let document, let window = document.windowControllers.first?.window else { return }
  let panel = NSSavePanel(); panel.allowedContentTypes = [.pdf]
  panel.nameFieldStringValue = (document.fileURL?.deletingPathExtension().lastPathComponent ?? "未命名") + ".pdf"
  panel.beginSheetModal(for:window) { [weak self] response in
   guard response == .OK, let target = panel.url else { return }
   self?.export(to:target) { [weak self] result in
    guard let self else { return }
    if case .failure(let error) = result, (error as? CocoaError)?.code != .userCancelled { self.document?.report(error,operation:"exportPDF") }
    if case .success(let warnings) = result, !warnings.isEmpty { self.document?.host?.send("error",payload:["message":warnings.joined(separator:"\n"),"operation":"exportPDF"]) }
   }
  }
 }
 func export(to target: URL, completion: @escaping (Result<[String],Error>) -> Void) {
  cancel()
  guard let document, let host, !document.closed else { completion(.failure(CocoaError(.userCancelled))); return }
  let id = UUID().uuidString
  requestID = id; self.target = target; completed = completion
  if let window = document.windowControllers.first?.window {
   let panel = NSPanel(contentRect:NSRect(x:0,y:0,width:340,height:100),styleMask:[.titled,.utilityWindow],backing:.buffered,defer:false)
   panel.title = "正在导出 PDF"; panel.isFloatingPanel = true
   let label = NSTextField(labelWithString:"使用固定快照，您可以继续编辑。")
   label.frame = NSRect(x:20,y:60,width:300,height:20); panel.contentView?.addSubview(label)
   let button = NSButton(title:"取消导出",target:self,action:#selector(cancelExport))
   button.frame = NSRect(x:210,y:15,width:110,height:30); panel.contentView?.addSubview(button)
   panel.setFrameOrigin(NSPoint(x:window.frame.maxX-360,y:window.frame.maxY-150))
   window.addChildWindow(panel,ordered:.above); progress = panel
  }
  host.flush { [weak self] result in
   guard let self, self.requestID == id else { return }
   do {
    let snapshot = try result.get(); self.snapshot = snapshot
    host.collectAssets(for:snapshot) { [weak self] manifest in
     guard let self, self.requestID == id else { return }
     do {
      let paths = try manifest.get()
      let store = try document.assets()
      self.resources = try PDFResources(webDirectory:host.entryURL.deletingLastPathComponent(),images:store.freeze(references:paths,documentURL:document.fileURL),assetToken:store.token)
      host.send("prepareExport",payload:["source":snapshot.source,"revision":snapshot.revision],requestID:id)
     } catch { self.finish(.failure(error)) }
    }
   } catch { self.finish(.failure(error)) }
  }
  DispatchQueue.main.asyncAfter(deadline:.now() + 20) { [weak self] in
   guard let self, self.requestID == id, self.printJob == nil else { return }
   self.finish(.failure(HostFailure.unavailable("导出渲染超时。")))
  }
 }
 func receive(_ envelope: BridgeEnvelope) {
  guard envelope.requestID == requestID, let snapshot, BridgeEnvelope.integer(envelope.payload["revision"]) == snapshot.revision, let html = envelope.payload["html"] as? String, let resources, let target, printJob == nil else { return }
  do {
   let job = try PDFPrintJob(html:html,resources:resources,target:target)
   printJob = job
   let id = requestID
   job.start { [weak self] result in guard self?.requestID == id else { return }; self?.finish(result) }
  } catch { finish(.failure(error)) }
 }
 @objc private func cancelExport() { cancel() }
 func cancel() {
  guard requestID != nil else { return }
  if let printJob {
   if printJob.cancel() == .completed { return }
   // If native printing is still unwinding it owns temporary cleanup and completion.
   if requestID != nil { return }
  } else { finish(.failure(CocoaError(.userCancelled))) }
 }
 private func finish(_ result: Result<[String],Error>) {
  guard requestID != nil else { return }
  requestID = nil; snapshot = nil; resources = nil; target = nil; printJob = nil
  if let progress { progress.parent?.removeChildWindow(progress); progress.close(); self.progress = nil }
  let callback = completed; completed = nil; callback?(result)
 }
}
