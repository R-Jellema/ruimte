import RuimtePulsar
import SwiftUI

/// Every routine of the connected machines, grouped by what a person needs to know: what waits on them, what still
/// runs today, what runs overnight, what comes later and what stands still. Routines are made on the machine; the
/// phone answers their runs, pauses, resumes and starts one now.
struct ScheduledPage: View {
    let runtime: AppRuntime
    let projects: UnifiedProjects
    let model: ScheduledModel
    let open: (ScheduledRoute) -> Void
    let addMachine: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            let board = model.board(now: timeline.date)
            MobileList {
                if runtime.machines.isEmpty {
                    ContentUnavailableView {
                        Label(String(localized: "No machines yet"), lucideIcon: "monitor", iconSize: 48)
                    } description: {
                        Text("Connect your computer to see what is scheduled on it.")
                    } actions: {
                        Button("Add machine", action: addMachine)
                    }
                } else if !board.answered {
                    unanswered(board)
                } else if board.isEmpty {
                    ContentUnavailableView(
                        String(localized: "Nothing scheduled"), lucideIcon: "calendar-clock",
                        description: Text("Routines you set up on your Mac show up here."))
                } else {
                    sections(board, now: timeline.date)
                }
                if board.answered, !board.outdated.isEmpty {
                    Text("Update Ruimte on \(board.outdated.formatted(.list(type: .and))) to see its routines here.")
                        .font(.footnote).foregroundStyle(MobileStyle.muted)
                }
            }
        }
        .refreshable { await model.refresh() }
        .onAppear { model.appear(runtime: runtime) }
        .onDisappear { model.disappear() }
        .onChange(of: runtime.machines.map(\.id)) { model.reconcile(runtime: runtime) }
        .onChange(of: runtime.connectionRevision) { model.reconcile(runtime: runtime) }
    }

    @ViewBuilder private func unanswered(_ board: ScheduledBoard) -> some View {
        if model.connecting {
            MobileLoadingRow(String(localized: "Connecting to your machines"))
                .frame(maxWidth: .infinity, minHeight: 120)
        } else if !board.outdated.isEmpty {
            ContentUnavailableView(
                String(localized: "Your machine needs an update"), lucideIcon: "calendar-clock",
                description: Text(
                    "Scheduled shows routines once \(board.outdated.formatted(.list(type: .and))) runs a newer Ruimte."
                ))
        } else {
            ContentUnavailableView {
                Label(String(localized: "Machine unavailable"), lucideIcon: "triangle-alert", iconSize: 48)
            } description: {
                Text("Could not connect to your machine.")
            } actions: {
                Button("Try again") {
                    for feed in model.feeds.values where !feed.session.connected { feed.session.reconnect() }
                }
            }
        }
    }

    @ViewBuilder private func sections(_ board: ScheduledBoard, now: Date) -> some View {
        if !board.needsYou.isEmpty {
            Section {
                ForEach(board.needsYou) { wait in
                    ScheduledWaitCard(wait: wait, badge: badge(wait.item)) {
                        guard let chatID = wait.run.chatID else { return open(.routine(wait.item.target)) }
                        open(
                            .run(
                                RoutineRunTarget(
                                    machineID: wait.item.machineID, chatID: chatID, title: wait.item.entry.title,
                                    due: wait.run.due)))
                    }
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                }
            } header: {
                NowHeader(
                    title: String(localized: "Needs you"), count: board.needsYou.count,
                    color: MobileStyle.statusNeedsYou, first: true)
            }
        }
        group(String(localized: "Today"), board.today, color: MobileStyle.statusRunning, first: board.needsYou.isEmpty)
        group(
            String(localized: "Overnight"), board.overnight, color: MobileStyle.statusIdle,
            first: board.needsYou.isEmpty && board.today.isEmpty)
        group(
            String(localized: "Later"), board.later, color: MobileStyle.faint,
            first: board.needsYou.isEmpty && board.today.isEmpty && board.overnight.isEmpty)
        group(
            String(localized: "Held"), board.held, color: MobileStyle.muted,
            first: board.needsYou.isEmpty && board.today.isEmpty && board.overnight.isEmpty && board.later.isEmpty)
    }

    @ViewBuilder private func group(_ title: String, _ items: [ScheduledItem], color: Color, first: Bool) -> some View {
        if !items.isEmpty {
            Section {
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { Divider().overlay(MobileStyle.border).padding(.leading, 46) }
                        Button {
                            open(.routine(item.target))
                        } label: {
                            ScheduledRow(item: item, badge: badge(item), timeZone: timeZone(item))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("scheduled.\(item.entry.id)")
                    }
                }
                .mobileCard(padding: 0)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
            } header: {
                NowHeader(title: title, count: items.count, color: color, first: first)
            }
        }
    }

    private func timeZone(_ item: ScheduledItem) -> TimeZone? { model.feed(item.machineID)?.timeZone }

    private func badge(_ item: ScheduledItem) -> ScheduledBadge {
        let id = UnifiedProjectRow.ID(machineID: item.machineID, projectID: item.entry.projectID)
        let summary =
            (projects.open + projects.recent + projects.chats).first { $0.id == id }?.summary
            ?? .object(["name": .string(item.entry.projectName)])
        return ScheduledBadge(summary: summary, session: model.feed(item.machineID)?.session)
    }
}

