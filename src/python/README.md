# Pale Diamond — Python backend

The server the static front end talks to when `data-api-base` is set. It owns
the database, the accounts, the subscription/credit ledger, and the single
hidden OpenRouter key. The API key is read from the environment and is **never**
returned to a client.

## Run

```bash
cd src/python
pip install -r requirements.txt
export OPENROUTER_API_KEY=sk-or-...        # optional; omit for demo/echo mode
uvicorn app:app --reload --port 8787
```

Then serve the front end with `data-api-base="http://localhost:8787"` on the
`<html>` element (see `src/ts/config.ts`).

## Endpoints

| Method | Path                | Body                | Returns            |
| ------ | ------------------- | ------------------- | ------------------ |
| POST   | `/auth/register`    | `{email, password}` | `Session`          |
| POST   | `/auth/login`       | `{email, password}` | `Session`          |
| POST   | `/auth/logout`      | —                   | `{}`               |
| POST   | `/billing/subscribe`| `{plan}`            | `Session`          |
| POST   | `/billing/credits`  | `{usd}`             | `Session`          |
| POST   | `/agent/run`        | `{prompt, model_class}` | routed reply   |
| GET    | `/health`           | —                   | `{status: "ok"}`   |

`Session` is `{email, plan, credits, createdAt}` — identical to the TypeScript
`Session` type.

## Files

- `app.py` — FastAPI application and route handlers
- `database.py` — SQLite persistence (`schema.sql` defines the tables)
- `security.py` — password hashing, session tokens, the model-access security check
- `billing.py` — the 50/50 revenue split and plan/credit pricing
- `openrouter.py` — the hidden-key proxy to OpenRouter (echo mode without a key)

## Environment

| Variable             | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `OPENROUTER_API_KEY` | Hidden routing key. Unset ⇒ demo/echo mode.   |
| `PALE_DIAMOND_DB`    | SQLite path (default `pale_diamond.db`).      |
| `PD_PREMIUM_MODEL`   | OpenRouter model id for the premium pool.     |
| `PD_OPEN_WEIGHT_MODEL` | OpenRouter model id for the open-weight pool. |
