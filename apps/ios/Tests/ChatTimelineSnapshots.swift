import Foundation
import SwiftUI
import Testing
import UIKit

@testable import Ruimte

/// Renders parts of a chat's thread to PNG files for review against the desktop. Runs only when
/// `RUIMTE_CHAT_SNAPSHOTS` names a folder (`TEST_RUNNER_RUIMTE_CHAT_SNAPSHOTS` through `xcodebuild`), since it waits on
/// web views and layout.
@Suite(.serialized) @MainActor struct ChatTimelineSnapshots {
    private nonisolated static let folder = ProcessInfo.processInfo.environment["RUIMTE_CHAT_SNAPSHOTS"]

    private static let diagrams = [
        "flowchart LR\n  Phone[iPhone] -->|offer| Broker\n  Broker --> Machine\n  Machine -->|answer| Phone",
        "sequenceDiagram\n  participant P as Phone\n  participant M as Machine\n  P->>M: chat.attach\n  M-->>P: snapshot\n  M-)P: chat.event",
        "graph TD\n  A-->",
    ]

    @Test(.enabled(if: folder != nil)) func mermaidFences() async throws {
        let reply = "The connection goes through three steps:\n\n"
            + Self.diagrams.map { "```mermaid\n\($0)\n```" }.joined(separator: "\n\nAnd then:\n\n")
        let keys = Self.diagrams.map { MermaidLayout.Key(source: $0, font: MermaidFont(size: 15)) }
        for dark in [false, true] {
            try await Self.render(
                ScrollView { MarkdownMessage(text: reply).padding(16) }, name: "mermaid-\(dark ? "dark" : "light")",
                dark: dark
            ) { keys.allSatisfy { MermaidLayout.shared.cached($0) != nil } }
        }
    }

    static func render(
        _ view: some View, name: String, dark: Bool, size: CGSize = CGSize(width: 402, height: 874),
        until ready: () -> Bool = { true }
    ) async throws {
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: size)
        window.windowLevel = .alert + 1
        window.overrideUserInterfaceStyle = dark ? .dark : .light
        window.rootViewController = UIHostingController(
            rootView: view.background(MobileStyle.surface).tint(MobileStyle.accent))
        window.isHidden = false
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }
        for _ in 0..<100 where !ready() {
            try await Task.sleep(for: .milliseconds(50))
        }
        // The web views of the drawings load their pages once the layout settled.
        try await Task.sleep(for: .milliseconds(1_200))
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let folder = URL(fileURLWithPath: try #require(Self.folder), isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try #require(image.pngData()).write(to: folder.appendingPathComponent("\(name).png"))
    }
}
