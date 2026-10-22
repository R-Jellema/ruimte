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

    func testTheSharedInfoPlistDeclaresTheMicrophoneForEveryConfiguration() throws {
        let plist = try Self.source("App/Info.plist")
        XCTAssertTrue(plist.contains(Self.key), "The Info.plist every configuration uses declares the microphone")
        let project = try Self.source("Ruimte.xcodeproj/project.pbxproj")
        XCTAssertFalse(project.contains("INFOPLIST_KEY_\(Self.key)"), "No configuration sets it apart from the others")
    }

    func testTheCameraAndTheBackgroundModesStay() throws {
        let plist = try Self.source("App/Info.plist")
        XCTAssertTrue(plist.contains("NSCameraUsageDescription"))
        XCTAssertTrue(plist.contains("<string>remote-notification</string>"))
        XCTAssertTrue(plist.contains("<string>fetch</string>"))
        XCTAssertTrue(plist.contains("<string>audio</string>"), "Voice goes on in the background and on a locked screen")
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
