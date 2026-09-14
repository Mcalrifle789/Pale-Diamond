import XCTest
@testable import RevenueSplit

final class RevenueSplitTests: XCTestCase {
    func testHalvesAlwaysReSum() {
        for cents in [0, 1, 99, 2000, 4500, 11500, 123457] {
            let split = RevenueSplit(grossCents: cents)
            XCTAssertEqual(split.ownerCents + split.apiFundingCents, split.grossCents)
        }
    }

    func testProPlanSplit() {
        let split = Plan.pro.monthlySplit          // $45.00
        XCTAssertEqual(split.grossCents, 4500)
        XCTAssertEqual(split.ownerCents, 2250)
        XCTAssertEqual(split.apiFundingCents, 2250)
    }

    func testNegativeIsClampedToZero() {
        let split = RevenueSplit(grossCents: -500)
        XCTAssertEqual(split, RevenueSplit(grossCents: 0))
    }
}
