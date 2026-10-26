import RuimtePulsar
import XCTest

@testable import Ruimte

final class ChatAnsiTests: XCTestCase {
    func testThePestPassBadgeAndTestLinesKeepTheirColorsAndResets() {
        let output =
            "\u{1b}[30;42;1m PASS \u{1b}[39;49;22m\u{1b}[39m Tests\\Audit\\NotificationsTest\u{1b}[39m\n"
            + "\u{1b}[32;1m✓\u{1b}[39;22m \u{1b}[90mit uses ULID session identity\u{1b}[39m"
        XCTAssertEqual(
            ChatAnsi.parse(output).tokens,
            [
                token(" PASS ", style(foreground: .palette(0), background: .palette(2), bold: true)),
                token(" Tests\\Audit\\NotificationsTest"),
                token("\n"),
                token("✓", style(foreground: .palette(2), bold: true)),
                token(" "),
                token("it uses ULID session identity", style(foreground: .palette(8))),
            ])
    }

    func testEveryStandardAndBrightColorIsAColorOfThePalette() {
        for i in 0..<8 {
            XCTAssertEqual(
                ChatAnsi.parse("\u{1b}[\(30 + i);\(40 + i)mtext").tokens[0].style,
                style(foreground: .palette(i), background: .palette(i)))
            XCTAssertEqual(
                ChatAnsi.parse("\u{1b}[\(90 + i);\(100 + i)mtext").tokens[0].style,
                style(foreground: .palette(i + 8), background: .palette(i + 8)))
        }
    }

    func testStackedParametersApplyInOrderAndAColorResetsApartFromTheRest() {
        XCTAssertEqual(
            ChatAnsi.parse("\u{1b}[31;0mdefault\u{1b}[0;32;1mgreen\u{1b}[39mstrong\u{1b}[mplain").tokens,
            [
                token("default"),
                token("green", style(foreground: .palette(2), bold: true)),
                token("strong", style(bold: true)),
                token("plain"),
            ])
    }

    func testDimItalicUnderlineStrikeAndInverseEachResetOnTheirOwn() {
        let tokens = ChatAnsi.parse(
            "\u{1b}[31;44;1;2;3;4;9mstyled\u{1b}[22;23;24;29;7mreversed\u{1b}[27;39;49mplain"
        ).tokens
        var styled = style(foreground: .palette(1), background: .palette(4), bold: true)
        styled.dim = true
        styled.italic = true
        styled.underline = true
        styled.strike = true
        XCTAssertEqual(tokens[0].style, styled)
        var reversed = style(foreground: .palette(1), background: .palette(4))
        reversed.inverse = true
        XCTAssertEqual(tokens[1].style, reversed)
        XCTAssertEqual(tokens[2].style, ChatAnsiStyle())
    }

    func testIndexedColorsCoverThePaletteTheColorCubeAndTheGrayRamp() {
        XCTAssertEqual(
            ChatAnsi.parse("\u{1b}[38;5;1;48;5;9mtheme").tokens[0].style,
            style(foreground: .palette(1), background: .palette(9)))
        XCTAssertEqual(
            ChatAnsi.parse("\u{1b}[38;5;196;48;5;232mcube").tokens[0].style,
            style(foreground: .rgb(255, 0, 0), background: .rgb(8, 8, 8)))
        XCTAssertEqual(
            ChatAnsi.parse("\u{1b}[38;5;231;48;5;255mgray").tokens[0].style,
            style(foreground: .rgb(255, 255, 255), background: .rgb(238, 238, 238)))
    }

    func testExtendedColorsReadInTheirSemicolonAndColonForms() {
        XCTAssertEqual(
            ChatAnsi.parse("\u{1b}[38;2;12;34;56;48;2;78;90;123mRGB").tokens[0].style,
            style(foreground: .rgb(12, 34, 56), background: .rgb(78, 90, 123)))
        XCTAssertEqual(
            ChatAnsi.parse("\u{1b}[38:2::12:34:56;48:5:196mRGB").tokens[0].style,
            style(foreground: .rgb(12, 34, 56), background: .rgb(255, 0, 0)))
        XCTAssertEqual(ChatAnsi.parse("\u{1b}[38:2:12:34:56mRGB").tokens[0].style.foreground, .rgb(12, 34, 56))
    }

    func testAnInvalidOrIncompleteExtendedColorKeepsTheColorBefore() {
        for code in ["38;5;256", "38;5", "38;5;", "38;2;300;2;3", "38;2;1;2", "38;2;;2;3"] {
            XCTAssertEqual(
                ChatAnsi.parse("\u{1b}[32mgreen\u{1b}[\(code)mstill green").tokens.last?.style.foreground,
                .palette(2), code)
        }
    }

