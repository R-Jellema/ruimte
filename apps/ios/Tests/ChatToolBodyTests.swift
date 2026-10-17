import RuimtePulsar
import XCTest

@testable import Ruimte

final class ChatToolBodyTests: XCTestCase {
    func testAShellCallShowsItsCommandWholeAndTheRestAsKeyAndValue() {
        let lines = ChatToolBody.lines(
            name: "Bash",
            input: .object([
                "command": .string("bun test"), "description": .string("Run the tests"), "timeout": .number(60000),
                "run_in_background": .bool(false),
            ]))
        XCTAssertEqual(lines.command, "bun test")
        XCTAssertEqual(
            lines.arguments, [argument("run_in_background", "false"), argument("timeout", "60000")])
        XCTAssertNil(lines.text)
    }

    func testARuimteCallShowsItsWholeCommandToo() {
        let command = #"ruimte-context node new note --view main --title "Open punten""#
        XCTAssertEqual(ChatToolBody.lines(name: "Bash", input: .object(["command": .string(command)])).command, command)
    }

    func testEveryOtherCallShowsItsInputAsKeyAndValueWithAnythingButTextAsCompactJSON() {
        let lines = ChatToolBody.lines(
            name: "TodoWrite",
            input: .object([
                "todos": .array([.object(["content": .string("Ship it"), "status": .string("pending")])]),
                "note": .string(""), "path": .string("/a/b.ts"), "gone": .null,
            ]))
        XCTAssertNil(lines.command)
        XCTAssertEqual(
            lines.arguments,
            [
                argument("gone", "null"), argument("note", #""""#), argument("path", "/a/b.ts"),
                argument("todos", #"[{"content":"Ship it","status":"pending"}]"#),
            ])
    }

    func testAShellCallWithoutACommandKeepsItsDescriptionAsAnArgument() {
        let lines = ChatToolBody.lines(
            name: "Bash", input: .object(["command": .string("  "), "description": .string("x")]))
        XCTAssertNil(lines.command)
        XCTAssertEqual(lines.arguments, [argument("command", "  "), argument("description", "x")])
    }

    func testAnInputThatIsNoObjectShowsAsTextAndNothingShowsNothing() {
        XCTAssertEqual(ChatToolBody.lines(name: "Odd", input: .string("hello")).text, "hello")
        XCTAssertEqual(ChatToolBody.lines(name: "Odd", input: .number(3)).text, "3")
        XCTAssertTrue(ChatToolBody.lines(name: "Odd", input: .null).isEmpty)
        XCTAssertTrue(ChatToolBody.lines(name: "Odd", input: .string("")).isEmpty)
        XCTAssertTrue(ChatToolBody.lines(name: "Odd", input: .object([:])).isEmpty)
    }

    func testAFailedShellNamesItsExitCodeApartFromWhatItPrinted() {
        XCTAssertEqual(pair(ChatToolBody.exitCode("Exit code 1\nerror: no tests")), Pair(1, "error: no tests"))
        XCTAssertEqual(pair(ChatToolBody.exitCode("Exit code 127")), Pair(127, ""))
        XCTAssertEqual(pair(ChatToolBody.exitCode("Exit code -2 \r\nkilled")), Pair(-2, "killed"))
        XCTAssertEqual(pair(ChatToolBody.exitCode("Exit code 0\nfine")), Pair(nil, "Exit code 0\nfine"))
        XCTAssertEqual(pair(ChatToolBody.exitCode("Error: Exit code 1")), Pair(nil, "Error: Exit code 1"))
        XCTAssertEqual(pair(ChatToolBody.exitCode("Exit code 1 and more")), Pair(nil, "Exit code 1 and more"))
    }

    func testATextPastTheLimitIsCutWithALineThatSaysHowMuchIsLeft() {
        let short = String(repeating: "a", count: ChatToolBody.outputLimit)
        XCTAssertEqual(ChatToolBody.clipped(short), short)
        XCTAssertEqual(ChatToolBody.clipped(short + "b"), short + "\n[1 more character]")
        XCTAssertEqual(ChatToolBody.clipped(short + "bcd"), short + "\n[3 more characters]")
    }

    func testACallOpensOnlyWhenItHasSomethingToShow() {
        XCTAssertFalse(ChatToolBody.opens(tool("Unknown", input: .object([:]))))
        XCTAssertFalse(ChatToolBody.opens(tool("Unknown", input: .object([:]), output: " \n")))
        XCTAssertTrue(ChatToolBody.opens(tool("Unknown", input: .object([:]), output: "done")))
        XCTAssertTrue(ChatToolBody.opens(tool("Read", input: .object(["file_path": .string("/a.ts")]))))
    }

    func testOnlyTheSummaryOfAFileCallIsAPath() {
        XCTAssertTrue(ChatToolPresentation.summaryIsPath(tool("Read", input: .object(["file_path": .string("/a.ts")]))))
        XCTAssertFalse(ChatToolPresentation.summaryIsPath(tool("Grep", input: .object(["pattern": .string("/a")]))))
        XCTAssertFalse(
            ChatToolPresentation.summaryIsPath(tool("Unknown", input: .object(["file_path": .string("/a.ts")]))))
    }

    func testAChangesCardNamesTheMoveOfTheBranchByShortHeads() {
        let moved = ChatFileChanges.baseMoved(turn(head: "1234567890", after: "abcdef1234"))
        XCTAssertEqual(moved?.from, "1234567")
        XCTAssertEqual(moved?.to, "abcdef1")
        XCTAssertNil(ChatFileChanges.baseMoved(turn(head: "1234567890", after: "1234567890")))
        XCTAssertNil(ChatFileChanges.baseMoved(turn(head: "1234567890", after: nil)))
    }

    private func turn(head: String?, after: String?) -> ChatTurnItem {
        ChatTurnItem(
            id: "turn", createdAt: 0, turnId: "turn", state: .done, endedAt: 1, costUsd: 0, checkpointHead: head,
            checkpointHeadAfter: after)
    }

    private struct Pair: Equatable {
        let code: Int?
        let rest: String
        init(_ code: Int?, _ rest: String) {
            self.code = code
            self.rest = rest
        }
    }

    private func pair(_ value: (code: Int?, rest: String)) -> Pair { Pair(value.code, value.rest) }

    private func argument(_ key: String, _ value: String) -> ChatToolCallLines.Argument {
        ChatToolCallLines.Argument(key: key, value: value)
    }

    private func tool(_ name: String, input: JSONValue, output: String? = nil) -> ChatToolItem {
        ChatWire.item([
            "kind": .string("tool"), "name": .string(name), "input": input,
            "output": output.map(JSONValue.string) ?? .null,
        ]).chatTool
    }
}
