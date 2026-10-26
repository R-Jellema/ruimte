import Foundation
import RuimtePulsar
import RuimteTransport
import SwiftUI
import Testing
import UIKit

@testable import Ruimte

/// Renders the Projects tab (two machines, one offline) and a project's page from fixtures to PNG files for review, in
/// light and dark. Runs only when `RUIMTE_PROJECT_SNAPSHOTS` names a folder (`TEST_RUNNER_RUIMTE_PROJECT_SNAPSHOTS`
/// through `xcodebuild`), since it waits on layout.
@Suite(.serialized) @MainActor struct ProjectSnapshots {
    private nonisolated static let folder = ProcessInfo.processInfo.environment["RUIMTE_PROJECT_SNAPSHOTS"]
    private static let date = Calendar.current.date(bySettingHour: 8, minute: 24, second: 0, of: .now) ?? .now
    private static var milliseconds: Double { date.timeIntervalSince1970 * 1000 }

    @Test(.enabled(if: folder != nil)) func projects() async throws {
        let connections = MachineConnections(monitorPaths: false)
        defer { connections.shutdown() }
        let runtime = AppRuntime(connections: connections)
        let offlineSince = (Calendar.current.date(bySettingHour: 6, minute: 12, second: 0, of: .now) ?? .now)
        let mac = machine("mac", name: "MacBook Pro")
        let studio = machine("studio", name: "Studio", lastSeen: offlineSince)
        runtime.machines = [mac, studio]
        let groups = ProjectOverview.groups(
            open: [
                row(mac, "score", name: "score-engine", color: "#7c3aed"), row(mac, "ruimte", name: "ruimte"),
                row(mac, "site", name: "site", color: "#16a34a"),
                row(studio, "mix", name: "mix-renders", connected: false),
            ],
            chats: [row(mac, "chats", name: "Chats", scratch: true)],
            reach: { $0.id == studio.id ? .offline : .connected(relayed: false) },
            activity: { id in
                switch id.projectID {
                case "score": ProjectActivity(views: 6, chats: 4, needsYou: 2, working: 1)
                case "ruimte": ProjectActivity(views: 3, chats: 1, working: 1)
                case "chats": ProjectActivity(views: 6, chats: 6)
                default: ProjectActivity(views: 2)
                }
            },
            git: { id in
                switch id.projectID {
                case "score": ProjectGitLine(branch: "s12-cache", changed: 3, added: 126, deleted: 4)
                case "ruimte": ProjectGitLine(branch: "main", changed: 0)
                case "site": ProjectGitLine(branch: "redesign-hero", changed: 2, added: 8, deleted: 2)
                default: nil
                }
            })
        let page = MobileList {
            ProjectMachineCards(groups: groups, session: runtime.session(for:)) { _ in }
            ProjectsCapsuleActions(machines: [mac], newChat: { _ in }, showRecent: {})
        }
        try await render(page.navigationTitle("Projects").navigationBarTitleDisplayMode(.large), name: "projects")
    }

