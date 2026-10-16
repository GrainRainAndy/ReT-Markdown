import AppKit

@MainActor
final class DocumentWindowController: NSWindowController {
    private weak var markdownDocument: MarkdownDocument?
    init(document: MarkdownDocument) throws {
        markdownDocument = document
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 940, height: 740), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 420, height: 320)
        window.isRestorable = true
        window.setFrameAutosaveName("ReT.DocumentWindow")
        window.center()
        super.init(window: window)
        try reloadEditor()
    }
    required init?(coder: NSCoder) { fatalError("Use init(document:)") }
    func reloadEditor() throws {
        guard let document = markdownDocument else { return }
        Task { @MainActor [weak self, weak document] in
            do {
                guard let self, let document else { return }
                try await document.prepareEditorLoad()
                let view = try EditorWebView(bridge: document.bridge, configure: document.configureWebView)
                view.handleDrop = document.handleDrop
                window?.contentView = view
                window?.makeFirstResponder(view)
            } catch { document?.presentError(error) }
        }
    }
}
