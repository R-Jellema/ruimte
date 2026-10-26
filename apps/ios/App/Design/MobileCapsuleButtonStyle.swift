import SwiftUI

/// A capsule of the design, in two weights and two sizes. Prominent is the one action a card leads with (Allow, a
/// chosen answer): the text color with the ground on it. Quiet is a soft fill for the rest. Small sits inside a row
/// (Resume, Reconnect, Install).
struct MobileCapsuleButtonStyle: ButtonStyle {
    enum Size {
        case regular
        case small
    }

    var prominent = false
    var size = Size.regular
    @Environment(\.isEnabled) private var enabled
    @ScaledMetric(relativeTo: .subheadline) private var regularHeight = 36
    @ScaledMetric(relativeTo: .footnote) private var smallHeight = 30

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(font)
            .lineLimit(1)
            .foregroundStyle(
                prominent ? MobileStyle.surface : configuration.role == .destructive ? .red : MobileStyle.text
            )
            .tint(prominent ? MobileStyle.surface : MobileStyle.text)
            .padding(.horizontal, horizontalPadding)
            .frame(minHeight: size == .regular ? regularHeight : smallHeight)
            .background(prominent ? MobileStyle.text : MobileStyle.fill, in: .capsule)
            .contentShape(.capsule)
            .opacity(!enabled ? 0.5 : configuration.isPressed ? 0.75 : 1)
    }

    private var font: Font {
        switch size {
        case .regular: .subheadline.weight(prominent ? .semibold : .medium)
        case .small: .footnote.weight(.medium)
        }
    }

    private var horizontalPadding: CGFloat {
        switch size {
        case .regular: prominent ? 20 : MobileSpacing.large
        case .small: MobileSpacing.medium
        }
    }
}

extension ButtonStyle where Self == MobileCapsuleButtonStyle {
    static var mobileCapsule: MobileCapsuleButtonStyle { MobileCapsuleButtonStyle() }
    static var mobileCapsuleProminent: MobileCapsuleButtonStyle { MobileCapsuleButtonStyle(prominent: true) }
    static var mobileCapsuleSmall: MobileCapsuleButtonStyle { MobileCapsuleButtonStyle(size: .small) }
}
