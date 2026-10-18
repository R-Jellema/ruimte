import Foundation
import Observation
import RuimteIntelligentUI
import RuimtePulsar

@MainActor @Observable
final class ChatItemState: Identifiable {
    let id: String
    private(set) var item: ChatItem
    @ObservationIgnored private var trees: (reply: ChatAssistantItem, trees: UiReplyTrees)?

    init(_ item: ChatItem) {
        id = item.id
        self.item = item
    }

    func update(_ item: ChatItem) { self.item = item }

    /// A reply's blocks as the interpreter takes them, encoded again only when they change and not on every word the
    /// reply streams.
    var replyTrees: UiReplyTrees? {
        guard case .assistant(let reply) = item, reply.ui?.isEmpty == false else { return nil }
        if let trees, trees.reply.ui == reply.ui, trees.reply.uiQueries == reply.uiQueries,
            trees.reply.uiAnswers == reply.uiAnswers
        {
            return trees.trees
        }
        let next = UiReplyTrees(reply)
        trees = (reply, next)
        return next
    }
}

/// Where a task's row reads what the thread does not carry: the task's own record, the chat of the agent working on
/// it, and the models of a CLI by its kind.
struct ChatAgentSources {
    var tasks: TaskStore?
    var attention: AttentionStore?
    var models: (String) -> [JSONValue] = { _ in [] }
}

struct ChatTimelineEntry: Identifiable, Equatable {
    enum Kind: Equatable {
        case message, tools, activity, turnFold, turnStart, changedFiles, subagent, forks, visual, liveThought
    }
    let id: String
    let kind: Kind
    var items: [ChatItemState] = []
    var visual: ChatVisual?

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id && lhs.kind == rhs.kind
            && lhs.items.map(ObjectIdentifier.init) == rhs.items.map(ObjectIdentifier.init) && lhs.visual == rhs.visual
    }
}

extension ChatTimelineEntry {
    /// A line of work (a call, a thought, an agent) sits tight against the lines around it, as the desktop's list
    /// rhythm has them; prose and cards keep a block's gap, so a run of work lines stands apart where it meets them.
    @MainActor var isWorkLine: Bool {
        switch kind {
        case .tools, .turnFold, .turnStart, .subagent, .liveThought, .activity: return true
        case .changedFiles, .forks, .visual: return false
        case .message:
            switch items.first?.item {
            case .thinking?, .approval?: return true
            case .tool(let tool)?:
                return ChatSubagents.handbackReport(.tool(tool)) == nil && !UiGeneratedImage.isGeneration(tool)
            default: return false
            }
        }
    }
}

/// The space above and below a row. Work lines sit tight against each other; where a run of them meets prose, either
/// way, the seam gets the gap two blocks of prose have, the desktop's seam at the phone's larger text.
struct ChatRowPadding: Equatable {
    static let prose: CGFloat = 10
    static let work: CGFloat = 2

    let top: CGFloat
    let bottom: CGFloat

    static func rows(work: [Bool]) -> [ChatRowPadding] {
        work.indices.map { index in
            guard work[index] else { return ChatRowPadding(top: prose, bottom: prose) }
            let above = index > 0 && !work[index - 1]
            let below = index + 1 < work.count && !work[index + 1]
            return ChatRowPadding(top: above ? prose : Self.work, bottom: below ? prose : Self.work)
        }
    }
}

