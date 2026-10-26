import Foundation
import Testing

@testable import Ruimte

@MainActor struct MermaidDiagramTests {
    private static let font = MermaidFont(size: 15)

    private func laidOut(_ source: String) async -> Result<MermaidDrawing, MermaidLayout.Failure> {
        await MermaidLayout.shared.drawing(MermaidLayout.Key(source: source, font: Self.font))
    }

    @Test func aDiagramIsLaidOutAtItsOwnSizeInTheVariablesOfPele() async throws {
        let drawing = try await laidOut("flowchart LR\n  A --> B").get()
        #expect(drawing.width > 0)
        #expect(drawing.height > 0)
        let root = try #require(drawing.svg.range(of: #"<svg\b[^>]*>"#, options: .regularExpression))
        #expect(drawing.svg[root].contains(#"width="\#(Int(drawing.width))""#))
        #expect(drawing.svg.contains("var(--pele-fg,"))
        #expect(drawing.svg.contains("-apple-system"))
    }

    @Test func aClickDirectiveAndALinkInTheTextLeaveNoTraceInTheDrawing() async throws {
        let drawing = try await laidOut(
            "flowchart LR\n  A --> B\n  click A \"https://example.com\"\n  click B callback"
        ).get()
        #expect(!drawing.svg.contains("example.com"))
        #expect(!drawing.svg.contains("<a "))
        #expect(!drawing.svg.contains("<script"))
    }

    @Test func aTextPeleCannotDrawStaysUnreadableAndIsKeptSo() async {
        let key = MermaidLayout.Key(source: "graph TD\n  A-->", font: Self.font)
        #expect(await MermaidLayout.shared.drawing(key) == .failure(.unreadable))
        #expect(MermaidLayout.shared.cached(key) == .failure(.unreadable))
    }

    @Test func theColorsReachTheVariablesPeleDrawsWith() async throws {
        let drawing = try await laidOut("flowchart LR\n  A --> B").get()
        let themed = MermaidTheme.themed(
            drawing.svg, colors: [("--pele-fg", "#111111"), ("--pele-surface", "#ffffff")])
        let root = try #require(themed.range(of: #"<svg\b[^>]*>"#, options: .regularExpression))
        #expect(themed[root].contains(#"style="--pele-fg:#111111;--pele-surface:#ffffff;"#))
        #expect(themed[root].contains(#"height="\#(Int(drawing.height))""#))
    }

    @Test func aValueCannotLeaveTheAttributeItIsWrittenIn() {
        let themed = MermaidTheme.themed(#"<svg viewBox="0 0 1 1"></svg>"#, colors: [("--pele-fg", #""><script>"#)])
        #expect(themed == #"<svg style="--pele-fg:&quot;>&lt;script>;" viewBox="0 0 1 1"></svg>"#)
    }

    @Test func aStyleOnTheRootKeepsItsOwnDeclarationsAfterTheColors() {
        let themed = MermaidTheme.themed(#"<svg style="max-width:10px"></svg>"#, colors: [("--pele-bg", "#000000")])
        #expect(themed == #"<svg style="--pele-bg:#000000;max-width:10px"></svg>"#)
    }

    @Test func anythingWithoutARootIsLeftAsItWas() {
        #expect(MermaidTheme.themed("no svg", colors: [("--pele-fg", "#000000")]) == "no svg")
    }

    @Test func theDataAddressEncodesTheDrawingWhole() {
        #expect(MermaidTheme.dataURL("<svg>#</svg>") == "data:image/svg+xml;charset=utf-8,%3Csvg%3E%23%3C%2Fsvg%3E")
    }

    @Test func everyVariableIsAnOpaqueColorWithTheBorderMixedOverTheGround() {
        for dark in [false, true] {
            let colors = MermaidTheme.colors(dark: dark)
            #expect(colors.count == 15)
            #expect(colors.allSatisfy { $0.value.range(of: "^#[0-9a-f]{6}$", options: .regularExpression) != nil })
        }
        let light = Dictionary(uniqueKeysWithValues: MermaidTheme.colors(dark: false).map { ($0.name, $0.value) })
        #expect(light["--pele-bg"] == "#ffffff")
        #expect(light["--pele-border"] == "#cccccc")
        let dark = Dictionary(uniqueKeysWithValues: MermaidTheme.colors(dark: true).map { ($0.name, $0.value) })
        #expect(dark["--pele-bg"] == "#18181c")
        #expect(dark["--pele-border"] == "#36363a")
    }

    @Test func thePageShowsTheDrawingAsAnImageUnderAPolicyThatLoadsNothing() {
        let page = MermaidTheme.page(MermaidDrawing(svg: "<svg></svg>", width: 120, height: 40), dark: false)
        #expect(page.contains(#"content="default-src 'none'; img-src data:; style-src 'unsafe-inline'""#))
        #expect(page.contains(#"<img src="data:image/svg+xml;charset=utf-8,%3Csvg%20style%3D%22--pele-bg"#))
        #expect(page.contains(#"width="120" height="40""#))
        #expect(!page.contains("<script"))
    }
}
