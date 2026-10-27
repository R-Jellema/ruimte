import RuimtePulsar
import SwiftUI

/// Now on an iPad, beside the sidebar: the cards that wait on you in two columns, Working and Finished side by side
/// under them, and Coming up below. The same board and rows as the iPhone's, answered in place the same way.
struct PadNowPage: View {
    let runtime: AppRuntime
    let now: NowModel
    let scheduled: ScheduledModel
    let open: (ProjectViewTarget) -> Void
    let openProject: (ProjectViewTarget) -> Void
    let openRoutine: (ScheduledRoute) -> Void
    let addMachine: () -> Void

    private let columns = [
        GridItem(.flexible(), spacing: MobileSpacing.medium, alignment: .top),
        GridItem(.flexible(), alignment: .top),
    ]

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            let board = now.board
            ScrollView {
                VStack(alignment: .leading, spacing: MobileSpacing.xLarge) {
                    if runtime.machines.isEmpty {
                        NoMachinesView(
                            description: Text("Connect a machine to see what your agents are doing."),
                            add: addMachine)
                    } else if !now.loaded && board.isEmpty {
                        MobileLoadingRow(String(localized: "Connecting to your machines"))
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else {
                        content(
                            board, date: timeline.date,
                            comingUp: NowComingUp.build(
                                snoozed: board.snoozed, scheduled: scheduled.board(now: timeline.date)))
                    }
                }
                .frame(maxWidth: 980)
                .padding(.horizontal, MobileSpacing.xLarge).padding(.vertical, MobileSpacing.large)
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Now")
        .navigationBarTitleDisplayMode(.inline)
        .modifier(NowWatch(now: now))
    }

    @ViewBuilder private func content(_ board: NowBoard, date: Date, comingUp: [NowComingUp]) -> some View {
        if board.needsYou.isEmpty {
            NowNothingWaits(notifies: runtime.notifications.enabled)
        } else {
            VStack(alignment: .leading, spacing: MobileSpacing.medium) {
                MobileSectionHeader(title: String(localized: "Needs you"), count: board.needsYou.count)
                LazyVGrid(columns: columns, alignment: .leading, spacing: MobileSpacing.medium) {
                    ForEach(board.needsYou) { entry in
                        NowCard(
                            now: now, entry: entry,
                            subtitle: NowCard.subtitle(entry, namesMachine: board.namesMachines, at: date),
                            connected: now.connected(entry.target.machineID), task: now.task(for: entry.target)
                        ) { open(entry.target) }
                        .contextMenu { menu(entry) }
                        .accessibilityIdentifier("now.\(entry.target.itemID)")
                    }
                }
            }
        }
        if !board.working.isEmpty || !board.finished.isEmpty {
            HStack(alignment: .top, spacing: MobileSpacing.medium) {
                group(String(localized: "Working"), empty: String(localized: "Nothing is working."), board.working) {
                    entry in
                    NowWorkingRow(
                        entry: entry, namesMachine: board.namesMachines, task: now.task(for: entry.target), date: date)
                }
                group(
                    String(localized: "Finished"), empty: String(localized: "Nothing finished while you were away."),
                    board.finished
                ) { entry in
                    NowFinishedRow(
                        entry: entry, namesMachine: board.namesMachines, task: now.task(for: entry.target), date: date)
                }
            }
        }
        if !comingUp.isEmpty {
            VStack(alignment: .leading, spacing: MobileSpacing.medium) {
                MobileSectionHeader(title: String(localized: "Coming up"))
                VStack(spacing: 0) {
                    MobileRowGroup(items: comingUp) { item in
                        NowComingUpButton(
                            item: item, namesMachine: board.namesMachines, date: date, open: open,
                            openRoutine: openRoutine
                        ) { menu($0) }
                    }
                }
            }
        }
    }

    /// One of the two columns under the cards; an empty one keeps its place, so the other does not stretch across.
    private func group<Row: View>(
        _ title: String, empty: String, _ entries: [ProjectViewEntry],
        @ViewBuilder row: @escaping (ProjectViewEntry) -> Row
    ) -> some View {
        VStack(alignment: .leading, spacing: MobileSpacing.medium) {
            MobileSectionHeader(title: title, count: entries.count)
            if entries.isEmpty {
                Text(empty)
                    .font(.footnote).foregroundStyle(MobileStyle.faint)
                    .padding(.horizontal, MobileSpacing.cardPadding)
                    .frame(maxWidth: .infinity, minHeight: MobileMetrics.rowHeight, alignment: .leading)
                    .mobileCard(padding: 0)
            } else {
                VStack(spacing: 0) {
                    MobileRowGroup(items: entries) { entry in
                        Button {
                            open(entry.target)
                        } label: {
                            row(entry)
                        }
                        .buttonStyle(.plain)
                        .contextMenu { menu(entry) }
                        .accessibilityIdentifier("now.\(entry.target.itemID)")
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private func menu(_ entry: ProjectViewEntry) -> some View {
        NowEntryMenu(now: now, entry: entry) {
            open(entry.target)
        } openProject: {
            openProject(entry.target)
        }
    }
}
