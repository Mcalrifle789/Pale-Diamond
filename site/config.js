/* Pale Diamond — front-end configuration.
   Edit this file (or override at runtime in agent Settings) — never commit secrets. */
window.PD_CONFIG = {
  /* Backend base URL.
     - Empty string = same origin (works when the site is served by Vercel alongside /api).
     - On GitHub Pages, set this to your Vercel deployment URL, e.g. 'https://pale-diamond.vercel.app'.
     - Users can also set it live in Agent → Settings → Backend. */
  apiBase: '',

  /* Ad networks. Leave empty to show house creatives; fill in to serve live ads. */
  ads: {
    adsenseClient: '',            // e.g. 'ca-pub-1234567890123456'
    adsenseSlots: { redbottom: '', blue: '' },
    medianetId: '',               // Media.net placement id (wired when provided)
  },
};
