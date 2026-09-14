/**
 * Interface behaviour: pricing cards, the auth dialog, the pay-as-you-go
 * sheet, toasts and the header state.
 *
 * Dialogs follow the Apple HIG guidance the brief calls for: a single clear
 * primary action, focus moved into the dialog on open and returned to the
 * trigger on close, Escape to dismiss, and a focus trap while open.
 */

import { CREDIT_BUNDLES, PLANS, YEARLY_DISCOUNT } from './config.js';
import { AuthError, type AuthMode, type AuthStore } from './auth.js';
import { splitRevenue } from './billing.js';
import type { PlanId, Session } from './types.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

// --- Toast -----------------------------------------------------------------

let toastTimer: number | undefined;

export function toast(message: string): void {
  const element = document.querySelector<HTMLElement>('.toast');
  if (!element) return;

  element.textContent = message;
  element.classList.add('is-visible');

  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove('is-visible'), 3600);
}

// --- Dialog ----------------------------------------------------------------

class Dialog {
  private lastFocused: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', (event) => {
      if (event.target === root) this.close();          // click the scrim
    });

    root.querySelectorAll<HTMLButtonElement>('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => this.close());
    });

    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { this.close(); return; }
      if (event.key !== 'Tab') return;

      // Keep focus inside the dialog while it is open.
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  get isOpen(): boolean { return this.root.classList.contains('is-open'); }

  open(): void {
    this.lastFocused = document.activeElement as HTMLElement | null;
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');

    const target = this.root.querySelector<HTMLElement>('input, button:not([data-close-dialog])');
    window.setTimeout(() => target?.focus(), 60);
  }

  close(): void {
    if (!this.isOpen) return;

    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
    this.lastFocused?.focus();
  }
}

// --- Pricing ---------------------------------------------------------------

const money = (value: number) =>
  value === 0 ? '$0' : '$' + (Number.isInteger(value) ? value : value.toFixed(2));

function renderPlans(auth: AuthStore, onChoose: (plan: PlanId) => void): void {
  const grid = document.getElementById('plan-grid');
  if (!grid) return;

  let yearly = false;

  const paint = () => {
    grid.innerHTML = '';

    for (const plan of PLANS) {
      // Yearly billing shows the discounted monthly-equivalent price.
      const price = yearly ? plan.monthly * (1 - YEARLY_DISCOUNT) : plan.monthly;
      const split = splitRevenue(plan.monthly);

      const card = document.createElement('article');
      card.className = 'plan-card glass' + (plan.featured ? ' is-featured' : '');
      if (auth.plan === plan.id && auth.signedIn) card.classList.add('is-current');

      const badge = plan.featured ? '<div class="plan-badge">MOST POPULAR</div>' : '';
      const current = auth.signedIn && auth.plan === plan.id;
      const note = plan.openWeightOnly
        ? 'Routed to open-weight models.'
        : 'Half of every payment funds the routing key.';

      card.innerHTML =
        badge +
        '<span class="plan-eyebrow">' + plan.name.toUpperCase() + '</span>' +
        '<h3>' + plan.tagline + '</h3>' +
        '<div class="plan-price"><b>' + money(price) + '</b><span>' +
          (plan.monthly === 0 ? '/ forever' : yearly ? '/ mo, billed yearly' : '/ month') +
        '</span></div>' +
        '<button class="plan-button' + (plan.featured ? ' is-primary' : '') + '"' +
          (current ? ' disabled' : '') + ' data-plan="' + plan.id + '">' +
          (current ? 'Your plan' : plan.monthly === 0 ? 'Start free' : 'Choose ' + plan.name) +
        '</button>' +
        '<ul>' + plan.features.map((f) => '<li>' + f + '</li>').join('') + '</ul>' +
        '<p class="plan-note" title="Owner ' + money(split.owner) + ' / API funding ' +
          money(split.apiFunding) + '">' + note + '</p>';

      card.querySelector<HTMLButtonElement>('[data-plan]')
        ?.addEventListener('click', () => onChoose(plan.id));

      grid.appendChild(card);
    }
  };

  document.querySelectorAll<HTMLButtonElement>('[data-billing]').forEach((button) => {
    button.addEventListener('click', () => {
      yearly = button.dataset.billing === 'yearly';
      document.querySelectorAll('[data-billing]').forEach((other) => {
        other.classList.toggle('is-active', other === button);
      });
      paint();
    });
  });

  auth.subscribe(() => paint());
}

// --- Auth dialog -----------------------------------------------------------

