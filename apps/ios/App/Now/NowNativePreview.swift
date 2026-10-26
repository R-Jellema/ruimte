#if DEBUG
import RuimtePulsar
import SwiftUI

/// A trial of Now on the system's own grouped list, to compare with the cards. Debug builds only; it reads the same
/// board and answers through the same model as Now.
struct NowNativePreview: View {
    let now: NowModel
    let scheduled: ScheduledModel
    let open: (ProjectViewTarget) -> Void
    let openRoutine: (ScheduledRoute) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 60)) { timeline in
                let board = now.board
                let comingUp = NowComingUp.build(
                    snoozed: board.snoozed, scheduled: scheduled.board(now: timeline.date))
                List {
                    Section {
                        if board.needsYou.isEmpty {
                            Label {
                                Text("Nothing needs you")
                            } icon: {
                                MobileStatusGlyph(tone: .done, symbol: "circle-check")
                            }
                        }
                        ForEach(board.needsYou) { entry in
                            needsYouRow(entry, board: board, date: timeline.date)
                        }
                    } header: {
                        Text("Needs you")
                    }
                    if !board.working.isEmpty {
                        Section("Working") {
                            ForEach(board.working) { entry in
                                row(
                                    entry, tone: .working, subtitle: entry.workingLine(namesMachine: board.namesMachines),
                                    value: entry.workingSince.map {
                                        Format.duration(milliseconds: timeline.date.timeIntervalSince1970 * 1000 - $0)
                                    })
                            }
                        }
                    }
                    if !board.finished.isEmpty {
                        Section("Finished") {
                            ForEach(board.finished) { entry in
                                row(
                                    entry, tone: .done, subtitle: entry.place(namesMachine: board.namesMachines),
                                    value: entry.finishedAt.map {
                                        Format.moment(Date(timeIntervalSince1970: $0 / 1000), now: timeline.date)
                                    })
                            }
                        }
                    }
                    if !comingUp.isEmpty {
                        Section("Coming up") {
                            ForEach(comingUp) { item in
                                comingUpRow(item, namesMachine: board.namesMachines, date: timeline.date)
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
            .refreshable { await now.refresh() }
            .navigationTitle("Now")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
            }
        }
    }

    private func needsYouRow(_ entry: ProjectViewEntry, board: NowBoard, date: Date) -> some View {
        let request = entry.requests.first
        return Button {
            go(entry.target)
        } label: {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title).foregroundStyle(MobileStyle.text)
                    if let request {
                        Text(request.wants).font(.subheadline).foregroundStyle(MobileStyle.text).lineLimit(2)
                    }
                    Text(NowCard.subtitle(entry, namesMachine: board.namesMachines, at: date))
                        .font(.footnote).foregroundStyle(MobileStyle.muted)
                }
            } icon: {
                MobileStatusGlyph(tone: .waiting, symbol: entry.iconName)
            }
        }
        .swipeActions(edge: .leading) {
            if let request, request.approval != nil {
                Button("Allow") {
                    Task { await now.approve(entry, request, decision: .allow) }
                }
                .tint(MobileStyle.swipeAction)
            }
        }
        .swipeActions(edge: .trailing) {
            if let request, request.approval != nil {
                Button("Deny", role: .destructive) {
                    Task { await now.approve(entry, request, decision: .deny) }
                }
                .tint(MobileStyle.swipeDestructive)
            }
        }
    }

    private func row(_ entry: ProjectViewEntry, tone: MobileTone, subtitle: String, value: String?) -> some View {
        Button {
            go(entry.target)
        } label: {
            LabeledContent {
                if let value { Text(value).monospacedDigit() }
            } label: {
                Label {
                    Text(entry.title).foregroundStyle(MobileStyle.text)
                    Text(subtitle)
                } icon: {
                    MobileStatusGlyph(tone: tone, symbol: entry.iconName)
                }
            }
        }
    }

    @ViewBuilder private func comingUpRow(_ item: NowComingUp, namesMachine: Bool, date: Date) -> some View {
        switch item.subject {
        case .snoozed(let entry):
            Button {
                go(entry.target)
            } label: {
                LabeledContent {
                    Text(SnoozeChoice.moment(item.at, from: date))
                } label: {
                    Label {
                        Text(entry.title).foregroundStyle(MobileStyle.text)
                        Text(entry.place(namesMachine: namesMachine))
                    } icon: {
                        MobileStatusGlyph(tone: .idle, symbol: entry.iconName)
                    }
                }
            }
        case .routine(let routine):
            Button {
                dismiss()
                openRoutine(.routine(routine.target))
            } label: {
                LabeledContent {
                    Text(Format.moment(item.at, now: date)).monospacedDigit()
                } label: {
                    Label {
                        Text(routine.entry.title).foregroundStyle(MobileStyle.text)
                        Text(routine.entry.projectName)
                    } icon: {
                        MobileStatusGlyph(tone: .idle, symbol: "calendar-clock")
                    }
                }
            }
        }
    }

    private func go(_ target: ProjectViewTarget) {
        dismiss()
        open(target)
    }
}
#endif
