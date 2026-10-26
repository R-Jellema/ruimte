import Foundation
import Observation
import RuimtePulsar

struct ChatPromptAnswer {
    var choices: [String] = []
    var text = ""
    var custom = false

    var value: String {
        custom ? text.trimmingCharacters(in: .whitespacesAndNewlines) : choices.joined(separator: ", ")
    }
}

struct ChatPromptDraft {
    var index = 0
    var answers: [String: ChatPromptAnswer] = [:]
    var denialReason = ""
    var showingReason = false
    var expanded = false
}

@MainActor @Observable
final class ChatPromptState {
    private var live: [ChatItem] = []
    private var completed: Set<String> = []
    private var drafts: [String: ChatPromptDraft] = [:]
    var activeID: String?
    var sendingID: String?
    var error: String?
    var pending: [ChatItem] {
        live.filter { !completed.contains($0.requestId ?? "") }
    }
    var active: ChatItem? { pending.first { $0.requestId == activeID } }
    var draft: ChatPromptDraft {
        get { activeID.flatMap { drafts[$0] } ?? ChatPromptDraft() }
        set { if let activeID { drafts[activeID] = newValue } }
    }

    func update(_ requests: [ChatItem]) {
        live = requests
        let ids = Set(requests.map { $0.requestId ?? "" })
        completed.formIntersection(ids)
        drafts = drafts.filter { ids.contains($0.key) }
        reconcile()
    }

    private func reconcile() {
        guard active == nil else { return }
        let candidates = pending.sorted {
            let first = Self.waitsLater($0)
            let second = Self.waitsLater($1)
            if first != second { return !first }
            return $0.createdAt < $1.createdAt
        }
        activeID = candidates.first?.requestId
        error = nil
    }

    /// A question the agent goes on without, which waits behind every request that holds it up.
    private static func waitsLater(_ item: ChatItem) -> Bool {
        if case .question(let question) = item { question.async == true } else { false }
    }

    func submit(
        _ item: ChatItem, connected: Bool, perform: @MainActor () async throws -> Void
    ) async {
        let id = item.requestId ?? ""
        guard sendingID == nil, activeID == id, pending.contains(where: { $0.requestId == id }), connected
        else { return }
        sendingID = id
        error = nil
        defer { sendingID = nil }
        do {
            try await perform()
            completed.insert(id)
            drafts.removeValue(forKey: id)
            reconcile()
        } catch {
            guard activeID == id else { return }
            self.error = error.localizedDescription
        }
    }
}

/// Takes the keyboard from the draft while a request holds the composer, and gives it back once the last request is
/// handled, only if the draft had it.
struct ChatDraftFocusHandoff {
    private var resumes = false

    /// The draft's focus after the active request changed, or nil to leave it as it is.
    mutating func focus(from previous: String?, to next: String?, focused: Bool, visible: Bool) -> Bool? {
        if next != nil && previous == nil {
            resumes = focused
            return false
        }
        if next == nil && resumes && visible {
            resumes = false
            return true
        }
        return nil
    }
}

extension ChatApprovalItem {
    /// What the request says about itself, left out where an agent describes a command by the command itself, which
    /// the card already shows.
    var shownDescription: String? {
        guard let description, !description.isEmpty else { return nil }
        let command = input["command"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        return description.trimmingCharacters(in: .whitespacesAndNewlines) == command ? nil : description
    }
}
