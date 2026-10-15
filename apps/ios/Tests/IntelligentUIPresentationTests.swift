import RuimteIntelligentUI
import RuimtePulsar
import XCTest

@testable import Ruimte

final class IntelligentUIPresentationTests: XCTestCase {
    func testChoiceJumpKeepsExactSourceAndRejectsIncompleteOrigins() throws {
        let origin = choice(itemID: "item", blockID: "block", revision: "revision")
        let jump = try XCTUnwrap(UiChoiceJump(origin))
        XCTAssertEqual(jump.itemID, "item")
        XCTAssertEqual(jump.blockID, "block")
        XCTAssertEqual(jump.revision, "revision")
        XCTAssertNotEqual(jump.nonce, UiChoiceJump(origin)?.nonce)
        XCTAssertNil(UiChoiceJump(choice(itemID: "item", blockID: "", revision: "")))
    }

    private func choice(itemID: String, blockID: String, revision: String) -> ChatUserItemUiChoice {
        ChatUserItemUiChoice(
            itemId: itemID, blockId: blockID, revision: revision, choiceId: "choice", label: "Yes", sourceAt: 0,
            older: false, at: 0)
    }

    private func node(_ json: String) throws -> UiNode {
        try XCTUnwrap(UiNode(JSONValue.decode(Data(json.utf8))))
    }

