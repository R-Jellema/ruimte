import Foundation
import RuimtePulsar

/// When a routine starts, as `RoutineScheduleSchema` writes it: a day and a time, weekdays and a time,
/// weekdays and a repeat within a day, or a crontab expression, on the machine's clock.
enum RoutineSchedule: Equatable {
    case once(date: String, time: String)
    /// ISO weekdays: 1 is Monday, 7 is Sunday.
    case weekly(days: [Int], time: String)
    /// On those days every `every` minutes from `from` up to and including `to`.
    case interval(days: [Int], every: Int, from: String, to: String)
    /// Five crontab fields, such as `0 9 * * 1-5`.
    case cron(expression: String)
    /// A kind a newer machine knows and this app does not.
    case unknown

    init(json: JSONValue?) {
        let days = (json?.list("days") ?? []).compactMap { $0.numberValue.map(Int.init) }.sorted()
        switch json?.text("kind") {
        case "once": self = .once(date: json?.text("date") ?? "", time: json?.text("time") ?? "")
        case "weekly": self = .weekly(days: days, time: json?.text("time") ?? "")
        case "interval":
            self = .interval(
                days: days, every: Int(json?.number("every", fallback: 60) ?? 60), from: json?.text("from") ?? "",
                to: json?.text("to") ?? "")
        case "cron": self = .cron(expression: json?.text("expression") ?? "")
        default: self = .unknown
        }
    }

    /// "Daily at 08:00", "Mon, Thu at 08:00" or "Once, Mon 19 Oct 22:00", read in the machine's time zone.
    func words(timeZone: TimeZone?, in locale: FormatLocale = .current) -> String {
        var locale = locale
        if let timeZone { locale.timeZone = timeZone }
        switch self {
        case .once(let date, let time):
            guard let moment = Self.moment(date: date, time: time, timeZone: locale.timeZone) else { return time }
            return String(
                localized: "Once, \(Format.weekdayDay(moment, in: locale)) \(Format.clock(moment, in: locale))",
                comment: "A routine that runs one time: its day, then its time")
        case .weekly(let days, let time):
            let clock = Self.clock(time, in: locale)
            switch Set(days) {
            case Set(1...7): return String(localized: "Daily at \(clock)")
            case Set(1...5): return String(localized: "Weekdays at \(clock)")
            case [6, 7]: return String(localized: "Weekends at \(clock)")
            default:
                var calendar = Calendar(identifier: .gregorian)
                calendar.locale = locale.language
                let symbols = calendar.shortWeekdaySymbols
                let names = days.filter { (1...7).contains($0) }.map { symbols[$0 % 7] }.joined(separator: ", ")
                return String(
                    localized: "\(names) at \(clock)",
                    comment: "Weekdays a routine runs on, such as Mon, Thu, then a time")
            }
        case .interval(let days, let every, let from, let to):
            let start = Self.clock(from, in: locale)
            let end = Self.clock(to, in: locale)
            return String(
                localized: "\(Self.dayWords(days, in: locale)), \(Self.stepWords(every)) from \(start) to \(end)",
                comment: "A routine that repeats within a day: its days, how often, then the first and last time")
        case .cron(let expression):
            return String(localized: "Cron \(expression)", comment: "A routine on a crontab expression, such as 0 9 * * 1-5")
        case .unknown:
            return String(localized: "On a schedule this app does not know")
        }
    }

    private static func dayWords(_ days: [Int], in locale: FormatLocale) -> String {
        switch Set(days) {
        case Set(1...7): return String(localized: "Daily", comment: "The days of a routine that repeats within a day")
        case Set(1...5):
            return String(localized: "Weekdays", comment: "The days of a routine that repeats within a day")
        case [6, 7]: return String(localized: "Weekends", comment: "The days of a routine that repeats within a day")
        default:
            var calendar = Calendar(identifier: .gregorian)
            calendar.locale = locale.language
            let symbols = calendar.shortWeekdaySymbols
            return days.filter { (1...7).contains($0) }.map { symbols[$0 % 7] }.joined(separator: ", ")
        }
    }

