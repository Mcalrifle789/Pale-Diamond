"""Pale Diamond — Vercel serverless API (single entrypoint).

All endpoints live in this one function; vercel.json rewrites /api/* here so
everything is served from one origin, exactly like production:

    POST /api/chat           OpenRouter relay (streaming SSE or JSON, page reading)
    GET  /api/models         OpenRouter catalog grouped into provider sections
    POST /api/image          image generation via image-capable models
    POST /api/checkout       Stripe Checkout create + verify (auto-priced)
    POST /api/auth/register  create an account in the database
    POST /api/auth/login     sign in
    GET  /api/auth/me        session -> account
    POST /api/auth/logout    revoke session
    POST /api/billing/record persist subscription dates
    GET  /api/health         status

Database (in order of preference):
    DATABASE_URL    Neon Postgres (cloud) — used whenever present
    PD_DB_PATH      SQLite file path — set this to an external hard drive
                    location to make that drive the database location
    (local default: first writable secondary drive -> /PaleDiamondData/)

Secrets live ONLY in the environment:
    OPENROUTER_API_KEY   private Pale Diamond key for OpenRouter
    STRIPE_SECRET_KEY    Stripe secret key
    PUBLIC_URL           deployed site origin (redirects + referer)
    PD_DEFAULT_MODEL, PD_IMAGE_MAX_TOKENS, PD_CHAT_MAX_TOKENS  optional

Nothing here ever returns a key or password to a client.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import sqlite3
import tempfile
import time
from datetime import datetime, timedelta, timezone
from html import unescape

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = os.environ.get("PD_DEFAULT_MODEL", "openai/gpt-4o-mini")
IMAGE_MAX_TOKENS = int(os.environ.get("PD_IMAGE_MAX_TOKENS", "6000"))
# OpenRouter pre-authorizes max_tokens against the account balance (402 when
# the default 16K+ exceeds what the key can afford). Cap chat output; raise
# PD_CHAT_MAX_TOKENS when the balance grows.
CHAT_MAX_TOKENS = int(os.environ.get("PD_CHAT_MAX_TOKENS", "4000"))
FALLBACK_IMAGE_MODEL = "google/gemini-2.5-flash-image-preview"

PLAN_PRICES = {"Port": 999, "Plus": 2000, "Pro": 4500, "Max": 11500}  # cents/month


def public_url() -> str:
    return (os.environ.get("PUBLIC_URL") or "").rstrip("/")


def openrouter_key() -> str | None:
    return os.environ.get("OPENROUTER_API_KEY") or None


def stripe_key() -> str | None:
    return os.environ.get("STRIPE_SECRET_KEY") or None


app = FastAPI(title="Pale Diamond API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # stateless API: no cookies, so a wildcard is safe
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def openrouter_headers() -> dict:
    headers = {
        "Content-Type": "application/json",
        "HTTP-Referer": public_url() or "https://pale-diamond.app",
        "X-Title": "Pale Diamond",
    }
    key = openrouter_key()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def split_revenue(cents: int) -> dict:
    cents = max(0, int(cents))
    owner = round(cents * 0.5)
    return {"owner": owner, "apiFunding": cents - owner}


# ---------------------------------------------------------------------------
# /api/health
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "pale-diamond-api",
        "openrouter": bool(openrouter_key()),
        "stripe": bool(stripe_key()),
        "public_url": public_url() or None,
    }


# ---------------------------------------------------------------------------
# /api/models — OpenRouter catalog grouped by provider
# ---------------------------------------------------------------------------


@app.get("/api/models")
async def models():
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(f"{OPENROUTER_BASE}/models")
            r.raise_for_status()
            rows = r.json().get("data", [])
        groups: dict[str, list[dict]] = {}
        for row in rows:
            provider = row.get("id", "").split("/")[0] or "other"
            arch = row.get("architecture") or {}
            out = [m.lower() for m in (arch.get("output_modalities") or [])]
            modality = (arch.get("modality") or "").lower()
            pricing = row.get("pricing") or {}
            free = pricing.get("prompt") == "0" and pricing.get("completion") == "0"
            image = "image" in out or "image" in modality
            video = "video" in out
            groups.setdefault(provider, []).append(
                {
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "image": image,
                    "video": video,
                    "free": free,
                    "ctx": f"{(row.get('context_length') or 0) // 1000}K" if row.get("context_length") else "",
                }
            )
        ordered = sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        return {"demo": False, "groups": [{"provider": p, "models": ms} for p, ms in ordered]}
    except Exception as exc:  # noqa: BLE001 — the site has a static fallback
        return JSONResponse({"demo": True, "error": str(exc)[:200], "groups": []}, status_code=200)


# ---------------------------------------------------------------------------
# /api/chat — relay to OpenRouter (stream or JSON), with page reading
# ---------------------------------------------------------------------------

_URL_RE = re.compile(r"https?://[^\s<>\"']+")


class ChatRequest(BaseModel):
    model: str | None = None
    messages: list = []
    stream: bool = False


async def _fetch_page_text(url: str, client: httpx.AsyncClient) -> str:
    """Read a live web page so the agent can act on real sites."""
    try:
        r = await client.get(url, timeout=15, follow_redirects=True)
        ctype = r.headers.get("content-type", "")
        if "html" in ctype:
            txt = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", r.text)
            txt = re.sub(r"<[^>]+>", " ", txt)
            txt = unescape(re.sub(r"\s+", " ", txt))
            return f"CONTENT OF {url}:\n{txt[:6000]}"
        return f"CONTENT OF {url}:\n{r.text[:6000]}"
    except Exception as exc:  # noqa: BLE001
        return f"(could not fetch {url}: {exc})"


def _urls_in_last_user(messages: list) -> list[str]:
    for m in reversed(messages):
        if m.get("role") != "user":
            continue
        content = m.get("content")
        text = content if isinstance(content, str) else next(
            (p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"), "")
        return _URL_RE.findall(text or "")[:2]
    return []


async def _augment_with_pages(messages: list) -> list:
    urls = _urls_in_last_user(messages)
    if not urls:
        return messages
    async with httpx.AsyncClient(timeout=20) as client:
        pages = [await _fetch_page_text(u, client) for u in urls]
    augmented = list(messages)
    augmented.insert(0, {"role": "system", "content": "\n\n".join(pages)})
    return augmented


def _demo_reply(messages: list) -> str:
    last_user = ""
    for m in reversed(messages):
        if isinstance(m.get("content"), str) and m.get("role") == "user":
            last_user = m["content"]
            break
    return (
        "[demo] Pale Diamond backend is connected but OPENROUTER_API_KEY is not set "
        f"on the server. I would route your message ({str(last_user)[:160]}...) to "
        f"{DEFAULT_MODEL} once the private key is configured in the environment."
    )


async def _demo_stream(messages: list):
    chunk = json.dumps({"choices": [{"delta": {"content": _demo_reply(messages)}}]}).encode()
    yield b"data: " + chunk + b"\n\n"
    yield b"data: [DONE]\n\n"


@app.post("/api/chat")
async def chat(req: ChatRequest, authorization: str | None = Header(default=None)):
    key = openrouter_key()
    # The agent is members-only: real (paid-key) relay requires a signed-in session.
    if key:
        _user_for_token(authorization)
    messages = await _augment_with_pages(req.messages)
    payload = {
        "model": req.model or DEFAULT_MODEL,
        "messages": messages,
        "stream": bool(req.stream),
        "max_tokens": CHAT_MAX_TOKENS,
    }
    headers = openrouter_headers()

    if not key:
        if req.stream:
            return StreamingResponse(_demo_stream(req.messages), media_type="text/event-stream")
        return {"demo": True, "model": payload["model"], "reply": _demo_reply(req.messages)}

    if req.stream:
        async def relay():
            timeout = httpx.Timeout(30.0, read=600.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST", f"{OPENROUTER_BASE}/chat/completions",
                    json=payload, headers=headers,
                ) as r:
                    if r.status_code >= 400:
                        detail = (await r.aread()).decode("utf-8", "ignore")[:400]
                        err = json.dumps({"error": {"message": f"OpenRouter {r.status_code}: {detail}"}}).encode()
                        yield b"data: " + err + b"\n\n"
                        yield b"data: [DONE]\n\n"
                        return
                    async for chunk in r.aiter_bytes():
                        yield chunk

        return StreamingResponse(relay(), media_type="text/event-stream")

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=600.0)) as client:
        r = await client.post(f"{OPENROUTER_BASE}/chat/completions", json=payload, headers=headers)
    if r.status_code >= 400:
        return JSONResponse({"error": f"OpenRouter {r.status_code}: {r.text[:400]}"}, status_code=502)
    data = r.json()
    reply = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    return {"model": payload["model"], "reply": reply}


# ---------------------------------------------------------------------------
# /api/image — generation via image-capable models
# ---------------------------------------------------------------------------


class ImageRequest(BaseModel):
    prompt: str
    model: str | None = None


def _demo_image(prompt: str) -> str:
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">'
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#0a1020"/><stop offset="1" stop-color="#1c2c55"/>'
        '</linearGradient></defs><rect width="640" height="480" fill="url(#g)"/>'
        '<g transform="translate(320,210) rotate(45)">'
        '<rect x="-90" y="-90" width="180" height="180" rx="14" fill="none" stroke="#bcd2ff" stroke-width="3"/>'
        '<rect x="-60" y="-60" width="120" height="120" rx="10" fill="rgba(188,210,255,.25)" stroke="#eaf1ff" stroke-width="1.5"/></g>'
        '<text x="320" y="395" fill="#cfe0ff" font-family="monospace" font-size="14" text-anchor="middle">'
        'DEMO RENDER — SET OPENROUTER_API_KEY FOR REAL GENERATION</text></svg>'
    )
    encoded = base64.b64encode(svg.encode()).decode()
    return f"data:image/svg+xml;base64,{encoded}"


@app.post("/api/image")
async def image(req: ImageRequest, authorization: str | None = Header(default=None)):
    key = openrouter_key()
    if not key:
        return {"demo": True, "images": [_demo_image(req.prompt)], "text": "Demo render."}
    # Members-only: image generation burns credits, so require a signed-in session.
    _user_for_token(authorization)

    headers = openrouter_headers()
    payload = {
        "messages": [{"role": "user", "content": [{"type": "text", "text": req.prompt}]}],
        "modalities": ["image", "text"],
        "max_tokens": IMAGE_MAX_TOKENS,
    }
    errors = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=600.0)) as client:
        if req.model:
            candidates = [req.model]
        else:
            try:
                r = await client.get(f"{OPENROUTER_BASE}/models")
                r.raise_for_status()
                candidates = _image_candidates(r.json().get("data", [])) or [FALLBACK_IMAGE_MODEL]
            except Exception:  # noqa: BLE001 — catalog unavailable, try the fallback
                candidates = [FALLBACK_IMAGE_MODEL]
        # Try candidates until one produces an image (max 3 attempts).
        for model in candidates[:3]:
            payload["model"] = model
            try:
                r = await client.post(f"{OPENROUTER_BASE}/chat/completions", json=payload, headers=headers)
            except httpx.HTTPError as exc:
                errors.append(f"{model}: {exc}")
                continue
            if r.status_code >= 400:
                errors.append(f"{model}: OpenRouter {r.status_code}")
                continue
            message = ((r.json().get("choices") or [{}])[0].get("message") or {})
            images = []
            for img in message.get("images") or []:
                url = (img.get("image_url") or {}).get("url") if isinstance(img, dict) else None
                if url:
                    images.append(url)
            if images:
                return {"model": model, "images": images, "text": message.get("content") or ""}
            errors.append(f"{model}: no image in response")

    return {"error": " | ".join(errors) or "no image produced", "images": []}


def _image_candidates(rows: list) -> list[str]:
    """Real image-capable models, best first. Pseudo-routers (openrouter/*) skipped."""
    candidates = []
    for row in rows:
        mid = row.get("id", "")
        if mid.startswith("openrouter/"):
            continue
        arch = row.get("architecture") or {}
        out = [m.lower() for m in (arch.get("output_modalities") or [])]
        modality = (arch.get("modality") or "").lower()
        if "image" not in out and "image" not in modality:
            continue
        score = 1
        if "gemini" in mid and "image" in mid:
            score = 3
        elif "gpt" in mid and "image" in mid:
            score = 2
        if "preview" in mid:
            score -= 1
        candidates.append((score, mid))
    candidates.sort(key=lambda t: -t[0])
    seen, ordered = set(), []
    for _, mid in candidates:
        if mid not in seen:
            seen.add(mid)
            ordered.append(mid)
    return ordered


# ---------------------------------------------------------------------------
# /api/checkout — Stripe Checkout (create + verify), auto-priced via lookup keys
# ---------------------------------------------------------------------------


class CheckoutRequest(BaseModel):
    action: str  # "create" | "verify"
    plan: str | None = None
    interval: str = "monthly"
    sessionId: str | None = None


@app.post("/api/checkout")
def checkout(req: CheckoutRequest):
    import stripe

    if not stripe_key():
        return JSONResponse(
            {"url": None, "error": "stripe-not-configured",
             "detail": "STRIPE_SECRET_KEY is not set in the environment."},
            status_code=200,
        )
    stripe.api_key = stripe_key()

    if req.action == "create":
        plan = req.plan
        interval = req.interval if req.interval in ("monthly", "yearly") else "monthly"
        if plan not in PLAN_PRICES:
            return JSONResponse({"url": None, "error": "unknown-plan"}, status_code=400)

        def yearly(monthly_cents: int) -> int:
            return round(monthly_cents * 12 * 0.80)

        def price_id(plan_: str, interval_: str) -> str:
            lookup = f"pd_{plan_.lower()}_{interval_}"
            existing = stripe.Price.list(lookup_keys=[lookup], active=True, limit=5)
            if existing.data:
                return existing.data[0].id
            product = None
            try:
                found = stripe.Product.search(query="name:'Pale Diamond'", limit=1)
                if found.data:
                    product = found.data[0].id
            except Exception:  # noqa: BLE001
                pass
            if not product:
                product = stripe.Product.create(name="Pale Diamond", type="service").id
            monthly = PLAN_PRICES[plan_]
            amount = monthly if interval_ == "monthly" else yearly(monthly)
            price = stripe.Price.create(
                product=product,
                unit_amount=amount,
                currency="usd",
                recurring={"interval": "month" if interval_ == "monthly" else "year"},
                lookup_key=lookup,
                nickname=f"Pale Diamond {plan_} {interval_}",
            )
            return price.id

        try:
            base = public_url() or "http://localhost:4173"
            session = stripe.checkout.Session.create(
                mode="subscription",
                line_items=[{"price": price_id(plan, interval), "quantity": 1}],
                success_url=f"{base}/?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{base}/?checkout=cancelled",
                metadata={"plan": plan, "interval": interval},
            )
            return {"url": session.url, "sessionId": session.id}
        except Exception as exc:  # noqa: BLE001
            return JSONResponse({"url": None, "error": f"stripe-error: {exc}"}, status_code=502)

    if req.action == "verify":
        try:
            session = stripe.checkout.Session.retrieve(req.sessionId)
        except Exception as exc:  # noqa: BLE001
            return JSONResponse({"status": "error", "error": f"stripe-error: {exc}"}, status_code=502)
        if session.payment_status != "paid":
            return {"status": "unpaid"}
        plan = (session.metadata or {}).get("plan", "")
        interval = (session.metadata or {}).get("interval", "monthly")
        gross = session.amount_total or 0
        return {
            "status": "paid",
            "plan": plan,
            "interval": interval,
            "gross": gross,
            "split": split_revenue(gross),
        }

    return JSONResponse({"error": "unknown-action"}, status_code=400)


# Root-level alias (bare function visits)
@app.get("/")
def root():
    return health()


# ===========================================================================
# DATABASE — Neon Postgres (DATABASE_URL) or SQLite on the external drive
# ===========================================================================
#
# Location policy:
#   1. DATABASE_URL (Neon cloud Postgres) wins whenever present.
#   2. Otherwise SQLite, placed on an external/secondary hard drive:
#      PD_DB_PATH if set, else the first writable drive letter after C:
#      creates /PaleDiamondData/pale_diamond.db — the drive becomes the
#      new database location for the local stack.

def _sqlite_path() -> str:
    env = os.environ.get("PD_DB_PATH")
    if env:
        return env
    if os.environ.get("VERCEL"):
        return "/tmp/pale_diamond.db"
    for letter in "DEFGHIJKLMNOPQRSTUVWXYZ":
        drive_root = f"{letter}:/"
        if not os.path.isdir(drive_root):
            continue
        data_dir = f"{drive_root}PaleDiamondData"
        try:
            os.makedirs(data_dir, exist_ok=True)
            probe = os.path.join(data_dir, ".write-test")
            with open(probe, "w") as f:
                f.write("ok")
            os.remove(probe)
            return os.path.join(data_dir, "pale_diamond.db")
        except OSError:
            continue
    return os.path.join(tempfile.gettempdir(), "pale_diamond.db")


_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        credits INTEGER NOT NULL DEFAULT 0,
        subscribed_at TEXT,
        next_due TEXT,
        created_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL)""",
]

_DB_READY = False


def db_execute(sql: str, params: tuple = (), fetch: str = "none"):
    """Run a statement against Postgres or SQLite, returning rows as dicts."""
    global _DB_READY
    url = os.environ.get("DATABASE_URL")
    if url:
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(url, sslmode="require")
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql.replace("?", "%s"), params)   # dialect: %s for Postgres
                rows = [dict(r) for r in cur.fetchall()] if cur.description and fetch != "none" else []
            conn.commit()
            return rows
        finally:
            conn.close()
    conn = sqlite3.connect(_sqlite_path(), timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()] if fetch != "none" else []
        conn.commit()
        return rows
    finally:
        conn.close()


def _add_months(dt: datetime, months: int) -> datetime:
    """Add months, clamping end-of-month overflow (Jan 31 -> Feb 28)."""
    index = dt.month - 1 + months
    year = dt.year + index // 12
    month = index % 12 + 1
    leap = year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    days_in = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    return dt.replace(year=year, month=month, day=min(dt.day, days_in))


def db_init() -> None:
    global _DB_READY
    if _DB_READY:
        return
    for stmt in _SCHEMA:
        db_execute(stmt)
    _DB_READY = True


# --- password + session security (mirrors src/python/security.py) ----------

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return secrets.compare_digest(check, digest)


def _new_session(email: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    db_execute(
        "INSERT INTO sessions (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, email, datetime.now(timezone.utc).isoformat(), expires),
    )
    return token


def _user_for_token(authorization: str | None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in first.")
    token = authorization.split(" ", 1)[1].strip()
    rows = db_execute("SELECT email, expires_at FROM sessions WHERE token = ?", (token,), fetch="all")
    if not rows or rows[0]["expires_at"] < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    user = db_execute("SELECT * FROM users WHERE email = ?", (rows[0]["email"],), fetch="all")
    if not user:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    return user[0]


def _user_dict(u: dict) -> dict:
    return {
        "email": u["email"],
        "plan": u.get("plan") or "free",
        "credits": u.get("credits") or 0,
        "createdAt": u.get("created_at"),
        "subscribedAt": u.get("subscribed_at"),
        "nextDue": u.get("next_due"),
    }


# --- auth endpoints ---------------------------------------------------------

class Credentials(BaseModel):
    email: str
    password: str


@app.post("/api/auth/register")
def auth_register(creds: Credentials):
    db_init()
    email = creds.email.strip().lower()
    if len(creds.password) < 8:
        raise HTTPException(status_code=400, detail="Use at least 8 characters.")
    if db_execute("SELECT email FROM users WHERE email = ?", (email,), fetch="all"):
        raise HTTPException(status_code=409, detail="That email is already registered.")
    now = datetime.now(timezone.utc).isoformat()
    db_execute(
        "INSERT INTO users (email, password_hash, plan, credits, created_at) VALUES (?, ?, ?, ?, ?)",
        (email, hash_password(creds.password), "free", 0, now),
    )
    token = _new_session(email)
    user = db_execute("SELECT * FROM users WHERE email = ?", (email,), fetch="all")[0]
    return {"token": token, "user": _user_dict(user)}


@app.post("/api/auth/login")
def auth_login(creds: Credentials):
    db_init()
    email = creds.email.strip().lower()
    rows = db_execute("SELECT * FROM users WHERE email = ?", (email,), fetch="all")
    if not rows or not verify_password(creds.password, rows[0]["password_hash"]):
        raise HTTPException(status_code=401, detail="Wrong email or password.")
    token = _new_session(email)
    return {"token": token, "user": _user_dict(rows[0])}


@app.get("/api/auth/me")
def auth_me(authorization: str | None = Header(default=None)):
    db_init()
    return _user_dict(_user_for_token(authorization))


@app.post("/api/auth/logout")
def auth_logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.lower().startswith("bearer "):
        db_execute("DELETE FROM sessions WHERE token = ?", (authorization.split(" ", 1)[1].strip(),))
    return {}


# --- subscription dates ------------------------------------------------------

class BillingRecord(BaseModel):
    plan: str
    interval: str = "monthly"


@app.post("/api/billing/record")
def billing_record(record: BillingRecord, authorization: str | None = Header(default=None)):
    db_init()
    user = _user_for_token(authorization)
    email = user["email"]
    now = datetime.now(timezone.utc)
    # The first payment date sticks; every renewal pushes the next due date.
    base = user.get("subscribed_at") or now.isoformat()
    base_dt = datetime.fromisoformat(base)
    next_due = _add_months(base_dt, 12) if record.interval == "yearly" else _add_months(base_dt, 1)
    db_execute(
        "UPDATE users SET plan = ?, subscribed_at = ?, next_due = ? WHERE email = ?",
        (record.plan, base, next_due.isoformat(), email),
    )
    updated = db_execute("SELECT * FROM users WHERE email = ?", (email,), fetch="all")[0]
    return {"user": _user_dict(updated)}