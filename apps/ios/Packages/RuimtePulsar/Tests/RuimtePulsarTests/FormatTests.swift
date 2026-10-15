import Foundation
import Testing

@testable import RuimtePulsar

/// The cases of `@adecore/ui/format`'s own tests, so the phone and the desktop write the same thing.
struct FormatTests {
    private let zone = TimeZone(identifier: "Europe/Amsterdam")!

    private func region(_ region: String, language: String = "en") -> FormatLocale {
        FormatLocale(region: Locale(identifier: region), language: Locale(identifier: language), timeZone: zone)
    }

    private var dutch: FormatLocale { region("nl_NL") }
    private var american: FormatLocale { region("en_US") }

    private func date(_ day: Int, _ hour: Int, _ minute: Int) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour, minute: minute))!
    }

    private var at: Date { date(19, 8, 5) }

    private let minute = 60_000.0
    private var hour: Double { 60 * minute }
    private var day: Double { 24 * hour }

    @Test func aNumberGroupsAndSeparatesTheWayTheRegionWritesOne() {
        #expect(Format.number(1_234_567, in: dutch) == "1.234.567")
        #expect(Format.decimal(1.5, in: dutch) == "1,5")
        #expect(Format.number(1_234_567, in: american) == "1,234,567")
        #expect(Format.decimal(1.5, in: american) == "1.5")
    }

    @Test func aNumberKeepsTheDecimalOnlyWhereItStillSaysSomething() {
        #expect(Format.percent(8.5, in: dutch) == "8,5%")
        #expect(Format.percent(42.4, in: dutch) == "42%")
    }

    @Test func aFixedPrecisionCarriesEveryPlaceAlsoATrailingZero() {
        #expect(Format.fixed(1, decimals: 1, in: dutch) == "1,0")
        #expect(Format.fixed(1.25, decimals: 2, in: dutch) == "1,25")
        #expect(Format.fixed(2, decimals: 0, in: dutch) == "2")
        #expect(Format.fixed(1.5, decimals: 2, in: american) == "1.50")
    }

    @Test func aTokenCountIsReadAsASize() {
        #expect(Format.tokens(640, in: american) == "640")
        #expect(Format.tokens(412_000, in: american) == "412K")
        #expect(Format.tokens(1_240_000, in: american) == "1.2M")
        #expect(Format.tokens(11_900_000, in: american) == "12M")
        #expect(Format.tokens(1_240_000, in: dutch) == "1,2M")
    }

    @Test func moneyWearsThePlainSymbolOfItsCurrencyInEveryRegion() {
        #expect(Format.money(5480.96, currency: "USD", in: dutch) == "$\u{00a0}5.480,96")
        #expect(Format.money(5480.96, currency: "EUR", in: dutch) == "€\u{00a0}5.480,96")
        #expect(Format.money(5480.96, currency: "USD", in: american) == "$5,480.96")
        #expect(Format.money(0.0032, currency: "USD", maximumFractionDigits: 4, in: dutch) == "$\u{00a0}0,0032")
    }

    @Test func aSizeCarriesOneDecimalUnderTenAndWholeBytesBelowAKilobyte() {
        #expect(Format.bytes(1536, in: dutch) == "1,5 KB")
        #expect(Format.bytes(1024 * 1024 * 42, in: dutch) == "42 MB")
        #expect(Format.bytes(512, in: american) == "512 B")
        #expect(Format.bytes(1536, whole: true, in: american) == "2 KB")
    }

    @Test func dollarsToSignificantDigitsKeepWhatACentWouldRoundAway() {
        #expect(Format.usdSignificant(0.004, in: american) == "$0.004")
        #expect(Format.usdSignificant(0.0683, in: american) == "$0.0683")
        #expect(Format.usdSignificant(7.634, in: american) == "$7.63")
        #expect(Format.usdSignificant(10, in: american) == "$10")
        #expect(Format.usdSignificant(0.55, in: dutch) == "$\u{00a0}0,55")
    }

    @Test func aFigureToAtMostSomeDecimalsDropsTheFractionThatIsNotThere() {
        #expect(Format.rounded(39, decimals: 2, in: dutch) == "39")
        #expect(Format.rounded(1.95, decimals: 2, in: dutch) == "1,95")
        #expect(Format.rounded(1.998, decimals: 2, in: dutch) == "2")
        #expect(Format.rounded(1234.5, decimals: 2, in: american) == "1,234.5")
    }

    @Test func howLongSomethingTookClimbsToTheCoarsestUnit() {
        #expect(Format.duration(milliseconds: 30_000, in: american) == "30 s")
        #expect(Format.duration(milliseconds: 5 * minute, in: american) == "5 min")
        #expect(Format.duration(milliseconds: 90 * minute, in: american) == "1.5 h")
        #expect(Format.duration(milliseconds: 90 * minute, in: dutch) == "1,5 h")
    }

    @Test func howLongSomethingHasBeenRunningIsTwoUnitsAtATime() {
        #expect(Format.elapsedShort(milliseconds: 12_400) == "12s")
        #expect(Format.elapsedShort(milliseconds: 120_000) == "2m")
        #expect(Format.elapsedShort(milliseconds: 125_000) == "2m 5s")
        #expect(Format.elapsedShort(milliseconds: 3_780_000) == "1h 3m")
        #expect(Format.elapsedShort(milliseconds: 2 * hour) == "2h")
        #expect(Format.elapsedShort(milliseconds: 400) == "1s")
        #expect(Format.elapsedShort(milliseconds: 0) == "0s")
        #expect(Format.elapsedShort(milliseconds: -5) == "0s")
    }

    @Test func aStopwatchFloorsItsSecondsAndNeverRunsBackwards() {
        #expect(Format.clockDuration(milliseconds: 14_000) == "00:14")
        #expect(Format.clockDuration(milliseconds: hour + 2 * minute + 3_000) == "1:02:03")
        #expect(Format.clockDuration(milliseconds: 14_900) == "00:14")
        #expect(Format.clockDuration(milliseconds: -1_000) == "00:00")
    }

    @Test func howLongAWindowStillHasNeverCountsDownToZeroMinutes() {
        #expect(Format.countdown(milliseconds: 4 * day + 3 * hour, in: dutch) == "4d 3h")
        #expect(Format.countdown(milliseconds: 12 * hour + 8 * minute, in: dutch) == "12h 8m")
        #expect(Format.countdown(milliseconds: 9 * minute, in: dutch) == "9m")
        #expect(Format.countdown(milliseconds: 10_000, in: dutch) == "1m")
        #expect(Format.countdown(milliseconds: 0, in: dutch) == "1m")
    }

    @Test func howLongAgoIsWrittenInTheLanguageOfTheApp() {
        #expect(Format.ago(milliseconds: 30_000, in: american) == "now")
        #expect(Format.ago(milliseconds: 3 * minute, in: american) == "3m ago")
        #expect(Format.ago(milliseconds: 5 * hour, in: american) == "5h ago")
        #expect(Format.ago(milliseconds: 9 * day, in: american) == "9d ago")
        #expect(Format.ago(milliseconds: -5000, in: american) == "now")
        let inDutch = region("nl_NL", language: "nl")
        #expect(Format.ago(milliseconds: 30_000, in: inDutch) == "nu")
        #expect(Format.ago(milliseconds: 3 * minute, in: inDutch) == "3 min. geleden")
        #expect(Format.ago(milliseconds: 5 * hour, in: inDutch) == "5 uur geleden")
    }

    @Test func aClockCountsToTwentyFourOrSaysAMWhereTheRegionDoes() {
        #expect(Format.clock(at, in: dutch) == "08:05")
        #expect(Format.clock(at, in: american) == "08:05 AM")
        #expect(Format.hour(at, in: dutch) == "08")
        #expect(Format.hour(at, in: american) == "8 AM")
        #expect(Format.clockSeconds(at, in: dutch) == "08:05:00")
        #expect(Format.clockSeconds(at, in: american) == "08:05:00 AM")
    }

    @Test func aDateIsOrderedByTheRegionAndWordedInTheLanguage() {
        #expect(Format.day(at, in: dutch) == "19 Sep")
        #expect(Format.dayWithYear(at, in: dutch) == "19 Sep 2026")
        #expect(Format.weekdayDay(at, in: dutch) == "Sat 19 Sep")
        #expect(Format.dayClock(at, in: dutch) == "19 Sep, 08:05")
        #expect(Format.dayClockWithYear(at, in: dutch) == "19 Sep 2026, 08:05")
        #expect(Format.day(at, in: american) == "Sep 19")
        #expect(Format.weekdayDay(at, in: american) == "Sat, Sep 19")
        #expect(Format.numericDate(at, in: dutch) == "19-9-2026")
        #expect(Format.numericDate(at, in: american) == "9/19/2026")
        let inDutch = region("nl_NL", language: "nl")
        #expect(Format.day(at, in: inDutch) == "19 sep")
        #expect(Format.weekdayDay(at, in: inDutch) == "za 19 sep")
        #expect(Format.clock(at, in: inDutch) == "08:05")
    }

    @Test func aMomentIsTheTimeAloneTodayAndCarriesItsDayOnceItWasNot() {
        #expect(Format.moment(at, now: date(19, 22, 0), in: dutch) == "08:05")
        #expect(Format.moment(at, now: date(20, 9, 0), in: dutch) == "19 Sep, 08:05")
        #expect(Format.isSameDay(date(19, 23, 59), date(19, 0, 1), in: dutch))
        #expect(!Format.isSameDay(date(19, 23, 59), date(20, 0, 1), in: dutch))
    }
}