@MainActor @Observable
final class ChatPresentation {
    private(set) var entries: [ChatTimelineEntry] = []
    private(set) var revision = 0
    private(set) var info: ChatInfo?
    /// Where the thread's paths resolve. A sub-agent's thread has no info of its own and borrows its chat's folder.
    private(set) var cwd = ""
    private(set) var connected = false
    private(set) var startedAt: Double?
    private(set) var activityLabel = String(localized: "Working for", comment: "Followed by a running clock")
    private(set) var isAnimating = false
    @ObservationIgnored private var order: [String] = []
    @ObservationIgnored private var records: [String: ChatItemState] = [:]
    private(set) var expandedTurns: Set<String> = []
    private(set) var expandedSubagents: Set<String> = []
    private(set) var requestedItemID: String?
    /// A subagent row asked to open its conversation; the screen that shows this timeline pushes it.
    var conversationRequest: SubagentCrumb?
    /// Whether this is a chat's own thread, which can fork; a sub-agent's thread in its place cannot.
    @ObservationIgnored var forkable = false
    /// A row asked to fork after this turn; the screen shows the fork sheet.
    var forkRequest: ChatForkRequest?
    /// A row asked to open another chat of the project (a summary's fork); the screen pushes it.
    var openRequest: String?
    /// The forks this device knows of per turn, for the line under the turn.
    private(set) var forks: [String: [String]] = [:]
    var places: ChatPlaces?
    @ObservationIgnored var agentSources: ChatAgentSources?
    /// The messages a person marked, by item id, as the machine last said.
    private(set) var bookmarks: [String: ChatBookmark] = [:]
    /// A row asked to place, name or take away a bookmark; the screen carries it out.
    var bookmarkRequest: ChatBookmarkRequest?
    var uiChoiceRequest: UiChoiceJump?
    var uiChoiceHighlight: UiChoiceJump?
    /// The pages agents published in the chat, as the machine last said.
    private(set) var visuals: [ChatVisual] = []
    /// A card asked to open its visual large or to remove it; the screen carries it out.
    var visualRequest: ChatVisualRequest?
    @ObservationIgnored let visualPages = ChatVisualPages()
    /// Whether the machine holds a page of the thread before the first item here, which a visual from before that
    /// item waits for.
    @ObservationIgnored var earlierPageWaits = false
    /// The timeline entries on screen, answered by the timeline while it is there.
    @ObservationIgnored var visibleEntryIDs: () -> [String] = { [] }
    private(set) var scrollRequest = 0
    @ObservationIgnored private var activeID: String?
    @ObservationIgnored private var historyBoundaries = Set<String>()

    func replace(_ values: [ChatItem], info: ChatInfo?) {
        records = [:]
        order = []
        historyBoundaries = []
        expandedTurns = []
        expandedSubagents = []
        for record in values.map(ChatItemState.init) {
            if records[record.id] == nil { order.append(record.id) }
            records[record.id] = record
        }
        self.info = info
        if let info { cwd = info.cwd }
        refreshActivity()
        rebuild()
    }

    func prepend(_ values: [ChatItem]) {
        if let first = order.first { historyBoundaries.insert(first) }
        let visibleTurns = Set(records.values.compactMap(\.item.turnId))
        let incoming = values.map(ChatItemState.init)
        for record in incoming {
            if case .turn = record.item, let turn = record.item.turnId, visibleTurns.contains(turn) {
                expandedTurns.insert(turn)
            }
        }
        var older: [String] = []
        for record in incoming where records[record.id] == nil {
            records[record.id] = record
            older.append(record.id)
        }
        order = older + order
        rebuild()
    }

    func setInfo(_ info: ChatInfo?) {
        self.info = info
        if let info { cwd = info.cwd }
        refreshActivity()
        rebuild()
    }

    func setCwd(_ cwd: String) { self.cwd = cwd }

    func setConnected(_ connected: Bool) {
        self.connected = connected
        refreshActivity()
        rebuild()
    }

    func upsert(_ item: ChatItem, textOnly: Bool = false) {
        if let existing = records[item.id] {
            existing.update(item)
            if textOnly { return }
        } else {
            records[item.id] = ChatItemState(item)
            order.append(item.id)
        }
        refreshActivity()
        rebuild()
    }

