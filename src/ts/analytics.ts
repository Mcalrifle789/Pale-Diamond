/**
 * Google Tag (gtag.js) wiring.
 *
 * One tag drives measurement for the site and conversion reporting for the
 * TikTok / Instagram / Reddit / YouTube campaigns described in the brief: each
 * campaign lands on the site with UTM parameters, and the events below tie the
 * resulting sign-up or subscription back to the source.
 *
 * Nothing loads until `init()` runs, and `init()` is a no-op while the tag ID
 * is still the placeholder, so local development stays quiet.
 */

import { GOOGLE } from './config.js';

type GtagArgs = [string, ...unknown[]];

declare global {
  interface Window {
    dataLayer?: GtagArgs[];
    gtag?: (...args: GtagArgs) => void;
  }
}

const hasLiveTag = () => !!GOOGLE.tagId && !GOOGLE.tagId.includes('XXXX');

/** Campaign attribution pulled from the landing URL. */
export function campaignSource(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const attribution: Record<string, string> = {};

  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
    const value = params.get(key);
    if (value) attribution[key] = value;
  }

  return attribution;
}

export function initAnalytics(): void {
  if (!hasLiveTag()) {
    console.info('[analytics] Google Tag not configured — events will be logged locally only');
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: GtagArgs) { window.dataLayer!.push(args); };

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GOOGLE.tagId);
  document.head.appendChild(script);

  window.gtag('js', new Date());
  window.gtag('config', GOOGLE.tagId, { ...campaignSource() });
}

/** Report a product event to the tag, and to the console in development. */
export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  const payload = { ...campaignSource(), ...params };

  if (window.gtag) {
    window.gtag('event', name, payload);
    return;
  }

  console.debug('[analytics]', name, payload);
}
