/**
 * Revenue split, front-end copy.
 *
 * Every payment is divided in half: one half to the owner, the other half funds
 * the routing API key that talks to OpenRouter. The authoritative ledger lives
 * in the Swift service (src/swift/Sources/RevenueSplit); this exists so the
 * pricing cards can show the same numbers without a round trip.
 *
 * Keep `OWNER_SHARE` in step with `RevenueSplit.ownerShare` on the Swift side.
 */

import type { RevenueSplit } from './types.js';

/** Owner's share of gross revenue. */
export const OWNER_SHARE = 0.5;

/** Round to whole cents, avoiding the usual binary-float drift. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Split a gross payment.
 *
 * The owner's half is rounded to the cent and the remainder goes to API
 * funding, so the two parts always add back up to the gross exactly.
 */
export function splitRevenue(gross: number): RevenueSplit {
  const safe = Math.max(0, toCents(gross));
  const owner = toCents(safe * OWNER_SHARE);

  return { gross: safe, owner, apiFunding: toCents(safe - owner) };
}
