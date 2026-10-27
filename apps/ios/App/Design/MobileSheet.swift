import SwiftUI

extension Binding {
    /// Whether the optional holds a value, for a sheet or alert that shows while it does; dismissing clears it.
    func isPresent<Wrapped>() -> Binding<Bool> where Value == Wrapped? {
        // SwiftUI calls both closures on the main actor, where the bindings this replaced lived too.
        nonisolated(unsafe) let base = self

        return Binding<Bool>(get: { base.wrappedValue != nil }, set: { if !$0 { base.wrappedValue = nil } })
    }
}

struct MobileSheetSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .modifier(MobilePageSurface())
            .foregroundStyle(MobileStyle.text)
            .tint(MobileStyle.accent)
            .toggleStyle(SystemToggleStyle())
            // Sheets have their own surface instead of borrowing color from the view underneath.
            .presentationBackground(MobileStyle.surface)
            // A form sheet over the iPad's sidebar and content; an iPhone's sheet is the width of the screen anyway.
            .presentationSizing(.form)
    }
}

extension View {
    func mobileSheet<Content: View>(
        isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        sheet(isPresented: isPresented, onDismiss: onDismiss) { content().modifier(MobileSheetSurface()) }
    }

    func mobileSheet<Item: Identifiable, Content: View>(
        item: Binding<Item?>, onDismiss: (() -> Void)? = nil,
        @ViewBuilder content: @escaping (Item) -> Content
    ) -> some View {
        sheet(item: item, onDismiss: onDismiss) { content($0).modifier(MobileSheetSurface()) }
    }
}
