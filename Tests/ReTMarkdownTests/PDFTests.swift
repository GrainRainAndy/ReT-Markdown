import XCTest
import AppKit
import PDFKit
import CoreGraphics
@testable import ReTMarkdown

final class PDFTests: XCTestCase {
    private func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ret-pdf-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func pdf(_ url: URL, pages: Int = 2, width: CGFloat = 595.276) throws {
        var box = CGRect(x: 0, y: 0, width: width, height: 841.890)
        guard let context = CGContext(url as CFURL, mediaBox: &box, nil) else { throw CocoaError(.fileWriteUnknown) }
        for _ in 0..<pages { context.beginPDFPage(nil); context.setFillColor(CGColor(gray: 0, alpha: 1)); context.fill(CGRect(x: 60, y: 60, width: 20, height: 20)); context.endPDFPage() }
        context.closePDF()
    }

    @MainActor func testPrintProfileUsesA4MarginsScaleAndSilentSave() throws {
        let url = try directory().appendingPathComponent("output.pdf")
        let info = PrintProfile.makePrintInfo(savingTo: url)
        // AppKit's paper catalog rounds A4 to 595 × 842 pt on this SDK.
        XCTAssertEqual(info.paperSize.width, 595.276, accuracy: 0.5)
        XCTAssertEqual(info.paperSize.height, 841.890, accuracy: 0.5)
        for margin in [info.topMargin, info.bottomMargin, info.leftMargin, info.rightMargin] { XCTAssertEqual(margin, 56.693, accuracy: 0.001) }
        XCTAssertEqual(info.scalingFactor, 1)
        XCTAssertEqual(info.jobDisposition, .save)
        XCTAssertEqual(info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] as? URL, url)
        XCTAssertEqual(info.dictionary()[NSPrintInfo.AttributeKey.headerAndFooter] as? Bool, false)
    }

    @MainActor func testValidatedMultipagePDFAtomicallyReplacesExistingFile() async throws {
        let folder = try directory(), target = folder.appendingPathComponent("existing.pdf")
        try Data("old pdf".utf8).write(to: target)
        try await PDFOutputTransaction.write(to: target, validation: .init(minimumPages: 2)) { temporary in
            XCTAssertEqual(temporary.deletingLastPathComponent(), folder)
            XCTAssertNotEqual(temporary, target)
            XCTAssertEqual(try Data(contentsOf: target), Data("old pdf".utf8))
            try self.pdf(temporary)
        }
        XCTAssertEqual(PDFDocument(url: target)?.pageCount, 2)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path), ["existing.pdf"])
    }

    @MainActor func testFailureAndMalformedPDFPreserveOldOutputAndCleanTemporary() async throws {
        let folder = try directory(), target = folder.appendingPathComponent("existing.pdf")
        let old = Data("old pdf bytes".utf8)
        for failure in [true, false] {
            try old.write(to: target)
            do {
                try await PDFOutputTransaction.write(to: target) { temporary in
                    try Data("incomplete".utf8).write(to: temporary)
                    if failure { throw CocoaError(.fileWriteUnknown) }
                }
                XCTFail("Expected failed output")
            } catch {}
            XCTAssertEqual(try Data(contentsOf: target), old)
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path), ["existing.pdf"])
        }
    }

    @MainActor func testIncompletePageCountWrongMediaBoxAndMissingTextCannotReplaceOldOutput() async throws {
        let target = try directory().appendingPathComponent("existing.pdf")
        let old = Data("old".utf8)
        for (validation, pages, width) in [(PDFValidation(minimumPages: 3), 2, CGFloat(595.276)), (.init(), 2, CGFloat(612)), (.init(textSamples: ["final text"]), 2, CGFloat(595.276))] {
            try old.write(to: target)
            do {
                try await PDFOutputTransaction.write(to: target, validation: validation) { try self.pdf($0, pages: pages, width: width) }
                XCTFail("Expected validation failure")
            } catch {}
            XCTAssertEqual(try Data(contentsOf: target), old)
        }
    }

    @MainActor func testCancellationAfterProducerFinishesPreservesOldPDF() async throws {
        let folder = try directory(), target = folder.appendingPathComponent("existing.pdf")
        let old = Data("old".utf8)
        try old.write(to: target)
        let gate = PDFTestGate()
        let task = Task { @MainActor in
            try await PDFOutputTransaction.write(to: target) { temporary in
                try self.pdf(temporary)
                await gate.pause()
            }
        }
        while !gate.waiting { await Task.yield() }
        task.cancel(); gate.resume()
        do { try await task.value; XCTFail("Expected cancellation") } catch is CancellationError {} catch { XCTFail("\(error)") }
        XCTAssertEqual(try Data(contentsOf: target), old)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path), ["existing.pdf"])
    }

    @MainActor func testRenameFailurePreservesDestination() async throws {
        let folder = try directory(), target = folder.appendingPathComponent("existing.pdf", isDirectory: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        let marker = target.appendingPathComponent("keep")
        try Data("keep".utf8).write(to: marker)
        do { try await PDFOutputTransaction.write(to: target) { try self.pdf($0) }; XCTFail("Expected rename failure") } catch {}
        XCTAssertEqual(try Data(contentsOf: marker), Data("keep".utf8))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path), ["existing.pdf"])
    }

    @MainActor func testTruncatedPDFWithReadablePagesStillCannotReplaceOutput() async throws {
        let target = try directory().appendingPathComponent("existing.pdf")
        let old = Data("old".utf8)
        try old.write(to: target)
        do {
            try await PDFOutputTransaction.write(to: target) { temporary in
                try self.pdf(temporary)
                var bytes = try Data(contentsOf: temporary)
                guard let trailer = bytes.range(of: Data("%%EOF".utf8), options: .backwards) else { return XCTFail("Fixture has no EOF") }
                bytes.removeSubrange(trailer.lowerBound..<bytes.endIndex)
                try bytes.write(to: temporary)
            }
            XCTFail("Expected incomplete trailer rejection")
        } catch {}
        XCTAssertEqual(try Data(contentsOf: target), old)
    }

    @MainActor func testMissingExportResourcesPreserveOldPDF() async throws {
        let folder = try directory(), target = folder.appendingPathComponent("existing.pdf")
        try Data("old".utf8).write(to: target)
        do {
            try await PDFExporter(webRoot: folder).export(snapshot: Snapshot(), assets: AssetManifest(documentID: UUID(), documentURL: nil, resourceDirectoryURL: folder), to: target)
            XCTFail("Expected missing export resources")
        } catch PDFExportError.resourcesUnavailable {} catch { XCTFail("\(error)") }
        XCTAssertEqual(try Data(contentsOf: target), Data("old".utf8))
    }

    // Opt-in runs the production WKWebView / NSPrintOperation pipeline. The
    // default suite does not claim UI or native pagination proof.
    @MainActor func testRealWebKitPaginatedPrintWhenOptedIn() async throws {
        guard ProcessInfo.processInfo.environment["RET_PDF_RUNTIME"] == "1" else { throw XCTSkip("Set RET_PDF_RUNTIME=1 in a graphical macOS session after build:web") }
        _ = NSApplication.shared
        let webRoot = URL(fileURLWithPath: ProcessInfo.processInfo.environment["RET_EXPORT_WEB_ROOT"] ?? "build/web", isDirectory: true)
        let target = try directory().appendingPathComponent("runtime.pdf")
        let text = "# 中文分页\n\n" + (0..<120).map { "第\($0)段 Chinese searchable content.\n\n" }.joined() + "```swift\nlet finalCode = \"中文\"\n```\n\nFINAL_SENTINEL_中文"
        let fixtureURL = ProcessInfo.processInfo.environment["RET_PDF_FIXTURE_PATH"].map { URL(fileURLWithPath: $0) }
        let source = try fixtureURL.map { try SourceCodec.decode(Data(contentsOf: $0)) }
            ?? Source(text: text, eols: Array(repeating: "\n", count: text.filter { $0 == "\n" }.count), bom: false)
        let snapshot = Snapshot(source: source, revision: 1)
        let baseManifest = AssetManifest(documentID: UUID(), documentURL: fixtureURL,
            resourceDirectoryURL: try fixtureURL?.deletingLastPathComponent().appendingPathComponent("assets") ?? directory())
        let assets = try AssetStore.authorize(baseManifest, destinations: AssetReferences.scan(source.text).map(\.destination))
        FileHandle.standardError.write(Data("Task6 native print begins; temporary output: \(target.path)\n".utf8))
        do { try await PDFExporter(webRoot: webRoot).export(snapshot: snapshot, assets: assets, to: target) }
        catch {
            FileHandle.standardError.write(Data("Task6 error type: \(String(reflecting: type(of: error))); error: \(error)\n".utf8))
            throw error
        }
        FileHandle.standardError.write(Data("Task6 native print completed: \(target.path)\n".utf8))
        let result = try XCTUnwrap(PDFDocument(url: target))
        XCTAssertGreaterThan(result.pageCount, 1)
        let expected = fixtureURL == nil ? ["FINAL_SENTINEL_中文", "finalCode", "\"中文\"", "中文分页"]
            : ["PDF 分页验收", "searchable code 中文", "long-code-long-code-"]
        for text in expected {
            XCTAssertTrue(result.string?.contains(text) == true, "Missing literal extracted text: \(text)")
            XCTAssertFalse(result.findString(text, withOptions: []).isEmpty, "Missing literal PDF search: \(text)")
        }
        for index in 0..<result.pageCount { let box = try XCTUnwrap(result.page(at: index)).bounds(for: .mediaBox); XCTAssertEqual(box.width, 595.276, accuracy: 0.5); XCTAssertEqual(box.height, 841.890, accuracy: 0.5) }
        if let path = ProcessInfo.processInfo.environment["RET_PDF_PROOF_PATH"] { try Data(contentsOf: target).write(to: URL(fileURLWithPath: path), options: .atomic) }
    }
}

@MainActor private final class PDFTestGate {
    var waiting = false
    private var continuation: CheckedContinuation<Void, Never>?
    func pause() async { await withCheckedContinuation { continuation = $0; waiting = true } }
    func resume() { continuation?.resume(); continuation = nil }
}
