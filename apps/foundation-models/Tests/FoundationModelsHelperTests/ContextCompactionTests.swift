import FoundationModels
import Testing
@testable import FoundationModelsHelper

private func exchange(_ name: String) -> [Transcript.Entry] {
    [.prompt(.init(id: "prompt-\(name)", segments: [.text(.init(content: name))])),
     .response(.init(id: "response-\(name)", assetIDs: [], segments: [.text(.init(content: "Answer \(name)"))]))]
}

@Test func summaryKeepsRecentExchangesAndDoesNotMutateOriginalHistory() throws {
    let original = exchange("old") + exchange("middle") + exchange("recent")
    let plan = try #require(try ContextCompaction(original))
    #expect(plan.removed == Array(original.prefix(2)))
    let source = try plan.summarySource()
    #expect(source.contains("old"))
    #expect(!source.contains("middle"))
    #expect(!source.contains("prompt-old"))
    let result = Array(try plan.applying(summary: "A fallible summary."))
    #expect(Array(result.suffix(4)) == Array(original.suffix(4)))
    #expect(throws: (any Error).self) { try plan.applying(summary: "  ") }
}

@Test func summaryInputRetainsStructuredAnswersAndToolResultsWithoutRepeatedResponseSchemas() throws {
    let call = Transcript.ToolCall(id: "read", toolName: "Read", arguments: GeneratedContent(properties: ["path": "README.md"]))
    let old: [Transcript.Entry] = [
        .prompt(.init(segments: [.text(.init(content: "Read the file."))], responseFormat: .init(type: AssistantReply.self))),
        .toolCalls(.init([call])),
        .toolOutput(.init(id: "read", toolName: "Read", segments: [.text(.init(content: "launch_day = Thursday"))])),
        .response(.init(assetIDs: [], segments: [.structure(.init(source: "AssistantReply", content: GeneratedContent(properties: ["message": "Launch is Thursday.", "needsUserInput": false])))]))
    ]
    let plan = try #require(try ContextCompaction(old + exchange("middle") + exchange("recent")))
    let source = try plan.summarySource()
    #expect(source.contains("launch_day = Thursday"))
    #expect(source.contains("Launch is Thursday."))
    #expect(source.contains("README.md"))
    #expect(!source.contains("responseFormat"))
    #expect(!source.contains("generationSchema"))
}

@Test func compactionRejectsAnOrphanOrIncompleteToolExchange() throws {
    let output = Transcript.Entry.toolOutput(.init(id: "call", toolName: "Read", segments: []))
    #expect(throws: (any Error).self) { try ContextCompaction.validate([output]) }
    let call = Transcript.ToolCall(id: "call", toolName: "Read", arguments: GeneratedContent(properties: ["path": "README.md"]))
    let start = exchange("old")[0]
    let end = exchange("old")[1]
    #expect(throws: (any Error).self) { try ContextCompaction.validate([start, .toolCalls(.init([call])), end]) }
    try ContextCompaction.validate([start, .toolCalls(.init([call])), output, end])
    #expect(throws: (any Error).self) {
        try ContextCompaction.validate([start, .toolCalls(.init([call, call])), output, end])
    }
}

#if compiler(>=6.4)
@available(macOS 27, *)
@Test func reasoningPreservesExchangeValidation() throws {
    let reasoning = Transcript.Entry.reasoning(.init(segments: [.text(.init(content: "Consider the answer."))]))
    let conversation = exchange("question")
    try ContextCompaction.validate([conversation[0], reasoning, conversation[1]])
    #expect(throws: (any Error).self) { try ContextCompaction.validate([conversation[0], reasoning]) }

    let call = Transcript.ToolCall(id: "read", toolName: "Read", arguments: GeneratedContent(properties: ["path": "README.md"]))
    #expect(throws: (any Error).self) {
        try ContextCompaction.validate([conversation[0], .toolCalls(.init([call])), reasoning, conversation[1]])
    }
}
#endif

@Test func manifestOrderDoesNotChangeCompatibilityButDefinitionsDo() throws {
    let bridge = ToolBridge(send: { _ in })
    let read = ReadFile(bridge: bridge)
    let list = ListFiles(bridge: bridge)
    let fingerprint = try ToolManifest.fingerprint([read, list])
    #expect(try fingerprint == ToolManifest.fingerprint([list, read]))
    #expect(try fingerprint != ToolManifest.fingerprint([read]))
    let definition = ManifestDefinition(
        name: read.name, description: read.description, parameters: read.parameters,
        includesSchemaInInstructions: read.includesSchemaInInstructions)
    #expect(try fingerprint == ToolManifest.fingerprint([definition, list]))
    var changed = definition
    changed.name = "OtherRead"
    #expect(try fingerprint != ToolManifest.fingerprint([changed, list]))
    changed = definition
    changed.description += " Changed instructions."
    #expect(try fingerprint != ToolManifest.fingerprint([changed, list]))
    changed = definition
    changed.parameters = list.parameters
    #expect(try fingerprint != ToolManifest.fingerprint([changed, list]))
    changed = definition
    changed.includesSchemaInInstructions.toggle()
    #expect(try fingerprint != ToolManifest.fingerprint([changed, list]))
    #expect(throws: (any Error).self) { try ToolManifest.fingerprint([read, read]) }
}

private struct ManifestDefinition: Tool {
    typealias Arguments = ReadFile.Arguments
    var name: String
    var description: String
    var parameters: GenerationSchema
    var includesSchemaInInstructions: Bool

    func call(arguments: Arguments) async throws -> String {
        fatalError("Manifest compatibility never invokes a tool")
    }
}