    private func refreshActivity() {
        let nextID = info?.activeTurnId
        if activeID != nextID {
            activeID = nextID
            startedAt = nextID == nil ? nil : Date.now.timeIntervalSince1970 * 1000
        }
        if let nextID,
            let turn = order.lazy.compactMap({ self.records[$0].flatMap(Self.turn) }).first(where: {
                $0.turnId == nextID || $0.id == nextID
            })
        {
            startedAt = turn.createdAt
        }
        let blocked = records.values.contains {
            switch $0.item {
            case .approval(let approval): approval.decision == .pending
            case .question(let question): question.state == .pending && question.async != true
            default: false
            }
        }
        activityLabel =
            !connected
            ? String(localized: "Connection lost")
            : blocked
                ? String(localized: "Waiting for you")
                : String(localized: "Working for", comment: "Followed by a running clock")
        isAnimating = connected && !blocked && nextID != nil
    }

    func item(_ id: String) -> ChatItem? { records[id]?.item }

    var values: [ChatItem] { order.compactMap { records[$0]?.item } }

    /// The last turn that ended, which is where a fork from the conversation menu goes on after. Read from the end,
    /// since the screen asks on every render.
    var lastSettledTurnID: String? {
        for id in order.reversed() {
            if let turn = records[id].flatMap(Self.turn), turn.state != .running { return turn.id }
        }
        return nil
    }

    func setForks(_ forks: [String: [String]]) {
        guard forks != self.forks else { return }
        self.forks = forks
        rebuild()
    }

    func forkRefusal(turnID: String) -> String? {
        ChatForking.refusal(info: info, turn: records[turnID]?.item)
    }

    /// Scrolls the timeline to an entry, as the message index asks.
    func reveal(entryID: String) {
        requestedItemID = entryID
        scrollRequest += 1
    }

    /// Scrolls to a message, unfolding the turn that hides it. False while the message is not loaded.
    func revealItem(_ id: String) -> Bool {
        guard let record = records[id] else { return false }
        if !entries.contains(where: { $0.id == id }), let turnID = record.item.turnId {
            expandedTurns.insert(turnID)
            rebuild()
        }
        reveal(entryID: id)
        return true
    }

    func setVisuals(_ visuals: [ChatVisual]) {
        guard visuals != self.visuals else { return }
        self.visuals = visuals
        rebuild()
    }

    func setBookmarks(_ bookmarks: [ChatBookmark]) {
        let next = Dictionary(bookmarks.map { ($0.itemID, $0) }, uniquingKeysWith: { first, _ in first })
        if next != self.bookmarks { self.bookmarks = next }
    }

    /// The bookmarks in the order of the thread; one on a message this device has not loaded goes last.
    var orderedBookmarks: [ChatBookmark] {
        ChatBookmarks.inThreadOrder(Array(bookmarks.values), order: order)
    }

    func toggleTurn(_ id: String) {
        if !expandedTurns.insert(id).inserted { expandedTurns.remove(id) }
        rebuild()
    }

    func toggleSubagent(_ id: String) {
        if !expandedSubagents.insert(id).inserted { expandedSubagents.remove(id) }
    }

    /// The row of the sub-agent a call opened; a view that reads its value follows it as it changes.
    func subagent(toolUseID: String) -> ChatItemState? {
        records.values.first {
            if case .subagent(let agent) = $0.item { agent.toolUseId == toolUseID } else { false }
        }
    }

    func openSubagent(toolUseID: String) {
        guard let agent = subagent(toolUseID: toolUseID) else { return }
        expandedSubagents.insert(agent.id)
        requestedItemID = agent.id
        scrollRequest += 1
        if let turnID = agent.item.turnId { expandedTurns.insert(turnID) }
        rebuild()
    }

