# Pale Diamond — Swift `RevenueSplit`

The authoritative money model, as a small Swift package. Every payment is split
in half — owner / API funding — the same rule as `src/ts/billing.ts` and
`src/python/billing.py`. This package exists so a future native (iOS/macOS)
client shares one definition of the split instead of re-deriving it.

## Build & test

```bash
cd src/swift
swift build
swift test
```

## API

```swift
import RevenueSplit

let split = Plan.pro.monthlySplit      // $45.00
split.ownerCents        // 2250
split.apiFundingCents   // 2250

Billing.split(usd: 20)  // RevenueSplit for a $20 payment
```

`ownerCents + apiFundingCents` always equals `grossCents`.
