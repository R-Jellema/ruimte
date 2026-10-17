import Compression
import Foundation
import RuimtePulsar

public enum FramePiece: Equatable {
    case partial
    case frame(String)
    case invalid
}

public enum DirectFraming {
    // Deployed daemons send complete chat histories, which can exceed the WebSocket default of 16 Mi characters.
    public static let authenticatedFrameChars = 64 * 1_024 * 1_024
    public static let handshakeFrameChars = 4_096

    public static func split(_ frame: String, pieceChars: Int = WireConstants.directPieceChars) -> [String] {
        precondition(pieceChars >= 2)
        let units = frame.utf16
        let unitCount = units.count
        if unitCount <= pieceChars {
            return ["=" + frame]
        }
        var pieces: [String] = []
        pieces.reserveCapacity(unitCount / pieceChars + (unitCount.isMultiple(of: pieceChars) ? 0 : 1))
        var start = units.startIndex
        while start < units.endIndex {
            var end = units.index(start, offsetBy: pieceChars, limitedBy: units.endIndex) ?? units.endIndex
            if end < units.endIndex {
                let previous = units.index(before: end)
                if (0xD800...0xDBFF).contains(units[previous]) {
                    end = previous
                }
            }
            pieces.append((end == units.endIndex ? "=" : "+") + String(decoding: units[start..<end], as: UTF16.self))
            start = end
        }
        return pieces
    }
}

public struct FrameAssembler {
    public enum Failure: Equatable {
        case missingMarker
        case tooLarge(limit: Int)
    }

    private var parts: [String] = []
    private var length = 0
    public private(set) var failure: Failure?

    public init() {}

    public mutating func push(_ piece: String, maxChars: Int) -> FramePiece {
        failure = nil
        guard let mark = piece.unicodeScalars.first, mark == "+" || mark == "=" else {
            failure = .missingMarker
            parts.removeAll()
            length = 0
            return .invalid
        }
        let body = String(piece.unicodeScalars.dropFirst())
        length += body.utf16.count
        if length > maxChars {
            failure = .tooLarge(limit: maxChars)
            parts.removeAll()
            length = 0
            return .invalid
        }
        parts.append(body)
        if mark == "+" {
            return .partial
        }
        let frame = parts.joined()
        parts.removeAll()
        length = 0
        return .frame(frame)
    }
}

public enum BinaryFramePiece: Equatable {
    case partial
    case frame(Data)
    case invalid
}

/// Joins the pieces of a binary frame (`splitBinaryFrame` in the contracts), whose first byte says whether more follow.
/// No text piece starts with those bytes, so a text piece that arrives as binary still reads as text.
public struct BinaryFrameAssembler {
    private static let more: UInt8 = 0x01
    private static let last: UInt8 = 0x02
    private var parts = Data()

    public init() {}

    public static func isBinaryPiece(_ piece: Data) -> Bool { piece.first == more || piece.first == last }

    public mutating func push(_ piece: Data, maxBytes: Int) -> BinaryFramePiece {
        guard Self.isBinaryPiece(piece), parts.count + piece.count - 1 <= maxBytes else {
            parts = Data()
            return .invalid
        }
        parts.append(piece.dropFirst())
        if piece.first == Self.more { return .partial }
        let frame = parts
        parts = Data()
        return .frame(frame)
    }
}

/// Joins the pieces of a text frame the machine deflated (`splitDeflatedFrame` in the contracts); the frame stays deflated.
/// Its marks are neither a text piece's nor a binary frame's, so the three never join one another.
public struct DeflatedFrameAssembler {
    private static let more: UInt8 = 0x03
    private static let last: UInt8 = 0x04
    private var parts = Data()

    public init() {}

    public static func isDeflatedPiece(_ piece: Data) -> Bool { piece.first == more || piece.first == last }

    public mutating func push(_ piece: Data, maxBytes: Int) -> BinaryFramePiece {
        guard Self.isDeflatedPiece(piece), parts.count + piece.count - 1 <= maxBytes else {
            parts = Data()
            return .invalid
        }
        parts.append(piece.dropFirst())
        if piece.first == Self.more { return .partial }
        let frame = parts
        parts = Data()
        return .frame(frame)
    }
}

public enum InflateFailure: Error, Equatable {
    case tooLarge
    case invalid
}

extension DirectFraming {
    /// Inflates raw DEFLATE, which is what `COMPRESSION_ZLIB` reads, and stops once the text would pass `maxBytes`.
    public static func inflate(_ deflated: Data, maxBytes: Int) throws(InflateFailure) -> String {
        let bufferSize = 64 * 1_024
        let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
        defer { stream.deallocate() }
        guard compression_stream_init(stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
            throw .invalid
        }
        defer { compression_stream_destroy(stream) }
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }
        var output = Data()
        let failure: InflateFailure? = deflated.withUnsafeBytes { source in
            guard let base = source.bindMemory(to: UInt8.self).baseAddress else { return .invalid }
            stream.pointee.src_ptr = base
            stream.pointee.src_size = source.count
            while true {
                stream.pointee.dst_ptr = buffer
                stream.pointee.dst_size = bufferSize
                let status = compression_stream_process(stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
                output.append(buffer, count: bufferSize - stream.pointee.dst_size)
                if output.count > maxBytes { return .tooLarge }
                switch status {
                case COMPRESSION_STATUS_OK: continue
                case COMPRESSION_STATUS_END: return nil
                default: return .invalid
                }
            }
        }
        if let failure { throw failure }
        guard let frame = String(data: output, encoding: .utf8) else { throw .invalid }
        return frame
    }
}

public struct ChannelLiveness {
    public enum Action: Equatable {
        case none
        case ping(String)
        case dead
    }

    private var lastHeard: Double
    private var lastReceived: Double?
    private var pingSentAt: Double?
    private var nextID = 1
    private let idleMs: Double
    private let timeoutMs: Double

    public init(
        now: Double, idleMs: Double = WireConstants.directPingIdleMs,
        timeoutMs: Double = WireConstants.directPingTimeoutMs
    ) {
        lastHeard = now
        self.idleMs = idleMs
        self.timeoutMs = timeoutMs
    }

    public mutating func heard(now: Double) {
        lastHeard = now
        pingSentAt = nil
    }

    public mutating func tick(now: Double, received: Double? = nil) -> Action {
        if let received {
            let grew = lastReceived.map { received > $0 } ?? false
            lastReceived = received
            if grew {
                heard(now: now)
                return .none
            }
        }
        if let pingSentAt {
            return now - pingSentAt >= timeoutMs ? .dead : .none
        }
        if now - lastHeard >= idleMs {
            pingSentAt = now
            let id = "alive-\(nextID)"
            nextID += 1
            return .ping(id)
        }
        return .none
    }
}
