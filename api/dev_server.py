"""Local development server — hosts every api/*.py endpoint on ONE origin so the
front end can point its apiBase at http://127.0.0.1:PORT during testing
(mirroring how Vercel serves /api/chat, /api/models, ... under one domain).

Usage:  PYTHONPATH=api uvicorn api.dev_server:app --port 8900
"""

from __future__ import annotations

from fastapi import FastAPI

import chat as chat_mod
import checkout as checkout_mod
import health as health_mod
import image as image_mod
import models as models_mod
from _lib import make_app

app = make_app("Pale Diamond — local composite API")

for sub in (chat_mod.app, models_mod.app, image_mod.app, checkout_mod.app, health_mod.app):
    for route in sub.router.routes:
        if hasattr(route, "endpoint"):
            app.router.routes.append(route)