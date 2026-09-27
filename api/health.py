"""Pale Diamond — health check."""

from __future__ import annotations

from _lib import make_app, openrouter_key, public_url, stripe_key

app = make_app("Pale Diamond — health")


@app.get("/")
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "pale-diamond-api",
        "openrouter": bool(openrouter_key()),
        "stripe": bool(stripe_key()),
        "public_url": public_url() or None,
    }