# Pale Diamond

A web-hosted AI agent for tasks and automation — a calm, diamond-inspired
landing page and product front end, with a real backend the interface can be
pointed at.

## Live preview

The GitHub Pages workflow builds the site (`npm run build`) and publishes the
compiled `dist/` folder. After it completes, the site is available at:

https://mcalrifle789.github.io/Pale-Diamond/

## Run locally

The front end is compiled from TypeScript, so it must be **built first** — do not
open `public/index.html` directly (ES modules do not load over `file://`).

```bash
npm install
npm run build      # TypeScript -> dist/, copies assets + Omaris rules
npm run dev        # build and serve dist/ at http://localhost:4173
```

Then visit `http://localhost:4173`.

## Languages & layout

Per the product brief, the codebase spans several languages, each doing a real
job:

| Language      | Location            | Role                                              |
| ------------- | ------------------- | ------------------------------------------------- |
| TypeScript    | `src/ts/`           | The front-end application (compiled to `dist/js`) |
| JavaScript    | `scripts/build.mjs` | Build/assembly and local dev server               |
| Python        | `src/python/`       | Backend API, database, OpenRouter proxy, security |
| Swift         | `src/swift/`        | `RevenueSplit` — authoritative money model        |
| Rust          | `src/rust/`         | Caustics renderer (WASM) for the hero             |
| C             | `src/c/`            | Facet geometry (WASM)                             |
| C++           | `src/cpp/`          | Starfield background (WASM)                        |
| Omaris        | `public/rules/*.oma`| Entitlement & model-routing policy                |

The Rust/C/C++ sources compile to optional WASM modules; when they are absent,
the TypeScript renderers fall back to a pure-TS path so the site always renders.

## Included

- Responsive landing page with glassmorphism and faceted-diamond visual language
- Title image that masks into the page, plus diamond-reflection effects
- Free, Plus ($20), Pro ($45), and Mas ($115) plans, plus pay-as-you-go credits
- Sign-in / registration flows (backend accounts, or local demo state on Pages)
- Monthly/yearly billing toggle
- Rotating rail ads and dismissible pop-up ads (Google Ads slots)
- Google Tag / Ads identifiers wired in `src/ts/config.ts`
- GitHub Pages deployment via `.github/workflows/deploy-pages.yml`

## Backend

The static site runs in demo mode by default. To enable real accounts, run the
Python API (see `src/python/README.md`) and set `data-api-base` on the `<html>`
element to its URL. The API owns the database and the hidden OpenRouter key; the
key is never exposed to the browser. Every payment is split 50/50 between the
owner and API funding — a rule shared by the TypeScript, Python, and Swift code.

## Production work still needed

Wire live Stripe billing, real Google Ads/Tag IDs, and a managed database, and
lock the API's CORS origin to the deployed site before launch.
