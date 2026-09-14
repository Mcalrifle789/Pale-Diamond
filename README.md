# Pale Diamond

A calm, diamond-inspired AI workspace landing page and front-end product prototype.

## Live preview

After the GitHub Pages workflow completes, the site is available at:

https://mcalrifle789.github.io/Pale-Diamond/

## Included

- Responsive landing page with glassmorphism and faceted diamond visual language
- Free, Plus, Pro, and Mas plan presentation
- Sign-in and registration modal flows with local browser storage for demo state
- Pay-as-you-go usage modal
- Monthly/yearly billing toggle
- Provider sign-in placeholders
- Dismissible advertising showcase
- Responsive mobile navigation
- GitHub Pages deployment through `.github/workflows/deploy-pages.yml`

## Run locally

This is a static front-end prototype written with HTML, CSS, and JavaScript. It can be opened directly, or served with Python:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Production work still needed

Authentication, database persistence, Stripe billing, OpenRouter routing, Google Ads/Tag integration, and backend security should be connected before production launch.