    private func rebuild() {
        let all = order.compactMap { records[$0] }
        let children = Dictionary(grouping: all.filter { $0.item.parentToolUseID != nil }) {
            $0.item.parentToolUseID!
        }
        var chunks: [(String?, [ChatItemState])] = []
        var positions: [String: Int] = [:]
        for item in all {
            if let turnID = item.item.turnId {
                if let index = positions[turnID] {
                    chunks[index].1.append(item)
                } else {
                    positions[turnID] = chunks.count
                    chunks.append((turnID, [item]))
                }
            } else if chunks.last?.0 == nil && !chunks.isEmpty {
                chunks[chunks.count - 1].1.append(item)
            } else {
                chunks.append((nil, [item]))
            }
        }
        var rows: [ChatTimelineEntry] = []
        for (turnID, items) in chunks {
            guard let turnID, let turn = items.first(where: { Self.turn($0) != nil }), let turnItem = Self.turn(turn)
            else {
                let live = rowsFor(items, children: children)
                rows += turnID != nil && turnID == activeID ? Self.withLiveThought(live, items: items) : live
                continue
            }
            if turnItem.origin == .agent {
                rows.append(ChatTimelineEntry(id: "start-\(turnID)", kind: .turnStart, items: [turn]))
            }
            let conversation = items.filter { Self.turn($0) == nil }
            if turnID == activeID || turnItem.state == .running {
                rows += Self.withLiveThought(rowsFor(conversation, children: children), items: conversation)
                continue
            }
            // Steering splits the conversation inside a turn. Earlier responses keep their place above it.
            let split = (conversation.lastIndex { if case .user = $0.item { true } else { false } } ?? -1) + 1
            rows += rowsFor(Array(conversation[..<split]), children: children)
            let work = Array(conversation[split...])
            let final = work.last {
                if case .assistant = $0.item { $0.item.parentToolUseID == nil } else { false }
            }
            let notices = work.filter { if case .note = $0.item { true } else { false } }
            // Images stay a turn's visible result, and a workflow may still run after its turn ended.
            let standing = work.filter {
                guard let tool = $0.item.toolItem, $0.item.parentToolUseID == nil else { return false }
                return UiGeneratedImage.isGeneration(tool) || tool.workflow != nil && tool.state == .running
            }
            let standingIDs = Set(standing.map(\.id))
            let folded = work.filter {
                if case .note = $0.item { return false }
                return $0 !== final && !standingIDs.contains($0.id)
            }
            if !rowsFor(folded, children: children).isEmpty {
                let tools = work.filter {
                    guard case .tool = $0.item else { return false }
                    return $0.item.parentToolUseID == nil && ChatSubagents.handbackReport($0.item) == nil
                }
                rows.append(ChatTimelineEntry(id: "fold-\(turnID)", kind: .turnFold, items: [turn] + notices + tools))
                if expandedTurns.contains(turnID) { rows += rowsFor(folded, children: children) }
            }
            let edits = work.filter {
                guard case .tool(let tool) = $0.item else { return false }
                return tool.state == .done && ChatFileChanges.hasChanges(tool)
            }
            let changed =
                turnItem.checkpointDiff.map { !$0.files.isEmpty } ?? (!edits.isEmpty || turnItem.checkpoint != nil)
            if changed {
                rows.append(ChatTimelineEntry(id: "files-\(turnID)", kind: .changedFiles, items: [turn] + edits))
            }
            rows += rowsFor(standing, children: children)
            if let final { rows.append(ChatTimelineEntry(id: final.id, kind: .message, items: [final])) }
            rows += rowsFor(notices, children: children)
            if forks[turnID]?.isEmpty == false {
                rows.append(ChatTimelineEntry(id: "forks-\(turnID)", kind: .forks, items: [turn]))
            }
        }
        if let activeID { rows.append(ChatTimelineEntry(id: "working-\(activeID)", kind: .activity)) }
        let heldFrom = earlierPageWaits ? order.first.flatMap { records[$0]?.item.createdAt } : nil
        rows = ChatVisuals.placed(rows, visuals: visuals, heldFrom: heldFrom)
        guard rows != entries else { return }
        entries = rows
        revision += 1
    }