    @Test(.enabled(if: folder != nil)) func project() async throws {
        let connections = MachineConnections(monitorPaths: false)
        defer { connections.shutdown() }
        let runtime = AppRuntime(connections: connections)
        let mac = machine("mac", name: "MacBook Pro")
        runtime.machines = [mac]
        let workspace = MobileWorkspace(
            session: runtime.session(for: mac), projectID: "score",
            summary: .object(["projectId": .string("score"), "name": .string("score-engine")]))
        let defaults = try #require(UserDefaults(suiteName: "ruimte.snapshots.\(UUID().uuidString)"))
        let state = ProjectListState(machineID: "mac", projectID: "score", defaults: defaults)
        let views = [
            view("first", kind: "chat", name: "First draft"), view("stems", kind: "chat", name: "Export stems"),
            view("sync", kind: "chat", name: "Sync warnings"), view("presets", kind: "chat", name: "Delivery presets"),
            view("tests", kind: "terminal", name: "bun test --watch"), view("zsh", kind: "terminal", name: "zsh"),
            view("canvas", kind: "canvas", name: "Canvas"),
        ]
        let sources = ProjectMarkSources(
            statuses: [
                "first": .needsYou, "stems": .needsYou, "sync": .running, "presets": .idle, "tests": .running,
            ],
            unseen: ["presets"],
            requests: ["first": [Self.command()], "stems": [Self.question()]],
            activity: [
                "sync": ChatActivity(background: [.init(description: "Running sync tests", startedAt: 1)])
            ],
            finishedAt: ["presets": Self.milliseconds - 32 * 60_000])
        let git = ProjectGitLine(branch: "s12-cache", changed: 3, added: 126, deleted: 4)
        let page = MobileList {
            ProjectPageSections(
                workspace: workspace, state: state,
                groups: ProjectPageLayout.groups(views, git: true, expanded: state.isExpanded), sources: sources,
                git: git, date: Self.date, open: { _ in }, openGit: {}, act: { _, _ in })
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ProjectNewChatBar(workspace: workspace, add: {}, opened: { _ in })
        }
        .navigationTitle("score-engine")
        .navigationSubtitle("s12-cache · +126 \u{2212}4 · MacBook Pro")
        .navigationBarTitleDisplayMode(.large)
        try await render(page, name: "project")
    }

    private func render(_ view: some View, name: String) async throws {
        for dark in [false, true] {
            let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            let window = UIWindow(windowScene: scene)
            window.windowLevel = .alert + 1
            window.overrideUserInterfaceStyle = dark ? .dark : .light
            window.rootViewController = UIHostingController(
                rootView: NavigationStack { view.modifier(MobilePageSurface()) }
                    .foregroundStyle(MobileStyle.text).tint(MobileStyle.accent))
            window.isHidden = false
            try await Task.sleep(for: .milliseconds(800))
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            window.isHidden = true
            let folder = URL(fileURLWithPath: try #require(Self.folder), isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try #require(image.pngData())
                .write(to: folder.appendingPathComponent("\(name)-\(dark ? "dark" : "light").png"))
        }
    }

    private func machine(_ id: String, name: String, lastSeen: Date? = nil) -> Machine {
        Machine(
            id: "snapshot-\(id)-\(UUID().uuidString)", name: name, icon: nil, publicKey: DeviceKey().publicKey,
            brokerUrl: nil, lastSeenAt: lastSeen.map { Int64($0.timeIntervalSince1970 * 1000) })
    }

    private func row(
        _ machine: Machine, _ id: String, name: String, color: String? = nil, scratch: Bool = false,
        connected: Bool = true
    ) -> UnifiedProjectRow {
        var summary: [String: JSONValue] = ["projectId": .string(id), "name": .string(name)]
        if let color { summary["color"] = .string(color) }
        if scratch { summary["scratch"] = .bool(true) }
        return UnifiedProjectRow(machine: machine, summary: .object(summary), connected: connected)
    }

    private func view(_ id: String, kind: String, name: String) -> JSONValue {
        .object(["id": .string(id), "kind": .string(kind), "name": .string(name), "nodes": .array([])])
    }

    private static func command() -> NowRequest {
        NowRequest(
            .object([
                "requestId": .string("command"), "kind": .string("approval"), "createdAt": .number(milliseconds),
                "approval": .object([
                    "toolName": .string("Bash"), "subject": .string("bun test"),
                    "description": .string("Run the tests"), "command": .string("bun test"),
                    "canAllowAlways": .bool(false),
                ]),
            ]))!
    }

    private static func question() -> NowRequest {
        NowRequest(
            .object([
                "requestId": .string("question"), "kind": .string("question"), "createdAt": .number(milliseconds),
                "question": .object([
                    "questions": .array([
                        .object([
                            "id": .string("depth"), "header": .string("Bit depth"),
                            "question": .string("Which bit depth do you want for the stems?"),
                            "choices": .array([]), "multiSelect": .bool(false),
                        ])
                    ])
                ]),
            ]))!
    }
}
