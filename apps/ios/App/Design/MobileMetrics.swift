import SwiftUI

/// The rhythm every page is spaced in: steps of 4, 8, 12, 16 and 24 points.
enum MobileSpacing {
    static let xSmall: CGFloat = 4
    static let small: CGFloat = 8
    static let medium: CGFloat = 12
    static let large: CGFloat = 16
    static let xLarge: CGFloat = 24
    /// The edge of a page to its cards and rows, the same on every page.
    static let margin: CGFloat = 16
    static let cardPadding: CGFloat = 16
}

/// The fixed sizes of the design. A shape is a tile, a card or a capsule; nothing else takes a radius of its own.
enum MobileMetrics {
    /// A status tile, a code block or a field inside a card.
    static let tileRadius: CGFloat = 10
    static let cardRadius: CGFloat = 20
    static let rowHeight: CGFloat = 52
    static let statusTile: CGFloat = 28
    static let statusGlyph: CGFloat = 15
}
