import XCTest
@testable import ReTMarkdown

@MainActor
final class AssetsTests: XCTestCase {
    func testFrozenManifestCapabilityMapping() throws {
        let id = UUID()
        let url = URL(string: "ret-asset://image/\(id.uuidString)")!
        let capability = AssetCapability(url: url, data: Data([1, 2]), mimeType: "image/png")
        let manifest = AssetManifest(documentID: id, documentURL: nil,
            resourceDirectoryURL: URL(fileURLWithPath: "/tmp/draft/assets"),
            capabilities: ["图%20片.png": capability])
        XCTAssertEqual(manifest.capabilityMap, ["图%20片.png": url.absoluteString])
        XCTAssertEqual(manifest.resolveImage("图%20片.png"), url.absoluteString)
        XCTAssertNil(manifest.resolveImage("https://example.invalid/image.png"))
        XCTAssertEqual(manifest.capabilities["图%20片.png"]?.data, Data([1, 2]))
    }
}

extension AssetsTests {
    func testFinalContinuedDefinitionsMatchGrammarAndOriginalUTF16Ranges() {
        let cases: [(String, [String])] = [
            ("前🙂 ![x][pic]\n\n[pic]:\n  image.svg", ["image.svg"]),
            ("> ![x][pic]\n>\n> [pic]:\n>   image.svg", ["image.svg"]),
            ("- ![x][pic]\n\n  [pic]:\n    image.svg", ["image.svg"]),
            ("1. item\n\n   - ![x][pic]\n\n     [pic]:\n       <图 片.svg> \"title\"", ["图 片.svg"]),
            ("![x][pic]\n\n[pic]:\n    image.svg", ["image.svg"]),
            ("![x][pic]\n\n[pic]:\n  a\\(b\\).svg\n  \"continued\n  title\"", ["a\\(b\\).svg"]),
            ("![pic][] ![pic]\n\n[pic]:\n  first.svg\n[pic]: second.svg", ["first.svg"]),
            ("![x][pic]\n\n[pic]: bad.svg garbage\n\n[pic]:\n  good.svg", ["good.svg"]),
            ("![x][pic]\n\n[pic]:\n  bad(.svg\n\n[pic]: good.svg", ["good.svg"]),
            ("![x][pic]\n\n[pic]:\n  javascript:bad\n\n[pic]: good.svg", ["good.svg"]),
            ("![x][pic]\n\n[pic]:\n  image.svg \"unterminated", []),
            ("![x][pic]\n\n[pic]:\n  first.svg\n  \"unterminated\n\n[pic]: second.svg", ["first.svg"]),
            ("![x][pic]\n\n[pic]:\n\n  image.svg", []),
            ("![x][pic]\n\nparagraph\n[pic]:\n  image.svg", []),
            ("![x][pic]\n\n    [pic]:\n      image.svg", []),
            ("![x][pic]\n\n```\n[pic]:\n  image.svg\n```", []),
            ("![x][pic]\n\n[pic]:\n- image.svg", []),
            ("![x][pic]\n\n[pic]: bad.svg garbage\n[pic]: good.svg", []),
            ("![x][pic]\n\n- > [pic]:\n  > image.svg", ["image.svg"]),
            ("![x][pic]\n\n- >     [pic]:\n  >       image.svg", []),
            ("![x][pic]\n\n- > ```\n  > [pic]:\n  >   image.svg\n  > ```", []),
            ("![x][pic]\n\n> - [pic]:\n>     image.svg", ["image.svg"]),
            ("![x][pic]\n\n[pic]: <>\n[pic]: image.svg", []),
            ("![x][pic]\n\n[pic]:\n  image.svg\n  \"title\" garbage", ["image.svg"]),
            ("![x][pic]\n\n[pic]:\n  image.svg\n  \"\" garbage", []),
            ("![x][pic]\n\n[pic]:\n> image.svg", []),
            ("![x][pic]\n\n[pic]:\n  image.svg \"![fake](fake.svg)\"", ["image.svg"]),
            ("![x][Straße]\n\n[STRASSE]:\n  image.svg", ["image.svg"]),
            ("![x][pic]\n\n[pic]:\n  javascript&#58;bad\n\n[pic]: image.svg", ["image.svg"])
        ]
        for (text, expected) in cases {
            let references = AssetReferences.scan(text)
            XCTAssertEqual(references.map(\.destination), expected, text)
            for reference in references {
                let range = (text as NSString).range(of: reference.destination)
                XCTAssertEqual(reference.from, range.location, text)
                XCTAssertEqual(reference.to, NSMaxRange(range), text)
            }
        }
    }

    func testFinalContinuedLocalImagesAuthorizeFreezeAndWarnForSaveAs() async throws {
        let root = try temp(), url = root.appendingPathComponent("doc.md")
        let bytes = try image()
        try bytes.write(to: root.appendingPathComponent("image.svg"))
        let assets = try store(root, document: url)
        let text = "> ![x][pic]\n>\n> [pic]:\n>   image.svg\n"
        let snapshot = Snapshot(source: try SourceCodec.decode(Data(text.utf8)), revision: 1)
        let references = AssetReferences.scan(text)
        let manifest = try await assets.authorizedManifest(destinations: references.map(\.destination))
        XCTAssertEqual(manifest.capabilities["image.svg"]?.data, bytes)
        if let capability = manifest.capabilities["image.svg"] {
            let handler = AssetSchemeHandler(manifest: manifest)
            XCTAssertEqual(try handler.resource(for: capability.url).data, bytes)
        }
        let target = root.appendingPathComponent("elsewhere/copy.md")
        let plan = try await assets.planMigration(snapshot: snapshot, to: target)
        XCTAssertEqual(plan.unmanagedBrokenReferences.map(\.destination), ["image.svg"])
        XCTAssertTrue(plan.patches.isEmpty)
        let drafts = DraftStore(rootURL: root.appendingPathComponent("recovery"), documentID: manifest.documentID)
        try await drafts.persist(snapshot: snapshot, manifest: manifest)
        let recovered = try await drafts.recover()
        XCTAssertEqual(recovered?.manifest.capabilities["image.svg"]?.data, bytes)
    }

