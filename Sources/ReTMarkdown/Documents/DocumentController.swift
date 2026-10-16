import AppKit

@MainActor
final class DocumentController: NSDocumentController {
    var configureDocument: ((MarkdownDocument) throws -> Void)?
    private var pendingOpens: [String: [(NSDocument?, Bool, Error?) -> Void]] = [:]
    override var defaultType: String? { MarkdownDocument.typeName }
    override func documentClass(forType typeName: String) -> AnyClass? { MarkdownDocument.self }
    override func typeForContents(of url: URL) throws -> String { MarkdownDocument.typeName }
    override func makeUntitledDocument(ofType typeName: String) throws -> NSDocument {
        let document = try super.makeUntitledDocument(ofType: typeName)
        if let markdown = document as? MarkdownDocument { try configureDocument?(markdown) }
        return document
    }
    override func makeDocument(withContentsOf url: URL, ofType typeName: String) throws -> NSDocument {
        let document = try super.makeDocument(withContentsOf: url, ofType: typeName)
        if let markdown = document as? MarkdownDocument { try configureDocument?(markdown) }
        return document
    }
    override func makeDocument(for urlOrNil: URL?, withContentsOf contentsURL: URL, ofType typeName: String) throws -> NSDocument {
        let document = try super.makeDocument(for: urlOrNil, withContentsOf: contentsURL, ofType: typeName)
        if let markdown = document as? MarkdownDocument { try configureDocument?(markdown) }
        return document
    }
    override func document(for url: URL) -> NSDocument? {
        let identity = ExternalChanges.identity(url)
        return documents.first { $0.fileURL.map { ExternalChanges.identity($0) == identity } ?? false } ?? super.document(for: url)
    }
    override func openDocument(withContentsOf url: URL, display displayDocument: Bool, completionHandler: @escaping (NSDocument?, Bool, Error?) -> Void) {
        if let existing = document(for: url) {
            if displayDocument { existing.showWindows(); existing.windowControllers.first?.window?.makeKeyAndOrderFront(nil) }
            completionHandler(existing, true, nil); return
        }
        let key = ExternalChanges.identity(url)
        if pendingOpens[key] != nil { pendingOpens[key]?.append(completionHandler); return }
        pendingOpens[key] = [completionHandler]
        super.openDocument(withContentsOf: url, display: displayDocument) { [weak self] document, alreadyOpen, error in
            guard let self else { completionHandler(document, alreadyOpen, error); return }
            let callbacks = pendingOpens.removeValue(forKey: key) ?? []
            for (index, callback) in callbacks.enumerated() { callback(document, alreadyOpen || index > 0, error) }
        }
    }
}