    func testCursorTitleLinkAndIncompleteControlsGoWhileTheirTextStays() {
        let text =
            "\u{1b}[?25l\u{1b}[2K\u{1b}]0;Window title\u{07}before "
            + "\u{1b}]8;;https://example.com\u{1b}\\link\u{1b}]8;;\u{1b}\\ after\u{1b}[?25h\u{1b}[31;"
        XCTAssertEqual(plain(text), "before link after")
        XCTAssertEqual(ChatAnsi.strip(text), "before link after")
        XCTAssertEqual(plain("\u{9b}32mgreen\u{9b}0m"), "green")
        XCTAssertEqual(ChatAnsi.parse("\u{9b}32mgreen").tokens[0].style.foreground, .palette(2))
        XCTAssertEqual(plain("\u{1b}(Btext\u{07}\u{1b}Pignored\u{1b}\\\u{1b}"), "text")
    }

    func testPlainTextWhitespaceAndOrdinaryBracketsStayAsTheyAre() {
        let text = "hello\tworld\n  [32m is ordinary text\r\n"
        let parsed = ChatAnsi.parse(text)
        XCTAssertEqual(parsed.tokens, [token(text)])
        XCTAssertEqual(parsed.omitted, 0)
        XCTAssertEqual(ChatAnsi.parse("").tokens, [])
    }

    func testTheLimitCountsVisibleCharactersAndNeverCutsAColorSequence() {
        let clipped = ChatAnsi.parse("\u{1b}[32mhello\u{1b}[0m world", limit: 7)
        XCTAssertEqual(clipped.tokens, [token("hello", style(foreground: .palette(2))), token(" w")])
        XCTAssertEqual(clipped.omitted, 4)
        XCTAssertEqual(ChatAnsi.parse("\u{1b}[32mhello\u{1b}[0m", limit: 5).omitted, 0)
        let none = ChatAnsi.parse("\u{1b}[32mhello", limit: 0)
        XCTAssertEqual(none.tokens, [])
        XCTAssertEqual(none.omitted, 5)
    }

    func testTheLiveTailKeepsTheColorOfLinesItLeftOut() {
        let lines = (0..<20).map { "line \($0)" }.joined(separator: "\n")
        let result = ChatAnsi.parse("\u{1b}[32m\(lines)\n", tailLines: 12)
        XCTAssertEqual(
            result.tokens,
            [token((8..<20).map { "line \($0)" }.joined(separator: "\n"), style(foreground: .palette(2)))])
        XCTAssertEqual(result.omitted, 0)
        XCTAssertEqual(plain("first\n\nlast\n", tailLines: 2), "\nlast")
        XCTAssertEqual(plain("\n", tailLines: 12), "")
    }

    func testARunningCallShowsItsLastTwelveLinesInTheBufferedColor() {
        let lines = (0..<20).map { "line \($0)" }.joined(separator: "\n")
        let tool = ChatToolItem(
            id: "colored-live", createdAt: 0, turnId: nil, toolUseId: "call", name: "Bash",
            input: .object(["command": .string("bun test")]), output: nil, state: .running,
            parentToolUseId: nil,
            progress: ChatToolItemProgress(startedAt: nil, description: nil, output: "\u{1b}[32m\(lines)\n"))
        let tail = ChatToolPresentation.tail(tool)
        XCTAssertEqual(tail.map(\.content).joined(), (8..<20).map { "line \($0)" }.joined(separator: "\n"))
        XCTAssertEqual(tail.first?.style.foreground, .palette(2))
    }

    func testAnOutputOfOnlyControlsHasNothingToShow() {
        XCTAssertFalse(ChatToolBody.hasOutput("\u{1b}[?25l\u{1b}[2K\n"))
        XCTAssertTrue(ChatToolBody.hasOutput("\u{1b}[32mok\u{1b}[0m"))
    }

    private func token(_ content: String, _ style: ChatAnsiStyle = ChatAnsiStyle()) -> ChatAnsiToken {
        ChatAnsiToken(content: content, style: style)
    }

    private func style(
        foreground: ChatAnsiColor? = nil, background: ChatAnsiColor? = nil, bold: Bool = false
    ) -> ChatAnsiStyle {
        ChatAnsiStyle(foreground: foreground, background: background, bold: bold)
    }

    private func plain(_ text: String, tailLines: Int? = nil) -> String {
        ChatAnsi.parse(text, tailLines: tailLines).tokens.map(\.content).joined()
    }
}