    func testFinalManagedContinuedDefinitionsPatchOnlyDestinationBytes() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let imported = try await assets.importImage(data: image(), suggestedName: "图.svg", documentID: id)
        let raw = "🙂 ![x][pic]\r\n\r\n- item\r\n\r\n  [pic]:\r\n    <\(imported.destination)> \"title\"\rkeep"
        let snapshot = Snapshot(source: try SourceCodec.decode(Data(raw.utf8)), revision: 5)
        let plan = try await assets.planMigration(snapshot: snapshot, to: root.appendingPathComponent("named.md"))
        XCTAssertEqual(plan.patches.count, 1)
        XCTAssertTrue(plan.unmanagedBrokenReferences.isEmpty)
        let patch = try XCTUnwrap(plan.patches.first)
        let originalRange = (snapshot.text as NSString).range(of: imported.destination)
        XCTAssertEqual(patch.from, originalRange.location)
        XCTAssertEqual(patch.to, NSMaxRange(originalRange))
        XCTAssertEqual(plan.candidateSnapshot.eols, snapshot.eols)
        XCTAssertEqual(try SourceCodec.encode(plan.candidateSnapshot.source),
            Data(raw.replacingOccurrences(of: imported.destination, with: patch.insert).utf8))
    }

    func testRound1LegacyRecoveryFiltersURLAndSurvivesEpochRotation() async throws {
        let root = try temp(), id = UUID(), a = root.appendingPathComponent("a.md"), b = root.appendingPathComponent("b.md")
        let legacy = DraftStore(rootURL: root, documentID: id)
        let manifestA = AssetManifest(documentID: id, documentURL: a, resourceDirectoryURL: root)
        let manifestB = AssetManifest(documentID: id, documentURL: b, resourceDirectoryURL: root)
        try await legacy.persist(snapshot: Snapshot(text: "legacy A", revision: 10), manifest: manifestA)
        try await legacy.persist(snapshot: Snapshot(text: "legacy B", revision: 11), manifest: manifestB)
        let scoped = DraftStore(rootURL: root, documentID: id, documentURL: a)
        let epoch = try await scoped.beginSession()
        let old = try await scoped.recover()
        XCTAssertEqual(old?.snapshot.text, "legacy A")
        let untitled = DraftStore(rootURL: root, documentID: id, documentURL: nil)
        let notUntitled = try await untitled.recover()
        XCTAssertNil(notUntitled, "named legacy generations cannot restore into an untitled namespace")
        try await scoped.persist(snapshot: Snapshot(text: "new A", revision: 1), manifest: manifestA, sessionID: epoch)
        let current = try await scoped.recover()
        XCTAssertEqual(current?.snapshot.text, "new A")
    }

    func testRound1DurableEpochRejectsOldWriterAndKeepsSameSessionOrdering() async throws {
        let root = try temp(), id = UUID(), url = root.appendingPathComponent("doc.md")
        let manifest = AssetManifest(documentID: id, documentURL: url, resourceDirectoryURL: root)
        let first = DraftStore(rootURL: root, documentID: id, documentURL: url)
        let oldEpoch = try await first.beginSession()
        try await first.persist(snapshot: Snapshot(text: "old", revision: 10), manifest: manifest, sessionID: oldEpoch)
        let second = DraftStore(rootURL: root, documentID: id, documentURL: url)
        let newEpoch = try await second.beginSession()
        try await second.persist(snapshot: Snapshot(text: "new", revision: 1), manifest: manifest, sessionID: newEpoch)
        do {
            try await first.persist(snapshot: Snapshot(text: "delayed old", revision: 99), manifest: manifest, sessionID: oldEpoch)
            XCTFail("prior epoch published after new session")
        } catch { XCTAssertEqual(error as? AssetStorageError, .staleDraft) }
        do {
            try await second.persist(snapshot: Snapshot(text: "stale", revision: 0), manifest: manifest, sessionID: newEpoch)
            XCTFail("same-session revision regressed")
        } catch { XCTAssertEqual(error as? AssetStorageError, .staleDraft) }
        let reopened = DraftStore(rootURL: root, documentID: id, documentURL: url)
        let recovered = try await reopened.recover()
        XCTAssertEqual(recovered?.snapshot.text, "new")
    }

    func testRound1FinalizationRetryRecognizesAlreadyCommittedAssetPatch() async throws {
        let root = try temp(), document = MarkdownDocument(), id = document.documentID
        let assets = try AssetStore(documentID: id, rootURL: root.appendingPathComponent("provenance"))
        let imported = try await assets.importImage(data: image(), suggestedName: "image.svg", documentID: id)
        try document.read(from: Data("![](\(imported.destination))".utf8), ofType: MarkdownDocument.typeName)
        _ = try NativeAssetIntegration.install(on: document, rootURL: root)
        let mirror = document.mirror, bridge = document.bridge, target = root.appendingPathComponent("saved.md")
        let prepared = try await XCTUnwrap(document.prepareResources)(document.mirror.snapshot, target, .saveAsOperation)
        try SourceCodec.encode(prepared.snapshot.source).write(to: target)
        document.fileURL = target
        do { try await prepared.didWrite(); XCTFail("no editor transport should fail initial patch acknowledgement") }
        catch NativeEditorError.unavailable { }
        // The editor commit can arrive even when the command acknowledgement was lost.
        try edit(document, to: prepared.snapshot.text, revision: 1)
        try await prepared.didWrite()
        try await prepared.didWrite()
        XCTAssertEqual(document.mirror.snapshot.revision, 1)
        XCTAssertTrue(document.mirror === mirror)
        XCTAssertTrue(document.bridge === bridge)
        XCTAssertNotNil(document.bridge.assetMap.values.first)
    }

    func testRound1IdenticalCandidateNeedsWriteEvidenceAndCrashUsesStagedManifest() async throws {
        let root = try temp(), id = UUID(), a = root.appendingPathComponent("a.md"), b = root.appendingPathComponent("b.md")
        try Data("same".utf8).write(to: a)
        let original = try store(root, id: id, document: a)
        _ = try await original.importImage(data: image(), suggestedName: "only-a.svg", documentID: id)
        let before = await original.manifest
        let other = try store(root, id: id, document: b)
        let plan = try await other.planMigration(snapshot: Snapshot(text: "same"), to: a)
        _ = try await other.stageMigration(plan)
        let preWrite = try store(root, id: id, document: a)
        let preManifest = await preWrite.manifest
        XCTAssertEqual(preManifest, before, "equal Markdown hash is not evidence of a successful write")
        try Data("same".utf8).write(to: a, options: .atomic)
        let crashed = try store(root, id: id, document: a)
        let crashManifest = await crashed.manifest
        XCTAssertEqual(crashManifest, plan.candidateManifest, "recover exact staged generation after replacement, before adoption")
    }

    func testRound1MigrationReferencesStayRelativeAcrossTmpAliases() async throws {
        let root = try temp(), id = UUID(), a = root.appendingPathComponent("a.md")
        try Data().write(to: a)
        let assets = try store(root, id: id, document: a)
        let imported = try await assets.importImage(data: image(), suggestedName: "图.svg", documentID: id)
        let plan = try await assets.planMigration(snapshot: Snapshot(text: "![](\(imported.destination))"), to: root.appendingPathComponent("b.md"))
        XCTAssertTrue(plan.candidateManifest.managedAssets[0].destination.hasPrefix("b.assets/"))
    }

    func testRound1SaveAsIndependentRecoveryAndStableWireIdentity() async throws {
        let root = try temp(), a = root.appendingPathComponent("a.md"), b = root.appendingPathComponent("b.md")
        let document = MarkdownDocument()
        let adapterB = try NativeAssetIntegration.install(on: document, rootURL: root)
        let id = document.documentID, mirror = document.mirror, bridge = document.bridge
        try edit(document, to: "seed", revision: 1)
        let selection = Selection(anchor: 1, head: 3)
        try bridge.receive(EditorBridge.Envelope(documentID: mirror.documentID, sessionID: mirror.sessionID,
            id: "state", type: .state, payload: try .encoded(EditorState(revision: 1, selection: selection, canUndo: true))))
        let prepare = try XCTUnwrap(document.prepareResources)
        let first = try await prepare(document.mirror.snapshot, a, .saveAsOperation)
        try SourceCodec.encode(first.snapshot.source).write(to: a)
        document.fileURL = a
        try await first.didWrite()
        let delayedA = try XCTUnwrap(document.persistDraft)
        let second = try await prepare(document.mirror.snapshot, b, .saveAsOperation)
        try SourceCodec.encode(second.snapshot.source).write(to: b)
        document.fileURL = b
        try await second.didWrite()
        XCTAssertTrue(document.mirror === mirror)
        XCTAssertTrue(document.bridge === bridge)
        XCTAssertEqual(document.documentID, id)
        XCTAssertEqual(bridge.state.selection, selection)
        XCTAssertTrue(bridge.state.canUndo)
        try image().write(to: root.appendingPathComponent("a-only.svg"))
        try image().write(to: root.appendingPathComponent("b-only.svg"))
        let reopenedA = MarkdownDocument()
        reopenedA.fileURL = a
        let adapterA = try NativeAssetIntegration.install(on: reopenedA, rootURL: root)
        try edit(reopenedA, to: "unsaved A ![](a-only.svg)", revision: 1)
        try await XCTUnwrap(reopenedA.persistDraft)(reopenedA.mirror.snapshot, id)
        try edit(document, to: "unsaved B ![](b-only.svg)", revision: 2)
        try await XCTUnwrap(document.persistDraft)(document.mirror.snapshot, id)
        try await delayedA(Snapshot(text: "delayed A", revision: 90), id)
        try FileManager.default.removeItem(at: root.appendingPathComponent("a-only.svg"))
        try FileManager.default.removeItem(at: root.appendingPathComponent("b-only.svg"))
        let recoveryA = try await XCTUnwrap(reopenedA.restoreDraft)(id)
        let recoveryB = try await XCTUnwrap(document.restoreDraft)(id)
        XCTAssertEqual(recoveryA?.text, "unsaved A ![](a-only.svg)")
        XCTAssertEqual(recoveryB?.text, "unsaved B ![](b-only.svg)")
        let manifestA = try await adapterA.authorizedManifest(for: XCTUnwrap(recoveryA))
        let manifestB = try await adapterB.authorizedManifest(for: XCTUnwrap(recoveryB))
        XCTAssertEqual(manifestA.capabilities["a-only.svg"]?.data, try image())
        XCTAssertEqual(manifestB.capabilities["b-only.svg"]?.data, try image())
        XCTAssertNil(manifestA.capabilities["b-only.svg"])
        XCTAssertNil(manifestB.capabilities["a-only.svg"])
    }

    func testRound1CanceledReturnMigrationPreservesCompleteTargetManifest() async throws {
        let root = try temp(), id = UUID(), a = root.appendingPathComponent("a.md"), b = root.appendingPathComponent("b.md")
        let assets = try store(root, id: id, document: a)
        let imported = try await assets.importImage(data: image(), suggestedName: "first.svg", documentID: id)
        let original = Snapshot(text: "![a](\(imported.destination))")
        try SourceCodec.encode(original.source).write(to: a)
        let toB = try await assets.planMigration(snapshot: original, to: b)
        let stagedB = try await assets.stageMigration(toB)
        try SourceCodec.encode(toB.candidateSnapshot.source).write(to: b)
        _ = try await assets.adoptMigration(stagedB)
        let reopenedA = try store(root, id: id, document: a)
        _ = try await reopenedA.importImage(data: image(), suggestedName: "A-only.svg", documentID: id)
        let before = await reopenedA.manifest
        let bytes = try Data(contentsOf: a)
        let back = try await assets.planMigration(snapshot: toB.candidateSnapshot, to: a)
        let staged = try await assets.stageMigration(back)
        let duringStore = try store(root, id: id, document: a)
        let during = await duringStore.manifest
        XCTAssertEqual(during, before, "staging must not replace the committed manifest")
        try await assets.cancelMigration(staged)
        let afterStore = try store(root, id: id, document: a)
        let after = await afterStore.manifest
        XCTAssertEqual(after, before)
        XCTAssertEqual(try Data(contentsOf: a), bytes)
    }

    func testRound1ContainerImagesAndDefinitionsKeepExactRanges() {
        let cases: [(String, [String])] = [
            ("- item\n\n    ![image](image.svg)", ["image.svg"]),
            ("1. item\n\n   - nested\n\n       ![图](nested.svg)", ["nested.svg"]),
            ("> - item\n>\n>     ![图][ref]\n>\n>     [ref]: <图 片.svg>", ["图 片.svg"]),
            ("> ![图][ref]\n>\n> [ref]: quote.svg", ["quote.svg"]),
            ("- item\n\n      ![code](no.svg)\n\n    ![valid](yes.svg)", ["yes.svg"]),
            ("- item\n\n    ```\n    ![code](no.svg)\n    ```\n\n    ![yes](yes.svg)", ["yes.svg"]),
            ("    ![code](no.svg)\n\n>     ![code](no.svg)", []),
            ("> ![unresolved][ref]\n> [ref]: not-a-definition.svg", [])
        ]
        for (text, expected) in cases {
            let references = AssetReferences.scan(text)
            XCTAssertEqual(references.map(\.destination), expected, text)
            for reference in references {
                XCTAssertEqual((text as NSString).substring(with: NSRange(location: reference.from, length: reference.to - reference.from)), reference.destination)
            }
        }
    }

    func testRound1RecoveredFrozenBytesSurviveImportRenameMigrationAndSecondRecovery() async throws {
        let root = try temp(), id = UUID(), url = root.appendingPathComponent("doc.md")
        let assets = try store(root, id: id, document: url), source = Snapshot(text: "![x](user.svg)", revision: 1)
        let userImage = root.appendingPathComponent("user.svg")
        let bytes = try image()
        try bytes.write(to: userImage)
        let drafts = DraftStore(rootURL: root.appendingPathComponent("recovery"), documentID: id)
        try await drafts.persist(snapshot: source, manifest: assets.manifest)
        try FileManager.default.removeItem(at: userImage)
        let recovery = try await drafts.recover()
        let restored = try AssetStore(documentID: id, rootURL: root.appendingPathComponent("state"), documentURL: url,
            recoveredManifest: XCTUnwrap(recovery?.manifest))
        _ = try await restored.importImage(data: bytes, suggestedName: "new.svg", documentID: id)
        let imported = try await restored.authorizedManifest(destinations: ["user.svg"])
        XCTAssertEqual(imported.capabilities["user.svg"]?.data, bytes)
        let renamed = root.appendingPathComponent("renamed.md")
        try await restored.documentDidRename(to: renamed)
        let afterRename = try await restored.authorizedManifest(destinations: ["user.svg"])
        XCTAssertEqual(afterRename.capabilities["user.svg"]?.data, bytes)
        let plan = try await restored.planMigration(snapshot: source, to: root.appendingPathComponent("copy.md"))
        let staged = try await restored.stageMigration(plan)
        try SourceCodec.encode(plan.candidateSnapshot.source).write(to: plan.destination)
        _ = try await restored.adoptMigration(staged)
        let afterMigration = try await restored.authorizedManifest(destinations: ["user.svg"])
        XCTAssertEqual(afterMigration.capabilities["user.svg"]?.data, bytes)
        try await drafts.persist(snapshot: Snapshot(text: source.text, revision: 2), manifest: restored.manifest)
        let second = try await drafts.recover()
        XCTAssertEqual(second?.manifest.capabilities["user.svg"]?.data, bytes)
        let reopened = try store(root, id: id, document: plan.destination)
        let saved = try await reopened.authorizedManifest(destinations: ["user.svg"])
        XCTAssertEqual(saved.capabilities["user.svg"]?.data, bytes)
    }

    func testRound1NamedReopenAndRevertAcceptNewSessionRevision() async throws {
        let root = try temp(), url = root.appendingPathComponent("named.md"), id = UUID()
        try Data("saved".utf8).write(to: url)
        let assets = try AssetStore(documentID: id, rootURL: root.appendingPathComponent("provenance"), documentURL: url)
        try await assets.documentDidRename(to: url)
        let old = MarkdownDocument()
        old.fileURL = url
        _ = try NativeAssetIntegration.install(on: old, rootURL: root)
        try edit(old, to: "old session", revision: 10)
        try await XCTUnwrap(old.persistDraft)(old.mirror.snapshot, id)
        let reopened = MarkdownDocument()
        reopened.fileURL = url
        try reopened.read(from: Data("saved".utf8), ofType: MarkdownDocument.typeName)
        _ = try NativeAssetIntegration.install(on: reopened, rootURL: root)
        let before = try await XCTUnwrap(reopened.restoreDraft)(id)
        XCTAssertEqual(before?.text, "old session", "opening a new epoch must retain existing complete recovery")
        try image().write(to: root.appendingPathComponent("typed.svg"))
        let current = Snapshot(text: "![typed](typed.svg)", revision: 1)
        try edit(reopened, to: current.text, revision: current.revision)
        try await XCTUnwrap(reopened.persistDraft)(current, id)
        XCTAssertNotNil(reopened.bridge.assetMap["typed.svg"])
        let first = try await XCTUnwrap(reopened.restoreDraft)(id)
        XCTAssertEqual(first, current)
        let delayed = try XCTUnwrap(reopened.persistDraft)
        try reopened.read(from: Data("reverted".utf8), ofType: MarkdownDocument.typeName)
        let reverted = Snapshot(text: "revert edit ![](typed.svg)", revision: 1)
        try edit(reopened, to: reverted.text, revision: reverted.revision)
        try await XCTUnwrap(reopened.persistDraft)(reverted, id)
        XCTAssertNotNil(reopened.bridge.assetMap["typed.svg"])
        try await delayed(Snapshot(text: "late old edit", revision: 90), id)
        let second = try await XCTUnwrap(reopened.restoreDraft)(id)
        XCTAssertEqual(second, reverted)
    }

    private func edit(_ document: MarkdownDocument, to text: String, revision: Revision) throws {
        let mirror = document.mirror
        _ = try mirror.accept(Commit(base: mirror.snapshot.revision, revision: revision,
            patches: [Patch(from: 0, to: mirror.snapshot.text.utf16.count, insert: text)],
            selection: Selection(anchor: 0, head: 0), reason: .edit), id: UUID().uuidString,
            documentID: mirror.documentID, sessionID: mirror.sessionID)
    }
    private func temp() throws -> URL {
        let url = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("ret-assets-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
    private var fixtureRoot: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("build/fixtures")
    }
    private func image() throws -> Data { try Data(contentsOf: fixtureRoot.appendingPathComponent("assets/截图 0.svg")) }
    private func store(_ root: URL, id: UUID = UUID(), document: URL? = nil) throws -> AssetStore {
        try AssetStore(documentID: id, rootURL: root.appendingPathComponent("state"), documentURL: document)
    }
    func testCollisionUnicodeAndDurableManagedProvenance() async throws {
        let root = try temp(), id = UUID(), bytes = try image()
        let assets = try store(root, id: id)
        let a = try await assets.importImage(data: bytes, suggestedName: "截图 一.svg", documentID: id)
        let b = try await assets.importImage(data: bytes, suggestedName: "截图 一.svg", documentID: id)
        XCTAssertNotEqual(a.fileURL, b.fileURL)
        XCTAssertNotEqual(a.destination, b.destination)
        XCTAssertFalse(a.destination.contains(" "))
        XCTAssertEqual(try Data(contentsOf: a.fileURL), bytes)
        XCTAssertEqual(try Data(contentsOf: b.fileURL), bytes)
        let reopened = try store(root, id: id)
        let manifest = await reopened.manifest
        XCTAssertEqual(manifest.managedAssets.count, 2)
        XCTAssertEqual(manifest.managedAssets.first?.assetID, a.assetID)
        XCTAssertEqual(manifest.managedAssets.first?.destination, a.destination)
        let named = root.appendingPathComponent("named.md")
        let fakeDirectory = root.appendingPathComponent("named.assets")
        try FileManager.default.createDirectory(at: fakeDirectory, withIntermediateDirectories: true)
        try bytes.write(to: fakeDirectory.appendingPathComponent("user.svg"))
        let unmanaged = try store(root, document: named)
        let unmanagedManifest = await unmanaged.manifest
        XCTAssertTrue(unmanagedManifest.managedAssets.isEmpty)
    }
    func testImportFailureDoesNotOverwriteBlockingFile() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let directory = await assets.manifest.resourceDirectoryURL
        try Data("keep".utf8).write(to: directory)
        do {
            _ = try await assets.importImage(data: image(), suggestedName: "a.svg", documentID: id)
            XCTFail("import succeeded through regular file")
        } catch { }
        XCTAssertEqual(try Data(contentsOf: directory), Data("keep".utf8))
        let manifest = await assets.manifest
        XCTAssertTrue(manifest.managedAssets.isEmpty)
    }
    func testDraftGenerationRecoversExactFixtureBytesAndIndependentAssets() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let imported = try await assets.importImage(data: image(), suggestedName: "图.svg", documentID: id)
        let bytes = try Data(contentsOf: fixtureRoot.appendingPathComponent("mixed-eol.md"))
        let snapshot = Snapshot(source: try SourceCodec.decode(bytes), revision: 42)
        let drafts = DraftStore(rootURL: root.appendingPathComponent("recovery"), documentID: id)
        try await drafts.persist(snapshot: snapshot, manifest: assets.manifest)
        try FileManager.default.removeItem(at: imported.fileURL)
        let recoveredValue = try await drafts.recover()
        let recovered = try XCTUnwrap(recoveredValue)
        XCTAssertEqual(recovered.snapshot.revision, 42)
        XCTAssertEqual(try SourceCodec.encode(recovered.snapshot.source), bytes)
        let recoveredAsset = try XCTUnwrap(recovered.manifest.managedAssets.first)
        XCTAssertEqual(try Data(contentsOf: recoveredAsset.fileURL), try image())
        XCTAssertNotNil(recovered.manifest.resolveImage(imported.destination))
    }
    func testIncompleteAndCorruptDraftGenerationFallsBack() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let drafts = DraftStore(rootURL: root.appendingPathComponent("recovery"), documentID: id)
        let original = Snapshot(text: "原稿🙂", revision: 2)
        try await drafts.persist(snapshot: original, manifest: assets.manifest)
        try await drafts.persist(snapshot: Snapshot(text: "new", revision: 3), manifest: assets.manifest)
        let generations = await drafts.generationsURL
        let dirs = try FileManager.default.contentsOfDirectory(at: generations, includingPropertiesForKeys: nil)
            .filter { !$0.lastPathComponent.hasPrefix(".") }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        try Data("corrupt".utf8).write(to: XCTUnwrap(dirs.last).appendingPathComponent("snapshot.json"))
        let interrupted = generations.appendingPathComponent(".staging-interrupted")
        try FileManager.default.createDirectory(at: interrupted, withIntermediateDirectories: true)
        try Data("partial".utf8).write(to: interrupted.appendingPathComponent("snapshot.json"))
        let recovered = try await drafts.recover()
        XCTAssertEqual(recovered?.snapshot, original)
    }
    func testDraftCopyFailurePreservesPreviousCompleteGeneration() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let drafts = DraftStore(rootURL: root.appendingPathComponent("recovery"), documentID: id)
        let original = Snapshot(text: "committed", revision: 1)
        try await drafts.persist(snapshot: original, manifest: assets.manifest)
        let a = try await assets.importImage(data: image(), suggestedName: "a.svg", documentID: id)
        try FileManager.default.removeItem(at: a.fileURL)
        do {
            try await drafts.persist(snapshot: Snapshot(text: "bad", revision: 2), manifest: assets.manifest)
            XCTFail("missing asset copied")
        } catch { }
        let recovered = try await drafts.recover()
        XCTAssertEqual(recovered?.snapshot, original)
    }
    func testMigrationResourcesFirstAndReferencePatchLocality() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let a = try await assets.importImage(data: image(), suggestedName: "图 一.svg", documentID: id)
        let raw = "前🙂\r\n![图](\(a.destination) \"title\")\rkeep `![code](\(a.destination))`\n\n[ref]: <\(a.destination)>\n![other][ref]"
        let snapshot = Snapshot(source: try SourceCodec.decode(Data(raw.utf8)), revision: 8)
        let target = root.appendingPathComponent("新 文稿.md")
        let plan = try await assets.planMigration(snapshot: snapshot, to: target)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        XCTAssertEqual(plan.patches.count, 2)
        XCTAssertEqual(plan.candidateSnapshot.revision, snapshot.revision)
        let expected = plan.candidateSnapshot.text
        XCTAssertTrue(expected.contains("keep `![code](\(a.destination))`"))
        XCTAssertEqual(plan.candidateSnapshot.eols, snapshot.eols)
        XCTAssertTrue(plan.candidateSnapshot.text.hasPrefix("前🙂\n![图]("))
        let staged = try await assets.stageMigration(plan)
        for copy in plan.copies { XCTAssertEqual(try Data(contentsOf: copy.destination), try image()) }
        let before = await assets.manifest
        XCTAssertNil(before.documentURL)
        try SourceCodec.encode(plan.candidateSnapshot.source).write(to: target, options: .atomic)
        let adopted = try await assets.adoptMigration(staged)
        XCTAssertEqual(adopted.documentURL, target)
        XCTAssertEqual(try Data(contentsOf: a.fileURL), try image())
        let afterUndo = try await assets.authorizedManifest(destinations: [a.destination])
        XCTAssertNotNil(afterUndo.resolveImage(a.destination))
        let historyURL = try XCTUnwrap(AssetIO.localURL(a.destination, base: target.deletingLastPathComponent()))
        XCTAssertEqual(try Data(contentsOf: historyURL), try image(), "old references remain usable by plain Markdown readers after undo")
        let reopened = try store(root, id: id, document: target)
        let reopenedManifest = await reopened.manifest
        XCTAssertEqual(reopenedManifest.managedAssets.first?.assetID, a.assetID)
        XCTAssertEqual(reopenedManifest.resourceDirectoryURL, adopted.resourceDirectoryURL)
    }
    func testFailedFirstSaveResourceCopyPreservesDraftAndMarkdown() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let a = try await assets.importImage(data: image(), suggestedName: "a.svg", documentID: id)
        let target = root.appendingPathComponent("new.md")
        try Data("existing destination".utf8).write(to: target)
        let plan = try await assets.planMigration(snapshot: Snapshot(text: "![x](\(a.destination))"), to: target)
        try Data("block resource directory".utf8).write(to: plan.candidateManifest.resourceDirectoryURL)
        do { _ = try await assets.stageMigration(plan); XCTFail("copy did not fail") } catch { }
        XCTAssertEqual(try Data(contentsOf: target), Data("existing destination".utf8))
        XCTAssertEqual(try Data(contentsOf: a.fileURL), try image())
        let manifest = await assets.manifest
        XCTAssertNil(manifest.documentURL)
    }
    func testFailureAfterCopyAndCancelNeverAdoptOrRewriteOriginal() async throws {
        let root = try temp(), id = UUID(), old = root.appendingPathComponent("old.md")
        let assets = try store(root, id: id, document: old)
        let a = try await assets.importImage(data: image(), suggestedName: "a.svg", documentID: id)
        let bytes = Data("![a](\(a.destination))".utf8)
        try bytes.write(to: old)
        let target = root.appendingPathComponent("folder.md")
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        let plan = try await assets.planMigration(snapshot: Snapshot(source: SourceCodec.decode(bytes)), to: target)
        let staged = try await assets.stageMigration(plan)
        XCTAssertThrowsError(try SourceCodec.encode(plan.candidateSnapshot.source).write(to: target, options: .atomic))
        try await assets.cancelMigration(staged)
        let manifest = await assets.manifest
        XCTAssertEqual(manifest.documentURL, old)
        XCTAssertEqual(try Data(contentsOf: old), bytes)
        XCTAssertEqual(try Data(contentsOf: a.fileURL), try image())
    }
    func testUnmanagedSaveAsBreakageRequiresExplicitAcceptance() async throws {
        let root = try temp(), old = root.appendingPathComponent("old.md"), assets = try store(root, document: old)
        try image().write(to: root.appendingPathComponent("user.svg"))
        let folder = root.appendingPathComponent("elsewhere")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let plan = try await assets.planMigration(snapshot: Snapshot(text: "![u](user.svg) ![r](https://example.invalid/a.png)"), to: folder.appendingPathComponent("new.md"))
        XCTAssertEqual(plan.unmanagedBrokenReferences.map(\.destination), ["user.svg"])
        do { _ = try await assets.stageMigration(plan); XCTFail("implicit acceptance") }
        catch { XCTAssertEqual(error as? AssetStorageError, .unmanagedBreakageRequiresAcceptance) }
        let staged = try await assets.stageMigration(plan, acceptingUnmanagedBreakage: true)
        try await assets.cancelMigration(staged)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("user.svg")), try image())
    }
    func testRenamePreservesResourceDirectoryAndOriginals() async throws {
        let root = try temp(), old = root.appendingPathComponent("old.md"), assets = try store(root, document: old)
        let manifest = await assets.manifest
        try await assets.documentDidRename(to: root.appendingPathComponent("renamed.md"))
        let renamed = await assets.manifest
        XCTAssertEqual(renamed.resourceDirectoryURL, manifest.resourceDirectoryURL)
    }
    func testCapabilityAuthorizationParentReferencesFrozenBytesAndSymlinkSwap() async throws {
        let root = try temp(), folder = root.appendingPathComponent("docs")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let imageURL = root.appendingPathComponent("图 片.svg")
        try image().write(to: imageURL)
        let assets = try store(root, document: folder.appendingPathComponent("doc.md"))
        let manifest = try await assets.authorizedManifest(destinations: ["../图%20片.svg", "https://example.invalid/a.png", "file:///etc/passwd", "missing.svg"])
        let capability = try XCTUnwrap(manifest.capabilities["../图%20片.svg"])
        XCTAssertEqual(capability.data, try image())
        XCTAssertNil(manifest.resolveImage("file:///etc/passwd"))
        XCTAssertNil(manifest.resolveImage("https://example.invalid/a.png"))
        let secret = root.appendingPathComponent("secret.svg")
        try Data("secret".utf8).write(to: secret)
        try FileManager.default.removeItem(at: imageURL)
        try FileManager.default.createSymbolicLink(at: imageURL, withDestinationURL: secret)
        let handler = AssetSchemeHandler(manifest: manifest)
        XCTAssertEqual(try handler.resource(for: capability.url).data, try image())
        XCTAssertThrowsError(try handler.resource(for: URL(string: "ret-resource://asset/../../secret.svg")!))
        let changed = try await assets.authorizedManifest(destinations: ["../图%20片.svg"])
        XCTAssertNil(changed.resolveImage("../图%20片.svg"))
    }
    func testSVGScriptExternalResourcesAndInvalidImagesAreBlocked() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        for payload in [
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>",
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><image href=\"https://example.invalid/x\"/></svg>",
            "<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><svg xmlns=\"http://www.w3.org/2000/svg\"><text>&x;</text></svg>",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"/>",
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect style=\"fill:url(https://example.invalid/x)\"/></svg>",
            "this is not an image"
        ] {
            do { _ = try await assets.importImage(data: Data(payload.utf8), suggestedName: "bad.svg", documentID: id); XCTFail("unsafe image imported") } catch { }
        }
        let manifest = await assets.manifest
        XCTAssertTrue(manifest.managedAssets.isEmpty)
    }
}

