import Foundation
import XCTest
@testable import ReTMarkdown

final class SourceCodecTests: XCTestCase {
    func testSourceAndSnapshotIdentityDistinguishesUnicodeBytes() {
        let composed = Source(text: "é")
        let decomposed = Source(text: "e\u{301}")
        XCTAssertNotEqual(composed, decomposed)
        XCTAssertNotEqual(Snapshot(source: composed), Snapshot(source: decomposed))
        XCTAssertEqual(Source(text: "😀\n", eols: ["\r"]), Source(text: "😀\n", eols: ["\r"]))
        XCTAssertNotEqual(Snapshot(source: composed, revision: 1), Snapshot(source: composed, revision: 2))
    }
    func testRoundTripBytesAndExactNormalizedMetadata() throws {
        for text in ["", "\u{feff}", "\u{feff}\u{feff}x", "a\r\nb\rc\nend", "a\r\n", "a\r", "a\n", "e\u{301} ≠ é 😀 中\0"] {
            let bytes = Data(text.utf8)
            XCTAssertEqual(try SourceCodec.encode(SourceCodec.decode(bytes)), bytes)
        }
        let source = try SourceCodec.decode(Data("\u{feff}a\r\nb\rc\n\u{feff}e\u{301}".utf8))
        XCTAssertEqual(Array(source.text.utf8), Array("a\nb\nc\n\u{feff}e\u{301}".utf8))
        XCTAssertEqual(source.eols, ["\r\n", "\r", "\n"])
        XCTAssertTrue(source.bom)
        XCTAssertEqual(try SourceCodec.encode(Source()), Data())
    }

    func testControllerFixturesRoundTrip() throws {
        let root = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixtures = root.appendingPathComponent("build/fixtures")
        let files = try FileManager.default.contentsOfDirectory(at: fixtures, includingPropertiesForKeys: nil).filter { $0.pathExtension == "md" }
        XCTAssertGreaterThanOrEqual(files.count, 9)
        for file in files {
            let input = try Data(contentsOf: file)
            XCTAssertEqual(try SourceCodec.encode(SourceCodec.decode(input)), input, file.lastPathComponent)
        }
    }

