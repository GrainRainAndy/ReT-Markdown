import Foundation
import WebKit

/// Exact capability matching only. Requests are never interpreted as filesystem paths or network URLs.
/// Keep this instance alive for the WebView/export lifetime; its input bytes are immutable.
@MainActor
public final class AssetSchemeHandler: NSObject, WKURLSchemeHandler {
    public static let scheme = "ret-resource"
    private var resources: [String: AssetCapability]
    public init(manifest: AssetManifest, bundledResources: [URL: AssetCapability] = [:]) {
        var resources: [String: AssetCapability] = [:]
        for capability in manifest.capabilities.values where Self.isCapabilityURL(capability.url) {
            // Revalidate even caller-created manifests. Never serve unsafe SVG or non-image payloads.
            if let image = try? AssetIO.image(capability.data), image.mime == capability.mimeType {
                resources[capability.url.absoluteString] = capability
            }
        }
        for (url, resource) in bundledResources where url.scheme == Self.scheme && url.host == "bundle" && url.query == nil && url.fragment == nil {
            resources[url.absoluteString] = resource
        }
        self.resources = resources
        super.init()
    }
    /// Live views may add newly imported/frozen capabilities. Old tokens remain valid for history.
    /// Export views simply retain their initial manifest and never call update.
    public func update(manifest: AssetManifest) {
        for capability in manifest.capabilities.values where Self.isCapabilityURL(capability.url) {
            if let image = try? AssetIO.image(capability.data), image.mime == capability.mimeType {
                resources[capability.url.absoluteString] = capability
            }
        }
    }
    public func resource(for url: URL) throws -> AssetCapability {
        guard url.scheme == Self.scheme, url.user == nil, url.password == nil, url.port == nil,
              url.query == nil, url.fragment == nil, let resource = resources[url.absoluteString] else {
            throw AssetStorageError.unauthorizedResource
        }
        return resource
    }
    /// Native builds an exact bundle allowlist once. Symlinks, traversal and unlisted files are rejected.
    public static func bundledResources(rootURL: URL, paths: [String]) throws -> [URL: AssetCapability] {
        var result: [URL: AssetCapability] = [:]
        for path in paths {
            guard !path.hasPrefix("/"), !path.split(separator: "/").contains("..") else { throw AssetStorageError.invalidPath }
            let file = rootURL.appendingPathComponent(path).standardizedFileURL
            guard file.pathComponents.starts(with: rootURL.standardizedFileURL.pathComponents) else { throw AssetStorageError.invalidPath }
            let bytes = try AssetIO.read(file)
            let url = URL(string: "ret-resource://bundle/" + path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!)!
            let mime: String
            switch file.pathExtension.lowercased() {
            case "html": mime = "text/html"
            case "js", "mjs": mime = "text/javascript"
            case "css": mime = "text/css"
            case "woff2": mime = "font/woff2"
            case "woff": mime = "font/woff"
            default: mime = try AssetIO.image(bytes).mime
            }
            result[url] = AssetCapability(url: url, data: bytes, mimeType: mime)
        }
        return result
    }
    private static func isCapabilityURL(_ url: URL) -> Bool {
        url.scheme == scheme && url.host == "asset" && url.pathComponents.count == 2 && UUID(uuidString: url.lastPathComponent) != nil &&
            url.query == nil && url.fragment == nil && url.user == nil && url.password == nil && url.port == nil
    }
    public func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        do {
            guard urlSchemeTask.request.httpMethod == nil || urlSchemeTask.request.httpMethod == "GET",
                  let url = urlSchemeTask.request.url else { throw AssetStorageError.unauthorizedResource }
            let resource = try resource(for: url)
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                "Content-Type": resource.mimeType,
                "Content-Length": String(resource.data.count),
                "Content-Security-Policy": (url.host == "bundle" ? "default-src 'none'; script-src ret-resource:; style-src ret-resource: 'unsafe-inline'; img-src ret-resource:; font-src ret-resource:; connect-src 'none'" : "default-src 'none'; style-src 'unsafe-inline'; sandbox"),
                "X-Content-Type-Options": "nosniff"
            ])!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(resource.data)
            urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(error) }
    }
    public func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) { }
}
