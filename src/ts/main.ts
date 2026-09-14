/**
 * Pale Diamond — application entry point.
 *
 * Boot order is deliberate: the interface is wired first so the page is usable
 * immediately, then the ad policy and the hero renderer start in the
 * background. Neither of those can block the page, and both degrade to
 * something sensible if their assets are missing.
 */

import { AdManager } from './ads.js';
import { AuthStore } from './auth.js';
import { DiamondHero } from './diamond.js';
import { initAnalytics, trackEvent } from './analytics.js';
import { mountUI } from './ui.js';
import { load as loadRules, evaluate, setting } from './omaris.js';

async function boot(): Promise<void> {
  initAnalytics();

  const auth = new AuthStore();
  mountUI(auth);

  // --- Ads ----------------------------------------------------------------
  const ads = new AdManager();
  await ads.init();
  auth.subscribe((session) => {
    ads.apply({
      plan: session?.plan ?? 'free',
      credits: session?.credits ?? 0,
      signedIn: session !== null,
    });
  });

  // --- Entitlements -------------------------------------------------------
  // The plan rules decide which class of model the backend is asked for. The
  // key itself never reaches the browser; this only picks the pool name.
  const planRules = await loadRules('rules/plans.oma');
  auth.subscribe((session) => {
    const decision = evaluate(planRules, {
      plan: session?.plan ?? 'free',
      credits: session?.credits ?? 0,
      signedIn: session !== null,
    });

    const banner = document.getElementById('model-class');
    if (banner) {
      banner.textContent = setting<string>(decision, 'modelClass', 'open-weight') === 'premium'
        ? 'Premium models'
        : 'Open-weight models';
    }

    document.documentElement.dataset.modelRoute = decision.route ?? '';
  });

  // --- Hero ---------------------------------------------------------------
  const canvas = document.getElementById('hero-canvas') as HTMLCanvasElement | null;
  if (canvas) {
    try {
      await new DiamondHero(canvas).start('assets/hero-diamond.png');
    } catch (error) {
      // A failed renderer must not take the page with it: the CSS gradient
      // behind the canvas is a complete fallback on its own.
      console.warn('[hero] renderer unavailable', error);
      canvas.hidden = true;
      document.body.classList.add('hero-static');
    }
  }

  document.body.classList.add('is-ready');
  trackEvent('page_view', { page_title: document.title });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot());
} else {
  void boot();
}
