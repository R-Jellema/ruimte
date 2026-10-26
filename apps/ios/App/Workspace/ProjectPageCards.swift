import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// One row of a project's page on an iPhone: a view, a node under its unfolded canvas, or the project's Git.
enum ProjectPageRow: Identifiable {
    case view(JSONValue)
    case node(JSONValue)
    case git

    var id: String {
        switch self {
        case .view(let item): "view:\(item.stableID)"
        case .node(let node): "node:\(node.stableID)"
        case .git: "git"
        }
    }
}

/// One card of a project's page with the header over it.
struct ProjectPageGroup: Identifiable {
    let id: String
    let title: String?
    /// What the header counts beside its title; nil where it counts nothing.
    var count: Int?
    var rows: [ProjectPageRow]
}

enum ProjectPageLayout {
    /// Chats, then Terminals and views with Git last. Once a person headed parts of the list, each part keeps its
    /// heading and its order instead, and Git closes the last one.
    static func groups(_ views: [JSONValue], git: Bool, expanded: (String) -> Bool) -> [ProjectPageGroup] {
        func rows(_ items: [JSONValue]) -> [ProjectPageRow] {
            items.flatMap { item -> [ProjectPageRow] in
                let nodes = expanded(item.stableID) ? ProjectListLogic.nodes(of: item) : []
                return [.view(item)] + nodes.map { .node($0) }
            }
        }
        let sections = WorkspaceViewSections.split(views)
        var groups: [ProjectPageGroup]
        if sections.contains(where: { $0.title != nil }) {
            groups = sections.map { section in
                let id: String
                switch section.id {
                case .leading: id = "leading"
                case .divider(let divider): id = divider
                }
                return ProjectPageGroup(id: id, title: section.title, rows: rows(section.items))
            }
        } else {
            let items = sections.flatMap(\.items)
            let chats = items.filter { $0.text("kind") == "chat" }
            let others = items.filter { $0.text("kind") != "chat" }
            groups = []
            if !chats.isEmpty {
                groups.append(
                    ProjectPageGroup(
                        id: "chats", title: String(localized: "Chats"), count: chats.count, rows: rows(chats)))
            }
            if !others.isEmpty || git {
                groups.append(
                    ProjectPageGroup(id: "views", title: String(localized: "Terminals and views"), rows: rows(others)))
            }
        }
        if git {
            if groups.isEmpty {
                groups.append(ProjectPageGroup(id: "views", title: String(localized: "Terminals and views"), rows: []))
            }
            groups[groups.count - 1].rows.append(.git)
        }
        return groups
    }
}

/// What a row of a project's page says of its state: the tone of its glyph, and its second line from what the
/// machine reported, or none.
enum ProjectRowState {
    static func tone(_ marks: ProjectRowMarks) -> MobileTone {
        if marks.snoozedUntil != nil { return .idle }
        if marks.needsYou { return .waiting }
        if marks.working { return .working }
        if marks.status == .error { return .error }
        if marks.unseen { return .done }
        return .idle
    }

    /// `ids` is the row and, for a canvas, the nodes it speaks for.
    static func line(ids: [String], marks: ProjectRowMarks, sources: ProjectMarkSources, now: Date) -> String? {
        if let until = marks.snoozedUntil {
            return String(localized: "Snoozed until \(SnoozeChoice.moment(until, from: now))")
        }
        if marks.needsYou {
            guard let request = ids.lazy.compactMap({ sources.requests[$0]?.first }).first else {
                return String(localized: "Waiting for you")
            }
            return request.approval != nil ? request.wants : request.summary
        }
        if marks.working {
            return ids.lazy.compactMap { working(id: $0, sources: sources) }.first
        }
        switch marks.status {
        case .error: return String(localized: "Stopped on an error")
        case .exited: return String(localized: "Process ended")
        default: break
        }
        guard marks.unseen, let finishedAt = ids.compactMap({ sources.finishedAt[$0] }).max() else { return nil }
        let moment = Format.moment(Date(timeIntervalSince1970: finishedAt / 1000), now: now)
        return String(localized: "Finished \(moment)", comment: "%@ is when a session stopped, such as 07:52")
    }

