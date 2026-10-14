import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit

struct ChatFileChange: Equatable, Identifiable {
    var id: String { path }
    let path: String
    var diff: String
    var added: Int
    var deleted: Int
    var omitted: String?
}

enum ChatFileChanges {
    static func hasChanges(_ tool: ChatToolItem) -> Bool { !fromTool(tool).isEmpty }

    static func fromTool(_ tool: ChatToolItem) -> [ChatFileChange] {
        let patches = (tool.changes ?? []).filter { !$0.diff.isEmpty }
        if !patches.isEmpty { return patches.map { counted(path: $0.path, diff: $0.diff) } }
        return fromInput(name: tool.name, input: tool.input)
    }

    /// An approval carries the changes its call would make in its input, which has no schema of its own.
    static func fromApproval(_ approval: ChatApprovalItem) -> [ChatFileChange] {
        let patches = approval.input.list("changes").filter { !$0.text("diff").isEmpty }
        if !patches.isEmpty { return patches.map(fromJSON) }
        return fromInput(name: approval.toolName, input: approval.input)
    }

    static func fromFile(_ file: ChatTurnItemCheckpointDiffFilesItem) -> ChatFileChange {
        ChatFileChange(
            path: file.path, diff: file.diff, added: Int(file.added), deleted: Int(file.deleted),
            omitted: file.omitted?.rawValue)
    }

    private static func fromInput(name: String, input: JSONValue) -> [ChatFileChange] {
        let path = input.text("file_path")
        guard !path.isEmpty else { return [] }
        switch name {
        case "Edit": return [replacement(path: path, before: input.text("old_string"), after: input.text("new_string"))]
        case "Write": return [replacement(path: path, before: "", after: input.text("content"))]
        case "MultiEdit":
            return input.list("edits").map {
                replacement(path: path, before: $0.text("old_string"), after: $0.text("new_string"))
            }
        default: return []
        }
    }

    private static func fromJSON(_ value: JSONValue) -> ChatFileChange {
        var change = counted(path: value.text("path"), diff: value.text("diff"))
        if let added = value["added"]?.numberValue { change.added = Int(added) }
        if let deleted = value["deleted"]?.numberValue { change.deleted = Int(deleted) }
        change.omitted = value["omitted"]?.stringValue
        return change
    }

    /// A change that says only its diff, counted from the diff's own lines.
    private static func counted(path: String, diff: String) -> ChatFileChange {
        let lines = diff.components(separatedBy: "\n")
        return ChatFileChange(
            path: path, diff: diff, added: lines.filter { $0.hasPrefix("+") && !$0.hasPrefix("+++") }.count,
            deleted: lines.filter { $0.hasPrefix("-") && !$0.hasPrefix("---") }.count)
    }

    static func grouped(_ changes: [ChatFileChange]) -> [ChatFileChange] {
        var files: [ChatFileChange] = []
        var positions: [String: Int] = [:]
        for change in changes {
            if let index = positions[change.path] {
                files[index].diff += "\n" + change.diff
                files[index].added += change.added
                files[index].deleted += change.deleted
            } else {
                positions[change.path] = files.count
                files.append(change)
            }
        }
        return files
    }

    private static func replacement(path: String, before: String, after: String) -> ChatFileChange {
        let old = before.isEmpty ? [] : before.components(separatedBy: "\n")
        let new = after.isEmpty ? [] : after.components(separatedBy: "\n")
        // Provider edits describe a replacement fragment, not the complete file or its line numbers.
        let diff =
            String(localized: "Replacement", comment: "Header of a diff that shows a replaced fragment") + "\n"
            + (old.map { "-" + $0 } + new.map { "+" + $0 }).joined(separator: "\n")
        return ChatFileChange(path: path, diff: diff, added: new.count, deleted: old.count)
    }
}

