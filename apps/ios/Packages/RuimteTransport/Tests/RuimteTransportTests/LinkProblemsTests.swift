import Foundation
import RuimtePulsar
import Synchronization
import Testing

@testable import RuimteTransport

private final class Heard: Sendable {
    private let problems = Mutex<[LinkProblem]>([])
    var all: [LinkProblem] { problems.withLock { $0 } }
    func append(_ problem: LinkProblem) { problems.withLock { $0.append(problem) } }
}

@MainActor private final class ClosingLink: MachineLink {
    let events: LinkEvents
    init(events: LinkEvents) { self.events = events }
    func send(_ text: String) throws {}
    func close() { events.closed(nil) }
}

@MainActor private final class ManualClock: TransportScheduling {
    var actions: [UUID: @MainActor () -> Void] = [:]
    func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void {
        let id = UUID()
        actions[id] = action
        return { self.actions.removeValue(forKey: id) }
    }
    func fire() { for action in Array(actions.values) { action() } }
}

@MainActor private func problems(during body: () -> Void) -> [LinkProblem] {
    let heard = Heard()
    LinkProblems.$observer.withValue({ heard.append($0) }, operation: body)
    return heard.all
}

@MainActor private func problemsAwaiting(_ body: () async -> Void) async -> [LinkProblem] {
    let heard = Heard()
    await LinkProblems.$observer.withValue({ heard.append($0) }, operation: body)
    return heard.all
}

@MainActor struct LinkProblemsTests {
    @Test func anOpenLinkThatClosesOnItsOwnIsADrop() {
        var link: ClosingLink!
        let pool = MachineConnections(scheduler: ManualClock(), monitorPaths: false)
        pool.setScene("scene", foreground: true)
        let lease = pool.hold(
            machineID: "machine",
            open: {
                link = ClosingLink(events: $0)
                return link
            }, events: LinkEvents(opened: {}, message: { _ in }, closed: { _ in }))
        defer {
            lease.release()
            pool.shutdown()
        }
        let beforeOpening = problems { link.events.closed(TransportFailure.invalid("The direct connection closed.")) }
        #expect(beforeOpening.isEmpty)
        pool.reconnect(machineID: "machine")
        link.events.opened()
        let whileOpen = problems { link.events.closed(TransportFailure.invalid("The direct connection closed.")) }
        #expect(whileOpen == [.dropped])
    }

    @Test func aLinkThisPhoneLetsGoIsNoDrop() {
        var link: ClosingLink!
        let pool = MachineConnections(scheduler: ManualClock(), monitorPaths: false)
        pool.setScene("scene", foreground: true)
        let lease = pool.hold(
            machineID: "machine",
            open: {
                link = ClosingLink(events: $0)
                return link
            }, events: LinkEvents(opened: {}, message: { _ in }, closed: { _ in }))
        link.events.opened()
        let heard = problems {
            pool.setScene("scene", foreground: false)
            pool.forget(machineID: "machine")
            lease.release()
            pool.shutdown()
        }
        #expect(heard.isEmpty)
    }

    @Test func aReadWithoutAnAnswerIsATimeout() async {
        let clock = ManualClock()
        let client = MachineClient(send: { _ in clock.fire() }, scheduler: clock, connected: true)
        let heard = await problemsAwaiting { _ = try? await client.request("server.ping") }
        #expect(heard == [.timeout(request: "server.ping")])
    }

    @Test func aMachineWithoutFeaturesIsRefusedAsOlder() {
        let gate = ProtocolGate(send: { _ in }, open: { _ in }, message: { _ in }, refuse: { _ in })
        let heard = problems { gate.receive(#"{"id":"protocol","ok":true,"result":{"protocol":1}}"#) }
        #expect(heard == [.refused(mismatch: .daemonOlder)])
    }

    @Test func aChallengeOnAnotherWireVersionNamesWhichSide() {
        let machine = DeviceKey()
        let heard = [Double(WireConstants.protocolVersion) - 1, Double(WireConstants.protocolVersion) + 1].flatMap {
            version in
            let challenge: JSONValue = .object([
                "type": .string("direct.challenge"), "protocol": .number(version), "challenge": .string("nonce"),
                "daemon": .object([
                    "id": .string("machine"), "publicKey": .string(machine.publicKey), "signature": .string("x"),
                ]),
            ])
            return problems {
                _ = try? DirectIdentity.proof(
                    challenge: challenge, binding: "binding", machineID: "machine", machineKey: machine.publicKey,
                    signer: machine)
            }
        }
        #expect(heard == [.refused(mismatch: .daemonOlder), .refused(mismatch: .daemonNewer)])
    }
}
