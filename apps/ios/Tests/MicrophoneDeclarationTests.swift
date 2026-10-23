import Foundation
import XCTest

/// Every build declares Voice's microphone, Release included, so TestFlight and the App Store offer Voice. Reads the
/// sources as well, since a test only ever runs a Debug build.
final class MicrophoneDeclarationTests: XCTestCase {
    private static let key = "NSMicrophoneUsageDescription"
    private static let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()

    private static func source(_ path: String) throws -> String {
        try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
    }

    private static func plist(_ path: String) throws -> [String: Any] {
        let data = try Data(contentsOf: root.appendingPathComponent(path))
        return try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
    }

    func testTheSharedInfoPlistDeclaresTheMicrophoneForEveryConfiguration() throws {
        let plist = try Self.plist("App/Info.plist")
        XCTAssertFalse(
            try XCTUnwrap(plist[Self.key] as? String).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        let objects = try XCTUnwrap(
            Self.plist("Ruimte.xcodeproj/project.pbxproj")["objects"] as? [String: [String: Any]])
        let app = objects.values.filter {
            ($0["buildSettings"] as? [String: Any])?["PRODUCT_BUNDLE_IDENTIFIER"] as? String == "app.ruimte.mobile"
        }
        XCTAssertEqual(Set(app.compactMap { $0["name"] as? String }), ["Debug", "Release"])
        for configuration in app {
            let settings = try XCTUnwrap(configuration["buildSettings"] as? [String: Any])
            XCTAssertEqual(settings["INFOPLIST_FILE"] as? String, "App/Info.plist")
            XCTAssertNil(settings["INFOPLIST_KEY_\(Self.key)"])
        }
        let project = try Self.source("Ruimte.xcodeproj/project.pbxproj")
        XCTAssertFalse(project.contains("INFOPLIST_KEY_\(Self.key)"), "No configuration sets it apart from the others")
    }

    func testTheCameraAndTheBackgroundModesStay() throws {
        let plist = try Self.plist("App/Info.plist")
        XCTAssertFalse(try XCTUnwrap(plist["NSCameraUsageDescription"] as? String).isEmpty)
        let modes = try XCTUnwrap(plist["UIBackgroundModes"] as? [String])
        XCTAssertTrue(modes.contains("remote-notification"))
        XCTAssertTrue(modes.contains("fetch"))
        XCTAssertTrue(modes.contains("audio"), "Voice goes on in the background and on a locked screen")
    }

    func testTheMicrophonePromptHasItsWordsInBothLanguages() throws {
        let catalog = try Self.source("App/InfoPlist.xcstrings")
        let root = try JSONSerialization.jsonObject(with: Data(catalog.utf8)) as? [String: Any]
        let strings = try XCTUnwrap(root?["strings"] as? [String: Any])
        let entry = try XCTUnwrap(strings[Self.key] as? [String: Any])
        let localizations = try XCTUnwrap(entry["localizations"] as? [String: Any])
        XCTAssertNotNil(localizations["en"])
        XCTAssertNotNil(localizations["nl"])
    }

    func testThisBuildDeclaresTheMicrophone() {
        XCTAssertNotNil(Bundle.main.object(forInfoDictionaryKey: Self.key))
    }
}
