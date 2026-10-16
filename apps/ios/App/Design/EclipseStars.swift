import SwiftUI

struct EclipseStars: View {
    let size: CGSize
    let center: CGPoint
    let density: Double
    let time: TimeInterval?
    let dark: Bool
    var interaction = EclipseInteraction.Frame()

    var body: some View {
        Rectangle()
            .fill(.white)
            .colorEffect(
                ShaderLibrary.galaxy(
                    .float2(size), .float2(center), .float(Float(time ?? 0)),
                    .float(Float(density)), .float(dark ? 1 : 0), .float(time == nil ? 0 : 1),
                    .float2(interaction.point), .float(Float(interaction.strength)),
                    .float(Float(interaction.boost)), .float(Float(interaction.travel))))
    }
}
