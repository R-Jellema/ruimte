import SwiftUI

/// The state a card or row stands in. The color lives in its tile and nowhere else on the row.
enum MobileTone: CaseIterable {
    case waiting
    case working
    case done
    case error
    case idle
    case voice

    var color: Color {
        switch self {
        case .waiting: MobileStyle.statusNeedsYou
        case .working, .voice: MobileStyle.statusRunning
        case .done: MobileStyle.statusIdle
        case .error: MobileStyle.statusError
        case .idle: MobileStyle.muted
        }
    }

    var tint: Color {
        switch self {
        case .idle: MobileStyle.subtleFill
        default: color.opacity(0.14)
        }
    }

    /// The glyph of a tile that has no subject of its own to show.
    var symbol: String {
        switch self {
        case .waiting: "hand"
        case .working: "loader-circle"
        case .done: "circle-check"
        case .error: "circle-x"
        case .idle: "circle"
        case .voice: "mic"
        }
    }

    var label: String {
        switch self {
        case .waiting: String(localized: "Waiting")
        case .working: String(localized: "Working")
        case .done: String(localized: "Done")
        case .error: String(localized: "Error")
        case .idle: String(localized: "Idle")
        case .voice: String(localized: "Voice")
        }
    }
}

/// A 28 pt rounded tile: the subject's glyph in the color of its state, over a tint of that color. Its label is the
/// state, for a row that reads it out beside its title.
struct MobileStatusTile: View {
    let tone: MobileTone
    var symbol: String?
    @ScaledMetric(relativeTo: .subheadline) private var size = MobileMetrics.statusTile
    @ScaledMetric(relativeTo: .subheadline) private var glyph = MobileMetrics.statusGlyph

    var body: some View {
        LucideIcon(name: symbol ?? tone.symbol, size: glyph)
            .foregroundStyle(tone.color)
            .frame(width: size, height: size)
            .background(tone.tint, in: RoundedRectangle(cornerRadius: MobileMetrics.tileRadius))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(tone.label)
    }
}
