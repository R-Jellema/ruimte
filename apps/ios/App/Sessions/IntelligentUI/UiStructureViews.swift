import RuimtePulsar
import SwiftUI

/// The tabs as wide as their titles on a tile, like a segmented control, scrolling sideways when they run past the
/// block. A tab that arrives while the block streams is not picked: the one that was open stays open.
struct UiTabsView: View {
    let node: UiNode
    let context: UiRenderContext
    @Environment(\.uiInSection) private var inSection

    var body: some View {
        let tabs = node.children(of: "Tab")
        let key = "tabs:\(node.id)"
        let picked = context.local.pick(key).flatMap { id in tabs.first { $0.id == id } } ?? tabs.first
        VStack(alignment: .leading, spacing: 12) {
            ScrollView(.horizontal) {
                HStack(spacing: 4) {
                    ForEach(tabs) { tab in
                        let chosen = tab.id == picked?.id
                        Button {
                            context.local.setPick(key, tab.id)
                        } label: {
                            Text(tab.string("title") ?? "").font(.subheadline.weight(.medium)).lineLimit(1)
                                .foregroundStyle(chosen ? MobileStyle.text : MobileStyle.muted)
                                .padding(.horizontal, 10).frame(minHeight: 32)
                                .background(chosen ? MobileStyle.active : .clear, in: RoundedRectangle(cornerRadius: 9))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(chosen ? [.isSelected] : [])
                    }
                }
                .padding(3)
                .background(
                    inSection ? UiTileStyle.inset : UiTileStyle.tile,
                    in: RoundedRectangle(cornerRadius: UiTileStyle.radius))
            }
            .scrollIndicators(.hidden).scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(String(localized: "Options"))
            if let picked {
                UiNodesView(nodes: picked.children, parent: "Tab", context: context, spacing: 12).id(picked.id)
            }
        }
        .sensoryFeedback(.selection, trigger: picked?.id)
    }
}

/// Every section arrives open until the person folds one of the set; after that nothing opens by itself.
struct UiSectionsView: View {
    let node: UiNode
    let context: UiRenderContext

    var body: some View {
        let sections = node.children.filter { !$0.isText }
        let touched = context.local.flag("sections:\(node.id)") == true
        VStack(alignment: .leading, spacing: 6) {
            ForEach(sections) { section in
                if section.type == "Section" && section.error == nil {
                    UiSectionView(node: section, touched: touched, context: context) {
                        context.local.setFlag("sections:\(node.id)", true)
                    }
                } else {
                    UiNodeView(node: section, parent: node.type, context: context)
                }
            }
        }
    }
}

/// A tile with its title as the fold; its content keeps one margin on both sides, and the parts in it line up with
/// the title (`uiInSection`).
struct UiSectionView: View {
    let node: UiNode
    let touched: Bool
    let context: UiRenderContext
    var touch: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.uiInSection) private var inSection

    var body: some View {
        let key = "section:\(node.id)"
        let open = context.local.flag(key) ?? !touched
        VStack(alignment: .leading, spacing: 0) {
            Button {
                touch()
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.15)) { context.local.setFlag(key, !open) }
            } label: {
                HStack(spacing: 8) {
                    Image(lucide: "chevron-right", size: 14).foregroundStyle(MobileStyle.faint)
                        .rotationEffect(.degrees(open ? 90 : 0))
                    Text(node.string("title") ?? "").font(.subheadline.weight(.medium))
                        .foregroundStyle(MobileStyle.text).lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, UiTileStyle.padding).frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(open ? String(localized: "Expanded") : String(localized: "Collapsed"))
            if open {
                UiNodesView(nodes: node.children, parent: "Section", context: context, spacing: 12)
                    .environment(\.uiInSection, true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, UiTileStyle.padding).padding(.bottom, UiTileStyle.padding)
            }
        }
        .background(
            inSection ? UiTileStyle.inset : UiTileStyle.tile, in: RoundedRectangle(cornerRadius: UiTileStyle.radius))
    }
}