extension AssetsTests {
    func testReferenceScannerSkipsCodeAndKeepsExactDestinationRanges() throws {
        let text = """
        前🙂 ![one](<图 片.svg> "a title") ![two](images/a\\(b\\).png 'title')
        ![alt][REF] ![REF][] ![shortcut]

        [ref]: <资源 一.svg> "title"
        [shortcut]: local.png
        [unused]: untouched.png
        `![literal](secret.png)`
        ``![literal](other.png)``
        ```md
        ![fenced](hidden.png)
        [ref]: hidden-too.png
        ```
            ![indented](no.png)
        \\![escaped](no.png)
        """
        let references = AssetReferences.scan(text)
        XCTAssertEqual(references.map(\.destination), ["图 片.svg", "images/a\\(b\\).png", "资源 一.svg", "local.png"])
        for reference in references {
            XCTAssertEqual((text as NSString).substring(with: NSRange(location: reference.from, length: reference.to - reference.from)), reference.destination)
        }
    }
    func testSchemeHandlerUpdateRetainsOldCapabilitiesAndRejectsMalformedRequests() async throws {
        let root = try temp(), assets = try store(root, document: root.appendingPathComponent("doc.md"))
        let id = await assets.manifest.documentID
        let a = try await assets.importImage(data: image(), suggestedName: "a.svg", documentID: id)
        let first = try await assets.authorizedManifest(destinations: [a.destination])
        let handler = AssetSchemeHandler(manifest: first)
        let old = try XCTUnwrap(first.capabilities[a.destination])
        let b = try await assets.importImage(data: image(), suggestedName: "b.svg", documentID: id)
        let second = try await assets.authorizedManifest(destinations: [b.destination])
        handler.update(manifest: second)
        let new = try XCTUnwrap(second.capabilities[b.destination])
        XCTAssertEqual(try handler.resource(for: old.url).data, try image())
        XCTAssertEqual(try handler.resource(for: new.url).data, try image())
        for string in [old.url.absoluteString + "?path=/etc/passwd", "file:///etc/passwd", "https://example.invalid/a.svg", "ret-resource://asset/unknown", old.url.absoluteString + "#x"] {
            XCTAssertThrowsError(try handler.resource(for: XCTUnwrap(URL(string: string))))
        }
    }
    func testCorruptLatestDraftImageFallsBackToCompleteGeneration() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        _ = try await assets.importImage(data: image(), suggestedName: "a.svg", documentID: id)
        let drafts = DraftStore(rootURL: root.appendingPathComponent("recovery"), documentID: id)
        try await drafts.persist(snapshot: Snapshot(text: "first", revision: 1), manifest: assets.manifest)
        try await drafts.persist(snapshot: Snapshot(text: "second", revision: 2), manifest: assets.manifest)
        let latest = try await drafts.recover()
        try Data("corrupted image".utf8).write(to: XCTUnwrap(latest?.manifest.managedAssets.first?.fileURL))
        let fallback = try await drafts.recover()
        XCTAssertEqual(fallback?.snapshot.text, "first")
    }
}

