import Foundation

public struct StoredSession: Codable, Sendable {
    public let refreshToken: String
    public let expiresAt: Int64
    public let account: Account

    public init(refreshToken: String, expiresAt: Int64, account: Account) {
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.account = account
    }
}

public protocol SessionStore: Sendable {
    func read() throws -> StoredSession?
    func write(_ session: StoredSession?) throws
}

public struct SessionView: Sendable {
    public let accessToken: String
    public let accessExpiresAt: Int64
    public let expiresAt: Int64
    public let account: Account
}

public struct RestoredSession: Sendable {
    public let account: Account
    public let expiresAt: Int64
}

public actor SessionVault {
    private let client: any SessionAPI
    private let store: any SessionStore
    private let signer: @Sendable () async throws -> any SessionSigner?
    private let now: @Sendable () -> Int64
    private var current: SessionView?
    private var currentRevision: Int?
    private var refreshing: Task<SessionView?, Error>?
    private var revision = 0

    public init(
        client: any SessionAPI, store: any SessionStore,
        signer: @escaping @Sendable () async throws -> any SessionSigner?,
        now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.client = client
        self.store = store
        self.signer = signer
        self.now = now
    }

    public func exchange(_ login: SessionLoginCode) async throws -> SessionView {
        try Task.checkCancellation()
        revision += 1
        let operation = revision
        refreshing?.cancel()
        refreshing = nil
        guard let key = try await signer() else {
            throw AddressBookRequestError(
                code: "unauthorized", status: 0,
                message: String(localized: "This device cannot sign in yet. Try again.", bundle: .module))
        }
        try Task.checkCancellation()
        try ensureCurrent(operation)
        let signature = try key.sign(SigningBytes.sessionKey(code: login.code, publicKey: key.publicKey))
        let result = try await client.exchange(
            SessionExchangePayload(
                code: login.code, codeVerifier: login.codeVerifier, redirectUri: login.redirectUri,
                label: login.label, sessionKey: key.publicKey, sessionKeySignature: signature
            ))
        try Task.checkCancellation()
        try ensureCurrent(operation)
        return try keep(result)
    }

    public func restore() throws -> RestoredSession? {
        guard let stored = try store.read() else {
            return nil
        }
        guard stored.expiresAt > now() else {
            try store.write(nil)
            return nil
        }
        return RestoredSession(account: stored.account, expiresAt: stored.expiresAt)
    }

    public func accessToken() async throws -> String? {
        if let current, current.accessExpiresAt > now() + 30_000 {
            return current.accessToken
        }
        return try await refresh()?.accessToken
    }

    public func refresh() async throws -> SessionView? {
        try await refreshOperation().value
    }

    func refreshOperation() -> Task<SessionView?, Error> {
        if let refreshing {
            return refreshing
        }
        let operation = revision
        let task = Task {
            defer {
                if operation == revision {
                    refreshing = nil
                }
            }
            return try await rotate(operation: operation)
        }
        refreshing = task
        return task
    }

    public func signOut() async throws {
        let token: String?
        if let current {
            token = current.accessToken
        } else {
            token = try? await refresh()?.accessToken
        }
        revision += 1
        dropCurrent()
        try store.write(nil)
        if let token {
            try? await client.endSession(accessToken: token)
        }
    }

    public func discard(accessToken: String) async {
        // A canceled login must never erase a newer login that finished during cleanup.
        if current?.accessToken == accessToken {
            if currentRevision == revision { revision += 1 }
            dropCurrent()
            try? store.write(nil)
        }
        try? await client.endSession(accessToken: accessToken)
    }

    private func dropCurrent() {
        refreshing?.cancel()
        refreshing = nil
        current = nil
        currentRevision = nil
    }

    /// A late answer must not restore a session after a sign-out or another login.
    private func ensureCurrent(_ operation: Int) throws {
        guard operation == revision else { throw CancellationError() }
    }

    private func rotate(operation: Int) async throws -> SessionView? {
        let stored = try store.read()
        let key = if let stored, stored.expiresAt > now() { try await signer() } else { nil as any SessionSigner? }
        try ensureCurrent(operation)
        guard let stored, let key else {
            current = nil
            if stored != nil {
                try store.write(nil)
            }
            return nil
        }
        let issuedAt = now()
        let signature = try key.sign(SigningBytes.sessionRefresh(token: stored.refreshToken, issuedAt: issuedAt))
        let result: SessionResult
        do {
            result = try await client.refresh(
                SessionRefreshPayload(refreshToken: stored.refreshToken, issuedAt: issuedAt, signature: signature))
        } catch let error as AddressBookRequestError
            where ["unauthorized", "bad-request", "bad-signature"].contains(error.code)
        {
            try ensureCurrent(operation)
            current = nil
            try store.write(nil)
            return nil
        }
        try Task.checkCancellation()
        try ensureCurrent(operation)
        return try keep(result)
    }

    private func keep(_ result: SessionResult) throws -> SessionView {
        try store.write(
            StoredSession(refreshToken: result.refreshToken, expiresAt: result.expiresAt, account: result.account))
        let view = SessionView(
            accessToken: result.accessToken, accessExpiresAt: result.accessExpiresAt, expiresAt: result.expiresAt,
            account: result.account)
        current = view
        currentRevision = revision
        return view
    }
}