    /// What runs beside a turn where the machine says; the machine names no step of a turn itself.
    private static func working(id: String, sources: ProjectMarkSources) -> String? {
        let activity = sources.activity[id] ?? ChatActivity()
        var parts: [String] = []
        if activity.background.count == 1, let description = activity.background.first?.description,
            !description.isEmpty
        {
            parts.append(description)
        } else if !activity.background.isEmpty {
            parts.append(String(localized: "\(activity.background.count) in the background"))
        } else if sources.delegating.contains(id) && sources.statuses[id] != .running {
            parts.append(String(localized: "Waiting on delegated work"))
        }
        if activity.queued > 0 {
            parts.append(
                String(localized: "\(activity.queued) queued", comment: "Messages queued for a chat's next turn"))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// A project's page on an iPhone: its views in cards with what each one waits on or does, read live from the
/// machine's attention.
struct PhoneProjectCards: View {
    let workspace: MobileWorkspace
    let state: ProjectListState
    let views: [JSONValue]
    let git: ProjectGitLine?
    let open: (String) -> Void
    let openGit: () -> Void
    let act: (ProjectRowAction, JSONValue) -> Void

    var body: some View {
        let sources = markSources
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            MobileList {
                ProjectPageSections(
                    workspace: workspace, state: state,
                    groups: ProjectPageLayout.groups(
                        views, git: git != nil && !workspace.isScratch, expanded: state.isExpanded),
                    sources: sources, git: git, date: timeline.date, open: open, openGit: openGit, act: act)
            }
        }
        .accessibilityIdentifier("workspace.views")
        .task(id: ProjectListLogic.chatIDs(views)) {
            state.readDrafts(machineID: workspace.session.machine.id, chatIDs: ProjectListLogic.chatIDs(views))
        }
        .onAppear {
            state.readDrafts(machineID: workspace.session.machine.id, chatIDs: ProjectListLogic.chatIDs(views))
            state.watchWarnings(workspace.client)
        }
        .onDisappear { state.stopWatching() }
    }

    private var markSources: ProjectMarkSources {
        let attention = workspace.session.attention
        return ProjectMarkSources(
            statuses: attention.statuses, unseen: attention.unseen,
            delegating: attention.delegating.union(workspace.session.tasks.parentsWithOpenTasks),
            drafts: state.drafts, warnings: state.warnings,
            shared: Set(workspace.document.list("shared").compactMap(\.stringValue)),
            snoozes: workspace.session.snoozes.standing,
            requests: attention.waits.mapValues { $0.requests.compactMap(NowRequest.init) },
            activity: attention.activity, finishedAt: attention.finishedAt)
    }
}

/// The cards of a project's page as sections of a list.
struct ProjectPageSections: View {
    let workspace: MobileWorkspace
    let state: ProjectListState
    let groups: [ProjectPageGroup]
    let sources: ProjectMarkSources
    let git: ProjectGitLine?
    let date: Date
    let open: (String) -> Void
    let openGit: () -> Void
    let act: (ProjectRowAction, JSONValue) -> Void
    @ScaledMetric(relativeTo: .subheadline) private var indent = MobileMetrics.statusColumn + MobileSpacing.medium
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ForEach(groups) { group in
            Section {
                MobileRowGroup(items: group.rows) { row in
                    switch row {
                    case .view(let item): itemRow(item, isView: true)
                    case .node(let node): itemRow(node, isView: false).padding(.leading, indent)
                    case .git: gitRow
                    }
                }
                .listRowInsets(NowSections.cardInsets)
            } header: {
                if let title = group.title {
                    MobileSectionHeader(title: title, count: group.count)
                        .padding(.top, group.id == groups.first?.id ? 0 : MobileSpacing.small)
                }
            }
        }
    }

    private func itemRow(_ item: JSONValue, isView: Bool) -> some View {
        let id = item.stableID
        let nodes = isView ? ProjectListLogic.nodes(of: item) : []
        let marks =
            isView
            ? ProjectListLogic.marks(view: item, sources: sources) : ProjectListLogic.marks(node: item, sources: sources)
        let expanded = !nodes.isEmpty && state.isExpanded(id)
        return HStack(spacing: 0) {
            Button {
                open(id)
            } label: {
                MobileStatusRow(
                    tone: ProjectRowState.tone(marks), symbol: WorkspaceViewIcon.name(for: item), title: title(item),
                    subtitle: ProjectRowState.line(
                        ids: [id] + nodes.map(\.stableID), marks: marks, sources: sources, now: date)
                ) {
                    ProjectRowMarksView(
                        marks: marks, task: workspace.session.tasks.childTask(id), showsStatus: false)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(isView ? "workspace.view.\(id)" : "workspace.node.\(id)")
            .contextMenu {
                ProjectRowMenu(item: item, isView: isView, status: marks.status, workspace: workspace, act: act)
            } preview: {
                ProjectRowPreview(workspace: workspace, item: item, marks: marks, nodes: nodes, sources: sources)
            }
            if !nodes.isEmpty {
                Button {
                    withAnimation(reduceMotion ? nil : .snappy) { state.toggle(id) }
                } label: {
                    Image(lucide: expanded ? "chevron-down" : "chevron-right", size: 15)
                        .foregroundStyle(MobileStyle.muted)
                        .frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.trailing, MobileSpacing.xSmall)
                .accessibilityLabel(expanded ? "Fold \(title(item))" : "Unfold \(title(item))")
            }
        }
    }

    private var gitRow: some View {
        Button(action: openGit) {
            MobileStatusRow(
                tone: .idle, symbol: "git-branch", title: String(localized: "Git"), value: git?.changedText ?? "")
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("project.git.row")
    }

    private func title(_ row: JSONValue) -> String {
        let name = row.text("name", fallback: row.text("title"))
        return name.isEmpty ? NewViewFactory.kindTitle(row.text("kind")) : name
    }
}

/// Starts a chat in a project from one line typed at the bottom of its page: a chat view at the end of its list, or
/// for the Chats project the chat the machine hands out with `project.newChat`, then `chat.send` with the line.
@MainActor @Observable
final class ProjectNewChatModel {
    var text = ""
    var provider: String?
    private(set) var sending = false
    var problem: String?
    @ObservationIgnored private let workspace: MobileWorkspace
    private let catalog: NewChatModel

    init(workspace: MobileWorkspace) {
        self.workspace = workspace
        catalog = NewChatModel(client: workspace.client, machineID: workspace.session.machine.id)
    }

    var agents: [JSONValue] { catalog.agents ?? [] }
    var canSend: Bool {
        !sending && provider != nil && workspace.ready && workspace.session.connected && !message.isEmpty
    }
    private var message: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    func load() async {
        await catalog.load()
        problem = catalog.problem
        if provider.map({ picked in !agents.contains { $0.agentKind == picked } }) ?? true {
            provider = agents.first?.agentKind
        }
    }

    /// Answers with the chat the line went to, to open; nil when it did not go out, which keeps the line.
    func send() async -> String? {
        guard canSend, let provider else { return nil }
        sending = true
        defer { sending = false }
        problem = nil
        let line = message
        do {
            let chat: JSONValue
            if workspace.isScratch {
                chat = try await scratchChat(provider)
            } else {
                chat = try await projectChat(provider)
            }
            try await workspace.ensureSession(chat)
            _ = try await workspace.client.request(
                "chat.send", payload: .object(["chatId": .string(chat.stableID), "text": .string(line)]))
            text = ""
            return chat.stableID
        } catch {
            problem = NewChat.message(for: error)
            return nil
        }
    }

    private func projectChat(_ provider: String) async throws -> JSONValue {
        let chat = NewChat.projectView(
            id: "chat-" + UUID().uuidString, provider: provider, account: catalog.account(for: provider))
        await workspace.edit { $0.setting("views", .array($0.list("views") + [chat])) }
        if let failure = workspace.problem { throw MachineClientError.invalid(failure) }
        return chat
    }

    private func scratchChat(_ provider: String) async throws -> JSONValue {
        guard let place = await catalog.start(provider: provider) else {
            throw MachineClientError.invalid(catalog.problem ?? String(localized: "Could not start the chat."))
        }
        guard place.projectID == workspace.projectID, await workspace.arrival(of: place.viewID),
            let chat = workspace.item(place.viewID)
        else { throw MachineClientError.invalid(String(localized: "The machine did not say where the chat is.")) }
        return chat
    }
}

/// The glass field at the bottom of a project's page that starts a chat there, with the plus beside it that adds a
/// terminal or another view.
struct ProjectNewChatBar: View {
    let workspace: MobileWorkspace
    let add: (() -> Void)?
    let opened: (String) -> Void
    @State private var model: ProjectNewChatModel
    @FocusState private var focused: Bool
    @ScaledMetric(relativeTo: .body) private var height = 56
    @ScaledMetric(relativeTo: .body) private var action = 40

    init(workspace: MobileWorkspace, add: (() -> Void)?, opened: @escaping (String) -> Void) {
        self.workspace = workspace
        self.add = add
        self.opened = opened
        _model = State(initialValue: ProjectNewChatModel(workspace: workspace))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: MobileSpacing.small) {
            if let problem = model.problem {
                Text(problem).font(.footnote).foregroundStyle(MobileStyle.statusError)
                    .padding(.horizontal, MobileSpacing.large)
            }
            HStack(spacing: 10) {
                HStack(spacing: 10) {
                    agentPicker
                    TextField(placeholder, text: $model.text)
                        .font(.body)
                        .foregroundStyle(MobileStyle.text)
                        .focused($focused)
                        .submitLabel(.send)
                        .onSubmit(send)
                        .disabled(model.sending)
                        .accessibilityIdentifier("project.newChat.field")
                    if !model.text.isEmpty || model.sending {
                        sendButton
                    }
                }
                .padding(.leading, 20)
                .padding(.trailing, 8)
                .frame(minHeight: height)
                .contentShape(.capsule)
                .onTapGesture { focused = true }
                .glassEffect(.regular.interactive(), in: .capsule)
                if let add {
                    Button(action: add) {
                        Image(lucide: "plus", size: 22).frame(width: height, height: height)
                    }
                    .buttonStyle(MobileGlassButtonStyle(shape: .circle))
                    .disabled(!workspace.ready)
                    .accessibilityLabel("Add view")
                    .accessibilityIdentifier("project.newView")
                }
            }
        }
        .padding(.horizontal, MobileSpacing.margin)
        .padding(.bottom, MobileSpacing.small)
        .task(id: workspace.session.generation) {
            if workspace.session.connected { await model.load() }
        }
    }

    private var placeholder: String {
        workspace.isScratch
            ? String(localized: "New chat")
            : String(localized: "New chat in \(workspace.title)", comment: "%@ is the name of a project")
    }

    @ViewBuilder private var agentPicker: some View {
        let icon = Image(lucide: "message-square-plus", size: 18).foregroundStyle(MobileStyle.text)
        if model.agents.count > 1 {
            Menu {
                Picker("Chat with", selection: $model.provider) {
                    ForEach(model.agents, id: \.agentKind) { agent in
                        Text(agent.text("name", fallback: agent.agentKind)).tag(Optional(agent.agentKind))
                    }
                }
            } label: {
                icon.frame(width: 28, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel("Chat with")
        } else {
            icon.accessibilityHidden(true)
        }
    }

    private var sendButton: some View {
        Button(action: send) {
            Group {
                if model.sending {
                    Spinner(size: 16)
                } else {
                    Image(lucide: "arrow-up", size: 19)
                }
            }
            .foregroundStyle(model.canSend ? MobileStyle.onAccent : MobileStyle.muted)
            .frame(width: action, height: action)
            .background(model.canSend ? MobileStyle.accent : MobileStyle.inset, in: .circle)
            .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .disabled(!model.canSend)
        .accessibilityLabel("Send message")
    }

    private func send() {
        Task {
            guard let id = await model.send() else { return }
            focused = false
            opened(id)
        }
    }
}
