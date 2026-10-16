import AppKit
import WebKit
import PDFKit
import Darwin

struct PDFRenderIssue: Codable, Sendable, Equatable {
    let kind: String
    let message: String
    let from: Int
    let to: Int
}

struct PDFExportReady: Codable, Sendable {
    let revision: Int
    let issues: [PDFRenderIssue]
    let overflow: [SourceRange]
    let ready: Bool
    let failure: String?

    var firstBlockingRange: SourceRange? {
        issues.first.map { SourceRange(from: $0.from, to: $0.to) } ?? overflow.first
    }
}

enum PDFExportError: Error, LocalizedError {
    case resourcesUnavailable
    case busy
    case loadFailed(String)
    case notReady(PDFExportReady)
    case invalidResult
    case printFailed
    case invalidPDF(String)

    var errorDescription: String? {
        switch self {
        case .resourcesUnavailable: "The offline PDF export resources are unavailable."
        case .busy: "A PDF export is already running."
        case .loadFailed(let message): "The PDF export page could not load: \(message)"
        case .notReady(let result): result.failure ?? result.issues.first?.message ?? "Content exceeds the printable page."
        case .invalidResult: "The export page returned an invalid readiness result."
        case .printFailed: "The print operation failed or was cancelled."
        case .invalidPDF(let message): "The PDF did not pass validation: \(message)"
        }
    }
}

struct PDFValidation: Codable, Sendable {
    var minimumPages: Int = 1
    var textSamples: [String] = []

    func validate(_ url: URL) throws {
        // Read completed bytes, rather than allowing PDFKit to lazily reopen a
        // path after it has been renamed. No destination mutation precedes this.
        let data = try Data(contentsOf: url)
        let trailer = String(decoding: data.suffix(1024), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard data.starts(with: Data("%PDF-".utf8)),
              trailer.hasSuffix("%%EOF"),
              let document = PDFDocument(data: data), !document.isLocked,
              document.pageCount >= max(1, minimumPages) else {
            throw PDFExportError.invalidPDF("Missing or incomplete pages")
        }
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index) else { throw PDFExportError.invalidPDF("Unreadable page \(index + 1)") }
            let box = page.bounds(for: .mediaBox)
            guard box.width.isFinite, box.height.isFinite,
                  abs(box.width - 595.276) <= 0.5, abs(box.height - 841.890) <= 0.5 else {
                throw PDFExportError.invalidPDF("Page \(index + 1) is not A4 portrait")
            }
        }
        func compact(_ text: String) -> String {
            String(text.unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) })
        }
        let extracted = compact(document.string ?? "")
        for sample in textSamples where !compact(sample).isEmpty {
            guard extracted.contains(compact(sample)) else { throw PDFExportError.invalidPDF("Missing expected document text") }
        }
    }
}

/// Producer failures, validation failures and cancellation remove only the
/// temporary sibling. POSIX rename is one atomic replacement on this volume,
/// and does not delete the old output first (including on replacement failure).
@MainActor enum PDFOutputTransaction {
    static func write(
        to destination: URL, validation: PDFValidation = PDFValidation(),
        produce: @MainActor (URL) async throws -> Void
    ) async throws {
        try Task.checkCancellation()
        guard destination.isFileURL else { throw CocoaError(.fileWriteUnsupportedScheme) }
        let temporary = destination.deletingLastPathComponent()
            .appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString).pdf")
        let descriptor = temporary.withUnsafeFileSystemRepresentation { path in
            path.map { Darwin.open($0, O_CREAT | O_EXCL | O_WRONLY, S_IRUSR | S_IWUSR) } ?? -1
        }
        guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        Darwin.close(descriptor)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try await produce(temporary)
        try Task.checkCancellation()
        try validation.validate(temporary)
        let handle = try FileHandle(forWritingTo: temporary)
        do { try handle.synchronize(); try handle.close() }
        catch { try? handle.close(); throw error }
        // There is no suspension between this cancellation check and rename.
        // Cancellation after this commit point cannot roll a completed PDF back.
        try Task.checkCancellation()
        let status = temporary.withUnsafeFileSystemRepresentation { source in
            destination.withUnsafeFileSystemRepresentation { target in
                guard let source, let target else { errno = EINVAL; return Int32(-1) }
                return Darwin.rename(source, target)
            }
        }
        guard status == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    }
}