    /// The rows of a running turn with its latest thought repeated over the call it led to. Nothing when that call
    /// follows the thought directly, where the thought's own row shows it, or when a newer thought came after the call.
    static func withLiveThought(_ rows: [ChatTimelineEntry], items: [ChatItemState]) -> [ChatTimelineEntry] {
        guard
            let at = items.lastIndex(where: {
                if case .thinking = $0.item { $0.item.parentToolUseID == nil } else { false }
            }),
            case .thinking(let thought) = items[at].item, !ChatThought.line(thought.text).isEmpty
        else { return rows }
        let after = Set(items[(at + 1)...].map(\.id))
        let call = rows.firstIndex {
            guard $0.kind == .message, let record = $0.items.first, let tool = record.item.toolItem else {
                return false
            }
            return after.contains(record.id) && tool.state == .running && tool.workflow == nil
        }
        guard let call, call == 0 || rows[call - 1].id != items[at].id else { return rows }
        var next = rows
        let entry = ChatTimelineEntry(
            id: "live-thought-\(items[at].id)", kind: .liveThought, items: [items[at]] + rows[call].items.prefix(1))
        next.insert(entry, at: call)
        return next
    }

    private static func turn(_ record: ChatItemState) -> ChatTurnItem? {
        if case .turn(let turn) = record.item { turn } else { nil }
    }

    private func rowsFor(_ items: [ChatItemState], children: [String: [ChatItemState]]) -> [ChatTimelineEntry] {
        var rows: [ChatTimelineEntry] = []
        for item in items where item.item.parentToolUseID == nil && !item.item.isPending {
            switch item.item {
            case .turn: continue
            case .tool(let tool) where tool.workflow != nil:
                rows.append(ChatTimelineEntry(id: item.id, kind: .message, items: [item]))
            // A subagent's `SubagentHandback` call reads as the report it carries rather than as a tool call.
            case .tool(let tool)
            where tool.state != .running && ChatSubagents.handbackReport(item.item) == nil
                && !UiGeneratedImage.isGeneration(tool):
                if rows.last?.kind == .tools && !historyBoundaries.contains(item.id) {
                    rows[rows.count - 1].items.append(item)
                } else {
                    rows.append(ChatTimelineEntry(id: "tools-\(item.id)", kind: .tools, items: [item]))
                }
            case .subagent(let agent):
                rows.append(
                    ChatTimelineEntry(id: item.id, kind: .subagent, items: [item] + (children[agent.toolUseId] ?? [])))
            default:
                rows.append(ChatTimelineEntry(id: item.id, kind: .message, items: [item]))
            }
        }
        return rows
    }

    /// The notes of the turn tell a turn a person stopped from one the machine ended after a restart.
    static func turnLabel(_ turn: ChatTurnItem, items: [ChatItem] = []) -> String {
        let duration = ChatToolPresentation.elapsed((turn.endedAt ?? turn.createdAt) - turn.createdAt)
        switch turn.state {
        case .error: return String(localized: "Failed after \(duration)")
        case .aborted:
            return abortedByMachine(turn, items: items)
                ? String(localized: "Stopped after \(duration)") : String(localized: "You stopped after \(duration)")
        case .running, .done: return String(localized: "Worked for \(duration)")
        }
    }

    // The daemon's warning note in a turn it could not resume, `notResumedNote` in the contracts.
    private static let notResumedPrefix = "This turn could not be resumed after the machine restarted: "

    static func abortedByMachine(_ turn: ChatTurnItem, items: [ChatItem]) -> Bool {
        let turnID = turn.turnId ?? turn.id
        return turn.state == .aborted
            && items.contains {
                guard let note = $0.noteItem else { return false }
                return note.turnId == turnID && note.level == .warning && note.text.hasPrefix(notResumedPrefix)
            }
    }

    /// The header of a turn the chat did not start from a person's message.
    static func agentTurnLabel(_ turn: ChatTurnItem) -> String {
        let label = turn.label ?? ""
        let tasks = turn.taskIds?.count ?? 0
        if tasks > 0 {
            // A turn the machine opened with the results of tasks this chat gave; the label is their titles.
            return label.isEmpty
                ? String(localized: "Woken by \(tasks) tasks") : String(localized: "Woken by \(tasks) tasks: \(label)")
        }
        return label.isEmpty
            ? String(localized: "Continued on its own") : String(localized: "Sub-agent finished: \(label)")
    }

}

