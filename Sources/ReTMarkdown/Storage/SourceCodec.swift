import Foundation

public enum SourceCodecError: Error, Equatable, Sendable {
    case invalidUTF8, invalidSource, invalidPatch
}
public enum SourceCodec {
    public static func decode(_ data: Data) throws -> Source {
        // Foundation's failable initializer rejects malformed UTF-8; never use a repairing decoder here.
        guard String(data: data, encoding: .utf8) != nil else { throw SourceCodecError.invalidUTF8 }
        let bytes = Array(data)
        let bom = bytes.starts(with: [0xef, 0xbb, 0xbf])
        var index = bom ? 3 : 0
        var normalized: [UInt8] = []
        normalized.reserveCapacity(bytes.count)
        var eols: [EOL] = []
        while index < bytes.count {
            let byte = bytes[index]
            if byte == 13 {
                if index + 1 < bytes.count && bytes[index + 1] == 10 {
                    eols.append("\r\n")
                    index += 1
                } else { eols.append("\r") }
                normalized.append(10)
            } else {
                if byte == 10 { eols.append("\n") }
                normalized.append(byte)
            }
            index += 1
        }
        return Source(text: String(decoding: normalized, as: UTF8.self), eols: eols, bom: bom)
    }

    public static func encode(_ source: Source) throws -> Data {
        try validate(text: source.text, eols: source.eols)
        var bytes = Data()
        bytes.reserveCapacity(source.text.utf8.count)
        if source.bom { bytes.append(contentsOf: [0xef, 0xbb, 0xbf]) }
        var line = 0
        for byte in source.text.utf8 {
            if byte == 10 {
                bytes.append(contentsOf: source.eols[line].utf8)
                line += 1
            } else { bytes.append(byte) }
        }
        return bytes
    }

    public static func applying(_ patches: [Patch], to source: Source) throws -> Source {
        try validate(text: source.text, eols: source.eols)
        // Array indexing is deliberately UTF-16, not Swift Character/grapheme indexing.
        let original = Array(source.text.utf16)
        var previousEnd = 0
        for patch in patches {
            guard isBoundary(patch.from, in: original), isBoundary(patch.to, in: original),
                  patch.from >= previousEnd, patch.to >= patch.from else { throw SourceCodecError.invalidPatch }
            try validate(text: patch.insert, eols: patch.eols)
            previousEnd = patch.to
        }
        var result: [UInt16] = []
        result.reserveCapacity(original.count)
        var eols: [EOL] = []
        var cursor = 0
        var line = 0
        func consume(until end: Int, keep: Bool) {
            if keep { result.append(contentsOf: original[cursor..<end]) }
            while cursor < end {
                if original[cursor] == 10 {
                    if keep { eols.append(source.eols[line]) }
                    line += 1
                }
                cursor += 1
            }
        }
        for patch in patches {
            consume(until: patch.from, keep: true)
            consume(until: patch.to, keep: false)
            result.append(contentsOf: patch.insert.utf16)
            eols.append(contentsOf: patch.eols)
        }
        consume(until: original.count, keep: true)
        return Source(text: String(decoding: result, as: UTF16.self), eols: eols, bom: source.bom)
    }

    static func validate(text: String, eols: [EOL]) throws {
        var lines = 0
        for byte in text.utf8 {
            if byte == 13 { throw SourceCodecError.invalidSource }
            if byte == 10 { lines += 1 }
        }
        guard lines == eols.count, eols.allSatisfy({ $0 == "\n" || $0 == "\r\n" || $0 == "\r" }) else {
            throw SourceCodecError.invalidSource
        }
    }

    private static func isBoundary(_ offset: Int, in text: [UInt16]) -> Bool {
        guard offset >= 0, offset <= text.count else { return false }
        if offset == 0 || offset == text.count { return true }
        return !(0xd800...0xdbff).contains(text[offset - 1]) || !(0xdc00...0xdfff).contains(text[offset])
    }
}
