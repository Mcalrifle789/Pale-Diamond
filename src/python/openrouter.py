"""OpenRouter proxy.

The final hop in the architecture sketch: User -> Subscription -> API ->
OpenRouter. The user pays the subscription; the subscription funds a single
hidden key; that key — and only that key — talks to OpenRouter on the user's
behalf. The key is read from the environment and never leaves this process.

If ``OPENROUTER_API_KEY`` is unset, the proxy runs in echo mode so the rest of
the stack can be developed and demoed without spending money.
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Any

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Model class -> a concrete OpenRouter model id. Matches the pools named in the
# Omaris rules (open-weight vs premium).
_MODEL_FOR_CLASS = {
    "open-weight": os.environ.get("PD_OPEN_WEIGHT_MODEL", "meta-llama/llama-3.1-8b-instruct"),
    "premium": os.environ.get("PD_PREMIUM_MODEL", "anthropic/claude-3.5-sonnet"),
}


def _api_key() -> str | None:
    return os.environ.get("OPENROUTER_API_KEY") or None


def route(prompt: str, model_class: str) -> dict[str, Any]:
    """Send a prompt to OpenRouter using the hidden key.

    Returns a small dict the frontend can render. Never includes the key.
    """
    model = _MODEL_FOR_CLASS.get(model_class, _MODEL_FOR_CLASS["open-weight"])
    key = _api_key()

    if not key:
        # Demo mode: no key configured, so echo rather than fail.
        return {
            "model": model,
            "model_class": model_class,
            "demo": True,
            "reply": f"[demo] would route to {model}: {prompt[:280]}",
        }

    body = json.dumps(
        {"model": model, "messages": [{"role": "user", "content": prompt}]}
    ).encode("utf-8")

    request = urllib.request.Request(
        _OPENROUTER_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",  # hidden key, server-side only
            "Content-Type": "application/json",
            "HTTP-Referer": os.environ.get("PD_PUBLIC_URL", "https://pale-diamond.app"),
            "X-Title": "Pale Diamond",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=60) as resp:  # noqa: S310 (trusted URL)
        payload = json.loads(resp.read().decode("utf-8"))

    reply = (
        payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    )
    return {"model": model, "model_class": model_class, "demo": False, "reply": reply}
