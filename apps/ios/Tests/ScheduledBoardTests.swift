import Foundation
import RuimtePulsar
import Testing

@testable import Ruimte

@Suite @MainActor struct ScheduledBoardTests {
    /// Monday 26 October 2026, 14:20 UTC.
    private static let now = Date(timeIntervalSince1970: 1_793_024_400)

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    private static let english = FormatLocale(
        region: Locale(identifier: "en_GB"), language: Locale(identifier: "en"), timeZone: TimeZone(identifier: "UTC")!)

    @Test func routinesFallUnderWhatAPersonNeedsToKnow() {
        let hour = 3_600.0
        let entries = [
            entry("tonight", next: Self.now.addingTimeInterval(8 * hour)),
            entry("morning", next: Self.now.addingTimeInterval(18 * hour)),
            entry("friday", next: Self.now.addingTimeInterval(4 * 24 * hour)),
            entry("evening", next: Self.now.addingTimeInterval(2 * hour)),
            entry("paused", next: nil, paused: true),
            entry("unapproved", next: nil, approved: false),
            entry("ended", next: nil),
            entry(
                "waiting", next: Self.now.addingTimeInterval(19 * hour),
                runs: [run("r2", state: "needs-you", chat: "chat-1"), run("r1", state: "done")]),
        ]
        let board = ScheduledBoard.build(
            [input(entries, questions: ["chat-1": "Include the major update?"])], now: Self.now,
            calendar: Self.calendar)
        #expect(board.needsYou.map(\.item.entry.id) == ["waiting"])
        #expect(board.needsYou.first?.question == "Include the major update?")
        #expect(board.today.map(\.entry.id) == ["evening", "tonight"])
        #expect(board.overnight.map(\.entry.id) == ["morning", "waiting"])
        #expect(board.later.map(\.entry.id) == ["friday"])
        #expect(board.held.map(\.entry.id) == ["paused", "unapproved"])
        #expect(board.answered)
    }

    @Test func aMachineWithoutRoutinesIsNamedAndListsNothing() {
        let older = ScheduledMachineInput(
            machineID: "old", machineName: "Studio", answers: false, entries: [], questions: [:])
        let unreached = ScheduledMachineInput(
            machineID: "far", machineName: "Laptop", answers: nil, entries: [], questions: [:])
        let board = ScheduledBoard.build([older, unreached], now: Self.now, calendar: Self.calendar)
        #expect(board.outdated == ["Studio"])
        #expect(!board.answered)
        #expect(board.isEmpty)
    }

    @Test func aScheduleReadsInWords() {
        func words(_ json: JSONValue) -> String { RoutineSchedule(json: json).words(timeZone: nil, in: Self.english) }
        let clock = "08:30"
        #expect(words(weekly([1, 2, 3, 4, 5, 6, 7])) == String(localized: "Daily at \(clock)"))
        #expect(words(weekly([1, 2, 3, 4, 5])) == String(localized: "Weekdays at \(clock)"))
        #expect(words(weekly([7, 6])) == String(localized: "Weekends at \(clock)"))
        let days = "Mon, Thu"
        #expect(words(weekly([4, 1])) == String(localized: "\(days) at \(clock)"))
        let day = "Mon 26 Oct"
        let time = "22:00"
        #expect(
            words(.object(["kind": .string("once"), "date": .string("2026-10-26"), "time": .string("22:00")]))
                == String(localized: "Once, \(day) \(time)"))
        #expect(
            words(.object(["kind": .string("monthly")])) == String(localized: "On a schedule this app does not know"))
    }

    @Test func anIntervalReadsItsDaysStepAndWindow() {
        func words(_ days: [Int], _ every: Int) -> String {
            RoutineSchedule(
                json: .object([
                    "kind": .string("interval"), "days": .array(days.map { .number(Double($0)) }),
                    "every": .number(Double(every)), "from": .string("09:00"), "to": .string("17:00"),
                ])
            ).words(timeZone: nil, in: Self.english)
        }
        let start = "09:00"
        let end = "17:00"
        func expected(_ days: String, _ step: String) -> String {
            String(localized: "\(days), \(step) from \(start) to \(end)")
        }
        let minutes = 30
        let hours = 2
        #expect(words([1, 2, 3, 4, 5], 60) == expected(String(localized: "Weekdays"), String(localized: "every hour")))
        #expect(
            words([1, 2, 3, 4, 5, 6, 7], minutes)
                == expected(String(localized: "Daily"), String(localized: "every \(minutes) minutes")))
        #expect(words([3, 1], 120) == expected("Mon, Wed", String(localized: "every \(hours) hours")))
    }

    @Test func anEntryReadsWhatTheMachineKeepsOfIt() {
        let entry = RoutineEntry(
            json: .object([
                "routine": .object([
                    "id": .string("deps"), "kind": .string("agent"), "title": .string("Dependency check"),
                    "schedule": weekly([1]),
                ]),
                "projectId": .string("p1"), "projectName": .string("adecore"), "approved": .bool(true),
                "local": .object(["pausedAt": .number(1_792_000_000_000)]), "next": .null,
                "runs": .array([
                    .object([
                        "runId": .string("r1"), "state": .string("done"), "due": .number(1_792_000_000_000),
                        "versionNumber": .number(3),
                    ])
                ]),
            ]))
        #expect(entry.held)
        #expect(entry.next == nil)
        #expect(entry.runs.first?.versionNumber == 3)
        #expect(entry.runs.first?.chatID == nil)
        #expect(entry.waitingRun == nil)
    }

    private func weekly(_ days: [Int]) -> JSONValue {
        .object([
            "kind": .string("weekly"), "days": .array(days.map { .number(Double($0)) }), "time": .string("08:30"),
        ])
    }

    private func input(_ entries: [RoutineEntry], questions: [String: String] = [:]) -> ScheduledMachineInput {
        ScheduledMachineInput(
            machineID: "mac", machineName: "Mac", answers: true, entries: entries, questions: questions)
    }

    private func run(_ id: String, state: String, chat: String? = nil) -> JSONValue {
        var run: [String: JSONValue] = [
            "runId": .string(id), "state": .string(state), "due": .number(Self.now.timeIntervalSince1970 * 1000),
        ]
        if let chat { run["chatId"] = .string(chat) }
        return .object(run)
    }

    private func entry(
        _ id: String, next: Date?, paused: Bool = false, approved: Bool = true, runs: [JSONValue] = []
    ) -> RoutineEntry {
        var local: [String: JSONValue] = [:]
        if paused { local["pausedAt"] = .number(Self.now.timeIntervalSince1970 * 1000) }
        return RoutineEntry(
            json: .object([
                "routine": .object([
                    "id": .string(id), "kind": .string("agent"), "title": .string(id), "schedule": weekly([1]),
                ]),
                "projectId": .string("p1"), "projectName": .string("ruimte"), "approved": .bool(approved),
                "local": .object(local), "next": next.map { .number($0.timeIntervalSince1970 * 1000) } ?? .null,
                "runs": .array(runs),
            ]))
    }
}
