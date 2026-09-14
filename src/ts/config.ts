import type { Plan } from './types.js';

/**
 * Subscription tiers.
 *
 * Prices come directly from the product brief: Free (open-weight models only),
 * Plus $20, Pro $45, Mas $115, plus a pay-as-you-go credit option.
 */
export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    monthly: 0,
    tagline: 'Get a feel for what the agent can do.',
    features: ['Open-weight models', 'Core workspace', 'Limited daily runs'],
    openWeightOnly: true,
  },
  {
    id: 'plus',
    name: 'Plus',
    monthly: 20,
    tagline: 'For the work you want to move faster.',
    features: ['Premium model access', 'Unlimited workspace', 'Priority execution'],
    openWeightOnly: false,
    featured: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 45,
    tagline: 'For people building at full speed.',
    features: ['All premium models', 'Advanced automations', 'Private routing'],
    openWeightOnly: false,
  },
  {
    id: 'mas',
    name: 'Mas',
    monthly: 115,
    tagline: 'For teams and ambitious operators.',
    features: ['Everything in Pro', 'Shared workspaces', 'Highest priority'],
    openWeightOnly: false,
  },
];

/** Pay-as-you-go credit bundles. */
export const CREDIT_BUNDLES = [
  { usd: 10, credits: 100 },
  { usd: 25, credits: 275 },
  { usd: 50, credits: 600 },
];

/** Yearly billing discount shown on the pricing toggle. */
export const YEARLY_DISCOUNT = 0.2;

/**
 * Backend base URL. On GitHub Pages there is no server, so the front end runs
 * in demo mode and persists the session locally. Point this at the deployed
 * Python API (src/python) to enable real accounts.
 */
export const API_BASE: string | null =
  (document.documentElement.dataset.apiBase || '').trim() || null;

/** Google Ads / Google Tag identifiers. Replace with live IDs before launch. */
export const GOOGLE = {
  adClient: 'ca-pub-0000000000000000',
  tagId: 'G-XXXXXXXXXX',
};
