import SwiftUI

/// The light app icon, the one every design shows whatever the appearance.
struct AppIconImage: View {
    let size: CGFloat
    var lifted = true

    var body: some View {
        Image("RuimteLogo")
            .renderingMode(.original)
            .resizable()
            .frame(width: size, height: size)
            .clipShape(.rect(cornerRadius: size * 0.235, style: .continuous))
            .shadow(color: .black.opacity(lifted ? 0.3 : 0), radius: 14, y: 8)
            .accessibilityHidden(true)
    }
}