function wireAuthDialog(auth: AuthStore): (mode: AuthMode) => void {
  const root = document.getElementById('auth-dialog');
  if (!root) return () => {};

  const dialog = new Dialog(root);
  const form = root.querySelector<HTMLFormElement>('#auth-form')!;
  const email = root.querySelector<HTMLInputElement>('#auth-email')!;
  const password = root.querySelector<HTMLInputElement>('#auth-password')!;
  const submit = root.querySelector<HTMLButtonElement>('#auth-submit')!;
  const title = root.querySelector<HTMLElement>('#auth-title')!;
  const subtitle = root.querySelector<HTMLElement>('#auth-subtitle')!;
  const switchCopy = root.querySelector<HTMLElement>('#auth-switch-copy')!;
  const switchButton = root.querySelector<HTMLButtonElement>('#auth-switch')!;
  const error = root.querySelector<HTMLElement>('#auth-error')!;

  let mode: AuthMode = 'signup';
  /** Plan the visitor picked before signing in; applied once they have an account. */
  let pendingPlan: PlanId | null = null;

  const paint = () => {
    const signup = mode === 'signup';
    title.textContent = signup ? 'Create your workspace' : 'Welcome back';
    subtitle.textContent = signup
      ? 'A private space for your work. No card required.'
      : 'Sign in to pick up where you left off.';
    submit.textContent = signup ? 'Create account' : 'Sign in';
    switchCopy.textContent = signup ? 'Already have an account?' : 'New to Pale Diamond?';
    switchButton.textContent = signup ? 'Sign in' : 'Create one';
    password.autocomplete = signup ? 'new-password' : 'current-password';
    error.textContent = '';
  };

  switchButton.addEventListener('click', () => {
    mode = mode === 'signup' ? 'signin' : 'signup';
    paint();
    email.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true;

    try {
      await auth.authenticate(mode, email.value.trim(), password.value);

      if (pendingPlan && pendingPlan !== 'free') {
        await auth.setPlan(pendingPlan);
        toast('You are on the ' + pendingPlan.toUpperCase() + ' plan.');
      } else {
        toast(mode === 'signup' ? 'Workspace created.' : 'Signed in.');
      }

      pendingPlan = null;
      form.reset();
      dialog.close();
    } catch (caught) {
      error.textContent = caught instanceof AuthError
        ? caught.message
        : 'Something went wrong. Try again.';
    } finally {
      submit.disabled = false;
    }
  });

  root.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach((button) => {
    button.addEventListener('click', () => {
      toast(button.dataset.provider + ' sign-in is not connected yet.');
    });
  });

  return (requested: AuthMode, plan?: PlanId) => {
    mode = requested;
    pendingPlan = plan ?? null;
    paint();
    dialog.open();
  };
}

// --- Pay as you go ---------------------------------------------------------

function wirePaygoDialog(auth: AuthStore, requireAccount: () => void): () => void {
  const root = document.getElementById('paygo-dialog');
  if (!root) return () => {};

  const dialog = new Dialog(root);
  const options = root.querySelector<HTMLElement>('#credit-options')!;

  for (const bundle of CREDIT_BUNDLES) {
    const split = splitRevenue(bundle.usd);
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML =
      '<strong>' + money(bundle.usd) + '</strong><span>' + bundle.credits + ' credits</span>' +
      '<em>' + money(split.apiFunding) + ' funds routing</em>';

    button.addEventListener('click', async () => {
      try {
        await auth.addCredits(bundle.credits, bundle.usd);
        toast(bundle.credits + ' credits added.');
        dialog.close();
      } catch {
        dialog.close();
        requireAccount();
      }
    });

    options.appendChild(button);
  }

  return () => dialog.open();
}

// --- Header ----------------------------------------------------------------

function wireHeader(auth: AuthStore, openAuth: (mode: AuthMode) => void): void {
  const signIn = document.getElementById('header-signin') as HTMLButtonElement | null;
  const cta = document.getElementById('header-cta') as HTMLButtonElement | null;
  const account = document.getElementById('header-account');
  const accountEmail = document.getElementById('account-email');
  const accountPlan = document.getElementById('account-plan');
  const signOut = document.getElementById('header-signout');

  const paint = (session: Session | null) => {
    const signedIn = session !== null;

    if (signIn) signIn.hidden = signedIn;
    if (cta) cta.hidden = signedIn;
    if (account) account.hidden = !signedIn;

    if (session) {
      if (accountEmail) accountEmail.textContent = session.email;
      if (accountPlan) {
        accountPlan.textContent = session.plan.toUpperCase()
          + (session.credits > 0 ? ' · ' + session.credits + ' credits' : '');
      }
    }
  };

  signIn?.addEventListener('click', () => openAuth('signin'));
  cta?.addEventListener('click', () => openAuth('signup'));
  signOut?.addEventListener('click', async () => {
    await auth.signOut();
    toast('Signed out.');
  });

  auth.subscribe(paint);

  // Header gains a solid background once the page scrolls.
  const header = document.querySelector('.site-header');
  const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const menu = document.querySelector<HTMLButtonElement>('.menu-button');
  menu?.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    menu.setAttribute('aria-expanded', String(open));
  });

  document.querySelectorAll('.main-nav a').forEach((link) => {
    link.addEventListener('click', () => document.body.classList.remove('nav-open'));
  });
}

// --- Reveal on scroll ------------------------------------------------------

function wireReveals(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    targets.forEach((element) => element.classList.add('is-revealed'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-revealed');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  targets.forEach((element) => observer.observe(element));
}

// --- Entry point -----------------------------------------------------------

export function mountUI(auth: AuthStore): void {
  const openAuth = wireAuthDialog(auth);
  const openPaygo = wirePaygoDialog(auth, () => openAuth('signup'));

  wireHeader(auth, openAuth);
  wireReveals();

  renderPlans(auth, async (plan) => {
    if (!auth.signedIn) {
      // Remember the choice and collect it after the account exists.
      (openAuth as (mode: AuthMode, plan?: PlanId) => void)('signup', plan);
      return;
    }

    try {
      await auth.setPlan(plan);
      toast(plan === 'free' ? 'Switched to the free plan.' : 'You are on the ' + plan.toUpperCase() + ' plan.');
    } catch (error) {
      toast(error instanceof AuthError ? error.message : 'Could not update your plan.');
    }
  });

  document.querySelectorAll<HTMLButtonElement>('[data-open-auth]').forEach((button) => {
    button.addEventListener('click', () => openAuth(button.dataset.openAuth as AuthMode));
  });

  document.querySelectorAll<HTMLButtonElement>('[data-open-paygo]').forEach((button) => {
    button.addEventListener('click', openPaygo);
  });
}
