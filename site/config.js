/* Pale Diamond — front-end configuration.
   Edit this file (or override at runtime in agent Settings) — never commit secrets. */
window.PD_CONFIG = {
  /* Backend base URL — deployed on Vercel (single-function API).
     Same-origin when served by Vercel; the Pages site points here. */
  apiBase: 'https://pale-diamond.vercel.app',

  /* Ad networks. Leave empty to show house creatives; fill in to serve live ads. */
  ads: {
    adsenseClient: '',            // e.g. 'ca-pub-1234567890123456'
    adsenseSlots: { redbottom: '', blue: '' },
    medianetId: '',               // Media.net placement id (wired when provided)
  },
};
