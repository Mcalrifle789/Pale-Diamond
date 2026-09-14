/**
 * Ad surface.
 *
 * Layout follows the reference sketch:
 *   - two "black box" rail slots flanking the content column ($400/mo each).
 *     An ad shows up, stays for its dwell time, then moves to the next ad.
 *   - one "grey box" pop-up slot ($350/mo) the visitor can dismiss with the X.
 *
 * Slot visibility, dwell time and the pop-up delay are all decided by the
 * Omaris rules in public/rules/ads.oma, so ad policy is data, not code.
 *
 * Google AdSense is wired in through `mountGoogleSlot`: when a real ad client
 * is configured the house creative is replaced by an `<ins class="adsbygoogle">`
 * unit. Until then the house creatives stand in so the layout is reviewable.
 */

import { GOOGLE } from './config.js';
import type { AdCreative } from './types.js';
import { evaluate, load, setting, type OmarisDecision, type OmarisRule } from './omaris.js';
import { trackEvent } from './analytics.js';

const HOUSE_CREATIVES: AdCreative[] = [
  {
    id: 'house-01', advertiser: 'Aperture Studio', rate: 400,
    headline: 'Objects for focus', body: 'Desk tools made for long, quiet work.',
    cta: 'See the range', href: '#plans',
  },
  {
    id: 'house-02', advertiser: 'Northbound', rate: 400,
    headline: 'Ship on Fridays', body: 'Project tracking that stays out of the way.',
    cta: 'Try it free', href: '#plans',
  },
  {
    id: 'house-03', advertiser: 'Verra Type', rate: 400,
    headline: 'Typefaces with a point', body: 'Editorial families for teams that care.',
    cta: 'Browse fonts', href: '#plans',
  },
  {
    id: 'house-04', advertiser: 'Cold Harbour', rate: 400,
    headline: 'Coffee, measured', body: 'Single-origin subscriptions, ground to order.',
    cta: 'Start a box', href: '#plans',
  },
];

const POPUP_CREATIVE: AdCreative = {
  id: 'house-popup', advertiser: 'Meridian Books', rate: 350,
  headline: 'The long way in', body: 'A reading list for people who build things slowly and well.',
  cta: 'Read the list', href: '#plans',
};

const hasLiveAdClient = () => !!GOOGLE.adClient && !/^ca-pub-0+$/.test(GOOGLE.adClient);

/** Render a house creative into a slot element. */
function renderCreative(host: HTMLElement, creative: AdCreative, kind: 'rail' | 'popup'): void {
  host.innerHTML = '';

  const advertiser = document.createElement('span');
  advertiser.className = 'ad-advertiser';
  advertiser.textContent = creative.advertiser;

  const headline = document.createElement('strong');
  headline.className = 'ad-headline';
  headline.textContent = creative.headline;

  const body = document.createElement('p');
  body.className = 'ad-body';
  body.textContent = creative.body;

  const cta = document.createElement('a');
  cta.className = 'ad-cta';
  cta.href = creative.href;
  cta.textContent = creative.cta;
  cta.addEventListener('click', () => {
    trackEvent('ad_click', { creative_id: creative.id, slot: kind, value: creative.rate });
  });

  host.append(advertiser, headline, body, cta);
  trackEvent('ad_impression', { creative_id: creative.id, slot: kind, value: creative.rate });
}

/**
 * Swap a house slot for a real AdSense unit. Called only when a live ad client
 * is configured, so the reference layout stays intact during development.
 */
function mountGoogleSlot(host: HTMLElement, adSlotId: string): void {
  host.innerHTML = '';

  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.style.width = '100%';
  ins.style.height = '100%';
  ins.setAttribute('data-ad-client', GOOGLE.adClient);
  ins.setAttribute('data-ad-slot', adSlotId);
  ins.setAttribute('data-ad-format', 'auto');
  ins.setAttribute('data-full-width-responsive', 'true');
  host.appendChild(ins);

  const queue = ((window as unknown as { adsbygoogle?: unknown[] }).adsbygoogle ||= []);
  queue.push({});
}