extension AssetsTests {
    func testStaleDraftCannotReplaceNewerRecovery() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let drafts = DraftStore(rootURL: root.appendingPathComponent("recovery"), documentID: id)
        try await drafts.persist(snapshot: Snapshot(text: "new", revision: 9), manifest: assets.manifest)
        do { try await drafts.persist(snapshot: Snapshot(text: "old", revision: 8), manifest: assets.manifest) }
        catch { XCTAssertEqual(error as? AssetStorageError, .staleDraft) }
        let recovered = try await drafts.recover()
        XCTAssertEqual(recovered?.snapshot.text, "new")
    }
    func testNativeAutosaveElsewhereKeepsDraftResourcesAndReferences() async throws {
        let root = try temp(), document = MarkdownDocument()
        let adapter = try NativeAssetIntegration.install(on: document, rootURL: root)
        try document.read(from: Data("![x](assets/keep.svg)".utf8), ofType: MarkdownDocument.typeName)
        let initial = try await adapter.authorizedManifest(for: document.mirror.snapshot)
        let prepared = try await XCTUnwrap(document.prepareResources)(document.mirror.snapshot, root.appendingPathComponent("Autosaved.md"), .autosaveElsewhereOperation)
        XCTAssertEqual(prepared.snapshot, document.mirror.snapshot)
        try await prepared.didWrite()
        let after = try await adapter.authorizedManifest(for: document.mirror.snapshot)
        XCTAssertEqual(after.documentURL, initial.documentURL)
        XCTAssertEqual(after.resourceDirectoryURL, initial.resourceDirectoryURL)
    }
    func testNativeAdapterRestoresDraftByStableIdentity() async throws {
        let root = try temp(), document = MarkdownDocument()
        _ = try NativeAssetIntegration.install(on: document, rootURL: root)
        let id = document.documentID, snapshot = Snapshot(text: "恢复🙂", revision: 7)
        try edit(document, to: snapshot.text, revision: snapshot.revision)
        try await XCTUnwrap(document.persistDraft)(snapshot, id)
        let reopened = MarkdownDocument()
        _ = try NativeAssetIntegration.install(on: reopened, rootURL: root)
        reopened.onIdentityRestored?(id)
        let recovered = try await XCTUnwrap(reopened.restoreDraft)(id)
        XCTAssertEqual(recovered, snapshot)
    }
}

