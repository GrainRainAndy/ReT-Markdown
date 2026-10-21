import XCTest
@testable import ReTMarkdown

/// Suspend the real bridge at its external transport boundary, without a timer or WebKit UI.
@MainActor
private final class CloseACKGate {
    let entered = XCTestExpectation(description: "ACK entered transport")
    let finished = XCTestExpectation(description: "ACK transport finished")
    private var continuation: CheckedContinuation<Void, Error>?
    private(set) var completed = false

    func wait() async throws {
        defer { finished.fulfill() }
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            entered.fulfill()
        }
        completed = true
    }

    func release(_ result: Result<Void, Error> = .success(())) {
        let pending = continuation
        continuation = nil
        pending?.resume(with: result)
    }
}

@MainActor
private final class CloseBridgeFixture {
    let bytes = Data([0xEF, 0xBB, 0xBF] + Array("```swift\r\nlet x = 1\n```\r".utf8))
    let gate = CloseACKGate()
    let mirror: CommittedMirror
    let bridge: EditorBridge
    var errors: [Error] = []
    init(rejectACK: Bool = false, malformedACK: String? = nil) throws {
        let snapshot = Snapshot(source: try SourceCodec.decode(bytes), revision: 2)
        mirror = try CommittedMirror(snapshot: snapshot, documentID: "doc", sessionID: "session")
        let gate = gate
        // Transport is the only substitute: snapshot reconciliation, ACK construction,
        // request sequencing, error propagation and process termination are production code.
        bridge = EditorBridge(mirror: mirror) { request in
            let type: BridgeMessageType
            let payload: NativeJSON
            switch request.type {
            case .load:
                type = .loaded
                payload = .object(["revision": .number(2)])
            case .barrier:
                type = .snapshot
                payload = .object(["snapshot": try .encoded(snapshot),
                    "selection": try .encoded(Selection()), "composing": .bool(false)])
            case .ack:
                XCTAssertEqual(request.documentID, "doc")
                XCTAssertEqual(request.sessionID, "session")
                XCTAssertEqual(request.replyTo, "snapshot-or-commit")
                struct ACK: Decodable { let revision: Int }
                XCTAssertEqual(try request.payload.decoded(ACK.self).revision, 2)
                try await gate.wait()
                if malformedACK == "nil" { return nil }
                type = malformedACK == "snapshot" ? .snapshot : (rejectACK ? .error : .result)
                if malformedACK == "negative" { payload = .object(["ok": .bool(false)]) }
                else if malformedACK == "missing-ok" { payload = .object([:]) }
                else if malformedACK == "string-ok" { payload = .object(["ok": .string("true")]) }
                else { payload = rejectACK ? .object(["message": .string("ACK rejected")]) : .object(["ok": .bool(true)]) }
            default:
                throw NativeEditorError.invalidMessage
            }
            return EditorBridge.Envelope(documentID: "doc", sessionID: "session", id: "snapshot-or-commit",
                replyTo: request.id, type: type, payload: payload)
        }
        bridge.onError = { [weak self] in self?.errors.append($0) }
    }

    func ready() async throws {
        try bridge.receive(EditorBridge.Envelope(documentID: "doc", sessionID: "session", id: "ready",
            type: .ready, payload: .object([:])))
        for _ in 0..<10_000 where !bridge.isReady { await Task.yield() }
        guard bridge.isReady else { throw NativeEditorError.unavailable }
    }
}

final class BridgeCloseBarrierTests: XCTestCase {
    @MainActor func testCloseWaitsForACKCompletionBeforeAllowingTeardown() async throws {
        let fixture = try CloseBridgeFixture()
        try await fixture.ready()
        var returned = false
        let close = Task { @MainActor in
            let snapshot = try await fixture.bridge.snapshot(purpose: .close)
            returned = true
            XCTAssertTrue(fixture.gate.completed, "Close must not allow teardown before ACK transport completes")
            return snapshot
        }
        await fulfillment(of: [fixture.gate.entered], timeout: 2)
        XCTAssertFalse(returned, "Close returned while its ACK was still gated")
        fixture.gate.release()
        let captured = try await close.value
        XCTAssertEqual(try SourceCodec.encode(captured.source), fixture.bytes)
        XCTAssertFalse(fixture.mirror.isDirty)
        XCTAssertTrue(fixture.errors.isEmpty)
    }

    @MainActor func testCloseACKTransportFailurePreventsCloseAndRetainsBytes() async throws {
        let fixture = try CloseBridgeFixture()
        try await fixture.ready()
        let close = Task { try await fixture.bridge.snapshot(purpose: .close) }
        await fulfillment(of: [fixture.gate.entered], timeout: 2)
        fixture.gate.release(.failure(NativeEditorError.processLost))
        do {
            _ = try await close.value
            XCTFail("Failed ACK must prevent the caller from proceeding with close")
        } catch {
            guard case NativeEditorError.processLost = error else { return XCTFail("Unexpected error: \(error)") }
        }
        XCTAssertEqual(try SourceCodec.encode(fixture.mirror.snapshot.source), fixture.bytes)
        XCTAssertTrue(fixture.errors.isEmpty, "Close owns the failure; no detached late alert")
    }

