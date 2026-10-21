import AppKit

@MainActor
final class SettingsWindowController: NSWindowController {
    private let preferences: AppearancePreferences
    private let appearancePopup = NSPopUpButton(frame: .zero, pullsDown: false)

    init(preferences: AppearancePreferences) {
        self.preferences = preferences
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 360, height: 128),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Settings"
        window.isReleasedWhenClosed = false
        window.isRestorable = false
        window.tabbingMode = .disallowed
        window.center()
        super.init(window: window)

        for appearance in AppAppearance.allCases {
            appearancePopup.addItem(withTitle: appearance.title)
            appearancePopup.lastItem?.representedObject = appearance.rawValue
        }
        appearancePopup.selectItem(withTitle: preferences.selection.title)
        appearancePopup.target = self
        appearancePopup.action = #selector(changeAppearance(_:))
        appearancePopup.setAccessibilityLabel("Appearance")

        let label = NSTextField(labelWithString: "Appearance:")
        let row = NSStackView(views: [label, appearancePopup])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 16
        row.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(row)
        window.contentView = content
        NSLayoutConstraint.activate([
            row.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            row.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            appearancePopup.widthAnchor.constraint(equalToConstant: 180)
        ])
    }

    required init?(coder: NSCoder) { fatalError("Use init(preferences:)") }

    override func showWindow(_ sender: Any?) {
        appearancePopup.selectItem(withTitle: preferences.selection.title)
        super.showWindow(sender)
        window?.makeKeyAndOrderFront(sender)
    }

    @objc private func changeAppearance(_ sender: NSPopUpButton) {
        guard let value = sender.selectedItem?.representedObject as? String,
              let appearance = AppAppearance(rawValue: value) else { return }
        preferences.selection = appearance
    }
}
