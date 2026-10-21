import AppKit
import WebKit
import XCTest
@testable import ReTMarkdown

final class AppearanceTests: XCTestCase {
    private func defaults() throws -> UserDefaults {
        let suite = "ReTMarkdown.AppearanceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        addTeardownBlock { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }
        return defaults
    }

    @MainActor func testMissingAndInvalidPreferencesRemoveNativeOverride() throws {
        let application = NSApplication.shared
        let previous = application.appearance
        defer { application.appearance = previous }
        let defaults = try defaults()
        for value: Any? in [nil, "unknown", true] {
            defaults.set(value, forKey: "ReT.Appearance")
            application.appearance = NSAppearance(named: .darkAqua)
            let preferences = AppearancePreferences(defaults: defaults)
            preferences.apply()
            XCTAssertEqual(preferences.selection, .system)
            XCTAssertNil(application.appearance)
        }
    }

    @MainActor func testOverridePersistsAcrossInstancesAndSystemReturnsToInheritance() throws {
        let application = NSApplication.shared
        let previous = application.appearance
        defer { application.appearance = previous }
        let defaults = try defaults()
        let preferences = AppearancePreferences(defaults: defaults)
        preferences.selection = .dark
        XCTAssertEqual(application.appearance?.name, .darkAqua)
        application.appearance = nil
        let restored = AppearancePreferences(defaults: defaults)
        restored.apply()
        XCTAssertEqual(restored.selection, .dark)
        XCTAssertEqual(application.appearance?.name, .darkAqua)
        restored.selection = .light
        XCTAssertEqual(application.appearance?.name, .aqua)
        XCTAssertEqual(AppearancePreferences(defaults: defaults).selection, .light)
        restored.selection = .system
        XCTAssertNil(application.appearance)
        XCTAssertEqual(AppearancePreferences(defaults: defaults).selection, .system)
    }

    @MainActor func testLaunchRestoresAppearanceBeforeAnyWindowIsCreated() throws {
        let application = NSApplication.shared
        let previous = application.appearance
        let previousMenu = application.mainMenu
        let previousWindowsMenu = application.windowsMenu
        let previousTabbing = NSWindow.allowsAutomaticWindowTabbing
        defer {
            application.appearance = previous
            application.mainMenu = previousMenu
            application.windowsMenu = previousWindowsMenu
            NSWindow.allowsAutomaticWindowTabbing = previousTabbing
        }
        let defaults = try defaults()
        defaults.set("dark", forKey: "ReT.Appearance")
        let delegate = AppDelegate(appearancePreferences: AppearancePreferences(defaults: defaults))
        let windows = Set(application.windows.map(ObjectIdentifier.init))
        delegate.applicationWillFinishLaunching(Notification(name: NSApplication.willFinishLaunchingNotification))
        XCTAssertEqual(application.appearance?.name, .darkAqua)
        XCTAssertEqual(Set(application.windows.map(ObjectIdentifier.init)), windows)
    }

    @MainActor func testSettingsPopupRestoresSelectionAndAppliesChangesWithoutADocument() throws {
        let application = NSApplication.shared
        let previous = application.appearance
        defer { application.appearance = previous }
        let defaults = try defaults()
        defaults.set("dark", forKey: "ReT.Appearance")
        let preferences = AppearancePreferences(defaults: defaults)
        let documents = NSDocumentController.shared.documents.count
        let settings = SettingsWindowController(preferences: preferences)
        let window = try XCTUnwrap(settings.window)
        defer { window.close() }
        let popup = try XCTUnwrap(findPopup(in: try XCTUnwrap(window.contentView)))
        XCTAssertEqual(popup.titleOfSelectedItem, "Dark")
        XCTAssertNil(settings.document)
        XCTAssertEqual(NSDocumentController.shared.documents.count, documents)
        for (title, expected) in [("Light", NSAppearance.Name.aqua), ("Dark", .darkAqua)] {
            popup.selectItem(withTitle: title)
            XCTAssertTrue(application.sendAction(try XCTUnwrap(popup.action), to: popup.target, from: popup))
            XCTAssertEqual(application.appearance?.name, expected)
        }
        popup.selectItem(withTitle: "System")
        XCTAssertTrue(application.sendAction(try XCTUnwrap(popup.action), to: popup.target, from: popup))
        XCTAssertNil(application.appearance)
        XCTAssertEqual(AppearancePreferences(defaults: defaults).selection, .system)
        window.close()
        XCTAssertTrue(settings.window === window, "Closing Settings must retain the reusable window")
    }

