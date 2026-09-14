// RevenueSplit — the authoritative money model for Pale Diamond.
//
// Every payment is divided in half: one half to the owner, the other half funds
// the hidden OpenRouter routing key. This is the same rule enforced in
// `src/ts/billing.ts` (UI copy) and `src/python/billing.py` (ledger). Keeping it
// here as well means a future native client shares one source of truth for the
// split instead of re-deriving it.
//
// All amounts are integer cents to avoid floating-point drift.

import Foundation

/// The owner's share of every gross payment.
public let ownerShare = 0.5

/// The result of dividing a single payment.
public struct RevenueSplit: Equatable {
    /// Total charged, in cents.
    public let grossCents: Int
    /// The owner's half, in cents (rounded to the cent).
    public let ownerCents: Int
    /// The remainder that funds the API key, in cents.
    public let apiFundingCents: Int

    /// `ownerCents + apiFundingCents` always equals `grossCents`.
    public init(grossCents: Int) {
        let gross = max(0, grossCents)
        let owner = Int((Double(gross) * ownerShare).rounded())
        self.grossCents = gross
        self.ownerCents = owner
        self.apiFundingCents = gross - owner
    }
}

/// Subscription tiers, mirroring the product brief and `config.ts`.
public enum Plan: String, CaseIterable {
    case free, plus, pro, mas

    /// Monthly price in whole US dollars.
    public var monthlyUSD: Int {
        switch self {
        case .free: return 0
        case .plus: return 20
        case .pro:  return 45
        case .mas:  return 115
        }
    }

    /// The split applied to one month of this plan.
    public var monthlySplit: RevenueSplit {
        RevenueSplit(grossCents: monthlyUSD * 100)
    }
}

public enum Billing {
    /// Split an arbitrary gross payment given in whole dollars.
    public static func split(usd: Int) -> RevenueSplit {
        RevenueSplit(grossCents: usd * 100)
    }
}
