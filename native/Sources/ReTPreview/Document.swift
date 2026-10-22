import AppKit

@objc(MarkdownDocument) final class MarkdownDocument: NSDocument {
 var state = DocumentState()
 var host: EditorHost?
 private let recoveryQueue: DispatchQueue
 private let recovery: RecoveryStore
 private lazy var journal = RecoveryJournal(store: recovery, queue: recoveryQueue)
 private var writeSnapshot: Snapshot?
 private var diskBytes: Data?
 private var saveActive = false
 private var saveQueue: [() -> Void] = []
 var closed = false
 var serviceGeneration = 0
 var assetStore: AssetStore?
 var assetTransaction: AssetStore.Transaction?
 var pdfExport: PDFExportController?
 var assetDirectory: URL { recovery.directory.deletingLastPathComponent().appendingPathComponent("Assets", isDirectory:true) }
 private var closeActive = false
 private var closeSaveCompletion: ((Bool) -> Void)?
 private var externalCheckActive = false
 private struct ReloadAuthorization: Equatable {
  let epoch: String
  let snapshot: Snapshot
  let draft: RecoveryDraft?
  init(_ state: DocumentState) { epoch = state.epoch; snapshot = state.received; draft = state.recoveryDraft }
 }
 private var reloadAuthorization: ReloadAuthorization?
 /// Task 4 installs an asset transaction here. It must finish resources before calling success.
 /// The snapshot is frozen; failure must leave fileURL and state.saved unchanged.
 var prepareAssetsForSave: ((URL, Snapshot, @escaping (Result<Void, Error>) -> Void) -> Void)?
 var didCommitSave: ((URL, Snapshot) -> Void)?
 override class var autosavesInPlace: Bool { true }
 override class var preservesVersions: Bool { true }
 override var autosavingFileType: String? { "net.daringfireball.markdown" }
 override init() {
  recovery = .applicationStore
  recoveryQueue = DispatchQueue(label: "com.retmarkdown.rewrite.preview.recovery")
  super.init(); hasUndoManager = false
 }
 init(recoveryStore: RecoveryStore, recoveryQueue: DispatchQueue) {
  self.recovery = recoveryStore; self.recoveryQueue = recoveryQueue
  super.init(); hasUndoManager = false
 }
 override func makeWindowControllers() {
  let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1024, height: 760), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
  window.minSize = NSSize(width: 560, height: 400)
  window.center(); window.title = displayName
  let controller = NSWindowController(window: window)
  addWindowController(controller)
  guard let resources = Bundle.main.resourceURL else { return }
  let entry = resources.appendingPathComponent("web/index.html")
  guard FileManager.default.fileExists(atPath: entry.path) else {
   let message = NSTextField(labelWithString: "编辑器资源缺失。请运行 scripts/build-app.sh 构建完整应用。")
   message.frame = NSRect(x: 30, y: 30, width: 700, height: 40); window.contentView?.addSubview(message)
   return
  }
  let editor = EditorHost(document: self, entryURL: entry)
  host = editor
  installAssetServices(editor)
  window.contentView = editor.webView
 }
 override func read(from data: Data, ofType typeName: String) throws {
  let source = try UTF8File.decode(data)
  serviceGeneration += 1
  if pdfExport != nil { MainActor.assumeIsolated { pdfExport?.cancel() } }
  state = DocumentState(documentID: state.documentID, source: source)
  diskBytes = data
 }
 override func data(ofType typeName: String) throws -> Data { UTF8File.encode((writeSnapshot ?? state.received).source) }
 @discardableResult func accept(_ snapshot: Snapshot, requestID: String? = nil, resolvesRecoveryDraft: Bool = false) -> Bool {
  guard !closed else { return false }
  let accepted = resolvesRecoveryDraft ? state.resolveDraft(with: snapshot) : state.receive(snapshot, documentID: state.documentID, epoch: state.epoch)
  guard accepted else { return false }
  synchronizeDirty()
  persistRecovery(snapshot, requestID: requestID)
  return true
 }
 @discardableResult func acceptRecoveryDraft(_ draft: RecoveryDraft?) -> Bool {
  guard !closed, state.receiveDraft(draft) else { return false }
  synchronizeDirty(); persistRecovery(state.received)
  return true
 }
 var loadPayload: [String: Any] {
  var payload: [String: Any] = ["source":state.received.source,"savedSource":state.saved.source,"revision":state.received.revision,"displayName":displayName ?? "Untitled","fileURL":fileURL?.absoluteString as Any? ?? NSNull(),"appearance":"system"]
  if let assetStore { payload["assetToken"] = assetStore.token }
  if let draft = state.recoveryDraft { payload["recoveryDraft"] = draft.payload }
  return payload
 }
 func rendererWillRestart() { serviceGeneration += 1; state.epoch = UUID().uuidString }
 private func synchronizeDirty() {
  updateChangeCount(.changeCleared)
  if state.isDirty || state.recoveryDraft != nil { updateChangeCount(.changeDone) }
 }
 private func persistRecovery(_ snapshot: Snapshot, requestID: String? = nil, onDurable: (() -> Void)? = nil) {
  let epoch = state.epoch
  let record = RecoveryRecord(documentID: state.documentID, fileURL: fileURL, snapshot: snapshot, date: Date(), recoveryDraft: state.recoveryDraft)
  journal.write(record, acknowledge: { [weak self] stage in
   guard let self, !self.closed, self.state.epoch == epoch else { return }
   if stage == .durable { self.state.markDurable(snapshot); onDurable?() }
   if let requestID { self.host?.send("checkpointAck", payload: ["revision":snapshot.revision,"stage":stage.rawValue], requestID: requestID) }
  }) { [weak self] result in
   guard let self, !self.closed, self.state.epoch == epoch else { return }
   if case .failure(let error) = result { self.report(error, operation: "recovery") }
  }
 }
 func restore(_ record: RecoveryRecord) {
  // Recovery always opens as an untitled copy, preserving the external file unconditionally.
  state = DocumentState(source: "")
  assetStore = nil
  do { try assets().recover(from:record.documentID,originalURL:record.fileURL) }
  catch { report(error,operation:"assetRecovery") }
  state.received = record.snapshot
  _ = state.receiveDraft(record.recoveryDraft)
  displayName = "恢复副本 — \(record.fileURL?.lastPathComponent ?? "未命名")"
  synchronizeDirty()
  persistRecovery(state.received) { [recoveryQueue, recovery] in
   // Retire the old record only after the recovered copy exists on disk.
   recoveryQueue.async { recovery.remove(documentID: record.documentID) }
  }
 }
 override func save(to url: URL, ofType typeName: String, for saveOperation: NSDocument.SaveOperationType, completionHandler: @escaping (Error?) -> Void) {
  guard !closed, !closeActive || closeSaveCompletion != nil else {
   completionHandler(CocoaError(.userCancelled))
   advanceSaveQueue()
   return
  }
  if saveActive {
   saveQueue.append { [weak self] in self?.save(to: url, ofType: typeName, for: saveOperation, completionHandler: completionHandler) }; return
  }
  saveActive = true
  let isAutomatic = [.autosaveInPlaceOperation, .autosaveElsewhereOperation, .autosaveAsOperation].contains(saveOperation)
  var finished = false
  let finish: (Error?) -> Void = { [weak self] error in
   guard !finished else { return }; finished = true
   guard let self else { completionHandler(error); return }
   self.writeSnapshot = nil; self.saveActive = false
   completionHandler(error)
   self.advanceSaveQueue()
  }
  if !isAutomatic, state.recoveryDraft != nil { finish(HostFailure.pending("recovery draft")); return }
  let write: (Snapshot) -> Void = { [weak self] snapshot in
   guard let self, !self.closed else { finish(CocoaError(.userCancelled)); return }
   var prepared = false
   let commit: (Result<Void, Error>) -> Void = { [weak self] result in
    guard !prepared, !finished else { return }; prepared = true
    guard let self else { return }
    guard !self.closed else { finish(CocoaError(.userCancelled)); return }
    switch result {
    case .failure(let error): finish(error)
    case .success:
     self.writeSnapshot = snapshot
     self.systemSave(to: url, type: typeName, operation: saveOperation) { error in
      if error == nil {
       if saveOperation != .autosaveElsewhereOperation && saveOperation != .saveToOperation {
        self.state.markSaved(snapshot); self.diskBytes = UTF8File.encode(snapshot.source)
        self.host?.send("saved", payload: ["source":snapshot.source,"revision":snapshot.revision])
        self.didCommitSave?(url, snapshot)
       }
       self.synchronizeDirty()
       self.persistRecovery(self.state.received)
      }
      finish(error)
     }
    }
   }
   if let prepare = self.prepareAssetsForSave { prepare(url, snapshot, commit) } else { commit(.success(())) }
  }
  if isAutomatic { write(state.received) }
  else if let host {
   host.flush { result in
    switch result { case .success(let snapshot): write(snapshot); case .failure(let error): finish(error) }
   }
  } else { finish(HostFailure.unavailable("编辑器尚未就绪，不能确认全部输入。")) }
 }
 private func advanceSaveQueue() {
  guard !saveActive, !saveQueue.isEmpty else { return }
  saveQueue.removeFirst()()
 }
 private func systemSave(to url: URL, type: String, operation: NSDocument.SaveOperationType, completion: @escaping (Error?) -> Void) {
  super.save(to: url, ofType: type, for: operation, completionHandler: completion)
 }
 override func writeSafely(to url: URL, ofType typeName: String, for saveOperation: NSDocument.SaveOperationType) throws {
  // NSDocument owns coordinated safe replacement and platform version backups.
  // This extra byte check refuses overwriting a changed/deleted baseline.
  if [.saveOperation, .autosaveInPlaceOperation].contains(saveOperation), let diskBytes, url == fileURL {
   guard let current = try? Data(contentsOf: url), current == diskBytes else { throw HostFailure.externalConflict }
  }
  try super.writeSafely(to: url, ofType: typeName, for: saveOperation)
 }
 override func canClose(withDelegate delegate: Any, shouldClose shouldCloseSelector: Selector?, contextInfo: UnsafeMutableRawPointer?) {
  guard !closeActive else { return }
  closeActive = true
  var responded = false
  let respond: (Bool) -> Void = { [weak self] value in
   guard !responded else { return }; responded = true
   self?.closeActive = false
   guard let self, let selector = shouldCloseSelector, let object = delegate as? NSObject else { return }
   typealias Callback = @convention(c) (AnyObject, Selector, NSDocument, Bool, UnsafeMutableRawPointer?) -> Void
   let callback = unsafeBitCast(object.method(for: selector), to: Callback.self)
   callback(object, selector, self, value, contextInfo)
   self.advanceSaveQueue()
  }
  let proceed = { [weak self] in
   guard let self else { respond(false); return }
   guard let host = self.host else { self.closeDecision(pending: true, respond: respond); return }
   host.flush { result in
    switch result {
    case .success: self.closeDecision(pending: false, respond: respond)
    case .failure(let error): self.closeDecision(pending: true, reason: error.localizedDescription, respond: respond)
    }
   }
  }
  if saveActive { saveQueue.append(proceed) } else { proceed() }
 }
 private func closeDecision(pending: Bool, reason: String = "编辑器未就绪。", respond: @escaping (Bool) -> Void) {
  guard let window = windowControllers.first?.window else { respond(false); return }
  if !pending && !state.isDirty { respond(true); return }
  let alert = NSAlert()
  alert.messageText = pending ? "尚有未确认的输入" : "保存对“\(displayName ?? "未命名")”的更改？"
  alert.informativeText = pending ? reason + " 取消可继续编辑；放弃将关闭当前输入。" : "可保存当前文稿、放弃尚未保存的修改，或返回继续编辑。已完成的自动保存保留在磁盘及版本历史中。"
  if !pending { alert.addButton(withTitle: "保存") }
  alert.addButton(withTitle: "取消"); alert.addButton(withTitle: "放弃更改")
  alert.beginSheetModal(for: window) { [weak self] choice in
   guard let self else { respond(false); return }
   let index = choice.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
   if !pending && index == 0 {
    self.closeSaveCompletion = respond
    self.save(withDelegate: self, didSave: #selector(self.closeSaved(_:didSave:contextInfo:)), contextInfo: nil)
   } else if index == (pending ? 1 : 2) { respond(true) }
   else { respond(false) }
  }
 }
 @objc private func closeSaved(_ document: NSDocument, didSave: Bool, contextInfo: UnsafeMutableRawPointer?) {
  let callback = closeSaveCompletion; closeSaveCompletion = nil
  callback?(didSave && !state.isDirty && state.recoveryDraft == nil)
 }
 override func close() {
  closed = true; serviceGeneration += 1; pdfExport?.cancel(); host?.invalidate(); host = nil
  let id = state.documentID, store = recovery
  recoveryQueue.async { store.remove(documentID: id) }
  super.close()
 }
 override func revertToSaved(_ sender: Any?) {
  host?.flush { [weak self] result in
   guard let self else { return }
   switch result {
   case .success:
    self.preserveBeforeReload {
     self.reloadAuthorization = ReloadAuthorization(self.state); self.performSystemRevert(sender)
    }
   case .failure(let error): self.report(error, operation: "revert")
   }
  }
 }
 fileprivate func performSystemRevert(_ sender: Any?) { super.revertToSaved(sender) }
 override func revert(toContentsOf url: URL, ofType typeName: String) throws {
  let authorization = reloadAuthorization
  reloadAuthorization = nil
  guard authorization == ReloadAuthorization(state), state.recoveryDraft == nil else { throw HostFailure.stale }
  try super.revert(toContentsOf: url, ofType: typeName)
  host?.load()
 }
 override func presentedItemDidChange() {
  DispatchQueue.main.async { [weak self] in self?.checkExternalChange() }
 }
 private func checkExternalChange() {
  guard !closed, !saveActive, !externalCheckActive, let url = fileURL, let host else { return }
  let bytes = try? Data(contentsOf: url)
  guard bytes != diskBytes else { return }
  externalCheckActive = true
  host.flush { [weak self] result in
   guard let self else { return }
   self.externalCheckActive = false
   if case .success = result, !self.state.isDirty, bytes != nil {
    self.reloadExternal(url); return
   }
   guard let window = self.windowControllers.first?.window else { return }
   let alert = NSAlert(); alert.messageText = bytes == nil ? "原文件已删除或无法读取" : "文件已在外部改变"
   alert.informativeText = "保留本地副本会打开另存面板；读取外部版本会替换当前内容。输入尚未提交时请先取消并完成输入。"
   alert.addButton(withTitle: "保留本地副本"); alert.addButton(withTitle: "取消")
   if case .success = result, bytes != nil { alert.addButton(withTitle: "读取外部版本") }
   alert.beginSheetModal(for: window) { choice in
    if choice == .alertFirstButtonReturn { self.saveAs(nil) }
    else if choice == .alertThirdButtonReturn { self.reloadExternal(url) }
   }
  }
 }
 private func preserveBeforeReload(_ continuation: @escaping () -> Void) {
  guard !closed else { return }
  guard state.recoveryDraft == nil else { report(HostFailure.pending("recovery draft"), operation: "reload"); return }
  let protectedState = ReloadAuthorization(state)
  guard state.isDirty else { continuation(); return }
  // A separate record survives subsequent checkpoints and preserves the pre-revert source.
  let record = RecoveryRecord(documentID: UUID().uuidString, fileURL: fileURL, snapshot: state.received, date: Date(), recoveryDraft: state.recoveryDraft)
  let store = recovery
  recoveryQueue.async { [weak self] in
   do {
    try store.write(record)
    DispatchQueue.main.async {
     guard let self, !self.closed else { return }
     guard protectedState == ReloadAuthorization(self.state) else {
      self.report(HostFailure.unavailable("恢复写入期间收到新的输入；本次重载已取消，请完成输入后重试。"), operation: "reload")
      return
     }
     continuation()
    }
   } catch { DispatchQueue.main.async { self?.report(error, operation: "revertRecovery") } }
  }
 }
 func reloadExternal(_ url: URL) {
  preserveBeforeReload { [weak self] in
   guard let self else { return }
   do { self.reloadAuthorization = ReloadAuthorization(self.state); try self.revert(toContentsOf: url, ofType: self.fileType ?? "net.daringfireball.markdown") }
   catch { self.report(error, operation: "externalChange") }
  }
 }
 func report(_ error: Error, operation: String, sendToWeb: Bool = true) {
  if closed { return }
  if sendToWeb { host?.send("error", payload: ["message":error.localizedDescription,"operation":operation]) }
  if let window = windowControllers.first?.window, window.attachedSheet == nil {
   let alert = NSAlert(error: error); alert.beginSheetModal(for: window)
  }
 }
}