    /// A slider bound to `$count` and a summary that reads it, as the daemon compiles them.
    private let sliderBlock = #"""
        {"id":"b","catalogVersion":1,"start":0,"end":117,"complete":true,"defaults":{"$count":2},"queries":{},"revision":"r",
        "diagnostics":[],"fallback":"Count\nTotal 5","nodes":[
        {"id":"b:11","type":"Slider","props":{"min":0,"max":10},"expressions":{"value":{"kind":"reference","name":"$count"}},
        "bindings":{"value":"$count"},"complete":true,"fallback":"Count\n","start":11,"end":66,"children":[
        {"id":"b:52","type":"$text","props":{"text":"Count"},"expressions":{},"bindings":{},"children":[],"complete":true,"fallback":"Count","start":52,"end":57}]},
        {"id":"b:66","type":"Summary","props":{},"expressions":{},"bindings":{},"complete":true,"fallback":"Total\n","start":66,"end":117,"children":[
        {"id":"b:75","type":"$text","props":{"text":"Total "},"expressions":{},"bindings":{},"children":[],"complete":true,"fallback":"Total ","start":75,"end":81},
        {"id":"b:81","type":"$text","props":{},"expressions":{"text":{"kind":"reference","name":"$count"}},"bindings":{},"children":[],"complete":true,"fallback":"2","start":81,"end":107}]}]}
        """#

    func testWrittenTextIsProseAndAnExpressionStaysData() throws {
        let block = try JSONValue.decode(Data(sliderBlock.utf8))
        XCTAssertEqual(UiCatalog.writtenTexts(block["nodes"]?.arrayValue ?? []), ["b:52", "b:75"])
    }

    func testAPartThisVersionCannotDrawFallsBackAlone() throws {
        let unknown = try node(#"{"id":"x","type":"Gantt","props":{},"error":"unknown_component","fallback":"plan"}"#)
        let failed = try node(#"{"id":"y","type":"Stat","props":{},"error":"invalid_props","fallback":"Files"}"#)
        let fine = try node(#"{"id":"z","type":"Summary","props":{}}"#)
        XCTAssertEqual(UiFallbackProblem.of(unknown, catalogVersion: 1), .unknown("Gantt"))
        XCTAssertEqual(UiFallbackProblem.of(failed, catalogVersion: 1), .failed)
        XCTAssertNil(UiFallbackProblem.of(fine, catalogVersion: 1))
        XCTAssertEqual(UiFallbackProblem.of(fine, catalogVersion: 2), .unknown("Summary"))
    }

    func testAComponentFromANewerDaemonFallsBackAloneBesideItsSiblings() throws {
        let map = try node(
            #"{"id":"m","type":"Map","props":{"places":[]},"fallback":"Utrecht\nAmsterdam"}"#)
        let flagged = try node(
            #"{"id":"n","type":"Map","props":{},"error":"unknown_component","fallback":"Utrecht\nAmsterdam"}"#)
        let sibling = try node(#"{"id":"s","type":"Summary","props":{}}"#)
        XCTAssertEqual(UiFallbackProblem.of(map, catalogVersion: 1), .unknown("Map"))
        XCTAssertEqual(UiFallbackProblem.of(flagged, catalogVersion: 1), .unknown("Map"))
        XCTAssertEqual(map.fallback, "Utrecht\nAmsterdam")
        XCTAssertNil(UiFallbackProblem.of(sibling, catalogVersion: 1))
    }

    func testAWholeBlockReadsAsTextOnlyForItsOwnReasons() throws {
        let newer: JSONValue = .object(["catalogVersion": .number(2), "nodes": .array([])])
        XCTAssertEqual(UiBlockText.of(block: newer, evaluated: [], diagnostics: [], error: nil), .unreadable)
        let broken: JSONValue = .object([
            "catalogVersion": .number(1), "nodes": .array([]),
            "diagnostics": .array([.object(["code": .string("over_budget"), "message": .string("Too many nodes")])]),
        ])
        XCTAssertEqual(UiBlockText.of(block: broken, evaluated: [], diagnostics: [], error: nil), .tooLarge)
        let block = try JSONValue.decode(Data(sliderBlock.utf8))
        XCTAssertNil(UiBlockText.of(block: block, evaluated: [], diagnostics: [], error: nil))
    }

    func testTableColumnsComeFromColumnsOrFromTheRows() throws {
        let declared = try node(
            #"{"id":"t","type":"Table","props":{"rows":[{"name":"a","time":1200}]},"children":[{"id":"c1","type":"Column","props":{"key":"name"}},{"id":"c2","type":"Column","props":{"key":"time","as":"duration"}},{"id":"c3","type":"Column","props":{"key":"missing"}}]}"#
        )
        let columns = UiTableColumn.of(declared)
        XCTAssertEqual(columns.map(\.key), ["name", "time"])
        XCTAssertEqual(UiTableCell.of(.number(1200), column: columns[1]), .number(1200, .duration))
        XCTAssertEqual(UiTableCell.of(.string("soon"), column: columns[1]), .text("soon"))
        let derived = UiTableColumn.of(try node(#"{"id":"t","type":"Table","props":{"rows":[{"b":1,"a":"x"}]}}"#))
        XCTAssertEqual(derived.map(\.kind), [.text, .number])
    }

    func testChartsKeepSixSeriesAndSixtyRows() throws {
        let rows = (0..<70).map { #"{"label":"r\#($0)","a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7}"# }
        let chart = try XCTUnwrap(
            UiChartData(
                try node(#"{"id":"c","type":"Chart","props":{"kind":"bar","data":[\#(rows.joined(separator: ","))]}}"#))
        )
        XCTAssertEqual(chart.series.count, 6)
        XCTAssertEqual(chart.labels.count, 60)
        XCTAssertTrue(chart.truncated)
        XCTAssertEqual(chart.total, 70)
        XCTAssertEqual(chart.omitted, ["g"])
        XCTAssertEqual(chart.values.labels.count, 70)
        XCTAssertEqual(chart.values.series.count, 7)
        XCTAssertNil(UiChartData(try node(#"{"id":"c","type":"Chart","props":{"kind":"bar","data":[]}}"#)))
    }

    func testNegativeValuesAreDrawnAndNumbersTooLargeToScaleFallBack() throws {
        let stacked = try XCTUnwrap(
            UiChartData(
                try node(
                    #"{"id":"c","type":"Chart","props":{"kind":"stacked","data":[{"label":"Balance","income":10,"cost":-6}]}}"#
                )))
        XCTAssertEqual(stacked.kind, "bar")
        XCTAssertEqual(stacked.min, -6)
        let hbar = try XCTUnwrap(
            UiChartData(
                try node(#"{"id":"c","type":"Chart","props":{"kind":"hbar","data":[{"label":"Core","value":-3}]}}"#)))
        XCTAssertEqual(hbar.kind, "hbar")
        XCTAssertEqual(UiChartData.range(hbar.min, hbar.max), -5...0)
        XCTAssertNil(
            UiChartData(
                try node(#"{"id":"c","type":"Chart","props":{"kind":"bar","data":[{"label":"Huge","count":1.5e308}]}}"#)
            ))
    }

    func testAChoiceOffersItselfOnlyWhenTheHostWouldSendIt() throws {
        func choice(_ children: String, complete: Bool = true, error: String? = nil) throws -> UiNode {
            let failed = error.map { #","error":"\#($0)""# } ?? ""
            return try node(
                #"{"id":"c","type":"Choice","props":{},"complete":\#(complete)\#(failed),"children":[\#(children)]}"#)
        }
        let text = { (value: String) in #"{"id":"t","type":"$text","props":{"text":"\#(value)"},"complete":true}"# }
        XCTAssertEqual(try choice(text(" Run   checks ")).choiceLabel, "Run checks")
        XCTAssertNil(
            try choice(
                text("Run ") + "," + #"{"id":"e","type":"$text","props":{},"complete":true,"error":"unknown_variable"}"#
            ).choiceLabel)
        XCTAssertNil(try choice(text("  ")).choiceLabel)
        XCTAssertNil(try choice("").choiceLabel)
        XCTAssertNil(try choice(text("Run"), complete: false).choiceLabel)
        XCTAssertNil(try choice(text("Run"), error: "invalid_syntax").choiceLabel)
    }

    func testAScaleNeedsASpanItCanDivideBy() throws {
        XCTAssertNil(UiChartData.range(0, .leastNonzeroMagnitude))
        XCTAssertNil(UiChartData.range(0, 1e-310))
        XCTAssertNotNil(UiChartData.range(0, 1e-300))
        XCTAssertNil(
            UiChartData(
                try node(#"{"id":"c","type":"Chart","props":{"kind":"bar","data":[{"label":"Tiny","value":5e-324}]}}"#))
        )
    }

    func testDerivedTablesKeepEveryColumnAndFarDatesStayText() throws {
        let derived = UiTableColumn.of(
            try node(
                #"{"id":"t","type":"Table","props":{"rows":[{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8,"i":9}]}}"#
            ))
        XCTAssertEqual(derived.map(\.key), ["a", "b", "c", "d", "e", "f", "g", "h", "i"])
        let date = UiTableColumn(key: "at", title: "at", unit: nil, kind: .date)
        XCTAssertEqual(UiTableCell.of(.number(0), column: date), .date(0))
        XCTAssertEqual(UiTableCell.of(.number(1e20), column: date), .text(UiTableCell.textOf(.number(1e20))))
    }

    func testLiveStatusNamesTheSourceThatFailed() {
        let block: JSONValue = .object([
            "queries": .object([
                "$a": .object(["source": .string("git.status")]), "$b": .object(["source": .string("launch.status")]),
            ])
        ])
        let readings: [String: JSONValue] = [
            "$a": .object(["state": .string("fresh"), "readAt": .number(2_000)]),
            "$b": .object(["state": .string("failed"), "readAt": .number(3_000), "reason": .string("gone")]),
        ]
        let live = UiLiveStatus.of(block: block, order: ["$b", "$a"], readings: readings, reading: false)
        XCTAssertEqual(live?.state, .failed)
        XCTAssertEqual(live?.source, "launch.status")
        XCTAssertEqual(live?.sources, ["launch.status", "git.status"])
        XCTAssertEqual(live?.readAt, Date(timeIntervalSince1970: 2))
        XCTAssertEqual(live?.reason, "gone")
    }

    func testAKnownReasonCodeReadsInTheAppsWordsAndAnUnknownOneAsWritten() {
        XCTAssertEqual(
            UiReason.text(code: "timed-out", reason: "late"), String(localized: "The source took too long to answer."))
        XCTAssertEqual(UiReason.text(code: "from-a-newer-machine", reason: "As written"), "As written")
        XCTAssertNil(UiReason.text(code: nil, reason: nil))
    }

    private func reader(_ region: String = "nl_NL") -> FormatLocale {
        FormatLocale(
            region: Locale(identifier: region), language: Locale(identifier: "en"),
            timeZone: TimeZone(identifier: "Europe/Amsterdam")!)
    }

    func testAnEventTimeIsReadAsWrittenOrAsAnInstant() throws {
        let time = try XCTUnwrap(UiEventTime("14:05"))
        XCTAssertEqual(time.kind, .time)
        XCTAssertTrue(time.written)
        XCTAssertFalse(time.seconds)
        XCTAssertTrue(try XCTUnwrap(UiEventTime("15:41:55.123456789")).seconds)
        XCTAssertEqual(try XCTUnwrap(UiEventTime("2026-10-14")).kind, .date)
        XCTAssertEqual(try XCTUnwrap(UiEventTime("2026-10-14T14:05:30.250")).kind, .dateTime)
        XCTAssertFalse(try XCTUnwrap(UiEventTime("2026-10-14T14:05:30")).seconds)
        let offset = try XCTUnwrap(UiEventTime("2026-10-14T14:05:00+02:00"))
        XCTAssertFalse(offset.written)
        XCTAssertEqual(offset.date, ISO8601DateFormatter().date(from: "2026-10-14T12:05:00Z"))
        XCTAssertEqual(
            try XCTUnwrap(UiEventTime("2026-10-14T00:30:00-05:30")).date,
            ISO8601DateFormatter().date(from: "2026-10-14T06:00:00Z"))
        for good in ["-12:00", "+05:30", "+14:00"] {
            XCTAssertNotNil(UiEventTime("2026-10-14T12:00:00\(good)"), good)
        }
        for bad in ["-12:01", "-13:00", "+14:01", "+02:60", "+23:59"] {
            XCTAssertNil(UiEventTime("2026-10-14T12:00:00\(bad)"), bad)
        }
    }

    func testAnEventTimeThatNamesNoMomentIsNotRead() {
        for bad in [
            "", "2pm", "24:00", "14:60", "14:05:60", "14:05:3", "14:05:30.", "14:05:30Z", "9:05", "2026-02-30",
            "2026-13-01", "2026-10-14T25:00", "2026-10-14T14:05:61", "2026-10-14 14:05", "0050-01-01", "14:05Z",
            "14:05\n", "after lunch",
        ] {
            XCTAssertNil(UiEventTime(bad), bad)
        }
        XCTAssertNotNil(UiEventTime("2028-02-29"))
        XCTAssertNil(UiEventTime("2027-02-29"))
    }

    func testAnEventWritesItsTimeAsTheRegionDoesAndKeepsWhatItCannotRead() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-14T12:00:00Z"))
        func text(_ at: String, _ region: String = "nl_NL") -> String {
            UiEventTime.text(at, now: now, in: reader(region))
        }
        XCTAssertEqual(text("14:05"), "14:05")
        XCTAssertEqual(text("14:05", "en_US"), "02:05 PM")
        XCTAssertEqual(text("15:41:55"), "15:41:55")
        XCTAssertEqual(text("15:41:55.250"), "15:41:55")
        XCTAssertEqual(text("2026-03-02"), "2 Mar")
        XCTAssertEqual(text("2025-03-02"), "2 Mar 2025")
        XCTAssertEqual(text("2025-03-02T09:30"), "2 Mar 2025, 09:30")
        XCTAssertEqual(text("2027-06-01T12:00:00Z"), "1 Jun 2027, 14:00")
        // The clock change skips 02:30 in this zone; a time without an offset stays as written.
        XCTAssertEqual(text("2026-03-29T02:30"), "29 Mar, 02:30")
        XCTAssertEqual(text("after lunch"), "after lunch")
    }

    func testATextFieldIsCutAtItsLimitInTheUnitsTheInterpreterCounts() {
        XCTAssertEqual(UiTextLimit.clamp("Grace", to: 5), "Grace")
        XCTAssertEqual(UiTextLimit.clamp("Grace H", to: 5), "Grace")
        XCTAssertEqual(UiTextLimit.clamp("", to: 5), "")
        // An emoji is two units and a flag four; none is cut in half.
        XCTAssertEqual(UiTextLimit.clamp("ab😀c", to: 3), "ab")
        XCTAssertEqual(UiTextLimit.clamp("ab😀c", to: 4), "ab😀")
        XCTAssertEqual(UiTextLimit.clamp("🇳🇱🇳🇱", to: 6), "🇳🇱")
    }

    func testASelectNamesItselfByTheTextBesideItsOptions() throws {
        let select = try node(
            #"""
            {"id":"s","type":"Select","props":{"value":"a"},"children":[
            {"id":"s1","type":"Option","props":{"value":"a"},"children":[{"id":"t1","type":"$text","props":{"text":"Alpha"}}]},
            {"id":"t2","type":"$text","props":{"text":"  Pick a    mode "}}]}
            """#)
        XCTAssertEqual(select.ownLabel, "Pick a mode")
        XCTAssertEqual(select.label, "Alpha Pick a mode")
    }

    /// Every component the shared interpreter evaluates in the fixtures is one this version draws; a component the
    /// catalog gained and the renderer lacks would read as unknown here.
    func testEveryEvaluatedComponentOfTheFixturesIsOneTheAppDraws() throws {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "intelligent-ui-presentation", withExtension: "json"))
        let cases = try XCTUnwrap(JSONValue.decode(Data(contentsOf: url)).arrayValue)
        for fixture in cases {
            let name = fixture["name"]?.stringValue ?? ""
            func visit(_ list: [UiNode]) {
                for node in list where node.error == nil && !node.isText {
                    XCTAssertTrue(
                        UiCatalog.components.contains(node.type) || name == "unknown component", "\(name) \(node.type)")
                    visit(node.children)
                }
            }
            visit(UiNode.list(fixture["nodes"]?.arrayValue ?? []))
        }
    }

    /// Labels, table columns and chart data against the desktop's own functions, from fixtures the generator writes.
    func testTablesChartsAndLabelsMatchTheDesktop() throws {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "intelligent-ui-presentation", withExtension: "json"))
        let cases = try XCTUnwrap(JSONValue.decode(Data(contentsOf: url)).arrayValue)
        XCTAssertFalse(cases.isEmpty)
        for fixture in cases {
            let name = fixture["name"]?.stringValue ?? ""
            var nodes: [String: UiNode] = [:]
            func visit(_ list: [UiNode]) {
                for node in list {
                    nodes[node.id] = node
                    visit(node.children)
                }
            }
            visit(UiNode.list(fixture["nodes"]?.arrayValue ?? []))
            for (id, expected) in fixture["expected"]?.objectValue ?? [:] {
                let node = try XCTUnwrap(nodes[id], name)
                XCTAssertEqual(node.label, expected["label"]?.stringValue, "\(name) \(id)")
                if let columns = expected["columns"]?.arrayValue {
                    let actual = UiTableColumn.of(node)
                    let wanted = columns.map {
                        UiTableColumn(
                            key: $0["key"]?.stringValue ?? "", title: $0["title"]?.stringValue ?? "",
                            unit: $0["unit"]?.stringValue,
                            kind: UiTableColumn.Kind(rawValue: $0["as"]?.stringValue ?? "") ?? .text)
                    }
                    if node.children(of: "Column").isEmpty {
                        // Derived columns follow the rows' key order on the desktop; that order does not reach the app.
                        XCTAssertEqual(actual.sorted { $0.key < $1.key }, wanted.sorted { $0.key < $1.key }, name)
                    } else {
                        XCTAssertEqual(actual, wanted, name)
                    }
                }
                if let choiceLabel = expected["choiceLabel"] {
                    XCTAssertEqual(node.choiceLabel, choiceLabel.stringValue, "\(name) \(id)")
                }
                if let chart = expected["chart"] {
                    let actual = UiChartData(node)
                    guard let actual, chart != .null else {
                        XCTAssertEqual(actual == nil, chart == .null, name)
                        continue
                    }
                    XCTAssertEqual(actual.labels, chart["labels"]?.arrayValue?.compactMap(\.stringValue), name)
                    XCTAssertEqual(actual.min, chart["min"]?.numberValue, name)
                    XCTAssertEqual(actual.max, chart["max"]?.numberValue, name)
                    XCTAssertEqual(actual.truncated, chart["truncated"]?.boolValue, name)
                    XCTAssertEqual(actual.kind, chart["kind"]?.stringValue, name)
                    XCTAssertEqual(actual.total, chart["total"]?.numberValue.map { Int($0) }, name)
                    XCTAssertEqual(
                        Set(actual.omitted), Set(chart["omitted"]?.arrayValue?.compactMap(\.stringValue) ?? []), name)
                    var series: [String: [Double?]] = [:]
                    for entry in chart["series"]?.arrayValue ?? [] {
                        series[entry["key"]?.stringValue ?? ""] = (entry["values"]?.arrayValue ?? []).map(\.numberValue)
                    }
                    XCTAssertEqual(
                        Dictionary(uniqueKeysWithValues: actual.series.map { ($0.key, $0.values) }), series, name)
                }
            }
        }
    }

    @MainActor private func saveModel(
        list: @escaping @MainActor (String) throws -> JSONValue
    ) throws -> ImageSaveModel {
        let root: JSONValue = .object([
            "folder": .string("/work/ruimte"), "projectName": .string("ruimte"), "name": .string("rabbit.png"),
        ])
        return try ImageSaveModel(
            chatID: "c", attachmentID: "a", root: root,
            request: { _, payload in try list(payload["path"]?.stringValue ?? "") }, done: { _ in })
    }

    private func entries(_ names: [String], truncated: Bool = false) -> JSONValue {
        .object([
            "entries": .array(names.map { .object(["kind": .string("directory"), "name": .string($0)]) }),
            "truncated": .bool(truncated),
        ])
    }

    @MainActor func testTheFolderPickerStartsAtTheProjectRootAndNestsWhatIsOpen() async throws {
        struct Unreadable: Error, LocalizedError { var errorDescription: String? { "denied" } }
        let model = try saveModel { path in
            switch path {
            case "/work/ruimte": return self.entries(["docs", "assets"], truncated: true)
            case "/work/ruimte/assets": return self.entries([])
            default: throw Unreadable()
            }
        }
        XCTAssertEqual(
            ImageSaveFolderTree.rows(of: model, expanded: [""]).map(\.kind),
            [.folder(directory: "", name: "ruimte", expandable: true)])
        await model.loadFolders()
        await model.loadFolders("assets")
        await model.loadFolders("docs")
        let rows = ImageSaveFolderTree.rows(of: model, expanded: ["", "assets", "docs"])
        XCTAssertEqual(
            rows.map(\.kind),
            [
                .folder(directory: "", name: "ruimte", expandable: true),
                .folder(directory: "assets", name: "assets", expandable: false),
                .folder(directory: "docs", name: "docs", expandable: true),
                .failed(directory: "docs", message: "denied"),
                .truncated,
            ])
        XCTAssertEqual(rows.map(\.depth), [0, 1, 1, 2, 1])
        XCTAssertEqual(ImageSaveFolderTree.rows(of: model, expanded: []).count, 1)
    }

    @MainActor func testTheSaveHintNamesThePathUnderTheProject() throws {
        let model = try saveModel { _ in self.entries([]) }
        XCTAssertEqual(ImageSaveFolderTree.hint(model), "ruimte/rabbit.png")
        model.selectDirectory("assets/art")
        XCTAssertEqual(ImageSaveFolderTree.hint(model), "ruimte/assets/art/rabbit.png")
    }
}
