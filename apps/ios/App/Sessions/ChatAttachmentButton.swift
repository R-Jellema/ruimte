import QuickLook
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UniformTypeIdentifiers

struct ChatAttachmentButton: View {
    let client: any MachineRequesting
    let chatID: String
    let id: String
    let name: String
    let mime: String
    let size: Int64
    @State private var preview: URL?
    @State private var downloaded: URL?
    @State private var work = RemotePageState()

    private var resource: JSONValue { .chatAttachment(chatID: chatID, id: id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if mime.hasPrefix("image/") {
                ChatInlineImage(resource: resource, name: name)
            }
            Button {
                Task { await load() }
            } label: {
                HStack(spacing: 10) {
                    if work.busy {
                        ProgressView()
                    } else {
                        Image(lucide: "file-text", size: 18).foregroundStyle(.tint)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name)
                            .font(.caption.weight(.medium)).lineLimit(1).truncationMode(.middle)
                        Text(mobileAttachmentSize(Double(size)))
                            .font(.caption2).foregroundStyle(MobileStyle.muted).monospacedDigit()
                    }
                    Image(lucide: "circle-arrow-down", size: 14).foregroundStyle(MobileStyle.muted)
                }.padding(.horizontal, 12).frame(minHeight: 48)
                    .background(MobileStyle.surface, in: RoundedRectangle(cornerRadius: 12))
            }.buttonStyle(.plain).disabled(work.busy)
            if let problem = work.problem { Text(problem).font(.caption).foregroundStyle(MobileStyle.statusError) }
        }
        .quickLookPreview($preview)
        .onDisappear {
            if let downloaded { try? FileManager.default.removeItem(at: downloaded.deletingLastPathComponent()) }
            downloaded = nil
        }
    }

    private func load() async {
        if let downloaded {
            preview = downloaded
            return
        }
        await work.perform {
            let file = try await client.readResource(resource)
            try Task.checkCancellation()
            let folder = FileManager.default.temporaryDirectory.appending(
                path: "ruimte-attachment-\(UUID().uuidString)", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let safeName = URL(fileURLWithPath: name).lastPathComponent
            let url = folder.appendingPathComponent(
                safeName.isEmpty || safeName == "." || safeName == ".." ? String(localized: "Attachment") : safeName)
            try file.data.write(to: url, options: .atomic)
            downloaded = url
            preview = url
        }
    }
}

extension JSONValue {
    /// An attachment of a chat as `bytes.read` names the resource.
    static func chatAttachment(chatID: String, id: String) -> JSONValue {
        .object(["kind": .string("attachment"), "chatId": .string(chatID), "attachmentId": .string(id)])
    }
}
