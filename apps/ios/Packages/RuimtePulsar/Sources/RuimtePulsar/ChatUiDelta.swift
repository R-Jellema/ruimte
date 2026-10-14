import Foundation

public enum ChatUiDelta {
    /// The item with the delta's text appended. Only a reply, a thought and a tool call's output stream, as the
    /// daemon's `appendText` writes them; every other item comes back as it was.
    public static func apply(_ delta: ChatDeltaEvent, to item: ChatItem) -> ChatItem {
        switch item {
        case .assistant(let reply):
            let text = reply.text + delta.text
            // Daemon offsets use JavaScript UTF-16 units; a delayed preview must not replace a newer one.
            let preview = reply.streaming && delta.textLength == Int64(text.utf16.count) ? delta.ui : nil
            return .assistant(
                ChatAssistantItem(
                    id: reply.id, createdAt: reply.createdAt, turnId: reply.turnId, kind: reply.kind,
                    ui: preview ?? reply.ui, uiAnswers: reply.uiAnswers, uiQueries: delta.uiQueries ?? reply.uiQueries,
                    phase: reply.phase, text: text, streaming: reply.streaming,
                    parentToolUseId: reply.parentToolUseId))
        case .thinking(let thought):
            return .thinking(
                ChatThinkingItem(
                    id: thought.id, createdAt: thought.createdAt, turnId: thought.turnId, kind: thought.kind,
                    text: thought.text + delta.text, streaming: thought.streaming, endedAt: thought.endedAt))
        case .tool(let tool):
            let progress = tool.progress
            return .tool(
                ChatToolItem(
                    id: tool.id, createdAt: tool.createdAt, turnId: tool.turnId, kind: tool.kind,
                    toolUseId: tool.toolUseId, name: tool.name, input: tool.input, output: tool.output,
                    state: tool.state, parentToolUseId: tool.parentToolUseId,
                    progress: ChatToolItemProgress(
                        startedAt: progress?.startedAt, description: progress?.description,
                        output: (progress?.output ?? "") + delta.text),
                    changes: tool.changes, workflow: tool.workflow))
        default:
            return item
        }
    }
}
