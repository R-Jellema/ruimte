import RuimteIntelligentUI
import RuimtePulsar
import SwiftUI

/// A reply whose text holds blocks: the prose around the cards stays prose, and each compiled block is a card in
/// its place, split on the daemon's UTF-16 offsets. A block that is supplied never falls back to its raw fence;
/// what it cannot draw, the card itself shows as text.
struct UiReplyView: View {
    let item: ChatAssistantItem
    let trees: UiReplyTrees
    var presentation: ChatPresentation?
    /// The model of a block, kept by the caller across rows (`UiBlockModelCache`), created with the block it draws.
    let model: @MainActor (JSONValue) -> UiBlockModel
    @Environment(\.chatContent) private var chat

    var body: some View {
        let streaming = item.streaming
        let text = item.text
        let parts = Self.identified(UiReplyParts.split(text: text, blocks: trees.blocks, streaming: streaming))
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(parts.enumerated()), id: \.element.id) { index, part in
                switch part.part {
                case .text(let text):
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        ChatStreamingMessage(text: text, streaming: streaming && index == parts.count - 1)
                    }
                case .block(let block):
                    let id = block["id"]?.stringValue ?? ""
                    UiReplyBlock(
                        block: block, model: model(block), flash: highlight(block),
                        frozen: trees.frozen[id],
                        answered: trees.answered[id],
                        source: UiReplyParts.source(text: text, block: block),
                        localKey: "\(chat?.scopeID ?? "")\n\(chat?.chatID ?? "")\n\(item.id)\n\(id)"
                    )
                    .environment(\.markdownTableBleed, 0)
                }
            }
        }
    }

    private func highlight(_ block: JSONValue) -> UUID? {
        guard let target = presentation?.uiChoiceHighlight,
            target.itemID == item.id, target.blockID == block.text("id"),
            target.revision == block.text("revision")
        else { return nil }
        return target.nonce
    }

    private struct Identified {
        let id: String
        let part: UiReplyPart
    }

    /// Text is keyed by the block before it, so a block that arrives leaves the prose before it where it was.
    private static func identified(_ parts: [UiReplyPart]) -> [Identified] {
        var after = "start"
        return parts.map { part in
            switch part {
            case .text: return Identified(id: "text:\(after)", part: part)
            case .block(let block):
                after = block["id"]?.stringValue ?? after
                return Identified(id: "block:\(after)", part: part)
            }
        }
    }
}

/// A reply's blocks with the readings and answers stored for them, as the interpreter takes them: JSON, since it hands
/// them to JavaScriptCore as they are.
struct UiReplyTrees {
    let blocks: [JSONValue]
    let frozen: [String: JSONValue]
    let answered: [String: JSONValue]

    init(_ reply: ChatAssistantItem) {
        blocks = (reply.ui ?? []).compactMap { try? JSONValue(encoding: $0) }
        frozen = (reply.uiQueries?.blocks ?? [:]).compactMapValues { try? JSONValue(encoding: $0) }
        answered = (reply.uiAnswers ?? [:]).compactMapValues { try? JSONValue(encoding: $0) }
    }
}

/// One card, which hands its model every new compile, the stored readings and the stored answer.
private struct UiReplyBlock: View {
    let block: JSONValue
    let model: UiBlockModel
    let flash: UUID?
    let frozen: JSONValue?
    let answered: JSONValue?
    let source: String?
    let localKey: String

    private struct Update: Equatable {
        let block: JSONValue
        let frozen: JSONValue?
        let answered: JSONValue?
        let source: String?
    }

    var body: some View {
        UiBlockView(model: model, localKey: localKey, flash: flash)
            .task(id: Update(block: block, frozen: frozen, answered: answered, source: source)) {
                await model.update(block: block, frozen: frozen, answered: answered, source: source)
            }
    }
}
