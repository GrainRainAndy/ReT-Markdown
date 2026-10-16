import XCTest
@testable import ReTMarkdown

func sampleSnapshot(_ text: String = "", revision: Int = 0) throws -> Snapshot {
    let object: [String: Any] = ["text": text, "eols": [], "bom": false, "revision": revision]
    return try JSONDecoder().decode(Snapshot.self, from: JSONSerialization.data(withJSONObject: object))
}
func sampleCommit(base: Int, revision: Int, insert: String) throws -> Commit {
    let object: [String: Any] = ["base": base, "revision": revision,
        "patches": [["from": 0, "to": 0, "insert": insert, "eols": []]],
        "selection": ["anchor": 0, "head": 0], "reason": "edit"]
    return try JSONDecoder().decode(Commit.self, from: JSONSerialization.data(withJSONObject: object))
}

final class BridgeTests: XCTestCase {
    @MainActor func testBarrierCapturedBeforeNewerCommitSavesCapturedBytesWithoutRegressingMirror() async throws {
        let mirror = try CommittedMirror(snapshot: sampleSnapshot("r10", revision: 10), documentID: "doc", sessionID: "session")
        let bridge = EditorBridge(mirror: mirror) { request in
            let type: BridgeMessageType
            let payload: NativeJSON
            if request.type == .load { type = .loaded; payload = .object(["revision": .number(10)]) }
            else if request.type == .barrier {
                try mirror.accept(sampleCommit(base: 10, revision: 11, insert: "next"), id: "c11", documentID: "doc", sessionID: "session")
                type = .snapshot
                payload = .object(["snapshot": try .encoded(sampleSnapshot("r10", revision: 10)), "selection": try .encoded(Selection()), "composing": .bool(false)])
            } else { type = .result; payload = .object(["ok": .bool(true)]) }
            return EditorBridge.Envelope(documentID: "doc", sessionID: "session", id: UUID().uuidString, replyTo: request.id, type: type, payload: payload)
        }
        try bridge.receive(EditorBridge.Envelope(documentID: "doc", sessionID: "session", id: "ready", type: .ready, payload: .object([:])))
        for _ in 0..<100 where !bridge.isReady { await Task.yield() }
        XCTAssertTrue(bridge.isReady)
        let captured = try await bridge.snapshot(purpose: .save)
        XCTAssertEqual(captured.revision, 10)
        XCTAssertEqual(mirror.snapshot.revision, 11)
        XCTAssertEqual(mirror.snapshot.text, "nextr10")
    }

    @MainActor func testCanonicalEquivalentUnicodeDoesNotHideByteMismatch() throws {
        let mirror = try CommittedMirror(snapshot: sampleSnapshot("é", revision: 3), documentID: "doc", sessionID: "session")
        XCTAssertThrowsError(try mirror.reconcile(sampleSnapshot("e\u{0301}", revision: 3)))
        try mirror.reconcile(sampleSnapshot("e\u{0301}", revision: 4))
        XCTAssertTrue(mirror.isDirty)
        try mirror.reconcile(sampleSnapshot("é", revision: 5))
        XCTAssertFalse(mirror.isDirty)
    }

    @MainActor func testDuplicateCommitAppliesOnce() throws {
        let mirror = try CommittedMirror(snapshot: sampleSnapshot(), documentID: "doc", sessionID: "session")
        let commit = try sampleCommit(base: 0, revision: 1, insert: "中")
        XCTAssertEqual(try mirror.accept(commit, id: "c1", documentID: "doc", sessionID: "session"), 1)
        XCTAssertEqual(try mirror.accept(commit, id: "c1", documentID: "doc", sessionID: "session"), 1)
        XCTAssertEqual(mirror.snapshot.text, "中")
        XCTAssertEqual(mirror.snapshot.revision, 1)
    }
    @MainActor func testWrongSessionAndBaseCannotMutateMirror() throws {
        let mirror = try CommittedMirror(snapshot: sampleSnapshot(), documentID: "doc", sessionID: "session")
        XCTAssertThrowsError(try mirror.accept(sampleCommit(base: 0, revision: 1, insert: "x"), id: "c1", documentID: "doc", sessionID: "old"))
        XCTAssertThrowsError(try mirror.accept(sampleCommit(base: 7, revision: 8, insert: "x"), id: "c2", documentID: "doc", sessionID: "session"))
        XCTAssertEqual(mirror.snapshot.text, "")
        XCTAssertTrue(mirror.requiresResync)
    }
    @MainActor func testUndoToSavedBytesIsCleanDespiteNewRevision() throws {
        let mirror = try CommittedMirror(snapshot: sampleSnapshot("saved"), documentID: "doc", sessionID: "session")
        try mirror.reconcile(sampleSnapshot("other", revision: 1))
        XCTAssertTrue(mirror.isDirty)
        try mirror.reconcile(sampleSnapshot("saved", revision: 2))
        XCTAssertFalse(mirror.isDirty)
    }
    @MainActor func testStaleBarrierCannotReplaceNewerMirror() throws {
        let mirror = try CommittedMirror(snapshot: sampleSnapshot("new", revision: 11), documentID: "doc", sessionID: "session")
        XCTAssertThrowsError(try mirror.reconcile(sampleSnapshot("old", revision: 10)))
        XCTAssertEqual(mirror.snapshot.text, "new")
    }
    @MainActor func testSameRevisionDifferentBytesRejected() throws {
        let mirror = try CommittedMirror(snapshot: sampleSnapshot("one", revision: 3), documentID: "doc", sessionID: "session")
        XCTAssertThrowsError(try mirror.reconcile(sampleSnapshot("two", revision: 3)))
        XCTAssertEqual(mirror.snapshot.text, "one")
    }
}