extension AssetsTests {
    func testNamedReopenIdentityIndexSurvivesSaveAndFileURLAliases() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let imported = try await assets.importImage(data: image(), suggestedName: "文 图.svg", documentID: id)
        let target = root.appendingPathComponent("新 文稿.md")
        let plan = try await assets.planMigration(snapshot: Snapshot(text: "![x](\(imported.destination))"), to: target)
        let staged = try await assets.stageMigration(plan)
        XCTAssertNil(try AssetStore.documentIdentity(for: target, rootURL: root.appendingPathComponent("state")))
        try SourceCodec.encode(plan.candidateSnapshot.source).write(to: target, options: .atomic)
        _ = try await assets.adoptMigration(staged)
        XCTAssertEqual(try AssetStore.documentIdentity(for: target, rootURL: root.appendingPathComponent("state")), id)
        let alias = URL(fileURLWithPath: target.path.replacingOccurrences(of: "/private/tmp/", with: "/tmp/"))
        XCTAssertEqual(try AssetStore.documentIdentity(for: alias, rootURL: root.appendingPathComponent("state")), id)
        let recoveredID = try XCTUnwrap(AssetStore.documentIdentity(for: target, rootURL: root.appendingPathComponent("state")))
        let reopened = try store(root, id: recoveredID, document: target)
        let manifest = await reopened.manifest
        XCTAssertEqual(manifest.managedAssets.first?.assetID, imported.assetID)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(manifest.managedAssets.first?.fileURL)), try image())
    }
    func testFailedMigrationNeverReplacesExistingNamedIdentity() async throws {
        let root = try temp(), target = root.appendingPathComponent("existing.md"), oldID = UUID(), newID = UUID()
        try Data("old document".utf8).write(to: target)
        let named = try store(root, id: oldID, document: target)
        _ = try await named.importImage(data: image(), suggestedName: "old.svg", documentID: oldID)
        let draft = try store(root, id: newID)
        let imported = try await draft.importImage(data: image(), suggestedName: "new.svg", documentID: newID)
        let plan = try await draft.planMigration(snapshot: Snapshot(text: "![x](\(imported.destination))"), to: target)
        let staged = try await draft.stageMigration(plan)
        try await draft.cancelMigration(staged)
        XCTAssertEqual(try Data(contentsOf: target), Data("old document".utf8))
        XCTAssertEqual(try AssetStore.documentIdentity(for: target, rootURL: root.appendingPathComponent("state")), oldID)
    }
}

