import Foundation
import RuimtePulsar
import RuimteTransport
import SwiftUI
import Testing
import UIKit

@testable import Ruimte

/// Scrolls each tab of the iPhone's home and checks the large title folds into the bar, since the bar only follows
/// the scroll view it tracks.
@Suite(.serialized) @MainActor struct PhoneHomeScrollTests {
    @Test func largeTitleFoldsOnEveryTab() async throws {
        let domain = "PhoneHomeScrollTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        let machine = Machine(
            id: "scroll-mac", name: "MacBook Pro", icon: nil, publicKey: DeviceKey().publicKey, brokerUrl: nil,
            lastSeenAt: nil)
        let summaries = (0..<14).map { index in
            JSONValue.object([
                "projectId": .string("project-\(index)"), "name": .string("Project \(index)"),
                "folder": .string("/work/project-\(index)"), "lastOpenedAt": .number(Double(100 - index)),
                "closedAt": .null, "available": .bool(true),
            ])
        }
        defaults.set(try JSONValue.array(summaries).encoded(), forKey: "ruimte.ios.projects.\(machine.id)")
        defaults.set(machine.publicKey, forKey: "ruimte.ios.projects.\(machine.id).publicKey")

        let connections = MachineConnections(monitorPaths: false)
        defer { connections.shutdown() }
        let runtime = AppRuntime(connections: connections)
        runtime.machines = [machine]
        let projects = UnifiedProjects(defaults: defaults)
        projects.reconcile(machines: [machine], connect: nil)
        let router = PhoneRouter()

        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        window.rootViewController = UIHostingController(
            rootView: PhoneHome(
                runtime: runtime, projects: projects, now: NowModel(), router: router, showSettings: {},
                addMachine: {}))
        window.isHidden = false
        defer { window.isHidden = true }
        try await Task.sleep(for: .milliseconds(800))

        for tab in [PhoneTab.projects, .scheduled, .now, .machines, .projects] {
            router.tab = tab
            try await Task.sleep(for: .milliseconds(800))
            let bar = try #require(navigationBar(in: window))
            let expanded = bar.frame.height
            let list = try #require(visibleScrollView(in: window), "No list on \(tab.title)")
            list.setContentOffset(CGPoint(x: 0, y: list.contentOffset.y + 300), animated: false)
            try await Task.sleep(for: .milliseconds(800))
            #expect(bar.frame.height < expanded, "The large title of \(tab.title) stays out of the bar")
            // Pulled past the top, as a finger does, since the bar only grows its large title back from there.
            list.setContentOffset(CGPoint(x: 0, y: -list.adjustedContentInset.top - 200), animated: false)
            try await Task.sleep(for: .milliseconds(400))
            list.setContentOffset(CGPoint(x: 0, y: -list.adjustedContentInset.top), animated: false)
            try await Task.sleep(for: .milliseconds(400))
        }
    }

    private func navigationBar(in window: UIWindow) -> UINavigationBar? {
        allViews(window).compactMap { $0 as? UINavigationBar }.first { !$0.isHidden && $0.window != nil }
    }

    /// The list on screen, as the tab view keeps the lists of other tabs it already made.
    private func visibleScrollView(in window: UIWindow) -> UIScrollView? {
        allViews(window).compactMap { $0 as? UICollectionView }.first { view in
            var current: UIView? = view
            while let shown = current {
                if shown.isHidden || shown.alpha == 0 {
                    return false
                }
                current = shown.superview
            }
            return view.convert(view.bounds, to: window).intersects(window.bounds)
        }
    }

    private func allViews(_ root: UIView) -> [UIView] {
        [root] + root.subviews.flatMap(allViews)
    }
}
