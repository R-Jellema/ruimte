import Foundation
import RuimtePulsar

public struct PairingIdentity: Hashable, Sendable {
    public let machineID: String
    public let machineKey: String
    public let clientKey: String

    public init(machineID: String, machineKey: String, clientKey: String) {
        self.machineID = machineID
        self.machineKey = machineKey
        self.clientKey = clientKey
    }
}

@MainActor public protocol StatementPairingStore {
    func contains(_ identity: PairingIdentity) -> Bool
    func insert(_ identity: PairingIdentity)
    func remove(machineID: String)
}

@MainActor public struct UserDefaultsPairingStore: StatementPairingStore {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func contains(_ identity: PairingIdentity) -> Bool {
        defaults.bool(forKey: storageKey(identity))
    }

    public func insert(_ identity: PairingIdentity) {
        remove(machineID: identity.machineID)
        defaults.set(true, forKey: storageKey(identity))
    }

    public func remove(machineID: String) {
        let suffix = "." + Base64URL.encode(Data(machineID.utf8))
        for key in defaults.dictionaryRepresentation().keys
        where key.hasPrefix("ruimte.statement-pairing.v1.") && key.hasSuffix(suffix) {
            defaults.removeObject(forKey: key)
        }
    }

    private func storageKey(_ identity: PairingIdentity) -> String {
        let machineID = Base64URL.encode(Data(identity.machineID.utf8))
        return "ruimte.statement-pairing.v1.\(identity.machineKey).\(identity.clientKey).\(machineID)"
    }
}

@MainActor public final class StatementPairings {
    public typealias Access = () async throws -> JSONValue
    private let store: any StatementPairingStore
    private var generations: [String: Int] = [:]

    public init(store: any StatementPairingStore? = nil) {
        self.store = store ?? UserDefaultsPairingStore()
    }

    public func forget(machineID: String) {
        generations[machineID, default: 0] += 1
        store.remove(machineID: machineID)
    }

    public func open(
        identity: PairingIdentity, requestAccess: @escaping Access, events: LinkEvents,
        makeLink: (Access?, LinkEvents) throws -> any MachineLink
    ) rethrows -> any MachineLink {
        let generation = generations[identity.machineID, default: 0]
        let access: Access? = store.contains(identity) ? nil : requestAccess
        var authenticatedEvents = events
        var ended = false
        authenticatedEvents.accepted = { [self, store] in
            guard !ended, generations[identity.machineID, default: 0] == generation else { return }
            // The machine verified the statement before it accepted, so a refusal after this, such as an older
            // machine at the protocol check, must not ask the address book for access again.
            store.insert(identity)
            events.accepted()
        }
        authenticatedEvents.opened = { [self] in
            guard !ended, generations[identity.machineID, default: 0] == generation else { return }
            events.opened()
        }
        authenticatedEvents.closed = { error in
            ended = true
            events.closed(error)
        }
        return try makeLink(access, authenticatedEvents)
    }
}
