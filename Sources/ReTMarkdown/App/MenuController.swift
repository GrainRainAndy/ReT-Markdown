import AppKit

@MainActor
final class MenuController: NSObject, NSMenuItemValidation {
    private var zoom = 1.0
    private var document: MarkdownDocument? { NSDocumentController.shared.currentDocument as? MarkdownDocument }
    func install() {
        let bar = NSMenu(); NSApp.mainMenu = bar
        let app = submenu("ReT Markdown", in: bar)
        item("About ReT Markdown", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), in: app)
        app.addItem(.separator())
        item("Hide ReT Markdown", #selector(NSApplication.hide(_:)), key: "h", in: app)
        item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), key: "h", modifiers: [.command, .option], in: app)
        item("Show All", #selector(NSApplication.unhideAllApplications(_:)), in: app)
        app.addItem(.separator()); item("Quit ReT Markdown", #selector(NSApplication.terminate(_:)), key: "q", in: app)
        let file = submenu("File", in: bar)
        item("New", #selector(NSDocumentController.newDocument(_:)), key: "n", in: file)
        item("Open…", #selector(NSDocumentController.openDocument(_:)), key: "o", in: file)
        file.addItem(.separator())
        item("Close", #selector(NSWindow.performClose(_:)), key: "w", in: file)
        item("Save", #selector(NSDocument.save(_:)), key: "s", in: file)
        // AppKit rewrites its standard Save As action to Duplicate for autosaving documents.
        // Own this shortcut explicitly, then enter NSDocument's public Save As lifecycle.
        let saveAs = item("Save As…", #selector(saveCurrentDocumentAs(_:)), key: "s", modifiers: [.command, .shift], in: file)
        saveAs.target = self
        item("Revert To Saved…", #selector(NSDocument.revertToSaved(_:)), in: file)
        item("Browse All Versions…", NSSelectorFromString("browseDocumentVersions:"), in: file)
        file.addItem(.separator()); item("Export as PDF…", #selector(MarkdownDocument.exportPDFDocument(_:)), key: "e", modifiers: [.command, .shift], in: file)
        let edit = submenu("Edit", in: bar)
        command("Undo", "undo", key: "z", in: edit)
        command("Redo", "redo", key: "z", modifiers: [.command, .shift], in: edit)
        edit.addItem(.separator())
        item("Cut", #selector(NSText.cut(_:)), key: "x", in: edit)
        command("Copy Markdown", "copySource", key: "c", in: edit)
        command("Copy as Plain Text", "copyPlain", key: "c", modifiers: [.command, .shift], in: edit)
        command("Copy as Rich Text", "copyRich", key: "c", modifiers: [.command, .option], in: edit)
        item("Paste", #selector(NSText.paste(_:)), key: "v", in: edit)
        item("Select All", #selector(NSText.selectAll(_:)), key: "a", in: edit)
        edit.addItem(.separator()); command("Find…", "find", key: "f", in: edit)
        command("Find Next", "find", args: .object(["backwards": .bool(false)]), key: "g", in: edit)
        command("Find Previous", "find", args: .object(["backwards": .bool(true)]), key: "g", modifiers: [.command, .shift], in: edit)
        command("Replace…", "replace", key: "f", modifiers: [.command, .option], in: edit)
        command("Replace All", "replaceAll", in: edit)
        let format = submenu("Format", in: bar)
        for level in 1...6 { command("Heading \(level)", "format", args: .object(["kind": .string("heading"), "level": .number(Double(level))]), key: String(level), in: format) }
        for (title, kind, key) in [("Bold", "bold", "b"), ("Italic", "italic", "i"), ("Strikethrough", "strike", ""), ("Inline Code", "code", "`"), ("Link", "link", "k"), ("Quote", "quote", ""), ("Bullet List", "unorderedList", ""), ("Numbered List", "orderedList", ""), ("Task List", "taskList", ""), ("Code Block", "codeBlock", ""), ("Indent List", "indent", ""), ("Outdent List", "outdent", "")] {
            command(title, "format", args: .object(["kind": .string(kind)]), key: key, in: format)
        }
        command("Insert Image…", "insertImage", in: format)
        let view = submenu("View", in: bar)
        let toggle = item("Source Mode", #selector(toggleMode(_:)), key: "/", in: view); toggle.target = self
        for (title, key, tag) in [("Zoom In", "+", 1), ("Zoom Out", "-", -1), ("Actual Size", "0", 0)] {
            let value = item(title, #selector(changeZoom(_:)), key: key, in: view); value.target = self; value.tag = tag
        }
        let window = submenu("Window", in: bar); NSApp.windowsMenu = window
        item("Minimize", #selector(NSWindow.performMiniaturize(_:)), key: "m", in: window)
        item("Zoom", #selector(NSWindow.performZoom(_:)), in: window)
        window.addItem(.separator()); item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:)), in: window)
    }
    private func submenu(_ title: String, in parent: NSMenu) -> NSMenu {
        let menu = NSMenu(title: title); let entry = NSMenuItem(title: title, action: nil, keyEquivalent: ""); entry.submenu = menu; parent.addItem(entry); return menu
    }
    @discardableResult private func item(_ title: String, _ action: Selector, key: String = "", modifiers: NSEvent.ModifierFlags = [.command], in menu: NSMenu) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key); item.keyEquivalentModifierMask = modifiers; menu.addItem(item); return item
    }
    private func command(_ title: String, _ name: String, args: NativeJSON? = nil, key: String = "", modifiers: NSEvent.ModifierFlags = [.command], in menu: NSMenu) {
        let entry = item(title, #selector(editorCommand(_:)), key: key, modifiers: modifiers, in: menu)
        entry.target = self; entry.representedObject = EditorCommand(name: name, args: args)
    }
    @objc private func editorCommand(_ sender: NSMenuItem) {
        guard let command = sender.representedObject as? EditorCommand else { return }
        execute(command)
    }
    private func execute(_ command: EditorCommand) {
        guard let document else { return }
        Task { do { try await document.bridge.send(command: command) } catch { document.presentError(error) } }
    }
    @objc private func saveCurrentDocumentAs(_ sender: Any?) {
        document?.saveAs(nil)
    }
    @objc private func toggleMode(_ sender: Any?) {
        execute(EditorCommand(name: "setMode", args: .object(["mode": .string(document?.bridge.state.mode == .source ? "live" : "source")])))
    }
    @objc private func changeZoom(_ sender: NSMenuItem) {
        zoom = sender.tag == 0 ? 1 : min(2.5, max(0.5, zoom + Double(sender.tag) * 0.1))
        execute(EditorCommand(name: "setZoom", args: .object(["zoom": .number(zoom)])))
    }
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        guard let document else { return false }
        if let command = menuItem.representedObject as? EditorCommand {
            if command.name == "undo" { return document.bridge.isReady && document.bridge.state.canUndo }
            if command.name == "redo" { return document.bridge.isReady && document.bridge.state.canRedo }
        }
        if menuItem.action == #selector(toggleMode(_:)) { menuItem.state = document.bridge.state.mode == .source ? .on : .off }
        return document.bridge.isReady
    }
}
