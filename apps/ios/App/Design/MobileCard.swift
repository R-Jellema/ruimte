import RuimtePulsar
import SwiftUI

/// The one card of the app: the card ground with a radius of 20, without an edge. Rows inside one pass `padding: 0`
/// and pad themselves.
struct MobileCardSurface: ViewModifier {
    var padding: CGFloat = MobileSpacing.cardPadding

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(MobileStyle.card, in: .rect(cornerRadius: MobileMetrics.cardRadius))
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

/// The rows of one group in one card. The row height keeps them apart, so no line runs between two.
struct MobileRowGroup<Item: Identifiable, Row: View>: View {
    let items: [Item]
    @ViewBuilder var row: (Item) -> Row

    var body: some View {
        VStack(spacing: 0) {
            ForEach(items) { item in
                row(item)
            }
        }
        .mobileCard(padding: 0)
    }
}

/// A row of a card: the status glyph on the title's line, a title with a muted second line, and a trailing value or
/// control. At least 52 pt high, and taller once Dynamic Type asks for it.
struct MobileStatusRow<Trailing: View>: View {
    let tone: MobileTone
    var symbol: String?
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing
    @ScaledMetric(relativeTo: .subheadline) private var height = MobileMetrics.rowHeight

    var body: some View {
        HStack(spacing: MobileSpacing.medium) {
            HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.medium) {
                MobileStatusGlyph(tone: tone, symbol: symbol).centeredOnFirstLine(of: .subheadline)
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: title).font(.subheadline).foregroundStyle(MobileStyle.text)
                        .lineLimit(1).truncationMode(.tail)
                    if let subtitle, !subtitle.isEmpty {
                        Text(verbatim: subtitle).font(.caption).foregroundStyle(MobileStyle.muted)
                            .lineLimit(1).truncationMode(.tail)
                    }
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

/// The glyph, title and second line of a `MobileStatusRow` for a row in a list that pads and sizes its rows itself.
/// The glyph is the subject's and says no state, so it stays out of what VoiceOver reads.
struct MobileGlyphLabel: View {
    var tone = MobileTone.idle
    let title: String
    let subtitle: String
    let symbol: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.medium) {
            MobileStatusGlyph(tone: tone, symbol: symbol).centeredOnFirstLine(of: .subheadline)
                .accessibilityHidden(true)
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
