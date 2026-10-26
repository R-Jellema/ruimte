import FoundationModels

enum ContextBudgetError: Error, CustomStringConvertible {
    case tooLarge

    var description: String {
        "The current message, tool definitions and response schema do not fit the local context budget. Shorten the message or start a new chat."
    }
}

extension Transcript.Entry {
    var isInstructions: Bool {
        if case .instructions = self { return true }
        return false
    }

    var isPrompt: Bool {
        if case .prompt = self { return true }
        return false
    }
}

enum ContextHistory {
    static func refreshInstructions(_ entries: [Transcript.Entry], from current: [Transcript.Entry]) -> [Transcript.Entry] {
        current.filter(\.isInstructions) + entries.filter { !$0.isInstructions }
    }

    static func turnCount(_ entries: [Transcript.Entry]) -> Int {
        entries.count(where: \.isPrompt)
    }
}
