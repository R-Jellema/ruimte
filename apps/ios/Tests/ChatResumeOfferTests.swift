import RuimtePulsar
import XCTest

@testable import Ruimte

/// The cases of `resume-compaction.test.ts` and `continue-after-stop.test.ts` in the desktop's chat.
@MainActor final class ChatResumeOfferTests: XCTestCase {
    private static let now: Double = 1_800_000_000_000
    private static let ended = now - ChatResume.idleMilliseconds

    private func info(_ fields: [String: JSONValue] = [:], tokens: Int64 = ChatResume.compactionTokens) -> ChatInfo {
        var usage: [String: JSONValue] = [
            "contextTokens": .number(Double(tokens)), "contextWindow": .number(1_000_000), "costUsd": .number(1),
            "turns": .number(4),
        ]
        var fields = fields
        if let expires = fields.removeValue(forKey: "cacheExpiresAt") { usage["cacheExpiresAt"] = expires }
        fields["usage"] = .object(usage)
        return ChatWire.info(fields).chatInfo
    }

    private func turn(
        _ id: String, endedAt: Double?, createdAt: Double = 0, state: String? = nil, _ extra: [String: JSONValue] = [:]
    ) -> ChatItem {
        ChatWire.item(
            [
                "id": .string(id), "kind": .string("turn"), "turnId": .string(id), "createdAt": .number(createdAt),
                "state": .string(state ?? (endedAt == nil ? "running" : "done")),
                "endedAt": endedAt.map(JSONValue.number) ?? .null,
            ].merging(extra) { _, extra in extra }
        ).chatItem
    }

    private func compaction(_ turnID: String) -> ChatItem {
        ChatWire.item([
            "id": .string("compaction-\(turnID)"), "kind": .string("compaction"), "turnId": .string(turnID),
            "createdAt": .number(0), "preTokens": .number(180_000),
        ]).chatItem
    }

    private func offer(
        info: ChatInfo? = nil, compaction: String? = "prompt", items: [ChatItem]? = nil, dismissed: String? = nil,
        now: Double = now
    ) -> ChatCompactionOffer? {
        ChatResume.compactionOffer(
            info: info ?? self.info(), compaction: compaction, items: items ?? [turn("turn-1", endedAt: Self.ended)],
            dismissed: dismissed, now: now)
    }

    private func idle(_ turnID: String, tokens: Int64 = ChatResume.compactionTokens) -> ChatCompactionOffer {
        ChatCompactionOffer(turnID: turnID, tokens: tokens, reason: .idle)
    }

    func testAQuietChatWithEnoughContextIsOfferedACompactionNamingItsTurn() {
        XCTAssertEqual(offer(), idle("turn-1"))
        XCTAssertEqual(offer(compaction: "native"), idle("turn-1"))
    }

    func testAProviderThatCannotCompactOrWhoseCapabilitiesDidNotArriveIsNeverOfferedIt() {
        XCTAssertNil(offer(compaction: "none"))
        XCTAssertNil(offer(compaction: nil))
    }

    func testTheTokenThresholdIsAFloor() {
        XCTAssertNil(offer(info: info(tokens: ChatResume.compactionTokens - 1)))
        XCTAssertEqual(offer(info: info(tokens: 400_000))?.tokens, 400_000)
    }

    func testTheIdleThresholdIsAFloorAndARunningTurnHasNoEndToMeasureFrom() {
        XCTAssertNil(offer(now: Self.ended + ChatResume.idleMilliseconds - 1))
        XCTAssertNil(offer(items: [turn("turn-1", endedAt: nil)]))
        XCTAssertNil(offer(items: []))
    }

    func testAChatThatWorksOrHasAMessageWaitingIsLeftAlone() {
        XCTAssertNil(offer(info: info(["activeTurnId": .string("turn-2")])))
        XCTAssertNil(
            offer(
                info: info([
                    "queue": .array([
                        .object(["id": .string("queued-1"), "text": .string("later"), "createdAt": .number(0)])
                    ])
                ])))
    }

    func testATurnThatAlreadyCompactedIsNotOfferedItAgain() {
        XCTAssertNil(offer(items: [turn("turn-1", endedAt: Self.ended), compaction("turn-1")]))
        XCTAssertEqual(
            offer(items: [
                turn("turn-1", endedAt: Self.ended), compaction("turn-0"), turn("turn-2", endedAt: Self.ended),
            ]),
            idle("turn-2"))
    }

    func testKeepingTheFullHistoryHoldsForThatTurnOnly() {
        XCTAssertNil(offer(dismissed: "turn-1"))
        XCTAssertEqual(offer(dismissed: "turn-0"), idle("turn-1"))
        XCTAssertEqual(
            offer(
                items: [turn("turn-1", endedAt: Self.ended), turn("turn-2", endedAt: Self.ended)], dismissed: "turn-1"),
            idle("turn-2"))
    }

