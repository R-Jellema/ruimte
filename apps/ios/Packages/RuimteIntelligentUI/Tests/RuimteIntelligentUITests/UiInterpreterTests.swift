import Foundation
import RuimtePulsar
import Testing

@testable import RuimteIntelligentUI

struct UiInterpreterTests {
    private func fixtures() throws -> [JSONValue] {
        let url = try #require(Bundle.module.url(forResource: "parity", withExtension: "json"))
        return try #require(JSONValue.decode(Data(contentsOf: url)).arrayValue)
    }

    private func block(_ name: String) throws -> JSONValue {
        try #require(fixtures().first { $0["name"] == .string(name) }?["request"]?["block"])
    }

    @Test func sharedInterpreterParity() async throws {
        let interpreter = UiInterpreter()
        for fixture in try fixtures() {
            let request = try #require(fixture["request"])
            let result = try await interpreter.evaluate(
                block: #require(request["block"]), values: request["values"] ?? .object([:]),
                queries: request["queries"] ?? .object([:]), change: request["change"],
                action: request["action"]?["nodeId"]?.stringValue)
            #expect(result == fixture["result"], "\(fixture["name"]?.stringValue ?? "fixture")")
        }
        // The generated parity row keeps the refused `$row` reference; the Each local is `row`.
        func local(_ value: JSONValue) -> JSONValue {
            if var object = value.objectValue {
                if object["kind"] == .string("reference"), object["name"] == .string("$row") {
                    object["name"] = .string("row")
                }
                return .object(object.mapValues(local))
            }
            if let array = value.arrayValue { return .array(array.map(local)) }
            return value
        }
        let repetition = local(try block("conditional repetition"))
        let shown = try await interpreter.evaluate(block: repetition)
        #expect(shown["diagnostics"] == .array([]))
        let tags = try #require(shown["nodes"]?.arrayValue).filter { $0["type"] == .string("Tag") }
        #expect(tags.compactMap { $0["children"]?.arrayValue?.first?["props"]?["text"]?.stringValue } == ["a", "b"])
        let hidden = try await interpreter.evaluate(block: repetition, values: .object(["$show": .bool(false)]))
        #expect(hidden["diagnostics"] == .array([]))
        #expect(hidden["nodes"]?.arrayValue?.compactMap { $0["type"]?.stringValue } == ["Switch"])
    }

    @Test func localInputUpdatesExpressionAndKeepsBlockIndependent() async throws {
        let interpreter = UiInterpreter()
        let block = try block("local input")
        let initial = try await interpreter.evaluate(block: block)
        let sliderID = try #require(initial["nodes"]?.arrayValue?.first?["id"])
        let changed = try await interpreter.evaluate(
            block: block,
            change: .object([
                "nodeId": sliderID, "prop": .string("value"), "value": .number(7),
            ]))
        #expect(changed["values"]?["$count"] == .number(7))
        let summary = try #require(changed["nodes"]?.arrayValue?.last?["children"]?.arrayValue)
        #expect(summary.contains { $0["props"]?["text"] == .string("10") })
        let separate = try await interpreter.evaluate(block: block)
        #expect(separate["values"]?["$count"] == .number(2))
    }

