import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

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