enum ChatToolPresentation {
    static func summary(_ tool: ChatToolItem) -> String {
        let input = tool.input
        let keys: [String]
        switch tool.name {
        case "Bash": keys = ["description", "command"]
        case "Read", "Edit", "Write", "MultiEdit", "NotebookEdit": keys = ["file_path", "notebook_path"]
        case "Grep", "Glob": keys = ["pattern"]
        case "WebFetch", "WebSearch": keys = ["url", "query"]
        case "Task", "Agent": keys = ["description"]
        case "Skill": keys = ["skill"]
        default:
            // A tool nobody named shows whatever string it was called with, as chat/logic/tools.ts does. That reads
            // the input in the order the CLI wrote it; a decoded object has no order, so the keys decide instead.
            keys = (input.objectValue ?? [:]).keys.sorted()
        }
        return keys.compactMap { input[$0]?.stringValue }.first ?? ""
    }

    /// Whether the summary of a call is the path of a file, which a row cuts in the middle so the name stays.
    static func summaryIsPath(_ tool: ChatToolItem) -> Bool {
        guard ["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"].contains(tool.name) else { return false }
        let summary = summary(tool)
        return !summary.isEmpty
            && [tool.input["file_path"]?.stringValue, tool.input["notebook_path"]?.stringValue].contains(summary)
    }

    /// The mark of a call, as `toolIcon` in the desktop's chat draws it; a tool nobody named gets the wrench.
    static func icon(_ name: String) -> String {
        switch name {
        case "Read", "NotebookRead": "eye"
        case "Edit", "MultiEdit", "Write", "NotebookEdit", "ApplyPatch": "square-pen"
        case "Bash": "terminal"
        case "Grep": "search"
        case "Glob": "folder-search"
        case "WebFetch", "WebSearch": "globe"
        case "Task", "Agent": "bot"
        case "Skill": "zap"
        case "TodoWrite": "list-todo"
        case "Workflow": "workflow"
        case "ImageGeneration": "image"
        default: name.hasPrefix("mcp__") ? "hammer" : "wrench"
        }
    }

    static func mark(_ tool: ChatToolItem) -> ChatToolMark {
        RuimteCommandLook.run(of: tool) == nil ? .lucide(icon(tool.name)) : .ruimte
    }

    static func elapsed(_ milliseconds: Double) -> String { Format.elapsedShort(milliseconds: milliseconds) }

    static func tail(_ tool: ChatToolItem) -> String {
        let output = tool.progress?.output ?? ""
        return String(output.suffix(4000)).split(separator: "\n", omittingEmptySubsequences: false).suffix(12).joined(
            separator: "\n")
    }

    /// What a folded turn did, a sentence per kind of call in the order it first came, as `summarizeTurn` in
    /// `chat/logic/timeline.ts` writes it: every file change is one sentence, calls without one are counted last.
    static func turnSummary(_ tools: [ChatToolItem]) -> [ChatToolSentence] {
        var order: [String] = []
        var counts: [String: Int] = [:]
        var edited = Set<String>()
        var other = 0
        for tool in tools {
            let name = tool.name
            let key: String
            if let group = RuimteCommandLook.run(of: tool)?.groupKey {
                key = "look:\(group)"
            } else if fileChanges.contains(name) {
                edited.insert(tool.input["file_path"]?.stringValue ?? tool.id)
                key = "edited"
            } else if sentenceNames.contains(name) {
                key = name
            } else {
                other += 1
                continue
            }
            if counts[key] == nil { order.append(key) }
            counts[key, default: 0] += 1
        }
        var parts = order.map { key in
            let count = counts[key] ?? 0
            if key.hasPrefix("look:") { return usedRuimte(String(key.dropFirst(5)), count: count) }
            return ChatToolSentence(
                text: key == "edited" ? String(localized: "Edited \(edited.count) files") : sentence(key, count: count))
        }
        if other > 0 {
            parts.append(
                ChatToolSentence(
                    text: parts.isEmpty
                        ? String(localized: "\(other) tool calls") : String(localized: "\(other) other tool calls")))
        }
        return parts
    }