    @Test func incompleteBlocksAndUndeclaredValuesAreNotBindings() async throws {
        let interpreter = UiInterpreter()
        let block = try block("local input")
        var partial = try #require(block.objectValue)
        partial["complete"] = .bool(false)
        let initial = try await interpreter.evaluate(block: block)
        let nodeID = try #require(initial["nodes"]?.arrayValue?.first?["id"])
        await #expect {
            try await interpreter.evaluate(
                block: .object(partial),
                change: .object([
                    "nodeId": nodeID, "prop": .string("value"), "value": .number(7),
                ]))
        } throws: { error in
            if case UiInterpreterError.invalid(let message) = error {
                return message.contains("Only a completed supported block can accept local input.")
            }
            return false
        }
        await #expect {
            try await interpreter.evaluate(block: block, values: .object(["injected": .string("data")]))
        } throws: { error in
            if case UiInterpreterError.invalid(let message) = error {
                return message.contains("Only declared local input bindings can be changed.")
            }
            return false
        }
    }

    @Test func segmentedMembershipIsValidated() async throws {
        let interpreter = UiInterpreter()
        let block = try block("segmented input")
        let initial = try await interpreter.evaluate(block: block)
        let nodeID = try #require(initial["nodes"]?.arrayValue?.first?["id"])
        await #expect(throws: UiInterpreterError.self) {
            try await interpreter.evaluate(
                block: block,
                change: .object([
                    "nodeId": nodeID, "prop": .string("value"), "value": .string("not-an-option"),
                ]))
        }
    }

    @Test func aTextFieldTakesTextUpToItsLimitAndKeepsItsValueOtherwise() async throws {
        let interpreter = UiInterpreter()
        let block = try block("text field")
        let initial = try await interpreter.evaluate(block: block)
        let nodeID = try #require(initial["nodes"]?.arrayValue?.first?["id"])
        let changed = try await interpreter.evaluate(
            block: block,
            change: .object([
                "nodeId": nodeID, "prop": .string("value"), "value": .string("Grace"),
            ]))
        #expect(changed["values"]?["$name"] == .string("Grace"))
        let summary = try #require(changed["nodes"]?.arrayValue?.last?["children"]?.arrayValue)
        #expect(summary.contains { $0["props"]?["text"] == .string("Grace") })
        for refused in [JSONValue.string("Grace H"), .number(7)] {
            let kept = try await interpreter.evaluate(
                block: block,
                change: .object([
                    "nodeId": nodeID, "prop": .string("value"), "value": refused,
                ]))
            #expect(kept["values"]?["$name"] == .string("Ada"))
        }
        let again = try await interpreter.evaluate(block: block)
        #expect(again["values"]?["$name"] == .string("Ada"))
    }

    @Test func aSelectTakesOnlyTheValueOfAnOption() async throws {
        let interpreter = UiInterpreter()
        let block = try block("select input")
        let initial = try await interpreter.evaluate(block: block)
        let nodeID = try #require(initial["nodes"]?.arrayValue?.first?["id"])
        let changed = try await interpreter.evaluate(
            block: block,
            change: .object([
                "nodeId": nodeID, "prop": .string("value"), "value": .string("b"),
            ]))
        #expect(changed["values"]?["$mode"] == .string("b"))
        await #expect(throws: UiInterpreterError.self) {
            try await interpreter.evaluate(
                block: block,
                change: .object([
                    "nodeId": nodeID, "prop": .string("value"), "value": .string("not-an-option"),
                ]))
        }
    }

    @Test func pickingAPlaceSetsTheMapsValueToOneOfItsPlaces() async throws {
        let interpreter = UiInterpreter()
        let block = try block("map")
        let initial = try await interpreter.evaluate(block: block)
        let nodeID = try #require(initial["nodes"]?.arrayValue?.first?["id"])
        #expect(initial["values"]?["$picked"] == .string("dom"))
        let picked = try await interpreter.evaluate(
            block: block,
            change: .object([
                "nodeId": nodeID, "prop": .string("value"), "value": .string("ams"),
            ]))
        #expect(picked["values"]?["$picked"] == .string("ams"))
        await #expect(throws: UiInterpreterError.self) {
            try await interpreter.evaluate(
                block: block,
                change: .object([
                    "nodeId": nodeID, "prop": .string("value"), "value": .string("not-a-place"),
                ]))
        }
    }

    @Test func agentTextStaysDataAndOversizedInputIsRefused() async throws {
        let interpreter = UiInterpreter()
        let block = try block("local input")
        var contents = try #require(block.objectValue)
        var nodes = try #require(contents["nodes"]?.arrayValue)
        var slider = try #require(nodes.first?.objectValue)
        var children = try #require(slider["children"]?.arrayValue)
        var label = try #require(children.first?.objectValue)
        let script = "globalThis.injected = true; throw new Error('executed');"
        label["props"] = .object(["text": .string(script)])
        children[0] = .object(label)
        slider["children"] = .array(children)
        nodes[0] = .object(slider)
        contents["nodes"] = .array(nodes)
        let result = try await interpreter.evaluate(block: .object(contents))
        #expect(
            result["nodes"]?.arrayValue?.first?["children"]?.arrayValue?.first?["props"]?["text"] == .string(script))
        let budget = 1_048_576
        let emptyRequest = JSONValue.object([
            "block": .object(contents), "values": .object([:]), "queries": .object([:]),
        ])
        let padding = budget - (try emptyRequest.encoded()).count - 13
        contents["padding"] = .string(String(repeating: "a", count: padding))
        let atLimit: JSONValue = .object(["block": .object(contents), "values": .object([:]), "queries": .object([:])])
        #expect(try atLimit.encoded().count == budget)
        _ = try await interpreter.evaluate(block: .object(contents))
        contents["padding"] = .string(String(repeating: "a", count: padding + 1))
        await #expect {
            try await interpreter.evaluate(block: .object(contents))
        } throws: { error in
            if case UiInterpreterError.tooLarge = error { return true }
            return false
        }
        let again = try await interpreter.evaluate(block: block)
        #expect(again["values"]?["$count"] == .number(2))
    }

    @Test func aButtonSetsOnlyItsConstantAndADisabledOneRunsNothing() async throws {
        let interpreter = UiInterpreter()
        let block = try block("button action")
        let initial = try await interpreter.evaluate(block: block)
        let buttons = try #require(initial["nodes"]?.arrayValue).filter { $0["type"] == .string("Button") }
        let set = try #require(buttons.first?["id"]?.stringValue)
        let reset = try #require(buttons.last?["id"]?.stringValue)
        let pressed = try await interpreter.evaluate(block: block, action: set)
        #expect(pressed["values"]?["$mode"] == .string("b"))
        let restored = try await interpreter.evaluate(block: block, values: pressed["values"]!, action: reset)
        #expect(restored["values"]?["$mode"] == .string("a"))
        var disabled = try #require(block.objectValue)
        var nodes = try #require(disabled["nodes"]?.arrayValue)
        var first = try #require(nodes.first?.objectValue)
        var props = first["props"]?.objectValue ?? [:]
        props["disabled"] = .bool(true)
        first["props"] = .object(props)
        nodes[0] = .object(first)
        disabled["nodes"] = .array(nodes)
        await #expect(throws: UiInterpreterError.self) {
            try await interpreter.evaluate(block: .object(disabled), action: set)
        }
        await #expect(throws: UiInterpreterError.self) {
            try await interpreter.evaluate(block: block, action: "not-a-node")
        }
    }
}