    func testMalformedUTF8Fails() {
        for input: [UInt8] in [[0xff], [0x80], [0xc0, 0xaf], [0xc2], [0xe2, 0x28, 0xa1], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xef, 0xbb]] {
            XCTAssertThrowsError(try SourceCodec.decode(Data(input)))
        }
    }

    func testInvalidSourceFailsEvenWithoutPatches() {
        for source in [Source(text: "a\n", eols: []), Source(text: "a", eols: ["\n"]), Source(text: "a\n", eols: ["bad"]), Source(text: "a\r")] {
            XCTAssertThrowsError(try SourceCodec.encode(source))
            XCTAssertThrowsError(try SourceCodec.applying([], to: source))
        }
    }

    func testMiddleEditPreservesPrefixSuffixAndOriginal() throws {
        let prefix = "\u{feff}---\r\nx: e\u{301}\r---\n\n"
        let suffix = "\r\n\r<custom a=\"x\">😀</custom>\n"
        let original = Data((prefix + "middle" + suffix).utf8)
        let source = try SourceCodec.decode(original)
        let from = try SourceCodec.decode(Data(prefix.utf8)).text.utf16.count
        let result = try SourceCodec.applying([Patch(from: from, to: from + 6, insert: "中间", eols: [])], to: source)
        XCTAssertEqual(try SourceCodec.encode(result), Data((prefix + "中间" + suffix).utf8))
        XCTAssertEqual(try SourceCodec.encode(source), original)
    }

    func testSimultaneousPatchesPreserveUnaffectedTerminators() throws {
        let source = try SourceCodec.decode(Data("😀a\r\nb\rc\nend".utf8))
        let result = try SourceCodec.applying([
            Patch(from: 2, to: 4, insert: "X\nY\n", eols: ["\r", "\r\n"]),
            Patch(from: 6, to: 7, insert: "Z", eols: [])
        ], to: source)
        XCTAssertEqual(try SourceCodec.encode(result), Data("😀X\rY\r\nb\rZ\nend".utf8))
    }

    func testUTF16NotGraphemeCoordinates() throws {
        let source = Source(text: "e\u{301}😀")
        let result = try SourceCodec.applying([Patch(from: 1, to: 2, insert: "", eols: [])], to: source)
        XCTAssertEqual(Array(result.text.utf8), Array("e😀".utf8))
        let emoji = try SourceCodec.applying([Patch(from: 2, to: 4, insert: "中", eols: [])], to: source)
        XCTAssertEqual(Array(emoji.text.utf8), Array("e\u{301}中".utf8))
    }

    func testAdjacentInsertionsAndDeleteThroughEnd() throws {
        let inserted = try SourceCodec.applying([
            Patch(from: 1, to: 1, insert: "X", eols: []), Patch(from: 1, to: 1, insert: "Y", eols: [])
        ], to: Source(text: "ab"))
        XCTAssertEqual(inserted.text, "aXYb")
        let deleted = try SourceCodec.applying([Patch(from: 1, to: 6, insert: "", eols: [])], to: SourceCodec.decode(Data("a\r\nb\rc\n".utf8)))
        XCTAssertEqual(try SourceCodec.encode(deleted), Data("a".utf8))
    }

    func testMalformedPatchTransactionsFailAtomically() throws {
        let source = try SourceCodec.decode(Data("😀a\r\nb".utf8))
        let original = try SourceCodec.encode(source)
        let invalid: [[Patch]] = [
            [Patch(from: 1, to: 2)], [Patch(from: 0, to: 1)], [Patch(from: -1, to: 0)],
            [Patch(from: 0, to: 99)], [Patch(from: 3, to: 2)], [Patch(from: Int.max, to: Int.max)],
            [Patch(from: 3, to: 3), Patch(from: 2, to: 2)], [Patch(from: 0, to: 3), Patch(from: 2, to: 4)],
            [Patch(from: 2, to: 2, insert: "\r")], [Patch(from: 2, to: 2, insert: "\n")],
            [Patch(from: 2, to: 2, eols: ["\n"])], [Patch(from: 2, to: 2, insert: "\n", eols: ["bad"])],
            [Patch(from: 2, to: 2, insert: "valid"), Patch(from: 3, to: 4, insert: "\n")]
        ]
        for patches in invalid {
            XCTAssertThrowsError(try SourceCodec.applying(patches, to: source))
            XCTAssertEqual(try SourceCodec.encode(source), original)
        }
    }

    func testSnapshotWireIsFlatAndCommitCarriesSelection() throws {
        let snapshot = Snapshot(source: Source(text: "e\u{301}\n", eols: ["\r"], bom: true), revision: 7)
        let encoded = try JSONEncoder().encode(snapshot)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["text", "eols", "bom", "revision"])
        XCTAssertEqual(object["revision"] as? Int, 7)
        XCTAssertEqual(try SourceCodec.encode(JSONDecoder().decode(Snapshot.self, from: encoded).source), Data("\u{feff}e\u{301}\r".utf8))
        let json = #"{"base":0,"revision":1,"patches":[{"from":0,"to":0,"insert":"😀\n","eols":["\r\n"]}],"selection":{"anchor":3,"head":3},"reason":"edit"}"#
        let commit = try JSONDecoder().decode(Commit.self, from: Data(json.utf8))
        XCTAssertEqual(commit.selection, Selection(anchor: 3, head: 3))
        XCTAssertEqual(try SourceCodec.encode(SourceCodec.applying(commit.patches, to: Source())), Data("😀\r\n".utf8))
        XCTAssertEqual(try JSONSerialization.jsonObject(with: JSONEncoder().encode(commit)) as? NSDictionary, try JSONSerialization.jsonObject(with: Data(json.utf8)) as? NSDictionary)
    }

    func testWireRejectsInvalidSourceMetadataAndMissingRequiredFields() {
        for json in [
            #"{"text":"a\n","eols":[],"bom":false}"#,
            #"{"text":"a\n","eols":["bad"],"bom":false}"#,
            #"{"text":"a\r","eols":[],"bom":false}"#,
            #"{"text":"\ud800","eols":[],"bom":false}"#,
            #"{"text":"","eols":[]}"#,
            #"{"text":"","eols":[],"bom":"false"}"#
        ] {
            XCTAssertThrowsError(try JSONDecoder().decode(Source.self, from: Data(json.utf8)), json)
        }
    }

    func testWireRejectsUnsafeRevisionsOffsetsAndReversedRanges() {
        for revision in ["-1", "9007199254740992", "1.5"] {
            let json = "{\"text\":\"\",\"eols\":[],\"bom\":false,\"revision\":\(revision)}"
            XCTAssertThrowsError(try JSONDecoder().decode(Snapshot.self, from: Data(json.utf8)))
        }
        for json in [#"{"anchor":-1,"head":0}"#, #"{"anchor":0,"head":9007199254740992}"#] {
            XCTAssertThrowsError(try JSONDecoder().decode(Selection.self, from: Data(json.utf8)))
        }
        for json in [
            #"{"from":-1,"to":0,"insert":"","eols":[]}"#,
            #"{"from":2,"to":1,"insert":"","eols":[]}"#,
            #"{"from":0,"to":9007199254740992,"insert":"","eols":[]}"#,
            #"{"from":0,"to":0,"insert":"\n","eols":[]}"#
        ] {
            XCTAssertThrowsError(try JSONDecoder().decode(Patch.self, from: Data(json.utf8)))
        }
        for json in [#"{"from":2,"to":1}"#, #"{"from":-1,"to":0}"#] {
            XCTAssertThrowsError(try JSONDecoder().decode(SourceRange.self, from: Data(json.utf8)))
        }
        for revisions in [(0, 0), (2, 1), (-1, 1), (0, 9_007_199_254_740_992)] {
            let json = "{\"base\":\(revisions.0),\"revision\":\(revisions.1),\"patches\":[],\"selection\":{\"anchor\":0,\"head\":0},\"reason\":\"undo\"}"
            XCTAssertThrowsError(try JSONDecoder().decode(Commit.self, from: Data(json.utf8)))
        }
    }

    func testEnvelopeRoundTripVersionAndTypeAllowlist() throws {
        let json = #"{"v":1,"documentID":"doc","sessionID":"session","id":"web-1","replyTo":"native-1","type":"commit","payload":{"base":0,"revision":1,"patches":[{"from":0,"to":0,"insert":"😀\n","eols":["\r\n"]}],"selection":{"anchor":3,"head":3},"reason":"edit"}}"#
        let envelope = try JSONDecoder().decode(BridgeEnvelope<Commit>.self, from: Data(json.utf8))
        XCTAssertEqual(envelope.type, .commit)
        XCTAssertEqual(envelope.replyTo, "native-1")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: JSONEncoder().encode(envelope)) as? NSDictionary,
                       try JSONSerialization.jsonObject(with: Data(json.utf8)) as? NSDictionary)
        for invalid in [json.replacingOccurrences(of: "\"v\":1", with: "\"v\":2"),
                        json.replacingOccurrences(of: "\"type\":\"commit\"", with: "\"type\":\"executeScript\""),
                        json.replacingOccurrences(of: "\"documentID\":\"doc\"", with: "\"documentID\":\"\"")] {
            XCTAssertThrowsError(try JSONDecoder().decode(BridgeEnvelope<Commit>.self, from: Data(invalid.utf8)))
        }
    }
}
