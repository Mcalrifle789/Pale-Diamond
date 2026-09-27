"""Pale Diamond — chat relay.

Front end -> this function -> OpenRouter (with the hidden key) -> back.
Streams OpenRouter's SSE straight through when stream=true; otherwise returns
one JSON reply. Without OPENROUTER_API_KEY it runs in demo mode so the site
stays functional.
"""

from __future__ import annotations

import json
import re
from html import unescape

import httpx
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from _lib import DEFAULT_MODEL, OPENROUTER_BASE, make_app, openrouter_headers, openrouter_key

app = make_app("Pale Diamond — chat")

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
    """Fetch any URLs the user linked and inject their content as context."""
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
    chunk = json.dumps(
        {"choices": [{"delta": {"content": _demo_reply(messages)}}]}
    ).encode()
    yield b"data: " + chunk + b"\n\n"
    yield b"data: [DONE]\n\n"


@app.post("/")
@app.post("/api/chat")
async def chat(req: ChatRequest):
    key = openrouter_key()
    messages = await _augment_with_pages(req.messages)
    payload = {
        "model": req.model or DEFAULT_MODEL,
        "messages": messages,
        "stream": bool(req.stream),
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