@MainActor final class PDFExporter {
    // NSPrintOperation is process-global; prevent overlapping modal print jobs
    // even if two document windows each have their own exporter instance.
    private static var exporting = false
    private let webRoot: URL?

    init(webRoot: URL? = nil) { self.webRoot = webRoot }

    /// Install from DocumentController.configureDocument, after Task 5 has
    /// attached its store. The factory authorizes every image in this snapshot,
    /// including existing relative/reference images, and returns frozen bytes.
    static func install(
        on document: MarkdownDocument,
        manifest: @escaping @MainActor (Snapshot) async throws -> AssetManifest,
        webRoot: URL? = nil
    ) {
        let exporter = PDFExporter(webRoot: webRoot)
        document.exportPDF = { [weak document] snapshot, destination in
            let assets = try await manifest(snapshot)
            do { try await exporter.export(snapshot: snapshot, assets: assets, to: destination) }
            catch PDFExportError.notReady(let result) {
                // Never reveal an old snapshot's offsets in newer live text.
                if let document, document.mirror.snapshot.revision == result.revision,
                   let range = result.firstBlockingRange {
                    try? await document.bridge.send(command: EditorCommand(name: "revealRange", args: .object([
                        "from": .number(Double(range.from)), "to": .number(Double(range.to))
                    ])))
                }
                throw PDFExportError.notReady(result)
            }
        }
    }

    func export(snapshot: Snapshot, assets: AssetManifest, to destination: URL) async throws {
        try Task.checkCancellation()
        guard !Self.exporting else { throw PDFExportError.busy }
        Self.exporting = true
        defer { Self.exporting = false }
        // Value copies retain this committed revision and immutable capability
        // bytes for the entire job while the live editor continues changing.
        let frozenSnapshot = snapshot
        let frozenAssets = assets
        _ = try SourceCodec.encode(frozenSnapshot.source)
        guard frozenSnapshot.revision >= 0, frozenSnapshot.revision <= 9_007_199_254_740_991,
              frozenAssets.capabilities.values.allSatisfy({ $0.url.scheme == "ret-resource" }) else {
            throw PDFExportError.invalidResult
        }
        guard let root = webRoot ?? Bundle.module.url(forResource: "Web", withExtension: nil),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("export.html").path),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("export.js").path) else {
            throw PDFExportError.resourcesUnavailable
        }
        let job = PDFWebViewJob(manifest: frozenAssets)
        defer { job.finish() }
        do { try await job.load(root: root) }
        catch { try Task.checkCancellation(); throw PDFExportError.loadFailed("Navigation: \(error)") }
        try Task.checkCancellation()
        let encoded = try JSONEncoder().encode(frozenSnapshot)
        let input = try JSONSerialization.jsonObject(with: encoded)
        let value: Any?
        do {
            value = try await job.webView.callAsyncJavaScript(
                "return await window.retExport.prepareExport(snapshot, assets);",
                arguments: ["snapshot": input, "assets": frozenAssets.capabilityMap],
                in: nil, contentWorld: .page
            )
        } catch { try Task.checkCancellation(); throw PDFExportError.loadFailed("Readiness evaluation: \(error)") }
        try Task.checkCancellation()
        let ready: PDFExportReady = try decodeResult(value)
        guard ready.revision == frozenSnapshot.revision else { throw PDFExportError.invalidResult }
        guard ready.ready, ready.issues.isEmpty, ready.overflow.isEmpty, ready.failure == nil else {
            throw PDFExportError.notReady(ready)
        }
        let validationValue: Any?
        do {
            validationValue = try await job.webView.callAsyncJavaScript(
                "return window.retExport.validation();", arguments: [:], in: nil, contentWorld: .page
            )
        } catch { try Task.checkCancellation(); throw PDFExportError.loadFailed("Completeness evaluation: \(error)") }
        try Task.checkCancellation()
        let validation: PDFValidation = try decodeResult(validationValue)
        try await PDFOutputTransaction.write(to: destination, validation: validation) { temporary in
            try Task.checkCancellation()
            try await job.print(to: temporary)
            try Task.checkCancellation()
        }
    }

    private func decodeResult<T: Decodable>(_ value: Any?) throws -> T {
        guard let value, JSONSerialization.isValidJSONObject(value) else { throw PDFExportError.invalidResult }
        return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value))
    }
}