    /// The work of a folded turn after its time: "· Read 2 files · Ran 3 commands".
    static func turnLine(_ parts: [ChatToolSentence]) -> AttributedString {
        parts.reduce(into: AttributedString()) { line, part in
            line += AttributedString(line.characters.isEmpty ? "· " : " · ")
            line += part.attributed
        }
    }

    private static let fileChanges: Set<String> = ["Edit", "Write", "MultiEdit", "ApplyPatch"]

    private static let sentenceNames: Set<String> = [
        "Read", "NotebookEdit", "Bash", "Grep", "Glob", "WebFetch", "WebSearch", "Task", "Agent", "Skill", "TodoWrite",
    ]

    // The sentences of `chat:group.tools` in the client's English locale.
    private static func sentence(_ name: String, count: Int) -> String {
        switch name {
        case "Read": String(localized: "Read \(count) files")
        case "Write": String(localized: "Wrote \(count) files")
        case "NotebookEdit": String(localized: "Edited \(count) notebooks")
        case "Bash": String(localized: "Ran \(count) commands")
        case "Grep": String(localized: "Searched \(count) patterns")
        case "Glob": String(localized: "Listed \(count) patterns")
        case "WebFetch": String(localized: "Fetched \(count) pages")
        case "WebSearch": String(localized: "Searched the web \(count) queries")
        case "Task", "Agent": String(localized: "Delegated \(count) tasks")
        case "Skill": String(localized: "Used \(count) skills")
        case "TodoWrite": String(localized: "Updated \(count) plans")
        default: String(localized: "\(count) tool calls")
        }
    }

    /// The line of a run of calls, as `summarizeGroup` in `chat/logic/timeline.ts` writes it: a run of
    /// `ruimte-context` calls as using Ruimte, and edits by the files they touched rather than the calls.
    static func groupLabel(_ tools: [ChatToolItem]) -> ChatToolSentence {
        let count = tools.count
        if let looked = lookLabel(tools) { return looked }
        let names = Set(tools.map(\.name))
        let only = names.count == 1 ? names.first : nil
        if let only, sentenceNames.contains(only) || only == "Write" {
            return ChatToolSentence(text: sentence(only, count: count))
        }
        if tools.allSatisfy({ fileChanges.contains($0.name) }) {
            let paths = Set(tools.map { $0.input["file_path"]?.stringValue ?? $0.id })
            return ChatToolSentence(text: String(localized: "Edited \(paths.count) files"))
        }
        if let only {
            return ChatToolSentence(
                text: String(localized: "\(only) \(count) calls", comment: "%@ is the name of a tool"))
        }
        return ChatToolSentence(text: String(localized: "\(count) tool calls"))
    }

    /// A run whose calls are all `ruimte-context`: named after the part they share, else after Ruimte alone.
    private static func lookLabel(_ tools: [ChatToolItem]) -> ChatToolSentence? {
        let runs = tools.map(RuimteCommandLook.run(of:))
        guard let first = runs.first, let first, runs.allSatisfy({ $0 != nil }) else { return nil }
        if let key = first.groupKey, runs.allSatisfy({ $0?.groupKey == key }) {
            return usedRuimte(key, count: tools.count)
        }
        return ChatToolSentence(text: String(localized: "Used Ruimte \(tools.count) times"), branded: true)
    }

    private static func usedRuimte(_ name: String, count: Int) -> ChatToolSentence {
        ChatToolSentence(
            text: String(
                localized: "Used Ruimte \(name) \(count) times", comment: "%@ is the name of a part of Ruimte"),
            branded: true)
    }
}

enum ChatToolMark: Equatable {
    case lucide(String)
    case ruimte
}

/// A sentence about calls; one that names Ruimte draws its name in bold, as the desktop does.
struct ChatToolSentence: Equatable {
    let text: String
    var branded = false

    var attributed: AttributedString {
        branded ? RuimteCommandLook.emphasizingBrand(text) : AttributedString(text)
    }
}
