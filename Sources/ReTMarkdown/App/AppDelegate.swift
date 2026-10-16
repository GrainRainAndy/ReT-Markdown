import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let documentController = DocumentController()
    private let menus = MenuController()
    func applicationWillFinishLaunching(_ notification: Notification) {
        documentController.configureDocument = { document in
            let assets = try NativeAssetIntegration.install(on: document)
            PDFExporter.install(on: document, manifest: { snapshot in
                try await assets.authorizedManifest(for: snapshot)
            })
        }
        NSWindow.allowsAutomaticWindowTabbing = false
        menus.install()
    }
    func applicationDidFinishLaunching(_ notification: Notification) { NSApp.activate() }
    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { true }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        var remaining = filenames.count
        var failed = false
        guard remaining > 0 else { sender.reply(toOpenOrPrint: .success); return }
        for filename in filenames {
            documentController.openDocument(withContentsOf: URL(fileURLWithPath: filename), display: true) { _, _, error in
                if let error { failed = true; NSApp.presentError(error) }
                remaining -= 1
                if remaining == 0 { sender.reply(toOpenOrPrint: failed ? .failure : .success) }
            }
        }
    }
}
