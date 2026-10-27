import Foundation
import RuimtePulsar
import Synchronization

/// How a link reached its machine, or tried to, as the desktop client's metrics name it (`linkPathOf` in
/// `apps/client/src/telemetry/metrics.ts`). A phone has no socket of its own machine, so it is never `local`.
public enum LinkPath: String, Sendable {
    case lan
    case direct
    case turn

    /// The route the link last said, where none yet is a direct channel through the broker.
    init(_ route: LinkRoute?) {
        switch route {
        case .localNetwork: self = .lan
        case .relayed: self = .turn
        case .broker, nil: self = .direct
        }
    }
}

public enum LinkOutcome: String, Sendable {
    case ok
    case failed
}

/// Why the pool opens a new link, with the desktop client's words: the open one dropped, an attempt failed, the
/// machine refused it at the protocol check or it did not come up in time, or something asked for a new one.
public enum LinkReconnectReason: String, Sendable {
    case dropped
    case failed
    case refused
    case timeout
    case `switch`
}

/// A measurement of a link or a request, for the app's metrics. Fixed values only, never a machine or a payload.
public enum LinkMeasure: Equatable, Sendable {
    /// From the start of an attempt until the protocol check passed, or until the attempt failed.
    case connected(path: LinkPath, outcome: LinkOutcome, milliseconds: Double)
    case reconnecting(LinkReconnectReason)
    /// From sending a request until its reply, an error included; a request without one is never measured.
    case answered(area: String, milliseconds: Double)

    /// Every part before the dot of a request this app knows, which is the client's `REQUEST_AREAS`.
    static let areas = Set(WireRequest.allCases.map { area(in: $0.rawValue) })

    private static func area(in type: String) -> String {
        String(type.prefix { $0 != "." })
    }

    /// The part of a request type before its dot, or `other` for one the wire does not have.
    public static func area(of type: String) -> String {
        let area = area(in: type)
        return areas.contains(area) ? area : "other"
    }
}

/// Where the transport hands its measurements. The package measures for nobody itself; the app sets the meter once.
public enum LinkMeasures {
    private static let meter = Mutex<@Sendable (LinkMeasure) -> Void>({ _ in })

    /// Takes the place of the meter within a task, so tests that run side by side each hear their own.
    @TaskLocal static var observer: (@Sendable (LinkMeasure) -> Void)?

    public static func setMeter(_ record: @escaping @Sendable (LinkMeasure) -> Void) {
        meter.withLock { $0 = record }
    }

    static func record(_ measure: LinkMeasure) {
        if let observer {
            observer(measure)
            return
        }
        meter.withLock { $0 }(measure)
    }
}
