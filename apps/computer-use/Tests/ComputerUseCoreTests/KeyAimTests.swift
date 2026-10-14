import ComputerUseCore
import Testing

/// A fake accessibility tree: each element its role, its parent and the element it names as active descendant.
private struct FakeTree {
    let elements: [String: (role: String?, parent: String?, activeDescendant: String?)]

    func element(_ name: String) -> AimElement<String> {
        AimElement(node: name, role: elements[name]?.role, activeDescendant: elements[name]?.activeDescendant)
    }

    func aim(_ focused: String) -> KeyAim<String> {
        var ancestors: [AimElement<String>] = []
        var current = elements[focused]?.parent
        while let name = current {
            ancestors.append(element(name))
            current = elements[name]?.parent
        }
        return KeyAiming.aim(focused: element(focused), ancestors: ancestors)
    }
}

struct KeyAimTests {
    /// An editor in a web page with its completion list portaled beside it, the way a browser reports it while a
    /// row is the active descendant of the editor's text.
    private let page = FakeTree(elements: [
        "web": ("AXWebArea", nil, nil),
        "editor": ("AXGroup", "web", nil),
        "text": ("AXTextArea", "editor", nil),
        "listbox": ("AXList", "web", nil),
        "row": ("AXStaticText", "listbox", nil),
        "button": ("AXButton", "listbox", nil),
        "field": ("AXTextField", "listbox", nil),
        "save": ("AXButton", "web", nil),
    ])

    @Test func aTextKeepsTheAim() {
        #expect(page.aim("text") == .focus("text"))
        #expect(page.aim("save") == .focus("save"))
    }

    @Test func aRowOfAListIsLeftAloneWhateverRoleItHas() {
        #expect(page.aim("row") == .leave)
        #expect(page.aim("button") == .leave)
    }

    @Test func aFieldInsideAListStillTakesTheKeys() {
        #expect(page.aim("field") == .focus("field"))
    }

    @Test func theElementThatNamesTheRowAsActiveDescendantGetsTheAim() {
        let combo = FakeTree(elements: [
            "window": ("AXWindow", nil, nil),
            "combo": ("AXComboBox", "window", "option"),
            "list": ("AXList", "combo", nil),
            "option": ("AXRow", "list", nil),
        ])
        #expect(combo.aim("option") == .focus("combo"))
    }

    @Test func aMenuItemIsLeftAlone() {
        let menu = FakeTree(elements: [
            "app": ("AXApplication", nil, nil),
            "menu": ("AXMenu", "app", nil),
            "item": ("AXMenuItem", "menu", nil),
        ])
        #expect(menu.aim("item") == .leave)
    }
}
