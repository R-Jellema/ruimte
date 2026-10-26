import RuimtePulsar
import SwiftUI

/// A file Search found, shown in its project, so it can be mentioned in one of the project's chats or opened as one
/// of its views.
struct ProjectFilePage: View {
    let target: ProjectFileTarget
    let openView: (MobileWorkspace, String) -> Void
    @State private var workspace: MobileWorkspace?

    init(runtime: AppRuntime, target: ProjectFileTarget, openView: @escaping (MobileWorkspace, String) -> Void) {
        self.target = target
        self.openView = openView
        _workspace = State(
            initialValue: runtime.session(machineID: target.machineID).map {
                MobileWorkspace(session: $0, projectID: target.projectID)
            })
    }

    var body: some View {
        Group {
            if let workspace {
                FileContentPage(
                    client: workspace.client, path: target.path,
                    project: FilesProject(workspace: workspace, openView: { openView(workspace, $0) }))
            } else {
                ContentUnavailableView(
                    String(localized: "Machine unavailable"), lucideIcon: "triangle-alert",
                    description: Text("This machine is no longer connected to this device."))
            }
        }
        .modifier(MobilePageSurface())
        .task { workspace?.start() }
    }
}
