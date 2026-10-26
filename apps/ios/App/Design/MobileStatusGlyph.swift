import SwiftUI

/// The state a card or row stands in. The color lives in its glyph and nowhere else on the row.
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

    /// The glyph of a row that has no subject of its own to show. Working draws the spinner instead.
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

/// The subject's glyph in the color of its state, bare, in a column of one width so the titles of a list line up.
/// Working leaps as the spinner whatever the subject. Its label is the state, for a row that reads it out beside its
/// title. In an `HStack` on `.firstTextBaseline`, add `centeredOnFirstLine(of:)` so it sits on the first line.
struct MobileStatusGlyph: View {
    let tone: MobileTone
    var symbol: String?
    @ScaledMetric(relativeTo: .subheadline) private var column = MobileMetrics.statusColumn
    @ScaledMetric(relativeTo: .subheadline) private var glyph = MobileMetrics.statusGlyph

    var body: some View {
        Group {
            if tone == .working {
                Spinner(size: glyph.rounded())
            } else {
                LucideIcon(name: symbol ?? tone.symbol, size: glyph)
            }
        }
        .foregroundStyle(tone.color)
        .frame(width: column)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(tone.label)
    }
}
