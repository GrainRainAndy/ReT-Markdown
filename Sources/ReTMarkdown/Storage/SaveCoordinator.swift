import Foundation

// Requests are immutable byte snapshots. Resource staging is performed before submission.
enum SaveOperation: Sendable { case save, saveAs, autosave }
struct SaveRequest: Sendable {
    let snapshot: Snapshot
    let bytes: Data
    let destination: URL
    let operation: SaveOperation
    let expectedDisk: DiskFingerprint?
    let resourceMigrationID: UUID?
    init(snapshot: Snapshot, destination: URL, operation: SaveOperation = .save,
         expectedDisk: DiskFingerprint? = nil, resourceMigrationID: UUID? = nil) throws {
        guard (0...9_007_199_254_740_991).contains(snapshot.revision) else { throw NativeEditorError.invalidMessage }
        self.snapshot = snapshot
        self.bytes = try SourceCodec.encode(snapshot.source)
        self.destination = destination
        self.operation = operation
        self.expectedDisk = expectedDisk
        self.resourceMigrationID = resourceMigrationID
    }
}
struct SaveReceipt: Sendable {
    let revision: Revision
    let contentHash: String
    let destination: URL
}

@MainActor
final class SaveCoordinator {
    typealias Writer = @MainActor (SaveRequest) async throws -> Void
    private let writer: Writer
    private var tail: Task<Void, Never>?
    private var highestWrittenRevision: Revision = -1
    init(writer: @escaping Writer) { self.writer = writer }

    /// NSDocument autosave must start its captured write inline in the existing native file-access block.
    /// MarkdownDocument's saveTail serializes that path with save(_:); these shared checks retain ordering.
    func validateCapturedRequest(_ request: SaveRequest) throws {
        guard request.snapshot.revision >= highestWrittenRevision else { throw NativeEditorError.staleSnapshot }
    }
    func receiptForCompletedWrite(_ request: SaveRequest) -> SaveReceipt {
        highestWrittenRevision = request.snapshot.revision
        return SaveReceipt(revision: request.snapshot.revision, contentHash: contentHash(request.bytes), destination: request.destination)
    }
    func save(_ request: SaveRequest) async throws -> SaveReceipt {
        let previous = tail
        let work = Task { @MainActor in
            await previous?.value
            try Task.checkCancellation()
            try self.validateCapturedRequest(request)
            try await self.writer(request)
            return self.receiptForCompletedWrite(request)
        }
        tail = Task { _ = try? await work.value }
        return try await withTaskCancellationHandler { try await work.value } onCancel: { work.cancel() }
    }
}
