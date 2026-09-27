# Pale Diamond

A web-hosted AI agent for tasks and automation — a calm, diamond-inspired
landing page and product front end, backed by a real OpenRouter relay on Vercel.

## Live site

GitHub Pages publishes the `site/` folder automatically on every push to `main`:

https://mcalrifle789.github.io/Pale-Diamond/

## The agent

`agent.html` is the full agent interface (every "Launch agent" button routes
there; the landing page keeps its quick pop-up preview, which fades in when
you click the agent picture in section 04):

- Real AI chat through OpenRouter, streamed live (model picker included)
- Model catalog fetched from the OpenRouter routers, grouped by provider
- Image generation with image-capable models — the gem glows and pulses while
  generating; click to enlarge, download to keep
- File uploads: + button, drag-and-drop into the chatbox, or paste. Images and
  text documents (txt/md/csv/json/docx) are read into the conversation
- File creation: presentations (.pptx), spreadsheets (.xlsx), documents
  (.docx), diagrams (.svg), datasheets (.json) — built for download
- Live weather via Open-Meteo — ask "weather in Tokyo"
- Music player: persistent controls, queue management, search, responsive
- Conversations, analytics, packages, templates, settings — all local-first
- Account menu (profile click): Account Info, Settings, Switch Accounts, Sign
  Out. Switching lists the other accounts saved on the device — no forced
  logout. Account Info shows account age, plan, subscription start date and
  the next payment due date

## Run locally

The site is plain static files — serve `site/` with any HTTP server:

```bash
python -m http.server 8090 --directory site
# open http://localhost:8090
```

Without a backend configured, every feature runs in demo mode (canned replies,
placeholder renders) so the interface is fully explorable.

## Backend (Vercel)

The `api/` folder is the serverless backend (deploy the repo to Vercel):

| Endpoint          | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `POST /api/chat`  | OpenRouter relay — streaming SSE or JSON, page reading |
| `GET  /api/models`| OpenRouter catalog grouped into provider sections      |
| `POST /api/image` | Image generation via image-capable models             |
| `POST /api/checkout` | Stripe Checkout (create) + verification (verify)   |
| `POST /api/auth/register` | Create an account in the database              |
| `POST /api/auth/login` | Sign in (bearer session token)                   |
| `GET  /api/auth/me` | Session -> account (plan, subscription dates)      |
| `POST /api/auth/logout` | Revoke the session                             |
| `POST /api/billing/record` | Persist subscription start + next due date   |
| `GET  /api/health`| Status + which services are configured                |

### Database

Accounts, sessions and subscription dates live in a real database:

1. **Neon (cloud)** — set `DATABASE_URL` to your Neon Postgres connection
   string and everything persists server-side. Create one at neon.tech.
2. **External hard drive (local)** — without `DATABASE_URL`, the backend uses
   SQLite, placed automatically on the first writable external/secondary drive
   (e.g. `D:\PaleDiamondData\pale_diamond.db`) — the drive is the new database
   location. Override with `PD_DB_PATH`.

One function hosts everything on one origin (`api/index.py`, wired via
rewrites in `vercel.json`). Run it locally the same way:

```bash
pip install -r requirements.txt
uvicorn api.index:app --port 8900
```

Then set the backend URL in Agent → Settings (or `site/config.js` → `apiBase`).

### Environment variables (Vercel → Settings → Environment Variables)

| Key | Purpose |
| --- | ------- |
| `OPENROUTER_API_KEY` | The private Pale Diamond key — never exposed to the browser |
| `STRIPE_SECRET_KEY`  | Live Stripe secret key — prices are auto-provisioned with lookup keys on first use |
| `PUBLIC_URL`         | Deployed site origin (Stripe redirects + CORS) |
| `DATABASE_URL`       | Optional — Neon Postgres for real server-side accounts |
| `PD_DB_PATH`         | Optional — explicit SQLite location (defaults to an external drive) |

Optional: `PD_DEFAULT_MODEL`, `PD_IMAGE_MAX_TOKENS`, `PD_CHAT_MAX_TOKENS`.

### Secrets

No key ever belongs in the repo. `.env` is gitignored; see `.env.example`.

## Advertising

Two premium placements live on the landing page (section 06):

- **Red-Bottom box** — $340 / month
- **Blue-Ad box** — $400 / month

Companies and individual users request slots via the "Request an ad slot"
form; Media.net and Google AdSense then serve and rotate the ads automatically
once `site/config.js` gets the network client IDs.

## Payments

Plan buttons open Stripe Checkout (live keys). On return, the payment is
verified and the tier attached. Every payment is split 50/50 — half to the
owner, half funding the account's private API key that routes through
OpenRouter. Prices auto-provision in Stripe with lookup keys
(`pd_port_monthly`, `pd_plus_yearly`, ...).

## Languages & layout

| Language   | Location            | Role                                             |
| ---------- | ------------------- | ------------------------------------------------ |
| JavaScript | `site/`, `api/dev_server.py` | Front end + local composite dev server  |
| TypeScript | `src/ts/`           | Parallel compiled front end (not deployed)       |
| Python     | `api/`, `src/python/` | Vercel serverless API + classic FastAPI stack  |
| Swift      | `src/swift/`        | `RevenueSplit` — authoritative money model       |
| Rust/C/C++ | `src/rust/`, `src/c/`, `src/cpp/` | Optional WASM renderers            |
| Omaris     | `public/rules/*.oma`| Entitlement & ad policy files                    |

## Production notes

- Set the Vercel env vars above; the site falls back to demo mode without them
- Point `site/config.js` `apiBase` at the Vercel URL when serving from Pages
- Rotate any key that was ever shared in a document or chat