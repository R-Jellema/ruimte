import Foundation
import RuimtePulsar
import RuimteTransport
import Testing

@testable import Ruimte

@Suite @MainActor struct DeviceToolsTests {
    private static let reference: JSONValue = .object([
        "platform": .string("ios"), "kind": .string("simulator"), "name": .string("iPhone 18 Pro"),
        "runtime": .string("iOS 27.0"),
    ])

    private static func device(
        kind: String = "simulator", platform: String = "ios", state: String = "booted", tools: [String]? = nil,
        permissions: [String]? = nil
    ) -> JSONValue {
        var capabilities: [String: JSONValue] = [
            "boot": .bool(true), "shutdown": .bool(true), "stream": .bool(true), "input": .bool(true),
            "screenshot": .bool(true),
        ]
        if let tools { capabilities["tools"] = .array(tools.map(JSONValue.string)) }
        if let permissions { capabilities["permissions"] = .array(permissions.map(JSONValue.string)) }
        return .object([
            "deviceId": .string("UDID-1"), "backendId": .string("simctl"), "platform": .string(platform),
            "kind": .string(kind), "name": .string("iPhone 18 Pro"), "runtime": .string("iOS 27.0"),
            "state": .string(state), "capabilities": .object(capabilities),
        ])
    }

    @Test func aSimulatorThatAnnouncesNoToolsHasTheOldSixteenAndAPhoneNone() {
        #expect(DeviceTools.tools(Self.device()) == DeviceTools.simulatorFallback)
        #expect(DeviceTools.tools(Self.device(kind: "physical")).isEmpty)
        #expect(DeviceTools.tools(Self.device(tools: ["capture", "keyboard"])) == ["capture", "keyboard"])
    }

    @Test func permissionsKeepTheirOrderAndOnlyWhatTheDeviceNames() {
        #expect(DeviceTools.permissions(Self.device()) == DeviceTools.permissions)
        #expect(
            DeviceTools.permissions(Self.device(permissions: ["photos", "camera", "teleport"])) == ["camera", "photos"])
    }

    @Test func onlyASimulatorOrEmulatorThatAnnouncesEraseCanBeErased() {
        #expect(DeviceTools.canErase(Self.device(tools: ["erase"])))
        #expect(!DeviceTools.canErase(Self.device(tools: ["capture"])))
        #expect(!DeviceTools.canErase(Self.device(kind: "physical", tools: ["erase"])))
    }

    @Test func anActionCarriesTheTargetAndItsFields() {
        let payload = DeviceTools.action(Self.device(), "setAppearance", ["value": .string("dark")])
        #expect(
            payload
                == .object([
                    "deviceId": .string("UDID-1"), "backendId": .string("simctl"), "platform": .string("ios"),
                    "action": .string("setAppearance"), "value": .string("dark"),
                ]))
    }

    @Test func commandChordsStayTheAppsExceptPaste() {
        #expect(DeviceKeys.route(usage: 0x04, command: false) == .key(0x04))
        #expect(DeviceKeys.route(usage: 0x19, command: true) == .paste)
        #expect(DeviceKeys.route(usage: 0x04, command: true) == .pass)
        #expect(DeviceKeys.route(usage: 0xE3, command: false) == .pass)
        #expect(DeviceKeys.route(usage: 0, command: false) == .pass)
    }

    @Test func aScreenshotIsNamedAfterTheDeviceAndTheMoment() {
        var components = DateComponents()
        (components.year, components.month, components.day) = (2026, 10, 15)
        (components.hour, components.minute, components.second) = (9, 41, 7)
        let date = Calendar.current.date(from: components)!
        #expect(DeviceTools.captureName("iPad/Pro: 13", at: date) == "iPad-Pro- 13 2026-10-15 at 09.41.07.png")
    }

    @Test func aChangeGoesOutAsAnActionAndTheAnswerIsTheNewSettings() async {
        let machine = ToolsMachine(devices: [Self.device(tools: ["appearance"])])
        let model = DeviceToolsModel(client: machine, device: Self.device(tools: ["appearance"]))
        await model.load()
        #expect(model.setting("appearance") == .string("light"))

        #expect(await model.act("setAppearance", ["value": .string("dark")]))
        #expect(model.setting("appearance") == .string("dark"))
        #expect(machine.requests.last?.1["action"] == .string("setAppearance"))

        machine.refusal = "device-action-unavailable"
        #expect(!(await model.act("setAppearance", ["value": .string("light")])))
        #expect(model.problem != nil)
    }

    @Test func eraseStopsARunningSimulatorErasesItAndStartsItAgain() async {
        let machine = ToolsMachine(devices: [Self.device(tools: ["erase"])])
        let model = DeviceViewModel(client: machine, reference: Self.reference)
        await model.refresh()
        #expect(model.canErase)

        await model.erase()

        let steps = machine.requests.map(\.0).filter {
            ["device.shutdown", "device.action", "device.boot"].contains($0)
        }
        #expect(steps == ["device.shutdown", "device.action", "device.boot"])
        #expect(machine.requests.first { $0.0 == "device.action" }?.1["action"] == .string("erase"))
    }

    @Test func keysGoOutOnlyToADeviceThatAnnouncesTheKeyboard() async {
        let machine = ToolsMachine(devices: [Self.device(tools: ["keyboard"])])
        let model = DeviceViewModel(client: machine, reference: Self.reference)
        await model.refresh()
        #expect(model.takesKeys)
        model.key("down", usage: 0x04)
        for _ in 0..<20 where !machine.requests.contains(where: { $0.0 == "device.input" }) { await Task.yield() }
        #expect(
            machine.requests.first { $0.0 == "device.input" }?.1["input"]
                == .object(["kind": .string("key"), "phase": .string("down"), "usage": .number(4)]))

        let plain = DeviceViewModel(client: ToolsMachine(devices: [Self.device()]), reference: Self.reference)
        await plain.refresh()
        #expect(!plain.takesKeys)
    }
}

@MainActor private final class ToolsMachine: MachineRequesting {
    var devices: [JSONValue]
    var refusal: String?
    var requests: [(String, JSONValue)] = []
    private var settings: [String: JSONValue] = ["appearance": .string("light")]

    init(devices: [JSONValue]) { self.devices = devices }

    func request(_ type: String, payload: JSONValue) async throws -> JSONValue {
        requests.append((type, payload))
        if let refusal, type == "device.action" { throw MachineClientError.server(code: refusal, message: refusal) }
        switch type {
        case "device.list": return .object(["devices": .array(devices)])
        case "device.open": return (devices.first ?? .object([:])).setting("streamId", .string("device:1"))
        case "device.detail": return .object(["settings": .object(settings)])
        case "device.action":
            if payload.text("action") == "setAppearance" { settings["appearance"] = payload["value"] }
            return .object(["settings": .object(settings)])
        case "device.shutdown", "device.boot": return devices.first ?? .object([:])
        default: return .object([:])
        }
    }

    func subscribe(_ event: String, handler: @escaping @MainActor @Sendable (JSONValue) -> Void) -> () -> Void { {} }
}
