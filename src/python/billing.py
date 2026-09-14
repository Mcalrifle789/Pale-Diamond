"""Revenue split, backend side.

Authoritative money math. Every payment is halved: one half to the owner, the
other half funds the OpenRouter routing key. This is the same rule as
``src/ts/billing.ts`` and ``src/swift`` — kept in three places on purpose, so
the UI, the ledger, and the native client never disagree about a total.

All amounts are handled in integer cents to avoid floating-point drift.
"""

from __future__ import annotations

from dataclasses import dataclass

OWNER_SHARE = 0.5

# Plan monthly prices in whole US dollars (from the product brief).
PLAN_PRICES = {"free": 0, "plus": 20, "pro": 45, "mas": 115}

# Pay-as-you-go bundles: dollars -> credits (mirrors config.ts CREDIT_BUNDLES).
CREDIT_BUNDLES = {10: 100, 25: 275, 50: 600}


@dataclass(frozen=True)
class RevenueSplit:
    gross_cents: int
    owner_cents: int
    api_funding_cents: int


def split_revenue(gross_cents: int) -> RevenueSplit:
    """Split a gross payment (in cents). The two halves always re-sum exactly."""
    gross = max(0, int(gross_cents))
    owner = round(gross * OWNER_SHARE)
    return RevenueSplit(gross_cents=gross, owner_cents=owner, api_funding_cents=gross - owner)


def credits_for_usd(usd: int) -> int:
    """Credits granted for a pay-as-you-go top-up, or 0 for an unknown bundle."""
    return CREDIT_BUNDLES.get(int(usd), 0)
