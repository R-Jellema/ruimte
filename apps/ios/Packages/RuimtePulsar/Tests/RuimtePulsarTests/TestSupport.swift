import Foundation
import Testing

@testable import RuimtePulsar

/// `Fixtures/wire.json`, which `packages/contracts` writes from the TypeScript side.
func wireFixture() throws -> JSONValue {
    try JSONValue.decode(Data(contentsOf: #require(Bundle.module.url(forResource: "wire", withExtension: "json"))))
}

final class MemorySessionStore: SessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: StoredSession?

    func read() -> StoredSession? { lock.withLock { session } }
    func write(_ session: StoredSession?) { lock.withLock { self.session = session } }
}

/// An HTTP answer to `request`, as a fake `fetch` hands it back.
func answer(_ request: URLRequest, status: Int = 200, body: Data = Data()) -> (Data, HTTPURLResponse) {
    (body, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
}

func answer(_ request: URLRequest, status: Int = 200, body: String) -> (Data, HTTPURLResponse) {
    answer(request, status: status, body: Data(body.utf8))
}

/// A new folder under the temporary directory; the caller removes it.
func temporaryFolder() throws -> URL {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
}
