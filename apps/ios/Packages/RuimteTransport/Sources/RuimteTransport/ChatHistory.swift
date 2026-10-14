import Foundation
import RuimtePulsar

public struct ChatHistory {
    public private(set) var cursor: String?
    public private(set) var start = 0
    public private(set) var pending: [String: ChatItem] = [:]

    public init() {}

    /// A page from a machine before paging is the whole thread, so it has no history and nothing outside it.
    public mutating func replace(history page: ChatHistoryPage?, pending requests: [ChatItem]) {
        start = Int(page?.start ?? 0)
        cursor = page?.cursor
        pending = Dictionary(requests.map { ($0.id, $0) }, uniquingKeysWith: { _, newest in newest })
    }

    public mutating func includes(_ item: ChatItem, index: Int64?) -> Bool {
        if item.isPending { pending[item.id] = item } else { pending.removeValue(forKey: item.id) }
        return Int(index ?? Int64(start)) >= start
    }

    public mutating func prepend(_ page: ChatHistoryResult, to items: [ChatItem]) -> [ChatItem] {
        let ids = Set(items.map(\.id))
        start = Int(page.history.start)
        cursor = page.history.cursor
        return page.items.filter { !ids.contains($0.id) } + items
    }
}
