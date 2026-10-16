import AppKit
import WebKit

@MainActor
final class EditorWebView: WKWebView, WKNavigationDelegate {
    let editorBridge: EditorBridge
    var handleDrop: ((NSPasteboard) -> Bool)?
    init(bridge: EditorBridge, configure: ((WKWebViewConfiguration) -> Void)? = nil, beforeLoad: (@MainActor () async throws -> Void)? = nil) throws {
        self.editorBridge = bridge
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let bootstrap = try JSONSerialization.data(withJSONObject: ["documentID": bridge.mirror.documentID, "sessionID": bridge.mirror.sessionID], options: [.sortedKeys])
        let json = String(decoding: bootstrap, as: UTF8.self)
        configuration.userContentController.addUserScript(WKUserScript(source: "window.retEditorBootstrap = \(json);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.add(bridge, name: "ret")
        configure?(configuration)
        super.init(frame: .zero, configuration: configuration)
        navigationDelegate = self
        allowsBackForwardNavigationGestures = false
        allowsLinkPreview = false
        guard let page = Bundle.module.url(forResource: "index", withExtension: "html", subdirectory: "Web") else { throw NativeEditorError.unavailable }
        bridge.attach(self, pageURL: page)
        registerForDraggedTypes([.fileURL, .png, .tiff])
        Task { @MainActor [weak self] in
            do {
                try await beforeLoad?()
                self?.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
            } catch { bridge.onError?(error) }
        }
    }
    required init?(coder: NSCoder) { fatalError("Use init(bridge:configure:)") }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { editorBridge.processTerminated() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if navigationAction.navigationType == .linkActivated {
            if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }
            return .cancel
        }
        let allowed = Bundle.module.url(forResource: "index", withExtension: "html", subdirectory: "Web")
        return url == allowed ? .allow : .cancel
    }
    override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
        guard handleDrop != nil, sender.draggingPasteboard.availableType(from: [.fileURL, .png, .tiff]) != nil else { return super.draggingEntered(sender) }
        return .copy
    }
    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        if let handleDrop, sender.draggingPasteboard.availableType(from: [.fileURL, .png, .tiff]) != nil { return handleDrop(sender.draggingPasteboard) }
        return super.performDragOperation(sender)
    }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        guard editorBridge.isReady else { return }
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        Task { try? await editorBridge.send(command: EditorCommand(name: "setAppearance", args: .object(["appearance": .string(dark ? "dark" : "light")]))) }
    }
}
