import Synchronization

/// What a link to a machine went through, for a crash report. Never a payload, an address or a machine's name.
public enum LinkProblem: Equatable, Sendable {
    /// A link that was open closed without this phone letting it go.
    case dropped
    /// A read got no answer in time.
    case timeout(request: String)
    /// The machine runs another wire version than this app.
    case refused(mismatch: ProtocolMismatch)
}

/// The values `protocolMismatch` in `packages/contracts` names.
public enum ProtocolMismatch: String, Sendable {
    case daemonOlder = "daemon-older"
    case daemonNewer = "daemon-newer"
}

/// Where the transport hands its problems. The package reports nowhere itself; the app sets the reporter once.
public enum LinkProblems {
    private static let reporter = Mutex<@Sendable (LinkProblem) -> Void>({ _ in })
    /// Takes the place of the reporter within a task, so tests that run side by side each hear their own.
    @TaskLocal static var observer: (@Sendable (LinkProblem) -> Void)?

    public static func setReporter(_ report: @escaping @Sendable (LinkProblem) -> Void) {
        reporter.withLock { $0 = report }
    }

    static func report(_ problem: LinkProblem) {
        if let observer {
            observer(problem)
            return
        }
        reporter.withLock { $0 }(problem)
    }
}
