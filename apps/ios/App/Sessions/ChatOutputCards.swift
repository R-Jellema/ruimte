import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// A version a chat saved to Output, as a row of its card in the thread.
struct ChatSavedVersion: Equatable {
    let artifactID: String
    let title: String
    let kind: String
    let version: OutputVersion
    let latest: Bool
}

/// The versions one turn of the chat saved, as one card among the thread's rows. It is the app's own row and never
/// a chat item, so the thread on the wire stays as it was.
struct ChatOutputCard: Equatable, Identifiable {
    let saved: [ChatSavedVersion]
    var id: String { "output:\(saved[0].version.id)" }
    /// At the last version, so a turn's card stands under the commands that made it.
    var at: Double { saved[saved.count - 1].version.createdAt }
}

/// An Output item a card in the thread asked to open; nil `versionID` is its latest version.
struct ChatOutputOpen: Identifiable, Hashable {
    let artifactID: String
    let title: String
    let versionID: String?
    var id: String { "\(artifactID):\(versionID ?? "")" }
}

enum ChatOutputCards {
    /// The versions oldest first, one group for every turn that saved them, and else one for every run the thread
    /// places between the same two of its rows. A turn's commands fold away under its summary, so versions of one turn
    /// split by a command would otherwise read as two lists with a gap between, as `groupsBetweenItems` has it.
    static func groups(_ saved: [ChatSavedVersion], itemTimes: [Double]) -> [[ChatSavedVersion]] {
        var groups: [[ChatSavedVersion]] = []
        let sorted = saved.enumerated().sorted {
            $0.element.version.createdAt == $1.element.version.createdAt
                ? $0.offset < $1.offset : $0.element.version.createdAt < $1.element.version.createdAt
        }
        for entry in sorted.map(\.element) {
            guard let previous = groups.last?.last else {
                groups.append([entry])
                continue
            }
            let turnID = entry.version.provenance.turnID
            let sameTurn = turnID != nil && previous.version.provenance.turnID == turnID
            let apart =
                !sameTurn
                && itemTimes.contains { $0 > previous.version.createdAt && $0 <= entry.version.createdAt }
            if apart {
                groups.append([entry])
            } else {
                groups[groups.count - 1].append(entry)
            }
        }
        return groups
    }

    /// What of the read items this chat saved: every version an artifact of more than one was read with, and the
    /// latest of the rest.
    static func saved(chatID: String, items: [OutputItem], versions: [String: [OutputVersion]]) -> [ChatSavedVersion] {
        items.flatMap { item in
            let read = versions[item.id].map { versions in
                versions.enumerated().map { index, version in
                    ChatSavedVersion(
                        artifactID: item.id, title: item.title, kind: item.kind, version: version, latest: index == 0)
                }
            }
            return read ?? [
                ChatSavedVersion(
                    artifactID: item.id, title: item.title, kind: item.kind, version: item.latest, latest: true)
            ]
        }
        .filter { $0.version.provenance.chatID == chatID }
    }
}

/// What a chat saved to Output, read while its thread shows and only from a machine that names `artifact.list`:
/// the chat's items, and every version of an item with more than one, again whenever the machine says one changed.
/// What an older read found stays until the next lands, so a card never blinks out.
@MainActor final class ChatOutputWatch {
    private let client: any MachineRequesting
    private let chatID: String
    private let deliver: @MainActor ([ChatSavedVersion]) -> Void
    private var versions: [String: [OutputVersion]] = [:]
    private var subscriptions: [() -> Void] = []
    private var lease: MachineSubscription?
    private var loading: Task<Void, Never>?

    init(client: any MachineRequesting, chatID: String, deliver: @escaping @MainActor ([ChatSavedVersion]) -> Void) {
        self.client = client
        self.chatID = chatID
        self.deliver = deliver
    }

    func start() {
        guard subscriptions.isEmpty else { return }
        subscriptions.append(
            client.subscribe(WireEvent.artifactChanged.rawValue) { [weak self] _ in
                guard let self, lease != nil else { return }
                load()
            })
        subscriptions.append(
            client.observeConnection { [weak self] available in
                // Which machine answers what is known only once it is connected.
                guard let self, available, OutputMachine.answers(client) else { return }
                if let lease {
                    Task {
                        _ = try? await lease.refresh()
                        self.load()
                    }
                } else {
                    lease = client.acquireSubscription(
                        start: WireRequest.artifactWatch.rawValue, stop: WireRequest.artifactUnwatch.rawValue,
                        payload: .object([:]), stopPayload: .object([:]))
                    load()
                }
            })
    }

    func stop() {
        loading?.cancel()
        subscriptions.forEach { $0() }
        subscriptions.removeAll()
        let lease = lease
        self.lease = nil
        Task { await lease?.release() }
    }

    private func load() {
        loading?.cancel()
        loading = Task { [weak self] in
            guard let self else { return }
            guard
                let answer = try? await client.request(
                    WireRequest.artifactList.rawValue, payload: .object(["chatId": .string(chatID)]))
            else { return }
            let items = answer.list("artifacts").map(OutputItem.init(json:))
            for item in items where item.versionCount > 1 {
                guard
                    let read = try? await client.request(
                        WireRequest.artifactGet.rawValue, payload: .object(["artifactId": .string(item.id)]))
                else { continue }
                versions[item.id] = read.list("versions").map(OutputVersion.init(json:))
            }
            guard !Task.isCancelled else { return }
            deliver(ChatOutputCards.saved(chatID: chatID, items: items, versions: versions))
        }
    }
}

/// The versions a turn of a chat saved, as one block of tight rows, each opening its item. Read only, as Output is
/// on a phone.
struct ChatOutputCardView: View {
    let card: ChatOutputCard
    let presentation: ChatPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(card.saved, id: \.version.id) { entry in
                row(entry)
            }
        }
    }

    private func row(_ entry: ChatSavedVersion) -> some View {
        let what = Self.what(entry.version)
        return Button {
            presentation.outputRequest = ChatOutputOpen(
                artifactID: entry.artifactID, title: entry.title, versionID: entry.latest ? nil : entry.version.id)
        } label: {
            HStack(spacing: 8) {
                Image(lucide: OutputKind.icon(entry.kind), size: 14)
                    .foregroundStyle(MobileStyle.muted)
                    .frame(width: 24, height: 24)
                    .background(MobileStyle.subtleFill, in: RoundedRectangle(cornerRadius: 6))
                Text(verbatim: entry.title).fontWeight(.medium).foregroundStyle(MobileStyle.text).lineLimit(1)
                Text(what).foregroundStyle(MobileStyle.muted).lineLimit(1).layoutPriority(1)
                Spacer(minLength: 0)
            }
            .font(.footnote)
            .frame(minHeight: 36).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(entry.title), \(what)"))
        .accessibilityAddTraits(.isButton)
    }

    static func what(_ version: OutputVersion) -> String {
        version.number == 1
            ? String(localized: "Saved to Output")
            : String(localized: "Version \(version.number) saved to Output")
    }
}
