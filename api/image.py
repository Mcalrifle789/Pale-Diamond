"""Pale Diamond — image generation.

Routes an image request through OpenRouter to an image-capable model. The
private key never leaves this process. Returns data-URL images the front end
can show, enlarge and download. Demo mode emits a placeholder render.
"""

from __future__ import annotations

import base64
import os

import httpx
from pydantic import BaseModel

from _lib import (
    OPENROUTER_BASE, discover_image_models, make_app, openrouter_headers, openrouter_key,
)

app = make_app("Pale Diamond — image")

FALLBACK_IMAGE_MODEL = "google/gemini-2.5-flash-image-preview"

# OpenRouter pre-authorizes max_tokens against the account balance; image
# models default to tens of thousands of tokens, which can exceed a small
# balance (402). Cap it — plenty for an inline image, configurable via env.
IMAGE_MAX_TOKENS = int(os.environ.get("PD_IMAGE_MAX_TOKENS", "6000"))


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


@app.post("/")
@app.post("/api/image")
async def image(req: ImageRequest):
    key = openrouter_key()
    if not key:
        return {"demo": True, "images": [_demo_image(req.prompt)], "text": "Demo render."}

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
                candidates = await discover_image_models(client) or [FALLBACK_IMAGE_MODEL]
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