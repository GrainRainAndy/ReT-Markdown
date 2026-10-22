import AppKit
import WebKit

/// Asset and export services attach to this document-owned host in Task 4.
/// No unsupported request is acknowledged as a successful operation.
@MainActor final class EditorHost: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
 weak var document: MarkdownDocument?
 let webView: WKWebView
 let entryURL: URL
 private let assetScheme = AssetSchemeHandler()
 var resolveAsset: ((URL) throws -> (data: Data, mimeType: String))? {
  get { assetScheme.resolve }
  set { assetScheme.resolve = newValue }
 }
 var commandEnabled: [String:Bool] = [:]
 private var ready = false
 private var invalidated = false
 private var pending: [String: (Result<Snapshot, Error>) -> Void] = [:]
 private var seen = Set<String>()
 struct ReloadToken: Equatable {
  let requestID: String
  let candidateEpoch: String
 }
 private(set) var reloadToken: ReloadToken?
 private var reloadPrepared = false
 private var reloadCommitted = false
 private var reloadCompletion: ((Result<ReloadToken, Error>) -> Void)?
 func prepareReload(epoch: String, payload: [String:Any], completion: @escaping (Result<ReloadToken, Error>) -> Void) {
  guard ready, !invalidated, reloadToken == nil else { completion(.failure(HostFailure.unavailable("编辑器不能开始重载。"))); return }
  let token = ReloadToken(requestID:UUID().uuidString,candidateEpoch:epoch)
  reloadToken = token; reloadPrepared = false; reloadCommitted = false; reloadCompletion = completion
  send("reloadPrepare", payload: ["epoch":token.candidateEpoch,"load":payload], requestID:token.requestID)
  DispatchQueue.main.asyncAfter(deadline:.now() + 10) { [weak self] in
   self?.cancelReload(token, error:HostFailure.unavailable("重载屏障超时；已保留原文稿。"))
  }
 }
 var isReplacing: Bool { reloadToken != nil }
 var hasReloadBarrier: Bool { reloadToken != nil && reloadPrepared && !reloadCommitted }
 func hasReloadBarrier(for token: ReloadToken) -> Bool { reloadToken == token && reloadPrepared && !reloadCommitted && !invalidated }
 func cancelReload(_ token: ReloadToken, error: Error = CocoaError(.userCancelled)) {
  guard reloadToken == token, !reloadCommitted else { return }
  send("reloadCancel", payload:[:], requestID:token.requestID)
  reloadToken = nil; reloadPrepared = false
  let callback = reloadCompletion; reloadCompletion = nil; callback?(.failure(error))
 }
 func commitReload(_ token: ReloadToken) {
  guard hasReloadBarrier(for:token), document?.state.epoch == token.candidateEpoch else { return }
  reloadCommitted = true
  resendReloadCommit(token)
 }
 private func resendReloadCommit(_ token: ReloadToken) {
  guard !invalidated, reloadToken == token, reloadCommitted, document?.state.epoch == token.candidateEpoch else { return }
  send("reloadCommit", payload:[:], requestID:token.requestID)
  // A lost completion never unlocks old input or rolls the native epoch back.
  DispatchQueue.main.asyncAfter(deadline:.now() + 1) { [weak self] in self?.resendReloadCommit(token) }
 }
 private func invalidateReload() {
  let callback = reloadCompletion; reloadCompletion = nil
  reloadToken = nil; reloadPrepared = false; reloadCommitted = false
  callback?(.failure(HostFailure.stale))
 }
 private var assetRequests: [String: (Snapshot, (Result<[String], Error>) -> Void)] = [:]
 var onSessionInvalidated: (() -> Void)?
 var onImportImage: ((BridgeEnvelope) -> Void)?
 var onExportContent: ((BridgeEnvelope) -> Void)?
 var onExportPDF: (() -> Void)?
 init(document: MarkdownDocument, entryURL: URL) {
  self.document = document; self.entryURL = entryURL
  let configuration = WKWebViewConfiguration()
  configuration.websiteDataStore = .nonPersistent()
  Self.installBundledWorker(in: configuration, entryURL: entryURL)
  configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
  configuration.setURLSchemeHandler(assetScheme, forURLScheme: "ret-asset")
  webView = WKWebView(frame: .zero, configuration: configuration)
  super.init()
  configuration.userContentController.add(self, name: "ret")
  webView.navigationDelegate = self
  webView.underPageBackgroundColor = .textBackgroundColor
  webView.loadFileURL(entryURL, allowingReadAccessTo: entryURL.deletingLastPathComponent())
 }
 /// WKWebView rejects file:// worker scripts. Inject only this app's bundled classic
 /// worker bytes; Blob workers retain termination/deadline isolation without network.
 static func installBundledWorker(in configuration: WKWebViewConfiguration, entryURL: URL) {
  let url = entryURL.deletingLastPathComponent().appendingPathComponent("render-worker.js")
  guard let source = try? String(contentsOf: url, encoding: .utf8),
   let json = try? JSONSerialization.data(withJSONObject: [source]),
   let literal = String(data: json, encoding: .utf8) else { return }
  configuration.userContentController.addUserScript(WKUserScript(source: "Object.defineProperty(window,'retRenderWorkerSource',{value:(\(literal))[0]});", injectionTime: .atDocumentStart, forMainFrameOnly: true))
 }
 func send(_ method: String, payload: [String: Any], requestID: String = UUID().uuidString) {
  guard !invalidated, let document else { return }
  let envelope: [String: Any] = ["v":1,"documentId":document.state.documentID,"epoch":document.state.epoch,"requestId":requestID,"method":method,"payload":payload]
  webView.callAsyncJavaScript("window.retNative.receive(envelope)", arguments: ["envelope":envelope], in: nil, in: .page) { [weak self] result in
   if case .failure(let error) = result { self?.document?.report(error, operation: "bridge", sendToWeb: false) }
  }
 }
 func load() {
  guard let document else { return }
  ready = true
  send("load", payload: document.loadPayload)
 }
 func command(_ id: String) { if ready, commandEnabled[id] == true { send("command", payload: ["id":id]) } }
 func flush(_ completion: @escaping (Result<Snapshot, Error>) -> Void) {
  if document?.state.recoveryDraft != nil { completion(.failure(HostFailure.pending("recovery draft"))); return }
  guard ready, !invalidated else { completion(.failure(HostFailure.unavailable("编辑器尚未就绪；已接收的恢复副本仍保留。"))); return }
  let id = UUID().uuidString
  pending[id] = completion
  send("flush", payload: [:], requestID: id)
  DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
   self?.pending.removeValue(forKey: id)?(.failure(HostFailure.unavailable("编辑器未响应保存屏障。请重试；未确认保存成功。")))
  }
 }
 func collectAssets(for snapshot: Snapshot, completion: @escaping (Result<[String], Error>) -> Void) {
  guard ready, !invalidated else { completion(.failure(HostFailure.unavailable("编辑器尚未就绪。"))); return }
  let id = UUID().uuidString
  assetRequests[id] = (snapshot, completion)
  send("collectAssets", payload: ["source":snapshot.source,"revision":snapshot.revision], requestID:id)
  DispatchQueue.main.asyncAfter(deadline:.now() + 10) { [weak self] in
   self?.assetRequests.removeValue(forKey:id)?.1(.failure(HostFailure.unavailable("图片清单准备超时。")))
  }
 }
 private func cancelServices() {
  invalidateReload()
  commandEnabled = [:]
  onSessionInvalidated?()
  let requests = assetRequests.values; assetRequests.removeAll()
  for (_,completion) in requests { completion(.failure(HostFailure.stale)) }
 }
 func invalidate() {
  invalidated = true; ready = false
  cancelServices()
  let callbacks = pending.values; pending.removeAll()
  for callback in callbacks { callback(.failure(HostFailure.unavailable("文稿会话已关闭。"))) }
  webView.configuration.userContentController.removeScriptMessageHandler(forName: "ret")
  webView.navigationDelegate = nil
 }
 func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
  guard !invalidated, let document else { return }
  let trusted = message.frameInfo.isMainFrame && message.frameInfo.request.url?.standardizedFileURL == entryURL.standardizedFileURL
  guard let envelope = BridgeEnvelope.parse(message.body, trusted: trusted, documentID: document.state.documentID, epoch: document.state.epoch) else { return }
  if envelope.method == "reloadReady" {
   guard let token = reloadToken, envelope.requestID == token.requestID, !reloadPrepared, !reloadCommitted else { return }
   guard envelope.payload["status"] as? String == "ready", document.state.recoveryDraft == nil else { cancelReload(token, error:HostFailure.pending("composition or recovery draft")); return }
   let snapshot = Snapshot(source:envelope.payload["source"] as! String, revision:BridgeEnvelope.integer(envelope.payload["revision"])!)
   guard snapshot == document.state.received || document.accept(snapshot) else { cancelReload(token, error:HostFailure.stale); return }
   reloadPrepared = true
   let callback = reloadCompletion; reloadCompletion = nil; callback?(.success(token)); return
  }
  if envelope.method == "reloadComplete" {
   guard let token = reloadToken, envelope.requestID == token.requestID, document.state.epoch == token.candidateEpoch, reloadCommitted else { return }
   reloadToken = nil; reloadPrepared = false; reloadCommitted = false; return
  }
  if envelope.method == "assetManifest" {
   guard let (snapshot, callback) = assetRequests.removeValue(forKey:envelope.requestID) else { return }
   guard BridgeEnvelope.integer(envelope.payload["revision"]) == snapshot.revision else { callback(.failure(HostFailure.stale)); return }
   callback(.success(envelope.payload["paths"] as! [String])); return
  }
  if envelope.method == "flushResult" {
   guard let callback = pending.removeValue(forKey: envelope.requestID) else { return }
   if envelope.payload["status"] as? String == "pending" { callback(.failure(HostFailure.pending(envelope.payload["reason"] as? String ?? "pending"))); return }
   let snapshot = Snapshot(source: envelope.payload["source"] as! String, revision: BridgeEnvelope.integer(envelope.payload["revision"])!)
   if document.state.recoveryDraft != nil { callback(.failure(HostFailure.pending("recovery draft"))) }
   else if snapshot == document.state.received { callback(.success(snapshot)) }
   else if document.accept(snapshot) { callback(.success(snapshot)) }
   else { callback(.failure(HostFailure.stale)) }
   return
  }
  guard seen.insert(envelope.requestID).inserted else { return }
  if seen.count > 10000 { seen.removeAll(keepingCapacity: true); seen.insert(envelope.requestID) }
  switch envelope.method {
  case "ready": if !ready { load() }
  case "checkpoint":
   if !document.accept(Snapshot(source: envelope.payload["source"] as! String, revision: BridgeEnvelope.integer(envelope.payload["revision"])!), requestID: envelope.requestID, resolvesRecoveryDraft: envelope.payload["resolvesRecoveryDraft"] as? Bool ?? false) {
    send("error", payload: ["message":"检查点过期或仍有待恢复草稿。","operation":"checkpoint"], requestID: envelope.requestID)
   }
  case "recoveryDraft":
   let draft = envelope.payload["draft"] is NSNull ? nil : RecoveryDraft.parse(envelope.payload["draft"]!)
   if !document.acceptRecoveryDraft(draft) { send("error", payload: ["message":"恢复草稿基于过期版本。","operation":"recoveryDraft"], requestID: envelope.requestID) }
  case "commandState": commandEnabled = envelope.payload["enabled"] as! [String:Bool]
  case "openLink":
   if let url = Self.externalURL(envelope.payload["url"] as! String) { NSWorkspace.shared.open(url) }
  case "save": document.save(nil)
  case "saveAs": document.saveAs(nil)
  case "new": NSDocumentController.shared.newDocument(nil)
  case "open": NSDocumentController.shared.openDocument(nil)
  case "importImage":
   if let onImportImage { onImportImage(envelope) }
   else { send("assetResult", payload: ["requestId":envelope.requestID,"relativePath":"","error":"图片导入服务尚未安装。"], requestID: envelope.requestID) }
  case "exportPDF": requestExport()
  case "exportContent": onExportContent?(envelope)
  default: break
  }
 }
 func requestExport() {
  if let onExportPDF { onExportPDF() }
  else { document?.report(HostFailure.unavailable("PDF 导出服务尚未安装。"), operation: "exportPDF") }
 }
 static func externalURL(_ value: String) -> URL? {
  guard !value.isEmpty, !value.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 }), let url = URL(string:value), let scheme = url.scheme?.lowercased() else { return nil }
  if scheme == "mailto" { return url.path.isEmpty ? nil : url }
  return ["http","https"].contains(scheme) && !(url.host ?? "").isEmpty ? url : nil
 }
 func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
  guard let url = action.request.url else { decisionHandler(.cancel); return }
  if action.targetFrame?.isMainFrame == true && url.standardizedFileURL == entryURL.standardizedFileURL { decisionHandler(.allow); return }
  if action.navigationType == .linkActivated, Self.externalURL(url.absoluteString) != nil { NSWorkspace.shared.open(url) }
  decisionHandler(.cancel)
 }
 func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
  ready = false
  cancelServices()
  let callbacks = pending.values; pending.removeAll()
  for callback in callbacks { callback(.failure(HostFailure.unavailable("编辑进程已退出；请重新打开恢复副本。"))) }
  document?.report(HostFailure.unavailable("编辑进程已退出，正在恢复宿主已收到的源文与草稿。尚未发送到宿主的输入可能丢失。"), operation: "renderer", sendToWeb: false)
  document?.rendererWillRestart()
  seen.removeAll()
  webView.reload()
 }
}

/// The installed resolver must authorize the document identity and canonical path.
/// Task 4 supplies the resolver; without it, asset requests fail closed.
@MainActor private final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
 var resolve: ((URL) throws -> (data: Data, mimeType: String))?
 func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
  do {
   guard let url = urlSchemeTask.request.url, let resolve else { throw CocoaError(.fileReadNoPermission) }
   let asset = try resolve(url)
   urlSchemeTask.didReceive(URLResponse(url: url, mimeType: asset.mimeType, expectedContentLength: asset.data.count, textEncodingName: nil))
   urlSchemeTask.didReceive(asset.data); urlSchemeTask.didFinish()
  } catch { urlSchemeTask.didFailWithError(error) }
 }
 func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