/// This retained job has no editor bridge, bootstrap identity or live DOM. Its
/// scheme handler can serve only the frozen manifest, not fresh filesystem data.
@MainActor private final class PDFWebViewJob: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    private let printWindow: NSWindow
    private var continuation: CheckedContinuation<Void, Error>?
    private var printContinuation: CheckedContinuation<Bool, Never>?
    private var printOperation: NSPrintOperation?
    private var timeout: Task<Void, Never>?
    private var entry: URL?

    init(manifest: AssetManifest) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(AssetSchemeHandler(manifest: manifest), forURLScheme: "ret-resource")
        let width = (PrintProfile.paperSize.width - 2 * PrintProfile.margin) * 96 / 72
        let height = (PrintProfile.paperSize.height - 2 * PrintProfile.margin) * 96 / 72
        let frame = NSRect(x: 0, y: 0, width: width, height: height)
        webView = WKWebView(frame: frame, configuration: configuration)
        printWindow = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: true)
        printWindow.isReleasedWhenClosed = false
        printWindow.contentView = webView
        super.init()
        webView.navigationDelegate = self
    }

    func print(to temporary: URL) async throws {
        try Task.checkCancellation()
        let operation = webView.printOperation(with: PrintProfile.makePrintInfo(savingTo: temporary))
        operation.showsPrintPanel = false
        operation.showsProgressPanel = false
        // WKPrintingView's main-thread pagination path is for preview: before
        // asynchronous page rects arrive it returns NSIntegerMax. Synchronous
        // run() would enumerate that range without processing the reply.
        // AppKit must spawn its printing thread while MainActor services WebKit.
        operation.canSpawnSeparateThread = true
        printOperation = operation
        let success = await withCheckedContinuation { continuation in
            printContinuation = continuation
            operation.runModal(for: printWindow, delegate: self,
                didRun: #selector(printOperationDidRun(_:success:contextInfo:)), contextInfo: nil)
        }
        printOperation = nil
        try Task.checkCancellation()
        guard success else { throw PDFExportError.printFailed }
    }

    @objc nonisolated private func printOperationDidRun(
        _ operation: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?
    ) {
        // AppKit may deliver this delegate on its printing thread.
        Task { @MainActor in
            let pending = self.printContinuation
            self.printContinuation = nil
            pending?.resume(returning: success)
        }
    }

    func load(root: URL) async throws {
        // Foundation standardizes /private/tmp to /tmp. Both URLs must use
        // the same canonical spelling or WebKit rejects the main resource as
        // being outside the directory granted by allowingReadAccessTo.
        let readableRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        entry = readableRoot.appendingPathComponent("export.html").standardizedFileURL
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            try await withCheckedThrowingContinuation { continuation = $0
                timeout = Task { @MainActor [weak self] in
                    do { try await Task.sleep(for: .seconds(15)) } catch { return }
                    self?.resolve(.failure(PDFExportError.loadFailed("Timed out")))
                    self?.webView.stopLoading()
                }
                webView.loadFileURL(entry!, allowingReadAccessTo: readableRoot)
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                self?.resolve(.failure(CancellationError()))
                self?.webView.stopLoading()
            }
        }
    }

    func finish() {
        resolve(.failure(CancellationError()))
        webView.stopLoading()
        webView.navigationDelegate = nil
        printWindow.close()
    }

    private func resolve(_ result: Result<Void, Error>) {
        timeout?.cancel(); timeout = nil
        let pending = continuation; continuation = nil
        pending?.resume(with: result)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { resolve(.success(())) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { resolve(.failure(error)) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { resolve(.failure(error)) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { resolve(.failure(PDFExportError.loadFailed("Web content process terminated"))) }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        action.targetFrame?.isMainFrame == true && action.request.url?.standardizedFileURL == entry ? .allow : .cancel
    }
}
