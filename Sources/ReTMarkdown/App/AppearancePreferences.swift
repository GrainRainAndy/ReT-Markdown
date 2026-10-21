import AppKit

enum AppAppearance: String, CaseIterable {
    case system, light, dark

    var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
}

@MainActor
final class AppearancePreferences {
    private let defaults: UserDefaults
    private static let key = "ReT.Appearance"

    var selection: AppAppearance {
        didSet {
            defaults.set(selection.rawValue, forKey: Self.key)
            apply()
        }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        selection = defaults.string(forKey: Self.key).flatMap(AppAppearance.init(rawValue:)) ?? .system
    }

    func apply() {
        switch selection {
        case .system: NSApplication.shared.appearance = nil
        case .light: NSApplication.shared.appearance = NSAppearance(named: .aqua)
        case .dark: NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
        }
    }
}
