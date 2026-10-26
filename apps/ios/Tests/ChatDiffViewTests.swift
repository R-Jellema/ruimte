import SwiftUI
import UIKit
import XCTest

@testable import Ruimte

final class ChatDiffViewTests: XCTestCase {
    @MainActor func testALineWiderThanTheCardScrollsSideways() async throws {
        let long = "+" + String(repeating: "const value = compute(input, options) ", count: 8)
        let host = UIHostingController(rootView: ChatDiffView(diff: "@@ -1 +1 @@\n-short\n\(long)").frame(width: 300))
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
            throw XCTSkip("Needs an active window scene")
        }
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 400, height: 400)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        for _ in 0..<5 {
            await Task.yield()
            window.layoutIfNeeded()
        }
        let scrollView = try XCTUnwrap(Self.scrollView(in: host.view))
        XCTAssertGreaterThan(scrollView.contentSize.width, scrollView.bounds.width + 100)
    }

    private static func scrollView(in view: UIView) -> UIScrollView? {
        if let scrollView = view as? UIScrollView { return scrollView }
        for subview in view.subviews {
            if let found = scrollView(in: subview) { return found }
        }
        return nil
    }
}
