// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "ReTPreview", platforms: [.macOS(.v13)], products: [.executable(name: "ReTPreview", targets: ["ReTPreview"])], targets: [.executableTarget(name: "ReTPreview"), .testTarget(name: "ReTPreviewTests", dependencies: ["ReTPreview"])], swiftLanguageModes: [.v5])