extension AssetsTests {
    func testNativeInstallerAdoptsNamedProvenanceIdentity() async throws {
        let root = try temp(), id = UUID(), target = root.appendingPathComponent("named.md")
        try Data("content".utf8).write(to: target)
        let assets = try AssetStore(documentID: id, rootURL: root.appendingPathComponent("provenance"), documentURL: target)
        let imported = try await assets.importImage(data: image(), suggestedName: "图.svg", documentID: id)
        let document = MarkdownDocument()
        try document.read(from: Data("![x](\(imported.destination))".utf8), ofType: MarkdownDocument.typeName)
        document.fileURL = target
        let adapter = try NativeAssetIntegration.install(on: document, rootURL: root)
        XCTAssertEqual(document.documentID, id)
        let manifest = try await adapter.authorizedManifest(for: document.mirror.snapshot)
        XCTAssertEqual(manifest.managedAssets.first?.assetID, imported.assetID)
        XCTAssertNotNil(manifest.resolveImage(imported.destination))
    }
}

extension AssetsTests {
    func testHistoryAliasCollisionNeverOverwritesUserImage() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let imported = try await assets.importImage(data: image(), suggestedName: "a.svg", documentID: id)
        let target = root.appendingPathComponent("new.md")
        let alias = try XCTUnwrap(AssetIO.localURL(imported.destination, base: root))
        try FileManager.default.createDirectory(at: alias.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("user-owned image".utf8).write(to: alias)
        let plan = try await assets.planMigration(snapshot: Snapshot(text: "![x](\(imported.destination))"), to: target)
        do { _ = try await assets.stageMigration(plan); XCTFail("history alias collision overwritten") }
        catch { XCTAssertEqual(error as? AssetStorageError, .changedResource) }
        XCTAssertEqual(try Data(contentsOf: alias), Data("user-owned image".utf8))
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
    }
    func testRecoveredUnmanagedImageUsesFrozenAuthorizedBytesAfterOriginalIsGone() async throws {
        let root = try temp(), id = UUID(), target = root.appendingPathComponent("doc.md")
        let assets = try store(root, id: id, document: target)
        let url = root.appendingPathComponent("user.svg")
        try image().write(to: url)
        let drafts = DraftStore(rootURL: root.appendingPathComponent("recovery"), documentID: id)
        try await drafts.persist(snapshot: Snapshot(text: "![x](user.svg)"), manifest: assets.manifest)
        try FileManager.default.removeItem(at: url)
        let recovery = try await drafts.recover()
        let manifest = try AssetStore.authorize(XCTUnwrap(recovery?.manifest), destinations: ["user.svg"])
        XCTAssertEqual(manifest.capabilities["user.svg"]?.data, try image())
    }
    func testPersistDraftRefreshesTypedLocalReferenceCapabilities() async throws {
        let root = try temp(), document = MarkdownDocument(), target = root.appendingPathComponent("doc.md")
        try image().write(to: root.appendingPathComponent("typed.svg"))
        document.fileURL = target
        try document.read(from: Data("![typed](typed.svg)".utf8), ofType: MarkdownDocument.typeName)
        _ = try NativeAssetIntegration.install(on: document, rootURL: root)
        try await XCTUnwrap(document.persistDraft)(document.mirror.snapshot, document.documentID)
        XCTAssertNotNil(document.bridge.assetMap["typed.svg"])
    }
    func testStaleDraftIsRejectedAfterStoreRestart() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let recoveryRoot = root.appendingPathComponent("recovery")
        let drafts = DraftStore(rootURL: recoveryRoot, documentID: id)
        try await drafts.persist(snapshot: Snapshot(text: "new", revision: 10), manifest: assets.manifest)
        let reopened = DraftStore(rootURL: recoveryRoot, documentID: id)
        do { try await reopened.persist(snapshot: Snapshot(text: "old", revision: 1), manifest: assets.manifest); XCTFail("stale generation accepted") }
        catch { XCTAssertEqual(error as? AssetStorageError, .staleDraft) }
        let recovered = try await reopened.recover()
        XCTAssertEqual(recovered?.snapshot.revision, 10)
    }
}

