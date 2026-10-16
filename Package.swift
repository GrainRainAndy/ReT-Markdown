// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ReTMarkdown",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "ReTMarkdown", targets: ["ReTMarkdown"])],
    targets: [
        .executableTarget(name: "ReTMarkdown", resources: [.copy("Resources/Web")]),
        .testTarget(name: "ReTMarkdownTests", dependencies: ["ReTMarkdown"])
    ]
)
