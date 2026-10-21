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
   if let url = record.fileURL, let data = try? Data(contentsOf: url), data == UTF8File.encode(record.snapshot.source) { continue }
   let alert = NSAlert()
   alert.messageText = "发现可恢复文稿"
   alert.informativeText = "\(record.fileURL?.lastPathComponent ?? "未命名文稿") · 版本 \(record.snapshot.revision) · \(record.date.formatted())\n这是最后成功写入恢复存储的版本。原文件不会被覆盖。"
   alert.addButton(withTitle: "恢复副本"); alert.addButton(withTitle: "稍后"); alert.addButton(withTitle: "删除恢复记录")
   let result = alert.runModal()
   if result == .alertFirstButtonReturn {
    let document = MarkdownDocument(); document.restore(record)
    controller.addDocument(document); document.makeWindowControllers(); document.showWindows()
    RecoveryStore.applicationStore.remove(documentID: record.documentID)
   } else if result == .alertThirdButtonReturn { RecoveryStore.applicationStore.remove(documentID: record.documentID) }
  }
  if controller.documents.isEmpty { controller.newDocument(nil) }
 }
 func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { false }
 func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}