extension AssetsTests {
    func testProvenanceWriteFailurePreservesExistingBytesAndManifest() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        let original = try await assets.importImage(data: image(), suggestedName: "original.svg", documentID: id)
        let metadataDirectory = root.appendingPathComponent("state/\(id.uuidString)")
        let metadataURL = metadataDirectory.appendingPathComponent("manifest-untitled.json")
        let metadataBytes = try Data(contentsOf: metadataURL)
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: metadataDirectory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: metadataDirectory.path) }
        do { _ = try await assets.importImage(data: image(), suggestedName: "new.svg", documentID: id); XCTFail("provenance write succeeded without directory permission") } catch { }
        XCTAssertEqual(try Data(contentsOf: metadataURL), metadataBytes)
        XCTAssertEqual(try Data(contentsOf: original.fileURL), try image())
        let manifest = await assets.manifest
        XCTAssertEqual(manifest.managedAssets.count, 1)
    }
    func testRecoveredDraftImportsNeverMutateCompletedGenerationOrUseParentReferences() async throws {
        let root = try temp(), id = UUID(), assets = try store(root, id: id)
        _ = try await assets.importImage(data: image(), suggestedName: "original.svg", documentID: id)
        let drafts = DraftStore(rootURL: root.appendingPathComponent("recovery"), documentID: id)
        try await drafts.persist(snapshot: Snapshot(text: "draft", revision: 4), manifest: assets.manifest)
        let value = try await drafts.recover()
        let recovery = try XCTUnwrap(value)
        let generationAssets = recovery.generationURL.appendingPathComponent("assets")
        let before = try FileManager.default.contentsOfDirectory(atPath: generationAssets.path)
        let restored = try AssetStore(documentID: id, rootURL: root.appendingPathComponent("state"), recoveredManifest: recovery.manifest)
        let imported = try await restored.importImage(data: image(), suggestedName: "new.svg", documentID: id)
        XCTAssertFalse(imported.destination.hasPrefix("../"))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: generationAssets.path), before)
    }
}