/// A project's mark beside a routine, from the project list where the phone knows the project.
struct ScheduledBadge: View {
    let summary: JSONValue
    let session: SharedMachineSession?

    var body: some View {
        if let session {
            ProjectBadge(summary: summary, session: session, chats: NewChat.isChats(summary), size: 24)
        } else {
            Color.clear.frame(width: 24, height: 24)
        }
    }
}

/// A run waiting on a person, as a card: what it asks, and that the next time is skipped until it is answered.
struct ScheduledWaitCard: View {
    let wait: ScheduledWait
    let badge: ScheduledBadge
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    badge
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: wait.item.entry.title).font(.callout.weight(.semibold))
                            .foregroundStyle(MobileStyle.text).lineLimit(1)
                        Text(
                            verbatim: [
                                wait.item.entry.projectName, Format.moment(wait.run.due),
                                String(
                                    localized: "on \(wait.item.machineName)", comment: "%@ is the name of a machine"),
                            ].joined(separator: " · ")
                        )
                        .font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Image(lucide: "chevron-right", size: 14).foregroundStyle(MobileStyle.faint)
                }
                Text(verbatim: wait.question ?? String(localized: "Waiting for your answer"))
                    .font(.subheadline).foregroundStyle(MobileStyle.text).lineLimit(1)
                if let next = wait.item.entry.next {
                    Text("\(Format.weekdayClock(next)) is skipped while this waits")
                        .font(.caption).foregroundStyle(MobileStyle.statusNeedsYou)
                }
            }
            .mobileCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the run")
        .accessibilityIdentifier("scheduled.wait.\(wait.item.entry.id)")
    }
}

/// A routine in a group: its project, title, schedule in words and when it is due next, or why it stands still.
struct ScheduledRow: View {
    let item: ScheduledItem
    let badge: ScheduledBadge
    let timeZone: TimeZone?

    private var entry: RoutineEntry { item.entry }
    private var waiting: Bool { entry.waitingRun != nil }

    var body: some View {
        HStack(spacing: 12) {
            badge
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: entry.title).foregroundStyle(MobileStyle.text).lineLimit(1)
                Text(verbatim: "\(entry.projectName) · \(detail)")
                    .font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(2)
            }
            Spacer(minLength: 8)
            trailing
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 56)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    private var detail: String {
        if let pausedAt = entry.pausedAt {
            return String(localized: "paused since \(Format.moment(pausedAt))")
        }
        if !entry.approved {
            return String(localized: "approve on \(item.machineName) first", comment: "%@ is the name of a machine")
        }
        let words = entry.schedule.words(timeZone: timeZone)
        return waiting ? "\(words) · \(String(localized: "skips while waiting"))" : words
    }

    @ViewBuilder private var trailing: some View {
        if entry.pausedAt != nil {
            Image(lucide: "circle-pause", size: 18).foregroundStyle(MobileStyle.muted)
                .accessibilityLabel("Paused")
        } else if !entry.approved {
            Image(lucide: "laptop", size: 18).foregroundStyle(MobileStyle.muted)
                .accessibilityLabel("Waits for approval")
        } else if let next = entry.next {
            // Today and overnight read as a time alone, the way the groups above them already name the day.
            Text(next.timeIntervalSinceNow < 86_400 ? Format.clock(next) : Format.weekdayClock(next))
                .font(.footnote).monospacedDigit()
                .foregroundStyle(waiting ? MobileStyle.statusNeedsYou : MobileStyle.muted)
        }
    }
}