    private static func stepWords(_ minutes: Int) -> String {
        if minutes == 60 { return String(localized: "every hour") }
        if minutes % 60 == 0 {
            let hours = minutes / 60
            return String(localized: "every \(hours) hours", comment: "How often a routine repeats, two hours or more")
        }
        return String(localized: "every \(minutes) minutes", comment: "How often a routine repeats")
    }

    /// A schedule's `HH:MM` as the region writes a time, so a twelve-hour region reads `08:00 AM`.
    static func clock(_ time: String, in locale: FormatLocale) -> String {
        moment(date: "2026-01-05", time: time, timeZone: locale.timeZone).map { Format.clock($0, in: locale) } ?? time
    }

    private static func moment(date: String, time: String, timeZone: TimeZone) -> Date? {
        let day = date.split(separator: "-").compactMap { Int($0) }
        let clock = time.split(separator: ":").compactMap { Int($0) }
        guard day.count == 3, clock.count == 2 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.date(
            from: DateComponents(year: day[0], month: day[1], day: day[2], hour: clock[0], minute: clock[1]))
    }
}

/// One run of a routine, as `RoutineRunSchema` writes it.
struct RoutineRun: Equatable, Identifiable {
    let id: String
    /// `skipped`, `starting`, `running`, `needs-you`, `limit`, `done` or `failed`.
    let state: String
    /// Why a skipped run did not start: `overlap`, `held` or `paused`.
    let skipped: String?
    let due: Date
    /// The chat of an agent run; a command or a launch has none.
    let chatID: String?
    let limitUntil: Date?
    let error: String?
    let versionNumber: Int?