    @MainActor func testCloseACKRejectionPreventsClose() async throws {
        let fixture = try CloseBridgeFixture(rejectACK: true)
        try await fixture.ready()
        let close = Task { try await fixture.bridge.snapshot(purpose: .close) }
        await fulfillment(of: [fixture.gate.entered], timeout: 2)
        fixture.gate.release()
        do {
            _ = try await close.value
            XCTFail("Editor rejection of the ACK must prevent close")
        } catch {
            guard case NativeEditorError.commandFailed = error else { return XCTFail("Unexpected error: \(error)") }
        }
    }

    @MainActor func testCloseRequiresTypedPositiveACKResult() async throws {
        for invalid in ["nil", "negative", "snapshot", "missing-ok", "string-ok"] {
            let fixture = try CloseBridgeFixture(malformedACK: invalid)
            try await fixture.ready()
            let close = Task { try await fixture.bridge.snapshot(purpose: .close) }
            await fulfillment(of: [fixture.gate.entered], timeout: 2)
            fixture.gate.release()
            do {
                _ = try await close.value
                XCTFail("Close accepted invalid ACK result: \(invalid)")
            } catch { /* All malformed or negative replies must veto teardown. */ }
            XCTAssertEqual(try SourceCodec.encode(fixture.mirror.snapshot.source), fixture.bytes)
            XCTAssertTrue(fixture.errors.isEmpty)
        }
    }

    @MainActor func testSaveSnapshotStillReturnsWhileACKIsPending() async throws {
        try await checkNonCloseSnapshot(.save)
    }

    @MainActor func testExportSnapshotStillReturnsWhileACKIsPending() async throws {
        try await checkNonCloseSnapshot(.export)
    }

    @MainActor private func checkNonCloseSnapshot(_ purpose: SnapshotPurpose) async throws {
        let fixture = try CloseBridgeFixture()
        try await fixture.ready()
        let captured = try await fixture.bridge.snapshot(purpose: purpose)
        await fulfillment(of: [fixture.gate.entered], timeout: 2)
        XCTAssertFalse(fixture.gate.completed)
        XCTAssertEqual(try SourceCodec.encode(captured.source), fixture.bytes)
        fixture.gate.release()
        await fulfillment(of: [fixture.gate.finished], timeout: 2)
        XCTAssertTrue(fixture.errors.isEmpty)
    }

    @MainActor func testCommitACKRemainsAsynchronousAndReportsTransportFailure() async throws {
        let gate = CloseACKGate()
        var errors: [Error] = []
        let errorReported = expectation(description: "Commit ACK failure reported")
        let mirror = try CommittedMirror(snapshot: sampleSnapshot("saved", revision: 1), documentID: "doc", sessionID: "session")
        let bridge = EditorBridge(mirror: mirror) { request in
            XCTAssertEqual(request.type, .ack)
            XCTAssertEqual(request.replyTo, "commit")
            struct ACK: Decodable { let revision: Int }
            XCTAssertEqual(try request.payload.decoded(ACK.self).revision, 2)
            try await gate.wait()
            return nil
        }
        bridge.onError = { error in
            errors.append(error)
            errorReported.fulfill()
        }
        try bridge.receive(EditorBridge.Envelope(documentID: "doc", sessionID: "session", id: "commit",
            type: .commit, payload: try .encoded(sampleCommit(base: 1, revision: 2, insert: "new"))))
        XCTAssertEqual(mirror.snapshot.text, "newsaved")
        await fulfillment(of: [gate.entered], timeout: 2)
        XCTAssertFalse(gate.completed)
        gate.release(.failure(NativeEditorError.processLost))
        await fulfillment(of: [errorReported], timeout: 2)
        XCTAssertEqual(errors.count, 1)
        guard let error = errors.first, case NativeEditorError.processLost = error else { return XCTFail("Missing transport error") }
    }

    @MainActor func testProcessTerminationDuringCloseStillFailsAndPreservesRecoverySnapshot() async throws {
        let fixture = try CloseBridgeFixture()
        try await fixture.ready()
        let close = Task { try await fixture.bridge.snapshot(purpose: .close) }
        await fulfillment(of: [fixture.gate.entered], timeout: 2)
        fixture.bridge.processTerminated()
        XCTAssertFalse(fixture.bridge.isReady)
        XCTAssertEqual(fixture.errors.count, 1)
        guard let error = fixture.errors.first, case NativeEditorError.processLost = error else { return XCTFail("Missing recovery error") }
        do {
            _ = try await close.value
            XCTFail("A terminated process must not permit close")
        } catch {
            guard case NativeEditorError.processLost = error else { return XCTFail("Unexpected error: \(error)") }
        }
        XCTAssertEqual(try SourceCodec.encode(fixture.mirror.snapshot.source), fixture.bytes)
        // Drain the transport after termination: a late completion must not revive the bridge.
        fixture.gate.release()
        await fulfillment(of: [fixture.gate.finished], timeout: 2)
        XCTAssertFalse(fixture.bridge.isReady)
    }
}
