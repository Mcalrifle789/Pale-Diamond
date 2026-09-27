"""Pale Diamond — model catalog.

Fetches the OpenRouter model list (the "routers" that find models and route
them to Pale Diamond servers) and returns it grouped into sections by the
provider/route each model comes from. Public endpoint — no key needed.
"""

from __future__ import annotations

import httpx
from fastapi.responses import JSONResponse

from _lib import OPENROUTER_BASE, fetch_model_groups, make_app

app = make_app("Pale Diamond — models")


@app.get("/")
@app.get("/api/models")
async def models():
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            groups = await fetch_model_groups(client)
        return {"demo": False, "groups": groups}
    except Exception as exc:  # noqa: BLE001 — the site has a static fallback
        return JSONResponse({"demo": True, "error": str(exc)[:200], "groups": []}, status_code=200)