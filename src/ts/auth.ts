/**
 * Account handling for the front end.
 *
 * Two modes:
 *   - API mode  — when `data-api-base` is set on <html>, sign-up / sign-in hit
 *     the Python service in src/python, which owns the database and the
 *     OpenRouter key.
 *   - Demo mode — on GitHub Pages there is no backend, so the session lives in
 *     localStorage. This lets the whole interface be reviewed without a server.
 *
 * No password ever reaches localStorage; in demo mode only the email and plan
 * are stored.
 */

import { API_BASE } from './config.js';
import type { PlanId, Session } from './types.js';
import { trackEvent } from './analytics.js';

const STORAGE_KEY = 'pale-diamond.session';

export type AuthMode = 'signin' | 'signup';

export class AuthError extends Error {}

function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed.email) return null;

    return {
      email: parsed.email,
      plan: (parsed.plan ?? 'free') as PlanId,
      credits: Number(parsed.credits ?? 0),
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    };
  } catch {
    return null;                                        // corrupt entry: start fresh
  }
}

function writeStoredSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing can refuse writes; the session simply won't persist.
  }
}

/** Minimal client-side checks. The backend re-validates everything. */
export function validateCredentials(email: string, password: string, mode: AuthMode): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError('Enter a valid email address.');
  }
  if (mode === 'signup' && password.length < 8) {
    throw new AuthError('Use at least 8 characters for your password.');
  }
  if (!password) {
    throw new AuthError('Enter your password.');
  }
}

type Listener = (session: Session | null) => void;

export class AuthStore {
  private session: Session | null = readStoredSession();
  private readonly listeners = new Set<Listener>();

  get current(): Session | null { return this.session; }
  get signedIn(): boolean { return this.session !== null; }
  get plan(): PlanId { return this.session?.plan ?? 'free'; }
  get credits(): number { return this.session?.credits ?? 0; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.session);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    writeStoredSession(this.session);
    for (const listener of this.listeners) listener(this.session);
  }

  async authenticate(mode: AuthMode, email: string, password: string): Promise<Session> {
    validateCredentials(email, password, mode);

    if (API_BASE) {
      const response = await fetch(API_BASE + '/auth/' + (mode === 'signup' ? 'register' : 'login'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new AuthError((detail as { detail?: string }).detail || 'Could not sign you in.');
      }

      this.session = (await response.json()) as Session;
    } else {
      // Demo mode: accept the credentials locally so the interface is usable.
      this.session = {
        email,
        plan: this.session?.email === email ? this.session.plan : 'free',
        credits: this.session?.email === email ? this.session.credits : 0,
        createdAt: new Date().toISOString(),
      };
    }

    this.emit();
    trackEvent(mode === 'signup' ? 'sign_up' : 'login', { method: 'email' });
    return this.session;
  }

  async signOut(): Promise<void> {
    if (API_BASE) {
      await fetch(API_BASE + '/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    }
    this.session = null;
    this.emit();
  }

  /** Switch the signed-in account to a new subscription tier. */
  async setPlan(plan: PlanId): Promise<void> {
    if (!this.session) throw new AuthError('Create an account to choose a plan.');

    if (API_BASE) {
      const response = await fetch(API_BASE + '/billing/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ plan }),
      });
      if (!response.ok) throw new AuthError('Could not update your plan.');
    }

    this.session = { ...this.session, plan };
    this.emit();
    trackEvent('subscribe', { plan });
  }

  /** Add pay-as-you-go credits to the signed-in account. */
  async addCredits(credits: number, usd: number): Promise<void> {
    if (!this.session) throw new AuthError('Create an account to buy credits.');

    if (API_BASE) {
      const response = await fetch(API_BASE + '/billing/credits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ usd }),
      });
      if (!response.ok) throw new AuthError('Could not add credits.');
    }

    this.session = { ...this.session, credits: this.session.credits + credits };
    this.emit();
    trackEvent('purchase', { currency: 'USD', value: usd, items: [{ item_name: 'credits', quantity: credits }] });
  }
}
