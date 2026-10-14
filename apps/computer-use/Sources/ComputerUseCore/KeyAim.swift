import Foundation

/// What the focus is set on before keys go to an app behind the person's work.
public enum KeyAim<Node: Equatable>: Equatable {
    case focus(Node)
    /// Leave the focus where the app keeps it: the element it reports is not where its keys go.
    case leave
}

/// One element as the aim reads it.
public struct AimElement<Node: Equatable> {
    public let node: Node
    public let role: String?
    /// The element this one names as `AXActiveDescendant`, if any.
    public let activeDescendant: Node?

    public init(node: Node, role: String?, activeDescendant: Node? = nil) {
        self.node = node
        self.role = role
        self.activeDescendant = activeDescendant
    }
}

public enum KeyAiming {
    /// Roles that take text themselves, so keys belong there even inside a list.
    static let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox"]
    static let listRoles: Set<String> = ["AXList", "AXTable", "AXOutline", "AXGrid", "AXMenu", "AXComboBox"]

    /// A browser reports the element `aria-activedescendant` names as the focused one, while its keys still go to
    /// the text that names it. Focusing that row makes the page focus it, and the next key lands on the row.
    /// - Parameter ancestors: The focused element's ancestors, nearest first.
    public static func aim<Node>(focused: AimElement<Node>, ancestors: [AimElement<Node>]) -> KeyAim<Node> {
        if let owner = ancestors.first(where: { $0.activeDescendant == focused.node }) {
            return .focus(owner.node)
        }
        // A row of a list that highlights it for a text elsewhere: which role a browser gives an option varies.
        if !(focused.role.map(textRoles.contains) ?? false),
           ancestors.contains(where: { $0.role.map(listRoles.contains) ?? false }) {
            return .leave
        }
        return .focus(focused.node)
    }
}