    @MainActor func testSettingsShortcutRemainsAvailableWithoutADocument() throws {
        let application = NSApplication.shared
        let previousMenu = application.mainMenu
        let previousWindowsMenu = application.windowsMenu
        defer {
            application.mainMenu = previousMenu
            application.windowsMenu = previousWindowsMenu
        }
        let menus = MenuController()
        menus.install()
        let appMenu = try XCTUnwrap(application.mainMenu?.items.first?.submenu)
        let settings = try XCTUnwrap(appMenu.items.first { $0.title == "Settings…" })
        XCTAssertNil(NSDocumentController.shared.currentDocument)
        XCTAssertEqual(settings.keyEquivalent, ",")
        XCTAssertEqual(settings.keyEquivalentModifierMask, [.command])
        XCTAssertTrue(settings.target === menus)
        XCTAssertTrue(menus.validateMenuItem(settings))
        appMenu.update()
        XCTAssertTrue(settings.isEnabled)
    }

    @MainActor func testRealEditorInheritsStartupAndLiveAppearanceWithoutChangingSourceOrHistory() async throws {
        let application = NSApplication.shared
        let previous = application.appearance
        defer { application.appearance = previous }
        let preferences = AppearancePreferences(defaults: try defaults())
        preferences.selection = .dark
        let bytes = Data([0xEF, 0xBB, 0xBF]) + Data("# Appearance\r\n\nunchanged\r\n".utf8)
        let snapshot = Snapshot(source: try SourceCodec.decode(bytes), revision: 7)
        let mirror = try CommittedMirror(snapshot: snapshot, documentID: UUID().uuidString, sessionID: UUID().uuidString)
        let bridge = EditorBridge(mirror: mirror)
        let view = try EditorWebView(bridge: bridge)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 500),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = view
        defer {
            view.stopLoading()
            view.configuration.userContentController.removeScriptMessageHandler(forName: "ret")
            window.contentView = nil
            window.close()
        }
        let readyDeadline = ContinuousClock.now.advanced(by: .seconds(10))
        while !bridge.isReady && ContinuousClock.now < readyDeadline { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertTrue(bridge.isReady, "Existing bundled editor must load without rebuilding shared resources")
        guard bridge.isReady else { return }
        try await assertAppearance("dark", in: view)
        XCTAssertFalse(mirror.isDirty)
        XCTAssertEqual(try SourceCodec.encode(mirror.snapshot.source), bytes)
        try await bridge.applyPatches(base: 7, patches: [Patch(from: snapshot.text.utf16.count,
            to: snapshot.text.utf16.count, insert: "\nedit", eols: ["\n"])])
        let edited = try await bridge.snapshot(purpose: .save)
        let editedBytes = bytes + Data("\nedit".utf8)
        XCTAssertEqual(try SourceCodec.encode(edited.source), editedBytes)
        XCTAssertTrue(bridge.state.canUndo, "The appearance check must preserve an actual existing undo entry")
        let state = bridge.state
        for (selection, expected) in [(AppAppearance.light, "light"), (.dark, "dark")] {
            preferences.selection = selection
            try await assertAppearance(expected, in: view)
            XCTAssertEqual(window.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]), expected == "dark" ? .darkAqua : .aqua)
            let captured = try await bridge.snapshot(purpose: .save)
            XCTAssertEqual(try SourceCodec.encode(captured.source), editedBytes)
            XCTAssertEqual(captured.revision, edited.revision)
            XCTAssertTrue(mirror.isDirty)
            XCTAssertEqual(bridge.state.canUndo, state.canUndo)
            XCTAssertEqual(bridge.state.canRedo, state.canRedo)
            XCTAssertEqual(bridge.state.selection, state.selection)
        }
        preferences.selection = .system
        XCTAssertNil(application.appearance)
        let expected = window.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? "dark" : "light"
        try await assertAppearance(expected, in: view)
        XCTAssertTrue(bridge.state.canUndo)
        try await bridge.send(command: EditorCommand(name: "undo"))
        let undone = try await bridge.snapshot(purpose: .save)
        XCTAssertEqual(try SourceCodec.encode(undone.source), bytes, "One undo must reach the real edit across appearance changes")
        XCTAssertFalse(mirror.isDirty)
        XCTAssertFalse(bridge.state.canUndo)
        XCTAssertTrue(bridge.state.canRedo)
    }

    @MainActor private func findPopup(in view: NSView) -> NSPopUpButton? {
        if let popup = view as? NSPopUpButton { return popup }
        return view.subviews.lazy.compactMap { self.findPopup(in: $0) }.first
    }

    @MainActor private func assertAppearance(_ expected: String, in view: WKWebView,
        file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        var actual: [String] = []
        let background = expected == "dark" ? "rgb(30, 30, 30)" : "rgb(255, 255, 255)"
        let expectedValues = [expected, expected, background, background]
        repeat {
            actual = try await view.evaluateJavaScript("[matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', getComputedStyle(document.querySelector('.cm-editor')).colorScheme, getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.cm-editor')).backgroundColor]") as? [String] ?? []
            if actual == expectedValues { return }
            try await Task.sleep(for: .milliseconds(20))
        } while ContinuousClock.now < deadline
        XCTAssertEqual(actual, expectedValues, "WKWebView media query, theme and visible canvas must follow the native appearance", file: file, line: line)
    }
}
