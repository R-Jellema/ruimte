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
            return fail(.missingMarker)
        }
        let body = String(piece.unicodeScalars.dropFirst())
        length += body.utf16.count
        guard length <= maxChars else {
            return fail(.tooLarge(limit: maxChars))
        }
        parts.append(body)
        if mark == "+" {
            return .partial
        }
        defer { reset() }
        return .frame(parts.joined())
    }

    private mutating func fail(_ reason: Failure) -> FramePiece {
        failure = reason
        reset()
        return .invalid
    }

    private mutating func reset() {
        parts.removeAll()
        length = 0
    }
}

public enum BinaryFramePiece: Equatable {
    case partial
    case frame(Data)
    case invalid
}

/// Joins the pieces of a frame whose first byte says whether more follow: a binary frame (`splitBinaryFrame` in the
/// contracts), or a text frame the machine deflated (`splitDeflatedFrame`), which stays deflated. Text pieces and
/// the two kinds each have marks of their own, so a text piece that arrives as binary still reads as text.
public struct MarkedFrameAssembler {
    public static var binary: Self { Self(more: 0x01, last: 0x02) }
    public static var deflated: Self { Self(more: 0x03, last: 0x04) }

    private let more: UInt8
    private let last: UInt8
    private var parts = Data()

    private init(more: UInt8, last: UInt8) {
        self.more = more
        self.last = last
    }

    public func accepts(_ piece: Data) -> Bool { piece.first == more || piece.first == last }

    public mutating func push(_ piece: Data, maxBytes: Int) -> BinaryFramePiece {
        guard accepts(piece), parts.count + piece.count - 1 <= maxBytes else {
            parts = Data()
            return .invalid
        }
        parts.append(piece.dropFirst())
        if piece.first == more { return .partial }
        defer { parts = Data() }
        return .frame(parts)
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
        guard compression_stream_init(stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK
        else {
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
