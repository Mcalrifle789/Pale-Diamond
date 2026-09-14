/** Shared domain types for the Pale Diamond front end. */

export type PlanId = 'free' | 'plus' | 'pro' | 'mas';

export interface Plan {
  id: PlanId;
  /** Display name shown on the pricing card. */
  name: string;
  /** Monthly price in whole US dollars. */
  monthly: number;
  tagline: string;
  features: string[];
  /** Free tier is routed to open-weight models instead of premium ones. */
  openWeightOnly: boolean;
  featured?: boolean;
}

export interface Session {
  email: string;
  plan: PlanId;
  /** Usage credits bought through the pay-as-you-go flow. */
  credits: number;
  createdAt: string;
}

/** A single ad slot as drawn in the reference layout. */
export type AdSlotKind = 'rail' | 'popup';

export interface AdCreative {
  id: string;
  advertiser: string;
  headline: string;
  body: string;
  cta: string;
  href: string;
  /** Monthly rate card value for the slot, per the reference sketch. */
  rate: number;
}

export interface AdSlot {
  kind: AdSlotKind;
  element: HTMLElement;
  /** Milliseconds an ad rests before rotating to the next one. */
  dwellMs: number;
}

/** Revenue split applied to every payment (see src/swift/RevenueSplit). */
export interface RevenueSplit {
  gross: number;
  owner: number;
  apiFunding: number;
}
