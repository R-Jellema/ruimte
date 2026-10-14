import RuimtePulsar
import RuimteTransport

@MainActor
enum TerminalSnapshot {
    static func load(
        attachment: MachineAttachment, sessionID: String,
        onSnapshot: @escaping @MainActor @Sendable (JSONValue) -> Void
    ) async throws -> JSONValue {
        let payload: JSONValue = .object(["sessionId": .string(sessionID), "follow": .bool(true)])
        return try await attachment.snapshot(payload: payload, onSnapshot: onSnapshot)
    }
}
