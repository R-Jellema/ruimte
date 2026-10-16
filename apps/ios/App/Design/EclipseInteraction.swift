import SwiftUI
import UIKit

@Observable final class EclipseInteraction {
    struct Frame {
        var point = CGPoint.zero
        var strength = 0.0
        var boost = 0.0
        var travel = 0.0
    }

    private var location: CGPoint?
    private var began: Date?
    private var released: Date?
    private var warpBegan: Date?
    private var holding = false
    private var warpPoint = CGPoint.zero
    private var warpBoost = 0.0
    private var accumulatedTravel = 0.0

    func move(to point: CGPoint, at date: Date = .now) {
        if location == nil || released != nil {
            let previous = warp(at: date)
            accumulatedTravel = previous.travel
            warpBoost = min(1.6, previous.boost + 1)
            warpBegan = date
            holding = true
            began = date
        }
        location = point
        warpPoint = point
        released = nil
    }

    func end(at date: Date = .now) {
        guard holding else { return }
        let current = warp(at: date)
        accumulatedTravel = current.travel
        warpBoost = current.boost
        warpBegan = date
        holding = false
        released = date
    }

    func reset() {
        location = nil
        began = nil
        released = nil
        warpBegan = nil
        holding = false
        accumulatedTravel = 0
        warpBoost = 0
    }

    func frame(in bounds: CGRect, at date: Date) -> Frame {
        var frame = Frame()
        if let location, let began, bounds.contains(location) {
            frame.point = CGPoint(x: location.x - bounds.minX, y: location.y - bounds.minY)
            let held = max(0, (released ?? date).timeIntervalSince(began))
            frame.strength = 1 - exp(-held / 0.325)
            if let released { frame.strength *= exp(-max(0, date.timeIntervalSince(released)) / 0.325) }
        }
        if bounds.contains(warpPoint) {
            let warp = warp(at: date)
            frame.boost = warp.boost
            frame.travel = warp.travel
        }
        return frame
    }

    private func warp(at date: Date) -> (boost: Double, travel: Double) {
        guard let warpBegan else { return (0, accumulatedTravel) }
        let elapsed = max(0, date.timeIntervalSince(warpBegan))
        if holding { return (warpBoost, accumulatedTravel + warpBoost * elapsed) }
        let decay = exp(-elapsed * 1.3)
        return (warpBoost * decay, accumulatedTravel + warpBoost * (1 - decay) / 1.3)
    }
}

extension View {
    func eclipseTouch(_ interaction: EclipseInteraction) -> some View {
        modifier(EclipseTouchModifier(interaction: interaction))
    }
}

private struct EclipseTouchModifier: ViewModifier {
    let interaction: EclipseInteraction
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .gesture(EclipseTouchGesture(interaction: interaction, enabled: !reduceMotion && scenePhase == .active))
            .onDisappear { interaction.reset() }
            .onChange(of: reduceMotion) { _, _ in interaction.reset() }
            .onChange(of: scenePhase) { _, _ in interaction.reset() }
    }
}

private struct EclipseTouchGesture: UIGestureRecognizerRepresentable {
    let interaction: EclipseInteraction
    let enabled: Bool

    func makeUIGestureRecognizer(context: Context) -> EclipseTouchRecognizer {
        EclipseTouchRecognizer(interaction: interaction)
    }

    func updateUIGestureRecognizer(_ recognizer: EclipseTouchRecognizer, context: Context) {
        if recognizer.isEnabled != enabled { recognizer.isEnabled = enabled }
    }
}

final class EclipseTouchRecognizer: UIGestureRecognizer {
    private let interaction: EclipseInteraction
    private weak var tracked: UITouch?

    init(interaction: EclipseInteraction) {
        self.interaction = interaction
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
    }

    // Observe the same finger as the form's pan recognizer without taking its touches or preventing buttons.
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard tracked == nil, let touch = touches.first else { return }
        tracked = touch
        interaction.move(to: touch.location(in: view?.window))
        state = .began
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let tracked, touches.contains(tracked) else { return }
        let point = tracked.location(in: view?.window)
        interaction.move(to: point)
        state = .changed
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let tracked, touches.contains(tracked) else { return }
        let point = tracked.location(in: view?.window)
        interaction.move(to: point)
        interaction.end()
        state = .ended
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        interaction.end()
        state = .cancelled
    }

    override func reset() {
        super.reset()
        tracked = nil
        interaction.end()
    }
}
