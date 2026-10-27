import Foundation
import FoundationModels
@testable import FoundationModelsHelper

/// A fresh folder for a `--home`; the caller removes it.
func temporaryHome() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("ruimte-fm-store-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
    return url
}

/// Writes a version 1 checkpoint, which has no original history and no tool fingerprint.
@discardableResult
func writeLegacyCheckpoint(_ transcript: Transcript, for store: SessionStore) throws -> URL {
    struct Legacy: Encodable {
        let version = 1
        let id: String
        let transcript: Transcript
    }
    let file = store.folder.appendingPathComponent("\(store.id).json")
    try JSONEncoder().encode(Legacy(id: store.id, transcript: transcript)).write(to: file)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    return file
}

extension Request {
    init(type: String, id: String?, prompt: String? = nil, output: String? = nil, outcome: ToolOutcome? = nil) {
        self.init(type: type, id: id, prompt: prompt, output: output, outcome: outcome, instructions: nil, maxTokens: nil, temperature: nil)
    }
}
