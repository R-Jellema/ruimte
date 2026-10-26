import RuimtePulsar
import SwiftUI

/// The one card of the app: a panel with a radius of 20 and a hairline. Rows inside one pass `padding: 0` and pad
/// themselves, so their dividers run to the card's edge.
struct MobileCardSurface: ViewModifier {
    var padding: CGFloat = MobileSpacing.cardPadding

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(MobileStyle.panel, in: .rect(cornerRadius: MobileMetrics.cardRadius))
            .overlay(RoundedRectangle(cornerRadius: MobileMetrics.cardRadius).strokeBorder(MobileStyle.hairline))
    }
}

extension View {
    func mobileCard(padding: CGFloat = MobileSpacing.cardPadding) -> some View {
        modifier(MobileCardSurface(padding: padding))
    }
}

/// Stacked content in a card, with the design's gap between its parts.
struct MobileCard<Content: View>: View {
    var spacing: CGFloat = MobileSpacing.medium
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }.mobileCard()
    }
}

/// The line between two rows of a card, starting where the row's text does.
struct MobileRowDivider: View {
    @Environment(\.displayScale) private var displayScale
    @ScaledMetric(relativeTo: .subheadline) private var tile = MobileMetrics.statusTile

    var body: some View {
        MobileStyle.hairline.frame(height: 1 / displayScale)
            .padding(.leading, MobileSpacing.cardPadding + tile + MobileSpacing.medium)
            .accessibilityHidden(true)
    }
}

/// A row of a card: the status tile, a title with a muted second line, and a trailing value or control. At least 52 pt
/// high, and taller once Dynamic Type asks for it.
struct MobileStatusRow<Trailing: View>: View {
    let tone: MobileTone
    var symbol: String?
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing
    @ScaledMetric(relativeTo: .subheadline) private var height = MobileMetrics.rowHeight

    var body: some View {
        HStack(spacing: MobileSpacing.medium) {
            MobileStatusTile(tone: tone, symbol: symbol)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: title).font(.subheadline).foregroundStyle(MobileStyle.text)
                    .lineLimit(1).truncationMode(.tail)
                if let subtitle, !subtitle.isEmpty {
                    Text(verbatim: subtitle).font(.caption).foregroundStyle(MobileStyle.muted)
                        .lineLimit(1).truncationMode(.tail)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
        .padding(.horizontal, MobileSpacing.cardPadding)
        .padding(.vertical, MobileSpacing.small)
        .frame(maxWidth: .infinity, minHeight: height, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

extension MobileStatusRow where Trailing == MobileRowValue {
    /// A row whose trailing part is a value such as a time or a duration, in tabular digits.
    init(tone: MobileTone, symbol: String? = nil, title: String, subtitle: String? = nil, value: String) {
        self.init(tone: tone, symbol: symbol, title: title, subtitle: subtitle) { MobileRowValue(text: value) }
    }
}

extension MobileStatusRow where Trailing == EmptyView {
    init(tone: MobileTone, symbol: String? = nil, title: String, subtitle: String? = nil) {
        self.init(tone: tone, symbol: symbol, title: title, subtitle: subtitle) { EmptyView() }
    }
}

/// The tile, title and second line of a `MobileStatusRow` for a row in a list that pads and sizes its rows itself. The
/// tile is the subject's and says no state, so it stays out of what VoiceOver reads.
struct MobileTileLabel: View {
    var tone = MobileTone.idle
    let title: String
    let subtitle: String
    let symbol: String

    var body: some View {
        HStack(spacing: MobileSpacing.medium) {
            MobileStatusTile(tone: tone, symbol: symbol).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: title).font(.subheadline).foregroundStyle(MobileStyle.text)
                    .lineLimit(1).truncationMode(.tail)
                if !subtitle.isEmpty {
                    Text(verbatim: subtitle).font(.caption).foregroundStyle(MobileStyle.muted)
                        .lineLimit(1).truncationMode(.middle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The trailing value of a row: muted, small, and in digits that keep their width while they count.
struct MobileRowValue: View {
    let text: String

    var body: some View {
        Text(verbatim: text).font(.caption).monospacedDigit().foregroundStyle(MobileStyle.muted).lineLimit(1)
    }
}

/// The title of a group with how many it holds, as in "Needs you 2".
struct MobileSectionHeader: View {
    let title: String
    var count: Int?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.small) {
            Text(verbatim: title).font(.subheadline.weight(.semibold)).foregroundStyle(MobileStyle.text)
            if let count {
                Text(verbatim: Format.number(Double(count))).font(.subheadline).monospacedDigit().foregroundStyle(
                    MobileStyle.muted)
            }
            Spacer(minLength: 0)
        }
        .textCase(nil)
        .padding(.horizontal, MobileSpacing.xSmall)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