/** A rail that cycles through creatives on a timer. */
class RailSlot {
  private index = 0;
  private timer: number | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly viewport: HTMLElement,
    private readonly creatives: AdCreative[],
    private readonly slotId: string,
  ) {}

  start(dwellMs: number, transition: string): void {
    this.stop();
    this.root.hidden = false;
    this.root.dataset.transition = transition;

    if (hasLiveAdClient()) {
      mountGoogleSlot(this.viewport, this.slotId);
      return;                                           // Google handles its own rotation
    }

    this.show(this.creatives[this.index], transition);
    if (transition === 'none') return;                  // reduced motion: hold one ad

    this.timer = window.setInterval(() => {
      this.index = (this.index + 1) % this.creatives.length;
      this.show(this.creatives[this.index], transition);
    }, dwellMs);
  }

  private show(creative: AdCreative, transition: string): void {
    if (transition === 'fade') {
      this.viewport.classList.add('is-swapping');
      window.setTimeout(() => {
        renderCreative(this.viewport, creative, 'rail');
        this.viewport.classList.remove('is-swapping');
      }, 320);
      return;
    }
    renderCreative(this.viewport, creative, 'rail');
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
  }

  hide(): void {
    this.stop();
    this.root.hidden = true;
  }
}

/** The dismissible grey pop-up. */
class PopupSlot {
  private timer: number | undefined;
  private dismissed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly viewport: HTMLElement,
    private readonly closeButton: HTMLButtonElement,
  ) {
    this.closeButton.addEventListener('click', () => this.dismiss());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.root.classList.contains('is-open')) this.dismiss();
    });
  }

  schedule(delayMs: number): void {
    this.cancel();
    if (this.dismissed) return;                         // the visitor already said no

    this.timer = window.setTimeout(() => {
      renderCreative(this.viewport, POPUP_CREATIVE, 'popup');
      this.root.classList.add('is-open');
      this.root.setAttribute('aria-hidden', 'false');
    }, delayMs);
  }

  private dismiss(): void {
    this.dismissed = true;                              // stays dismissed for the session
    this.cancel();
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    trackEvent('ad_dismiss', { creative_id: POPUP_CREATIVE.id, slot: 'popup' });
  }

  cancel(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  hide(): void {
    this.cancel();
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
  }
}

export class AdManager {
  private rules: OmarisRule[] = [];
  private readonly railLeft: RailSlot | null;
  private readonly railRight: RailSlot | null;
  private readonly popup: PopupSlot | null;

  constructor() {
    this.railLeft = this.buildRail('rail-left', 'left');
    this.railRight = this.buildRail('rail-right', 'right');
    this.popup = this.buildPopup();

    // Re-evaluate rules on resize: the side rails disappear on narrow screens.
    let resizeTimer: number | undefined;
    window.addEventListener('resize', () => {
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => this.apply(this.lastContext), 200);
    });
  }

  private lastContext: { plan: string; credits: number; signedIn: boolean } =
    { plan: 'free', credits: 0, signedIn: false };

  private buildRail(id: string, side: 'left' | 'right'): RailSlot | null {
    const root = document.getElementById(id);
    const viewport = root?.querySelector<HTMLElement>('.ad-viewport');
    if (!root || !viewport) return null;

    // Offset the right rail so the two rails never show the same creative.
    const ordered = side === 'right'
      ? [...HOUSE_CREATIVES.slice(2), ...HOUSE_CREATIVES.slice(0, 2)]
      : HOUSE_CREATIVES;

    return new RailSlot(root, viewport, ordered, side === 'left' ? '1111111111' : '2222222222');
  }

  private buildPopup(): PopupSlot | null {
    const root = document.getElementById('ad-popup');
    const viewport = root?.querySelector<HTMLElement>('.ad-viewport');
    const close = root?.querySelector<HTMLButtonElement>('.ad-popup-close');
    if (!root || !viewport || !close) return null;
    return new PopupSlot(root, viewport, close);
  }

  async init(): Promise<void> {
    this.rules = await load('rules/ads.oma');
    this.apply(this.lastContext);
  }

  /** Re-run the Omaris policy for the current visitor and reconfigure slots. */
  apply(context: { plan: string; credits: number; signedIn: boolean }): void {
    this.lastContext = context;

    const decision: OmarisDecision = evaluate(this.rules, {
      plan: context.plan,
      credits: context.credits,
      signedIn: context.signedIn,
      viewport: window.innerWidth,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });

    const dwellMs = setting(decision, 'railDwellMs', 9000);
    const transition = setting(decision, 'railTransition', 'fade');
    const popupDelayMs = setting(decision, 'popupDelayMs', 12000);

    const railLeftVisible = !decision.hidden.has('rail-left');
    const railRightVisible = !decision.hidden.has('rail-right');
    const popupVisible = !decision.hidden.has('popup');

    document.body.classList.toggle('has-rails', railLeftVisible || railRightVisible);

    if (this.railLeft) railLeftVisible ? this.railLeft.start(dwellMs, transition) : this.railLeft.hide();
    if (this.railRight) railRightVisible ? this.railRight.start(dwellMs, transition) : this.railRight.hide();
    if (this.popup) popupVisible ? this.popup.schedule(popupDelayMs) : this.popup.hide();
  }
}