    func testACacheWithAKnownExpiryGoesColdAtThatMomentAndAWarmOneHoldsTheOfferBack() {
        let expires = Self.now - 60_000
        let cold = info(["cacheExpiresAt": .number(expires)])
        let items = [turn("turn-1", endedAt: expires - 120_000)]
        XCTAssertNil(offer(info: cold, items: items, now: expires - 1))
        XCTAssertEqual(
            offer(info: cold, items: items, now: expires),
            ChatCompactionOffer(turnID: "turn-1", tokens: ChatResume.compactionTokens, reason: .cacheExpired))
        let warm = info(["cacheExpiresAt": .number(Self.now + 1)])
        XCTAssertNil(offer(info: warm, items: [turn("turn-1", endedAt: Self.now - 2 * ChatResume.idleMilliseconds)]))
    }

    func testTheLastTurnIsTheOneThatStartedLastWhereverTheThreadHasIt() {
        XCTAssertNil(
            offer(items: [
                turn("turn-2", endedAt: nil, createdAt: 20), turn("turn-1", endedAt: Self.ended, createdAt: 10),
            ]))
        XCTAssertEqual(
            offer(items: [
                turn("turn-2", endedAt: Self.ended, createdAt: 20), turn("turn-1", endedAt: Self.ended, createdAt: 10),
            ])?.turnID, "turn-2")
    }

    private var stopped: [ChatItem] {
        [turn("turn-1", endedAt: 20, createdAt: 10, state: "aborted"), user("user-1", turn: "turn-1", at: 11)]
    }

    private func user(_ id: String, turn: String, at createdAt: Double) -> ChatItem {
        ChatWire.item([
            "id": .string(id), "kind": .string("user"), "turnId": .string(turn), "createdAt": .number(createdAt),
            "text": .string("Hello"),
        ]).chatItem
    }

    private func note(_ id: String, text: String) -> ChatItem {
        ChatWire.item([
            "id": .string(id), "kind": .string("note"), "turnId": .string("turn-1"), "createdAt": .number(21),
            "level": .string("warning"), "text": .string(text),
        ]).chatItem
    }

    private func continuable(_ info: ChatInfo, _ items: [ChatItem]) -> String? {
        ChatResume.continuableTurn(info: info, items: items)
    }

    private func continuable(_ items: [ChatItem]) -> String? { continuable(info(), items) }

    func testATurnAPersonStoppedIsTheOneToContinue() {
        XCTAssertEqual(continuable(stopped), "turn-1")
    }

    func testATurnThatFinishedFailedOrStillRunsHasNothingToContinue() {
        XCTAssertNil(continuable([turn("turn-1", endedAt: 20)]))
        XCTAssertNil(continuable([turn("turn-1", endedAt: 20, state: "error")]))
        XCTAssertNil(continuable(info(["activeTurnId": .string("turn-1")]), [turn("turn-1", endedAt: nil)]))
    }

    func testAQueueALimitAPausedGoalAndAWaitingRequestEachHaveTheirOwnWayOut() {
        let queue: JSONValue = .array([
            .object(["id": .string("queued-1"), "text": .string("Next"), "createdAt": .number(30)])
        ])
        XCTAssertNil(continuable(info(["queue": queue, "queuePaused": .bool(true)]), stopped))
        XCTAssertNil(continuable(info(["limit": .object(["kind": .string("usage")])]), stopped))
        XCTAssertNil(
            continuable([
                turn("turn-1", endedAt: 20, state: "aborted", ["limit": .object(["kind": .string("usage")])])
            ]))
        XCTAssertNil(continuable(info(["status": .string("needs-you")]), stopped))
        let goal = { (status: String) in
            self.info(["goal": .object(["objective": .string("Ship it"), "status": .string(status)])])
        }
        XCTAssertNil(continuable(goal("paused"), stopped))
        XCTAssertEqual(continuable(goal("active"), stopped), "turn-1")
    }

    func testATurnTheMachineEndedOrEndedWithItsChatWasNotStoppedByAPerson() {
        let restarted = note(
            "note-1", text: "This turn could not be resumed after the machine restarted: the CLI is gone")
        XCTAssertNil(continuable(stopped + [restarted]))
        XCTAssertNil(continuable(stopped + [note("ended-note-1", text: "Stopped with its children")]))
    }

    func testAMessageAfterTheStopOrALaterTurnLeavesNothingToContinue() {
        XCTAssertNil(continuable(stopped + [user("user-2", turn: "turn-2", at: 30)]))
        XCTAssertNil(continuable([]))
        XCTAssertNil(continuable(stopped + [turn("turn-2", endedAt: 50, createdAt: 40)]))
    }
}
