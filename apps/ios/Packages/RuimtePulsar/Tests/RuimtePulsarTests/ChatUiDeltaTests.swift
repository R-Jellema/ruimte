import XCTest

@testable import RuimtePulsar

final class ChatUiDeltaTests: XCTestCase {
    private func block(_ id: String) -> ChatUiBlock {
        ChatUiBlock(
            id: id, catalogVersion: 1, revision: nil, start: 0, end: 0, complete: false, defaults: [:], queries: [:],
            nodes: [], diagnostics: [], fallback: "")
    }

    private func reply(_ text: String, streaming: Bool, ui: [ChatUiBlock]? = nil) -> ChatItem {
        .assistant(
            ChatAssistantItem(id: "reply", createdAt: 0, turnId: nil, ui: ui, text: text, streaming: streaming))
    }

    private func delta(
        _ text: String = "", textLength: Int64? = nil, ui: [ChatUiBlock]? = nil, uiQueries: ChatUiQueryState? = nil
    ) -> ChatDeltaEvent {
        ChatDeltaEvent(type: "delta", itemId: "reply", text: text, ui: ui, uiQueries: uiQueries, textLength: textLength)
    }

    private func assistant(_ item: ChatItem) throws -> ChatAssistantItem {
        guard case .assistant(let reply) = item else {
            return try XCTUnwrap(nil, "The reply came back as another kind")
        }
        return reply
    }

    func testPreviewMatchesUTF16LengthWithoutAppendingItsTextTwice() throws {
        let preview = [block("block")]
        let updated = try assistant(
            ChatUiDelta.apply(delta(textLength: 5, ui: preview), to: reply("Hi 🐇", streaming: true)))
        XCTAssertEqual(updated.text, "Hi 🐇")
        XCTAssertEqual(updated.ui, preview)
    }

    func testStalePreviewPreservesCurrentTreeButQueryMetadataStillArrives() throws {
        let blocks = [block("new")]
        let queries = ChatUiQueryState(authorChatId: "chat", blocks: [:])
        let updated = try assistant(
            ChatUiDelta.apply(
                delta(textLength: 2, ui: [], uiQueries: queries), to: reply("newer", streaming: true, ui: blocks)))
        XCTAssertEqual(updated.ui, blocks)
        XCTAssertEqual(updated.uiQueries, queries)
    }

    func testTextAndToolDeltasKeepExistingMetadata() throws {
        let updated = try assistant(ChatUiDelta.apply(delta("b"), to: reply("a", streaming: false, ui: [])))
        XCTAssertEqual(updated.text, "ab")
        XCTAssertEqual(updated.ui, [])
        let tool = ChatItem.tool(
            ChatToolItem(
                id: "tool", createdAt: 0, turnId: nil, toolUseId: "use", name: "Bash", input: .null, output: nil,
                state: .running, parentToolUseId: nil,
                progress: ChatToolItemProgress(startedAt: 4, description: "Listing", output: "a")))
        guard case .tool(let progressed) = ChatUiDelta.apply(delta("b"), to: tool) else {
            return XCTFail("The tool call came back as another kind")
        }
        XCTAssertEqual(progressed.progress, ChatToolItemProgress(startedAt: 4, description: "Listing", output: "ab"))
        XCTAssertNil(progressed.output)
    }

    func testTreesReachOnlyAStreamingReplyAndQueryMetadataOnlyAReply() throws {
        let queries = ChatUiQueryState(authorChatId: "chat", blocks: [:])
        let event = delta(textLength: 2, ui: [block("block")], uiQueries: queries)
        let settled = try assistant(ChatUiDelta.apply(event, to: reply("hi", streaming: false)))
        XCTAssertNil(settled.ui)
        XCTAssertEqual(settled.uiQueries, queries)
        let thinking = ChatItem.thinking(
            ChatThinkingItem(id: "thought", createdAt: 0, turnId: nil, text: "hi", streaming: true, endedAt: nil))
        guard case .thinking(let thought) = ChatUiDelta.apply(delta(" there"), to: thinking) else {
            return XCTFail("The thought came back as another kind")
        }
        XCTAssertEqual(thought.text, "hi there")
    }

    func testQueryStateIgnoresKeysThisVersionDoesNotKnow() throws {
        let known = #"{"revision":"r","fallback":"Utrecht","readings":{}}"#
        let future = #"{"revision":"r","fallback":"Utrecht","readings":{},"routes":{"a":{"state":"found"}}}"#
        func decode(_ block: String) throws -> ChatUiQueryState {
            let json = #"{"authorChatId":"chat","extra":1,"blocks":{"block":\#(block)}}"#
            return try JSONDecoder().decode(ChatUiQueryState.self, from: Data(json.utf8))
        }
        let older = try decode(known)
        let newer = try decode(future)
        XCTAssertEqual(newer, older)
        XCTAssertEqual(newer.blocks["block"]?.fallback, "Utrecht")
        XCTAssertNil(newer.blocks["block"]?.places)
    }
}
