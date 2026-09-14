"""Pale Diamond backend API (FastAPI).

Implements the exact contract the front end calls in ``src/ts/auth.ts``:

    POST /auth/register     {email, password}   -> Session
    POST /auth/login        {email, password}   -> Session
    POST /auth/logout                            -> {}
    POST /billing/subscribe {plan}               -> Session
    POST /billing/credits   {usd}                -> Session
    POST /agent/run         {prompt}             -> {model, reply, ...}

A ``Session`` is ``{email, plan, credits, createdAt}`` — the same shape as the
TypeScript ``Session`` type. The OpenRouter key is never part of any response.

Run locally:

    pip install -r requirements.txt
    uvicorn app:app --reload --port 8787

Then point the front end at it by setting ``data-api-base="http://localhost:8787"``
on the <html> element (see src/ts/config.ts).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Cookie, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

import billing
import database as db
import openrouter
import security

SESSION_COOKIE = "pd_session"
SESSION_TTL = timedelta(days=30)

app = FastAPI(title="Pale Diamond API", version="1.0.0")

# The static site and the API are usually on different origins; allow the site
# to send its session cookie.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to the deployed site origin before launch
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    db.init_db()


# --- request/response models ----------------------------------------------

class Credentials(BaseModel):
    email: EmailStr
    password: str


class PlanChoice(BaseModel):
    plan: str


class CreditPurchase(BaseModel):
    usd: int


class AgentRequest(BaseModel):
    prompt: str
    model_class: str = "open-weight"


def _session_dict(user) -> dict:
    """Shape a user row as the front-end Session object."""
    return {
        "email": user["email"],
        "plan": user["plan"],
        "credits": user["credits"],
        "createdAt": user["created_at"],
    }


def _issue_session(response: Response, user_id: int) -> None:
    token = security.new_session_token()
    expires = (datetime.now(timezone.utc) + SESSION_TTL).isoformat()
    db.create_session(token, user_id, expires)
    response.set_cookie(
        SESSION_COOKIE, token,
        httponly=True, samesite="lax", secure=True, max_age=int(SESSION_TTL.total_seconds()),
    )


def _require_user(token: str | None):
    if not token:
        raise HTTPException(status_code=401, detail="Sign in first.")
    user = db.get_session_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    return user


# --- auth ------------------------------------------------------------------

@app.post("/auth/register")
def register(creds: Credentials, response: Response):
    if len(creds.password) < 8:
        raise HTTPException(status_code=400, detail="Use at least 8 characters.")
    if db.get_user_by_email(creds.email):
        raise HTTPException(status_code=409, detail="That email is already registered.")
    user = db.create_user(creds.email, security.hash_password(creds.password))
    _issue_session(response, user["id"])
    return _session_dict(user)


@app.post("/auth/login")
def login(creds: Credentials, response: Response):
    user = db.get_user_by_email(creds.email)
    if not user or not security.verify_password(creds.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Wrong email or password.")
    _issue_session(response, user["id"])
    return _session_dict(user)


@app.post("/auth/logout")
def logout(response: Response, pd_session: str | None = Cookie(default=None)):
    if pd_session:
        db.delete_session(pd_session)
    response.delete_cookie(SESSION_COOKIE)
    return {}


# --- billing ---------------------------------------------------------------

@app.post("/billing/subscribe")
def subscribe(choice: PlanChoice, pd_session: str | None = Cookie(default=None)):
    user = _require_user(pd_session)
    if choice.plan not in billing.PLAN_PRICES:
        raise HTTPException(status_code=400, detail="Unknown plan.")

    # Record how the subscription payment is split (half owner, half API funding).
    gross_cents = billing.PLAN_PRICES[choice.plan] * 100
    if gross_cents > 0:
        split = billing.split_revenue(gross_cents)
        db.record_split(
            user["id"], "subscription",
            split.gross_cents, split.owner_cents, split.api_funding_cents,
        )

    db.set_plan(user["id"], choice.plan)
    return _session_dict(db.get_user_by_email(user["email"]))


@app.post("/billing/credits")
def buy_credits(purchase: CreditPurchase, pd_session: str | None = Cookie(default=None)):
    user = _require_user(pd_session)
    credits = billing.credits_for_usd(purchase.usd)
    if credits == 0:
        raise HTTPException(status_code=400, detail="Choose a valid credit bundle.")

    split = billing.split_revenue(purchase.usd * 100)
    db.record_split(
        user["id"], "credits",
        split.gross_cents, split.owner_cents, split.api_funding_cents,
    )
    db.add_credits(user["id"], credits)
    return _session_dict(db.get_user_by_email(user["email"]))


# --- agent (OpenRouter proxy) ---------------------------------------------

@app.post("/agent/run")
def run_agent(req: AgentRequest, pd_session: str | None = Cookie(default=None)):
    user = _require_user(pd_session)

    # Security check before spending the hidden key (see the architecture sketch).
    try:
        security.authorise_model_class(user["plan"], user["credits"], req.model_class)
    except security.SecurityError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    return openrouter.route(req.prompt, req.model_class)


@app.get("/health")
def health():
    return {"status": "ok"}
