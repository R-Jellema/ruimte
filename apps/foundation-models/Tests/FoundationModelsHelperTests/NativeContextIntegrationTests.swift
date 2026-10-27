import Foundation
import FoundationModels
import Testing
@testable import FoundationModelsHelper

private let nativeEnabled = ProcessInfo.processInfo.environment["RUIMTE_TEST_NATIVE_APPLE"] == "1"

/// A runner restored from `original` as a version 1 checkpoint, past its session frame.
private func restoredRunner(_ store: SessionStore, original: Transcript) async throws -> (Runner, Output, AsyncStream<Frame>.Iterator) {
    try writeLegacyCheckpoint(original, for: store)
    let frames = AsyncStream<Frame>.makeStream()
    let output = Output(receive: { frames.continuation.yield($0) })
    let runner = Runner(store: store, output: output)
    try await runner.restore(required: true)
    var iterator = frames.stream.makeAsyncIterator()
    _ = await iterator.next()
    return (runner, output, iterator)
}

/// Compacts and answers whether it did; a failed compaction fails the test with its message.
private func compact(_ runner: Runner, frames: inout AsyncStream<Frame>.Iterator) async throws -> Bool {
    await runner.handle(Request(type: "compact", id: "compact"))
    while let frame = await frames.next() {
        if frame.type == "compacted" { return true }
        if frame.type == "done" { throw SessionStoreError(description: frame.text ?? "Compaction failed") }
    }
    return false
}

@Test(.enabled(if: nativeEnabled), .timeLimit(.minutes(1)))
func nativeSummaryPreservesSavedHistoryAndRestoresConversation() async throws {
    let home = try temporaryHome()
    defer { try? FileManager.default.removeItem(at: home) }
    let store = try SessionStore(id: UUID().uuidString.lowercased(), home: home.path)
    let facts = ["The project color is violet.", "The launch day is Thursday.", "The project is called Lantern.", "The budget has not been confirmed."]
    let original = Transcript(entries: facts.flatMap { fact -> [Transcript.Entry] in
        [.prompt(.init(segments: [.text(.init(content: fact))])),
         .response(.init(assetIDs: [], segments: [.text(.init(content: "I will remember that."))]))]
    })
    let (runner, output, frames) = try await restoredRunner(store, original: original)
    var iterator = frames
    #expect(try await compact(runner, frames: &iterator))
    struct Evidence: Decodable { let version: Int; let history: Transcript; let transcript: Transcript; let toolsetFingerprint: String }
    let saved = try JSONDecoder().decode(Evidence.self, from: Data(contentsOf: store.folder.appendingPathComponent("\(store.id).json")))
    #expect(saved.version == 2)
    #expect(saved.history == original)
    #expect(ContextHistory.turnCount(Array(saved.transcript)) == 3)
    #expect(!saved.toolsetFingerprint.isEmpty)
    let summary = Array(saved.transcript).compactMap { entry -> String? in
        guard case .response(let response) = entry else { return nil }
        return response.segments.compactMap { segment -> String? in
            guard case .text(let text) = segment else { return nil }
            return text.content
        }.joined(separator: "\n")
    }.first ?? ""
    #expect(summary.lowercased().contains("violet"))
    #expect(summary.lowercased().contains("thursday"))
    print("Native summary: \(summary)")
    try ContextCompaction.validate(Array(saved.transcript))
    let restarted = Runner(store: store, output: output)
    try await restarted.restore(required: true)
    _ = await iterator.next()
    await restarted.handle(Request(type: "turn", id: "recall", prompt: "What project color and launch day did we agree? Reply briefly from memory. Do not use tools."))
    var text = ""
    var metrics: Frame?
    while let frame = await iterator.next() {
        if frame.type == "text.snapshot" { text = frame.text ?? "" }
        if frame.type == "metrics" { metrics = frame }
        if frame.type == "tool.call" {
            print("Unexpected recall tool: \(frame.name ?? "unknown")")
            await restarted.handle(Request(type: "tool.result", id: frame.id, output: "This memory check needs no tools.", outcome: .denied))
        }
        if frame.type == "done" {
            #expect(frame.state == "done")
            break
        }
    }
    #expect(text.lowercased().contains("violet"))
    #expect(text.lowercased().contains("thursday"))
    #expect((metrics?.schemaTokens ?? 0) > 0)
    #expect((metrics?.contextTokens ?? 0) > 0)
    #expect(metrics?.toolCalls == 0)
    print("Native recall output: \(text)")
}

@Test(.enabled(if: nativeEnabled), .timeLimit(.minutes(1)))
func nativeCompactionHandlesSchemaHeavyHistory() async throws {
    let home = try temporaryHome()
    defer { try? FileManager.default.removeItem(at: home) }
    let store = try SessionStore(id: UUID().uuidString.lowercased(), home: home.path)
    let facts = ["The project color is violet. The launch day is Thursday."] + (1...23).map { "Status update \($0): there are no new decisions." }
    let original = Transcript(entries: facts.flatMap { fact -> [Transcript.Entry] in
        [.prompt(.init(segments: [.text(.init(content: fact))], responseFormat: .init(type: AssistantReply.self))),
         .response(.init(assetIDs: [], segments: [.text(.init(content: "Acknowledged."))]))]
    })
    let plan = try #require(try ContextCompaction(Array(original)))
    let oldSource = String(decoding: try JSONEncoder().encode(Transcript(entries: plan.removed)), as: UTF8.self)
    let oldTokens = try await SystemLanguageModel.default.tokenCount(for: oldSource)
    let newTokens = try await SystemLanguageModel.default.tokenCount(for: plan.summarySource())
    #expect(oldTokens + 768 > SystemLanguageModel.default.contextSize)
    #expect(newTokens + 768 < SystemLanguageModel.default.contextSize)
    let (runner, _, frames) = try await restoredRunner(store, original: original)
    var iterator = frames
    #expect(try await compact(runner, frames: &iterator))
    struct Evidence: Decodable { let history: Transcript; let transcript: Transcript }
    let saved = try JSONDecoder().decode(Evidence.self, from: Data(contentsOf: store.folder.appendingPathComponent("\(store.id).json")))
    #expect(saved.history == original)
    #expect(ContextHistory.turnCount(Array(saved.transcript)) == 3)
    try ContextCompaction.validate(Array(saved.transcript))
    print("Compaction source: \(oldTokens) serialized tokens -> \(newTokens) content tokens; original history preserved.")
}