struct ChatDiffView: View {
    let diff: String
    @State private var showAll = false
    private var lines: [String] { diff.components(separatedBy: "\n") }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView(.horizontal) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array((showAll ? lines : Array(lines.prefix(400))).enumerated()), id: \.offset) { _, line in
                        Text(line.isEmpty ? " " : line)
                            .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                            .fixedSize(horizontal: true, vertical: false)
                            .foregroundStyle(
                                line.hasPrefix("+") ? Color.green : line.hasPrefix("-") ? Color.red : MobileStyle.muted
                            )
                            .padding(.horizontal, 12).padding(.vertical, 2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                line.hasPrefix("+")
                                    ? Color.green.opacity(0.08) : line.hasPrefix("-") ? Color.red.opacity(0.08) : .clear
                            )
                    }
                }.fixedSize(horizontal: true, vertical: false)
            }
            if lines.count > 400 && !showAll {
                ChatExpansionButton(expanding: true) {
                    showAll = true
                } label: {
                    Text("Show all \(lines.count) lines")
                }.font(.caption).frame(minHeight: 44).padding(
                    .horizontal, 12)
            }
        }
        .contextMenu {
            Button(String(localized: "Copy diff"), lucideIcon: "copy") { UIPasteboard.general.string = diff }
        }
    }
}

struct ChatFileChangeView: View {
    let change: ChatFileChange
    @State private var expanded = false
    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            if let omitted = change.omitted {
                Text(omitted == "binary" ? "Binary file, no diff" : "Too large to show")
                    .font(.caption).foregroundStyle(MobileStyle.muted).padding(12)
            } else {
                ChatDiffView(diff: change.diff)
            }
        } label: {
            HStack(spacing: 8) {
                Text(change.path).font(.system(.caption, design: .monospaced)).lineLimit(2).truncationMode(.middle)
                Spacer(minLength: 0)
                Text("+\(change.added)").foregroundStyle(.green)
                Text("-\(change.deleted)").foregroundStyle(.red)
            }.font(.caption).monospacedDigit()
        }
    }
}

struct ChatChangedFilesRow: View {
    let turn: ChatItemState
    let tools: [ChatItemState]
    let client: any MachineRequesting
    let chatID: String
    @State private var work = RemotePageState()
    @State private var fetched: ChatTurnItemCheckpointDiff?
    @State private var fetchedOnce = false
    private var item: ChatTurnItem? { turn.item.turnItem }
    private var stored: ChatTurnItemCheckpointDiff? { item?.checkpointDiff }
    private var files: [ChatFileChange] {
        if let diff = stored ?? fetched {
            return ChatFileChanges.grouped(diff.files.map(ChatFileChanges.fromFile))
        }
        return ChatFileChanges.grouped(tools.compactMap(\.item.toolItem).flatMap(ChatFileChanges.fromTool))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !files.isEmpty || work.loading || work.problem != nil {
                VStack(alignment: .leading, spacing: 8) {
                    Label(
                        String(localized: "\(files.count) changed files"), lucideIcon: "file-diff",
                        iconSize: 14
                    )
                    .font(.footnote.weight(.medium))
                    if (stored ?? fetched)?.truncated == true {
                        Text("More changes were omitted from this snapshot.").font(.caption).foregroundStyle(
                            MobileStyle.muted)
                    }
                    ForEach(files) { change in
                        Divider()
                        ChatFileChangeView(change: change)
                    }
                    if work.loading { ProgressView("Loading changes...").font(.caption) }
                    if let problem = work.problem {
                        Text(problem).font(.caption).foregroundStyle(MobileStyle.muted)
                        Button("Retry") { Task { await load() } }.frame(minHeight: 44)
                    }
                }
                .padding(12)
                .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(MobileStyle.border) }
            }
        }.task(id: turn.id) { await load() }
    }

    private func load() async {
        guard stored == nil, !fetchedOnce, let item, item.checkpoint != nil, !work.loading else { return }
        await work.read { stillTheLatest in
            let result = try await client.request(
                "chat.turnDiff",
                payload: .object(["chatId": .string(chatID), "turnId": .string(item.turnId ?? item.id)]))
            try stillTheLatest()
            // A turn whose diff is empty still counts as read: a second attempt would answer the same.
            fetched = try? result["diff"]?.decoded(as: ChatTurnItemCheckpointDiff.self)
            fetchedOnce = true
        }
    }
}
