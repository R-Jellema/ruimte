import SwiftUI

/// The plus at the bottom of a project's page, on thumb height, that adds a view, or a chat to the Chats project.
struct ProjectAddButton: View {
    let workspace: MobileWorkspace
    let add: () -> Void
    @ScaledMetric(relativeTo: .body) private var size = 56

    var body: some View {
        Button(action: add) {
            Image(lucide: workspace.isScratch ? "message-square-plus" : "plus", size: 22)
                .frame(width: size, height: size)
        }
        .buttonStyle(MobileGlassButtonStyle(shape: .circle))
        .disabled(!workspace.ready)
        .accessibilityLabel(workspace.isScratch ? Text("New chat") : Text("Add view"))
        .accessibilityIdentifier("project.newView")
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.horizontal, MobileSpacing.margin)
        .padding(.bottom, MobileSpacing.small)
    }
}
