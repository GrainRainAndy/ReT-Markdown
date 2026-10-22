import AppKit

@main struct PreviewApp {
 static func main() {
  let application = NSApplication.shared
  let delegate = AppDelegate()
  application.setActivationPolicy(.regular)
  application.delegate = delegate
  withExtendedLifetime(delegate) { application.run() }
 }
}
@MainActor final class PreviewDocumentController: NSDocumentController {
 private var reviewActive = false
 private var reviewWaiters: [(Bool) -> Void] = []
 // AppKit consults this before applicationShouldTerminate. Web-only input must
 // enter document review even when the last received native snapshot was clean.
 override var hasEditedDocuments: Bool { !documents.isEmpty || super.hasEditedDocuments }
 override func reviewUnsavedDocuments(withAlertTitle title: String?, cancellable: Bool, delegate: Any?, didReviewAllSelector selector: Selector?, contextInfo: UnsafeMutableRawPointer?) {
  reviewAll { [self] value in notify(delegate, selector, contextInfo, value) }
 }
 override func closeAllDocuments(withDelegate delegate: Any?, didCloseAllSelector selector: Selector?, contextInfo: UnsafeMutableRawPointer?) {
  reviewAll { [self] value in notify(delegate, selector, contextInfo, value) }
 }
 private func notify(_ delegate: Any?, _ selector: Selector?, _ context: UnsafeMutableRawPointer?, _ value: Bool) {
  guard let object = delegate as? NSObject, let selector else { return }
  typealias Callback = @convention(c) (AnyObject, Selector, NSDocumentController, Bool, UnsafeMutableRawPointer?) -> Void
  unsafeBitCast(object.method(for: selector), to: Callback.self)(object, selector, self, value, context)
 }
 func reviewAll(_ completion: @escaping (Bool) -> Void) {
  reviewWaiters.append(completion)
  guard !reviewActive else { return }
  reviewActive = true
  reviewNext()
 }
 private func reviewNext() {
  // Re-read the controller after each close, including windows opened while
  // a save/sheet was outstanding. Each approved document closes immediately.
  guard let document = documents.first else { finishReview(true); return }
  if let markdown = document as? MarkdownDocument, markdown.closed {
   markdown.closeDurably { [self] success in if success { reviewNext() } else { finishReview(false) } }
  } else {
   document.canClose(withDelegate: self, shouldClose: #selector(reviewedDocument(_:shouldClose:contextInfo:)), contextInfo: nil)
  }
 }
 @objc private func reviewedDocument(_ document: NSDocument, shouldClose: Bool, contextInfo: UnsafeMutableRawPointer?) {
  guard reviewActive else { return }
  guard shouldClose else { finishReview(false); return }
  if let markdown = document as? MarkdownDocument {
   markdown.closeDurably { [self] success in if success { reviewNext() } else { finishReview(false) } }
  } else { document.close(); reviewNext() }
 }
 private func finishReview(_ value: Bool) {
  reviewActive = false
  let waiters = reviewWaiters; reviewWaiters.removeAll()
  for waiter in waiters { waiter(value) }
 }
 override var defaultType: String? { "net.daringfireball.markdown" }
 override func documentClass(forType typeName: String) -> AnyClass? { MarkdownDocument.self }
}
@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
 private var controller: PreviewDocumentController!
 func applicationWillFinishLaunching(_ notification: Notification) {
  controller = PreviewDocumentController()
  Menus.install()
 }
 func applicationDidFinishLaunching(_ notification: Notification) {
  NSApplication.shared.activate(ignoringOtherApps: true)
  let records = RecoveryStore.applicationStore.records()
  for record in records {
   // Clean on-disk snapshots are not offered as crash recovery.
   if record.recoveryDraft == nil, let url = record.fileURL, let data = try? Data(contentsOf: url), data == UTF8File.encode(record.snapshot.source) { continue }
   let alert = NSAlert()
   alert.messageText = "发现可恢复文稿"
   alert.informativeText = "\(record.fileURL?.lastPathComponent ?? "未命名文稿") · 版本 \(record.snapshot.revision) · \(record.date.formatted())\n这是最后成功写入恢复存储的版本。原文件不会被覆盖。"
   alert.addButton(withTitle: "恢复副本"); alert.addButton(withTitle: "稍后"); alert.addButton(withTitle: "删除恢复记录")
   let result = alert.runModal()
   if result == .alertFirstButtonReturn {
    let document = MarkdownDocument(); document.restore(record)
    controller.addDocument(document); document.makeWindowControllers(); document.showWindows()
   } else if result == .alertThirdButtonReturn { RecoveryStore.applicationStore.remove(documentID: record.documentID) }
  }
  if controller.documents.isEmpty { controller.newDocument(nil) }
 }
 private var terminationPending = false
 func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
  guard let controller, !controller.documents.isEmpty else { return .terminateNow }
  guard !terminationPending else { return .terminateLater }
  terminationPending = true
  // The normal path was handled in document review. This catches a document
  // opened between review and the delegate callback without recursive terminate.
  DispatchQueue.main.async { [self] in
   controller.reviewAll { [self] success in
    terminationPending = false
    sender.reply(toApplicationShouldTerminate: success)
   }
  }
  return .terminateLater
 }
 func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { false }
 func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}
