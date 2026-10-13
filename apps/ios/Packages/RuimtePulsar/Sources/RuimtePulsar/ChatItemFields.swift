import Foundation

/// What every kind of chat item carries, the `base` of `ChatItemSchema` in the contracts.
public protocol ChatItemFields: Sendable {
    var id: String { get }
    var createdAt: Double { get }
    var turnId: String? { get }
    var kind: String { get }
}

extension ChatUserItem: ChatItemFields {}
extension ChatAssistantItem: ChatItemFields {}
extension ChatThinkingItem: ChatItemFields {}
extension ChatToolItem: ChatItemFields {}
extension ChatSubagentItem: ChatItemFields {}
extension ChatApprovalItem: ChatItemFields {}
extension ChatQuestionItem: ChatItemFields {}
extension ChatTurnItem: ChatItemFields {}
extension ChatNoteItem: ChatItemFields {}
extension ChatCompactionItem: ChatItemFields {}

extension ChatItem {
    public var fields: any ChatItemFields {
        switch self {
        case .user(let item): item
        case .assistant(let item): item
        case .thinking(let item): item
        case .tool(let item): item
        case .subagent(let item): item
        case .approval(let item): item
        case .question(let item): item
        case .turn(let item): item
        case .note(let item): item
        case .compaction(let item): item
        }
    }

    public var id: String { fields.id }
    public var createdAt: Double { fields.createdAt }
    public var turnId: String? { fields.turnId }
    public var kind: String { fields.kind }

    /// The call of a subagent this item belongs to; only an assistant message and a tool call have one.
    public var parentToolUseID: String? {
        switch self {
        case .assistant(let item):
            if case .value(let parent) = item.parentToolUseId { return parent }
            return nil
        case .tool(let item): return item.parentToolUseId
        default: return nil
        }
    }

    /// A request that still waits on a person, an approval or a question.
    public var isPending: Bool {
        switch self {
        case .approval(let item): item.decision == .pending
        case .question(let item): item.state == .pending
        default: false
        }
    }
}
