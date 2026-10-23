import RuimtePulsar
import RuimteTransport
import XCTest

@testable import Ruimte

final class OlderMachineTests: XCTestCase {
    private static let olderMachine =
        "This machine runs an older Ruimte. Update Ruimte there, or restart it to pick up the update."

    @MainActor private func openSession(
        _ answer: String
    ) async -> (session: SharedMachineSession, cleanup: () -> Void) {
        let connections = MachineConnections(scheduler: GateScheduler(), monitorPaths: false)
        connections.setScene("scene", foreground: true)
        let runtime = AppRuntime(connections: connections, deviceKey: DeviceKey())
        var link: GatedLink?
        let holder = connections.hold(
            machineID: "machine",
            open: { events in
                let opened = GatedLink(events: events)
                link = opened
                return opened
            }, events: LinkEvents(opened: {}, message: { _ in }, closed: { _ in }))
        let session = SharedMachineSession(
            machine: Machine(
                id: "machine", name: "Machine", icon: nil, publicKey: String(repeating: "A", count: 43),
                brokerUrl: "wss://broker.test", lastSeenAt: nil),
            runtime: runtime)
        session.retain()
        link?.gate.start()
        link?.gate.receive(answer)
        await waitForNativeState { session.connected || session.problem != nil }
        return (
            session,
            {
                session.release()
                holder.release()
                connections.shutdown()
            }
        )
    }

    @MainActor func testAMachineWithoutFeaturesLeavesTheOlderRuimteLineAsTheProblem() async {
        let (session, cleanup) = await openSession(#"{"id":"protocol","ok":true,"result":{"protocol":1}}"#)
        defer { cleanup() }
        XCTAssertFalse(session.connected)
        XCTAssertEqual(session.problem, Self.olderMachine)
    }

    @MainActor func testAMachineThatNamesItsFeaturesOpensAndAnswersThem() async {
        let (session, cleanup) = await openSession(#"{"id":"protocol","ok":true,"result":{"features":["git.status"]}}"#)
        defer { cleanup() }
        XCTAssertTrue(session.connected)
        XCTAssertNil(session.problem)
        XCTAssertTrue(session.rpc.answers(.gitStatus))
        XCTAssertFalse(session.rpc.answers(.gitLog))
    }
}

@MainActor private final class GateScheduler: TransportScheduling {
    func after(milliseconds: Double, _ action: @escaping @MainActor () -> Void) -> () -> Void { {} }
}

/// Opens the way the direct link does: through the gate, which hands over the features before `opened`.
@MainActor private final class GatedLink: MachineLink {
    private(set) var gate: ProtocolGate!
    init(events: LinkEvents) {
        gate = ProtocolGate(
            send: { _ in },
            open: { features in
                events.features(features)
                events.opened()
            },
            message: events.message, refuse: { events.closed($0) })
    }
    func send(_ text: String) throws {}
    func close() {}
}
