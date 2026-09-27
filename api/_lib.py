"""Pale Diamond — shared backend helpers for the Vercel serverless functions.

Every function keeps its secrets in the process environment only:
  OPENROUTER_API_KEY   the private Pale Diamond key used to reach OpenRouter
  PUBLIC_URL           the deployed site origin (CORS + OpenRouter referer)
  STRIPE_SECRET_KEY    live Stripe secret key (checkout)
  PD_DEFAULT_MODEL     optional default model id

Nothing here ever returns a key to a client.
"""

from __future__ import annotations

import os

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = os.environ.get("PD_DEFAULT_MODEL", "openai/gpt-4o-mini")


def public_url() -> str:
    return (os.environ.get("PUBLIC_URL") or "").rstrip("/")


def openrouter_key() -> str | None:
    return os.environ.get("OPENROUTER_API_KEY") or None


def stripe_key() -> str | None:
    return os.environ.get("STRIPE_SECRET_KEY") or None


def make_app(title: str) -> FastAPI:
    """FastAPI app factory with CORS for the deployed site + local dev."""
    app = FastAPI(title=title)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # stateless API: no cookies, so a wildcard is safe
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )
    return app


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


# --- OpenRouter helpers ----------------------------------------------------


async def fetch_model_groups(client: httpx.AsyncClient) -> list[dict]:
    """Fetch the OpenRouter catalog and group it by provider/route."""
    r = await client.get(f"{OPENROUTER_BASE}/models")
    r.raise_for_status()
    rows = r.json().get("data", [])
    groups: dict[str, list[dict]] = {}
    for row in rows:
        provider = row.get("id", "").split("/")[0] or "other"
        arch = row.get("architecture") or {}
        out = [m.lower() for m in (arch.get("output_modalities") or [])]
        pricing = row.get("pricing") or {}
        free = pricing.get("prompt") == "0" and pricing.get("completion") == "0"
        groups.setdefault(provider, []).append(
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "image": "image" in out,
                "video": "video" in out,
                "free": free,
                "ctx": f"{(row.get('context_length') or 0) // 1000}K" if row.get("context_length") else "",
            }
        )
    ordered = sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    return [{"provider": p, "models": models} for p, models in ordered]


async def discover_image_models(client: httpx.AsyncClient) -> list[str]:
    """Real image-capable models from the router catalog, best first.
    Pseudo-routers (openrouter/*) are skipped — they have no direct endpoints."""
    r = await client.get(f"{OPENROUTER_BASE}/models")
    r.raise_for_status()
    rows = r.json().get("data", [])
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


# --- revenue split (50/50 owner / API funding) ------------------------------


def split_revenue(cents: int) -> dict:
    cents = max(0, int(cents))
    owner = round(cents * 0.5)
    return {"owner": owner, "apiFunding": cents - owner}