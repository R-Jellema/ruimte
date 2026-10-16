import UIKit
import XCTest

@testable import Ruimte

@MainActor final class GalaxyInteractionTests: XCTestCase {
    private let bounds = CGRect(x: 20, y: 100, width: 320, height: 468)
    private let date = Date(timeIntervalSinceReferenceDate: 100)

    func testFingerCoordinatesAndReleaseFade() {
        let interaction = EclipseInteraction()
        interaction.move(to: CGPoint(x: 180, y: 300), at: date)
        let held = interaction.frame(in: bounds, at: date.addingTimeInterval(1))
        XCTAssertEqual(held.point, CGPoint(x: 160, y: 200))
        XCTAssertGreaterThan(held.strength, 0.9)
        interaction.end(at: date.addingTimeInterval(1))
        let released = interaction.frame(in: bounds, at: date.addingTimeInterval(2))
        XCTAssertLessThan(released.strength, 0.05)
        XCTAssertLessThan(released.boost, 0.3)
    }

    func testHoldingKeepsWarpActiveAndReleaseDecaysWithoutJumping() {
        let interaction = EclipseInteraction()
        let point = CGPoint(x: 180, y: 300)
        interaction.move(to: point, at: date)
        XCTAssertEqual(interaction.frame(in: bounds, at: date).boost, 1)
        let held = interaction.frame(in: bounds, at: date.addingTimeInterval(5))
        XCTAssertEqual(held.boost, 1)
        XCTAssertEqual(held.travel, 5)
        interaction.end(at: date.addingTimeInterval(5))
        let released = interaction.frame(in: bounds, at: date.addingTimeInterval(5))
        XCTAssertEqual(released.travel, held.travel)
        XCTAssertEqual(released.boost, held.boost)
        let later = interaction.frame(in: bounds, at: date.addingTimeInterval(6))
        XCTAssertLessThan(later.boost, 0.3)
        XCTAssertGreaterThan(later.travel, released.travel)
        interaction.move(to: point, at: date.addingTimeInterval(6))
        XCTAssertEqual(interaction.frame(in: bounds, at: date.addingTimeInterval(6)).travel, later.travel)
        interaction.reset()
        let reset = interaction.frame(in: bounds, at: date.addingTimeInterval(7))
        XCTAssertEqual(reset.boost, 0)
        XCTAssertEqual(reset.travel, 0)
        XCTAssertEqual(reset.strength, 0)
    }

    func testTouchesOutsideTheSkyHaveNoEffect() {
        let interaction = EclipseInteraction()
        let point = CGPoint(x: 180, y: 800)
        interaction.move(to: point, at: date)
        let frame = interaction.frame(in: bounds, at: date.addingTimeInterval(1))
        XCTAssertEqual(frame.strength, 0)
        XCTAssertEqual(frame.boost, 0)
    }

    func testObserverPreservesScrollingAndButtons() {
        let recognizer = EclipseTouchRecognizer(interaction: EclipseInteraction())
        XCTAssertFalse(recognizer.cancelsTouchesInView)
        XCTAssertFalse(recognizer.delaysTouchesBegan)
        XCTAssertFalse(recognizer.delaysTouchesEnded)
        XCTAssertFalse(recognizer.canPrevent(UIPanGestureRecognizer()))
        XCTAssertFalse(recognizer.canBePrevented(by: UITapGestureRecognizer()))
    }
}
