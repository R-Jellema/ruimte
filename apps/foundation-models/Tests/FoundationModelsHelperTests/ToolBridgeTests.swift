import Testing
@testable import FoundationModelsHelper

/// A bridge whose turn has begun, and the frames it sends.
private struct BridgeHarness {
    let bridge: ToolBridge
    private var frames: AsyncStream<Frame>.Iterator

    init(turnID: String = "turn") async {
        let stream = AsyncStream<Frame>.makeStream()
        bridge = ToolBridge(send: { stream.continuation.yield($0) })
        frames = stream.stream.makeAsyncIterator()
        await bridge.begin(turnID: turnID)
    }

    /// Starts a tool call and returns it with the frame the bridge sent for it.
    mutating func call(_ name: String, path: String? = nil) async throws -> (Task<String, any Error>, Frame) {
        let bridge = bridge
        let call = Task { try await bridge.call(Frame(type: "tool.call", name: name, path: path)) }
        return (call, try #require(await frames.next()))
    }
}

@Test func deniedToolTerminatesAllPendingCallsAndCannotBecomeSuccessfulText() async throws {
    var harness = await BridgeHarness()
    let (first, firstFrame) = try await harness.call("read_file")
    let (second, _) = try await harness.call("ask_user")
    await harness.bridge.reply(id: firstFrame.id!, text: "No", outcome: .denied)
    await #expect(throws: ToolBridgeError.denied("No")) { try await first.value }
    await #expect(throws: ToolBridgeError.denied("No")) { try await second.value }
    await #expect(throws: ToolBridgeError.denied("No")) {
        try await harness.bridge.call(Frame(type: "tool.call", name: "write_file"))
    }
    #expect(await harness.bridge.calls == 2)
}

@Test func toolBudgetStopsBeforeThirteenthRequest() async throws {
    var harness = await BridgeHarness()
    for _ in 0..<12 {
        let (call, frame) = try await harness.call("read_file")
        await harness.bridge.reply(id: frame.id!, text: "Read", outcome: .success)
        #expect(try await call.value == "Read")
    }
    await #expect(throws: ToolBridgeError.callLimit) {
        try await harness.bridge.call(Frame(type: "tool.call", name: "read_file"))
    }
    #expect(await harness.bridge.calls == 12)
}

@Test func questionBudgetIncludesNativeAndStructuredQuestions() async throws {
    var harness = await BridgeHarness()
    for _ in 0..<3 {
        let (call, frame) = try await harness.call("ask_user")
        await harness.bridge.reply(id: frame.id!, text: "Answer", outcome: .success)
        _ = try await call.value
    }
    await #expect(throws: ToolBridgeError.questionLimit) {
        try await harness.bridge.call(Frame(type: "tool.call", name: "ask_user"))
    }
}

@Test func cancellationAndLateRepliesCannotChangeTheNextTurn() async throws {
    var harness = await BridgeHarness(turnID: "old")
    let (old, oldFrame) = try await harness.call("read_file")
    old.cancel()
    await #expect(throws: CancellationError.self) { try await old.value }
    await harness.bridge.begin(turnID: "new")
    let (current, currentFrame) = try await harness.call("read_file")
    await harness.bridge.reply(id: oldFrame.id!, text: "Late denial", outcome: .denied)
    await harness.bridge.cancel(turnID: "old")
    await harness.bridge.reply(id: currentFrame.id!, text: "Current result", outcome: .success)
    #expect(try await current.value == "Current result")
    #expect(await harness.bridge.failure == nil)
}

@Test func failedToolIsNotReturnedAsSuccessfulModelContext() async throws {
    var harness = await BridgeHarness()
    let (call, frame) = try await harness.call("edit_file")
    await harness.bridge.reply(id: frame.id!, text: "No unique match", outcome: .error)
    await #expect(throws: ToolBridgeError.failed("No unique match")) { try await call.value }
}

@Test func rejectedEditsAllowTwoCorrectionsWithoutHidingPriorEffects() async throws {
    var harness = await BridgeHarness()
    for attempt in 1...3 {
        let (call, frame) = try await harness.call("edit_file")
        await harness.bridge.reply(id: frame.id!, text: "No file was changed.", outcome: .recoverableError)
        if attempt < 3 {
            #expect(try await call.value == "TOOL ERROR. No file was changed.")
            #expect(await harness.bridge.failure == nil)
        } else {
            await #expect(throws: ToolBridgeError.correctionLimit) { try await call.value }
        }
        #expect(await harness.bridge.hasPossibleEffects == (attempt == 3))
        if attempt == 2 {
            let (write, written) = try await harness.call("write_file")
            await harness.bridge.reply(id: written.id!, text: "Created", outcome: .success)
            _ = try await write.value
            #expect(await harness.bridge.hasPossibleEffects)
        }
    }
}

@Test func onlySuccessfulEditOfTheSameFileResolvesARejectedEdit() async throws {
    var harness = await BridgeHarness()
    for (name, path, outcome) in [
        ("edit_file", "planning.md", ToolOutcome.recoverableError),
        ("read_file", "planning.md", .success),
        ("edit_file", "other.md", .success),
        ("edit_file", "planning.md", .success)
    ] {
        let (call, frame) = try await harness.call(name, path: path)
        await harness.bridge.reply(id: frame.id!, text: "result", outcome: outcome)
        _ = try await call.value
        #expect(await harness.bridge.unresolvedEdits.isEmpty == (name == "edit_file" && path == "planning.md" && outcome == .success))
    }
    await harness.bridge.begin(turnID: "next")
    #expect(await harness.bridge.unresolvedEdits.isEmpty)
}
