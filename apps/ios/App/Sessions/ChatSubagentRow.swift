import RuimtePulsar
import RuimteTransport
import SwiftUI

struct ChatSubagentRow: View {
    let item: ChatSubagentItem
    let children: [ChatItemState]
    let presentation: ChatPresentation
    let client: any MachineRequesting
    let chatID: String
    @State private var showingResult = false
    private var running: Bool { item.status == .running }
    private var expanded: Bool { !opens && presentation.expandedSubagents.contains(item.id) }
    private var opens: Bool { ChatSubagents.canOpen(item, machineRefused: presentation.subagentsRefused) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if opens {
                // The conversation opens on a page of its own, as a row of the sub-agent list does.
                Button {
                    presentation.conversationRequest = SubagentCrumb(item)
                } label: {
                    header
                }.buttonStyle(.plain).font(.footnote).foregroundStyle(MobileStyle.muted)
                    .accessibilityHint("Opens the conversation")
            } else {
                ChatExpansionButton(expanding: !expanded) {
                    presentation.toggleSubagent(item.id)
                } label: {
                    header
                }.buttonStyle(.plain).font(.footnote).foregroundStyle(MobileStyle.muted)
                    .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            }
            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    if item.itemsTruncated {
                        Text("Only the beginning of this agent's work is kept.").font(.caption).foregroundStyle(
                            MobileStyle.muted)
                    }
                    if children.isEmpty {
                        Text("Nothing to show yet.").font(.caption).foregroundStyle(MobileStyle.muted)
                    } else {
                        ScrollViewReader { reader in
                            ScrollView {
                                LazyVStack(alignment: .leading, spacing: 8) {
                                    ForEach(children) { child in
                                        ChatObservedRow(record: child, client: client, chatID: chatID).id(child.id)
                                    }
                                }
                            }
                            .defaultScrollAnchor(.bottom)
                            .frame(height: min(320, max(88, CGFloat(children.count) * 88)))
                            .onChange(of: children.count) { _, _ in
                                if running, let last = children.last { reader.scrollTo(last.id, anchor: .bottom) }
                            }
                        }
                    }
                    if let result = item.result, !result.isEmpty {
                        DisclosureGroup("Show result", isExpanded: $showingResult) {
                            MarkdownMessage(text: result).modifier(ChatMessageMenu(text: result))
                        }
                    }
                }
                .padding(.leading, 14)
                .overlay(alignment: .leading) { Rectangle().fill(MobileStyle.border).frame(width: 1) }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(lucide: "bot", size: 14)
                // A node another agent opened with `--task` reads as the task it is.
                ChatLiveLabel(
                    text: item.origin == .ruimte ? String(localized: "Task") : String(localized: "Sub-agent"),
                    active: running)
                Spacer(minLength: 4)
                if running {
                    ChatElapsed(startedAt: item.startedAt)
                } else {
                    Text(item.status == .failed ? "Failed" : "Done")
                        .foregroundStyle(item.status == .failed ? Color.red : MobileStyle.muted)
                    if let end = item.finishedAt {
                        Text(
                            "in \(ChatToolPresentation.elapsed(end - item.startedAt))",
                            comment: "How long a finished sub-agent took, after Done or Failed")
                    }
                }
                Image(lucide: opens || !expanded ? "chevron-right" : "chevron-down", size: 12)
            }
            Text(item.description).lineLimit(2).padding(.leading, 22)
            if item.background || running && !(item.lastTool ?? "").isEmpty {
                Text(
                    [
                        item.background ? String(localized: "Background") : "",
                        running ? item.lastTool ?? "" : "",
                    ].filter { !$0.isEmpty }.joined(separator: " · ")
                )
                .font(.caption).padding(.leading, 22)
            }
        }.frame(minHeight: 44).contentShape(Rectangle())
    }
}