    init(json: JSONValue) {
        id = json.text("runId")
        state = json.text("state")
        skipped = json["skipped"]?.stringValue
        due = Date(timeIntervalSince1970: json.number("due") / 1000)
        chatID = json["chatId"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        limitUntil = json["limitUntil"]?.numberValue.map { Date(timeIntervalSince1970: $0 / 1000) }
        error = json["error"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        versionNumber = json["versionNumber"]?.numberValue.map(Int.init)
    }

    var active: Bool { ["starting", "running", "needs-you", "limit"].contains(state) }

    var icon: String {
        switch state {
        case "skipped": "skip-forward"
        case "starting", "running": "circle-dot"
        case "needs-you": "hand"
        case "limit": "gauge"
        case "done": "check"
        case "failed": "circle-x"
        default: "circle"
        }
    }

    func words(now: Date = .now) -> String {
        switch state {
        case "skipped":
            switch skipped {
            case "overlap": return String(localized: "Skipped while the run before it went on")
            case "held": return String(localized: "Skipped, it was not approved")
            case "paused": return String(localized: "Skipped while paused")
            default: return String(localized: "Skipped")
            }
        case "starting": return String(localized: "Starting")
        case "running": return String(localized: "Running")
        case "needs-you": return String(localized: "Needs you")
        case "limit":
            if let limitUntil {
                return String(localized: "Waits on a usage limit until \(Format.moment(limitUntil, now: now))")
            }
            return String(localized: "Waits on a usage limit")
        case "done":
            if let versionNumber {
                return String(localized: "Done, v\(versionNumber)", comment: "A run that delivered a version to Output")
            }
            return String(localized: "Done")
        case "failed": return String(localized: "Failed")
        default: return state
        }
    }
}

/// A routine as `RoutineEntrySchema` writes it, with what its machine knows of it.
struct RoutineEntry: Equatable {
    let id: String
    let projectID: String
    let projectName: String
    let kind: String
    let title: String
    let schedule: RoutineSchedule
    let approved: Bool
    let pausedAt: Date?
    /// The next time it is due; nil while paused, held, declined or past its once.
    let next: Date?
    /// Newest first.
    let runs: [RoutineRun]

    init(json: JSONValue) {
        let routine = json["routine"] ?? .object([:])
        id = routine.text("id")
        projectID = json.text("projectId")
        projectName = json.text("projectName")
        kind = routine.text("kind")
        title = routine.text("title")
        schedule = RoutineSchedule(json: routine["schedule"])
        approved = json["approved"]?.boolValue == true
        pausedAt = json["local"]?["pausedAt"]?.numberValue.map { Date(timeIntervalSince1970: $0 / 1000) }
        next = json["next"]?.numberValue.map { Date(timeIntervalSince1970: $0 / 1000) }
        runs = json.list("runs").map(RoutineRun.init(json:))
    }

    /// The run that waits on a person, which keeps every next time from starting until it is answered.
    var waitingRun: RoutineRun? { runs.first { $0.state == "needs-you" } }
    var held: Bool { pausedAt != nil || !approved }
}

/// A routine on one machine.
struct RoutineTarget: Hashable {
    let machineID: String
    let projectID: String
    let routineID: String
}

/// A run of a routine opened as its chat.
struct RoutineRunTarget: Hashable {
    let machineID: String
    let chatID: String
    let title: String
    let due: Date
}

enum ScheduledRoute: Hashable {
    case routine(RoutineTarget)
    case run(RoutineRunTarget)
}

/// What one machine answered of its routines.
struct ScheduledMachineInput: Equatable {
    let machineID: String
    let machineName: String
    /// Nil while it was never reached on this link, false for a machine older than routines.
    let answers: Bool?
    let entries: [RoutineEntry]
}

struct ScheduledItem: Equatable, Identifiable {
    let machineID: String
    let machineName: String
    let entry: RoutineEntry
    var target: RoutineTarget { RoutineTarget(machineID: machineID, projectID: entry.projectID, routineID: entry.id) }
    var id: String { "\(machineID):\(entry.projectID):\(entry.id)" }
}

/// A run waiting on a person. What it asks is its chat's, which Now's attention reads.
struct ScheduledWait: Equatable, Identifiable {
    let item: ScheduledItem
    let run: RoutineRun
    var id: String { "\(item.id):\(run.id)" }
}

/// The Scheduled tab's groups across every machine: what waits on you, what is still due today, what runs before
/// tomorrow noon, what comes later, and what stands still.
struct ScheduledBoard: Equatable {
    var needsYou: [ScheduledWait] = []
    var today: [ScheduledItem] = []
    var overnight: [ScheduledItem] = []
    var later: [ScheduledItem] = []
    var held: [ScheduledItem] = []
    /// Machines reached on this link that do not know routines yet.
    var outdated: [String] = []
    /// Whether any machine answered routines at all.
    var answered = false

    var isEmpty: Bool { needsYou.isEmpty && today.isEmpty && overnight.isEmpty && later.isEmpty && held.isEmpty }

    static func build(_ inputs: [ScheduledMachineInput], now: Date, calendar: Calendar = .current) -> ScheduledBoard {
        var board = ScheduledBoard()
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
        let noon = calendar.date(byAdding: .hour, value: 12, to: tomorrow) ?? tomorrow
        for input in inputs.sorted(by: { $0.machineName < $1.machineName }) {
            if input.answers == false { board.outdated.append(input.machineName) }
            guard input.answers == true else { continue }
            board.answered = true
            for entry in input.entries {
                let item = ScheduledItem(machineID: input.machineID, machineName: input.machineName, entry: entry)
                if let run = entry.waitingRun {
                    board.needsYou.append(ScheduledWait(item: item, run: run))
                }
                if entry.held {
                    board.held.append(item)
                } else if let next = entry.next {
                    if next < tomorrow {
                        board.today.append(item)
                    } else if next < noon {
                        board.overnight.append(item)
                    } else {
                        board.later.append(item)
                    }
                }
            }
        }
        board.needsYou.sort { $0.run.due < $1.run.due }
        for keyPath in [\ScheduledBoard.today, \.overnight, \.later] {
            board[keyPath: keyPath].sort { ($0.entry.next ?? now) < ($1.entry.next ?? now) }
        }
        board.held.sort { $0.entry.title.localizedStandardCompare($1.entry.title) == .orderedAscending }
        return board
    }
}
