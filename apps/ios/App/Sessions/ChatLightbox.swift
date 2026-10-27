import CoreTransferable
import RuimtePulsar
import RuimteTransport
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// An image of a chat as the lightbox pages through it: an attachment, or a file on the machine.
struct ChatLightboxImage: Identifiable {
    let resource: JSONValue
    let name: String
    var mime: String? = nil

    var id: String {
        resource["attachmentId"]?.stringValue ?? resource["path"]?.stringValue ?? name
    }
}

/// The images that open together, in the order a swipe walks them, and the namespace their thumbnails zoom from.
struct ChatImageGroup {
    let images: [ChatLightboxImage]
    let namespace: Namespace.ID
}

extension EnvironmentValues {
    @Entry var chatImageGroup: ChatImageGroup?
}

/// Thumbnails inside open one lightbox together, and closing it zooms back into whichever one the person ended on.
struct ChatImageGroupScope<Content: View>: View {
    let images: [ChatLightboxImage]
    @ViewBuilder let content: Content
    @Namespace private var namespace

    var body: some View {
        content.environment(\.chatImageGroup, images.count > 1 ? ChatImageGroup(images: images, namespace: namespace) : nil)
    }
}

/// What a thumbnail hands the lightbox when it opens it.
struct ChatLightboxStart: Identifiable {
    let images: [ChatLightboxImage]
    let index: Int
    /// The picture the thumbnail already holds, so the zoom lands on it while the full bytes load.
    let placeholder: UIImage?

    var id: String { images[index].id }
}

/// Images over the whole screen, the way Photos shows them: a pinch or a double tap zooms, a swipe sideways walks the
/// group, a swipe down shrinks the picture back into its thumbnail, and a tap hides the controls.
struct ChatLightbox: View {
    let client: any MachineRequesting
    let start: ChatLightboxStart
    let namespace: Namespace.ID
    @Environment(\.dismiss) private var dismiss
    @State private var selection: String
    @State private var chrome = true

    init(client: any MachineRequesting, start: ChatLightboxStart, namespace: Namespace.ID) {
        self.client = client
        self.start = start
        self.namespace = namespace
        _selection = State(initialValue: start.id)
    }

    private var images: [ChatLightboxImage] { start.images }
    private var index: Int { images.firstIndex { $0.id == selection } ?? 0 }
    private var current: ChatLightboxImage { images[index] }

    var body: some View {
        // The pages run under the bars and the notch; the controls over them keep to the safe area.
        ZStack {
            Color.black.ignoresSafeArea()
            TabView(selection: $selection) {
                ForEach(images) { image in
                    ChatLightboxPage(
                        client: client, image: image,
                        placeholder: image.id == start.id ? start.placeholder : nil,
                        active: image.id == selection,
                        onTap: { withAnimation(.easeOut(duration: 0.2)) { chrome.toggle() } }
                    )
                    .tag(image.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
        }
        .overlay(alignment: .top) { if chrome { bar.transition(.opacity) } }
        .overlay(alignment: .bottom) { if chrome { caption.transition(.opacity) } }
        .statusBarHidden(!chrome)
        .environment(\.colorScheme, .dark)
        .navigationTransition(.zoom(sourceID: selection, in: namespace))
    }

    private var bar: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(lucide: "x", size: 16).frame(width: 44, height: 44)
            }
            .buttonStyle(MobileGlassButtonStyle(shape: .circle))
            .accessibilityLabel(String(localized: "Close"))
            Spacer(minLength: 0)
            ShareLink(
                item: ChatImageFile(
                    name: current.name, type: current.mime.flatMap { UTType(mimeType: $0) },
                    data: { [client, resource = current.resource] in try await client.readResource(resource).data }),
                preview: SharePreview(current.name)
            ) {
                Image(lucide: "share", size: 16).frame(width: 44, height: 44)
            }
            .buttonStyle(MobileGlassButtonStyle(shape: .circle))
            .accessibilityLabel(String(localized: "Share"))
        }
        .foregroundStyle(MobileStyle.text)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var caption: some View {
        VStack(spacing: 2) {
            Text(verbatim: current.name).font(.footnote.weight(.medium)).lineLimit(1).truncationMode(.middle)
            if images.count > 1 {
                Text("\(index + 1) of \(images.count)").font(.caption).foregroundStyle(MobileStyle.muted)
                    .monospacedDigit()
            }
        }
        .foregroundStyle(MobileStyle.text)
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
        .accessibilityElement(children: .combine)
    }
}

/// One image of the lightbox, read whole from the machine when its page comes up.
private struct ChatLightboxPage: View {
    let client: any MachineRequesting
    let image: ChatLightboxImage
    let placeholder: UIImage?
    let active: Bool
    let onTap: () -> Void
    @State private var full: UIImage?
    @State private var failure: String?

    var body: some View {
        ZStack {
            if let picture = full ?? placeholder {
                FileImageView(image: picture, name: image.name, active: active, onTap: onTap)
            } else if let failure {
                VStack(spacing: 8) {
                    Image(lucide: "image-off", size: 24).foregroundStyle(MobileStyle.faint)
                    Text(verbatim: failure).font(.footnote).foregroundStyle(MobileStyle.muted)
                        .multilineTextAlignment(.center)
                }
                .padding(32)
            } else {
                Spinner(size: 20).foregroundStyle(MobileStyle.faint)
                    .accessibilityLabel(String(localized: "Loading image"))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { if full == nil && placeholder == nil { onTap() } }
        .task(id: image.id) {
            guard full == nil else { return }
            do {
                let bytes = try await client.readResource(image.resource)
                try Task.checkCancellation()
                let decoded = await Task.detached(priority: .userInitiated) { FileImage.decode(bytes.data) }.value
                try Task.checkCancellation()
                if let decoded {
                    full = decoded.image
                } else {
                    failure = String(localized: "The image is not available")
                }
            } catch is CancellationError {} catch {
                failure = error.localizedDescription
            }
        }
    }
}

/// An image as a file for the share sheet, in the type the attachment says it is, so Save Image and other apps
/// take it as that image.
struct ChatImageFile: Transferable {
    let name: String
    let type: UTType?
    /// Read only once the person picks where the image goes.
    let data: @Sendable @MainActor () async throws -> Data

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .png) { try await $0.data() }
            .exportingCondition { $0.type == .png || $0.type == nil }
            .suggestedFileName { $0.name }
        DataRepresentation(exportedContentType: .jpeg) { try await $0.data() }
            .exportingCondition { $0.type == .jpeg }
            .suggestedFileName { $0.name }
        DataRepresentation(exportedContentType: .webP) { try await $0.data() }
            .exportingCondition { $0.type == .webP }
            .suggestedFileName { $0.name }
        DataRepresentation(exportedContentType: .image) { try await $0.data() }
            .exportingCondition { ![UTType.png, .jpeg, .webP].contains($0.type ?? .png) }
            .suggestedFileName { $0.name }
    }
}
