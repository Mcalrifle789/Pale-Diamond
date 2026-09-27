"""Pale Diamond — Stripe checkout (live mode).

Actions:
  create  {plan, interval} -> Stripe Checkout session URL
  verify  {sessionId}      -> payment status + 50/50 revenue split

Prices are provisioned automatically with lookup keys the first time a plan is
bought (idempotent), so no price IDs need to be configured by hand:
  pd_port_monthly / pd_port_yearly / pd_plus_monthly / pd_plus_yearly /
  pd_pro_monthly / pd_pro_yearly / pd_max_monthly / pd_max_yearly

Env: STRIPE_SECRET_KEY (live), PUBLIC_URL (redirects). Without a Stripe key the
endpoint reports itself unconfigured and the front end falls back to demo mode.
"""

from __future__ import annotations

import os

import stripe
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from _lib import public_url, make_app, split_revenue, stripe_key

app = make_app("Pale Diamond — checkout")

# Plan -> monthly unit amount in cents. Yearly = monthly x12 x0.80 (save 20%).
PLAN_PRICES = {"Port": 999, "Plus": 2000, "Pro": 4500, "Max": 11500}


def _stripe_ready() -> bool:
    return bool(stripe_key())


def _yearly_amount(monthly_cents: int) -> int:
    return round(monthly_cents * 12 * 0.80)


def _product_id() -> str:
    try:
        found = stripe.Product.search(query="name:'Pale Diamond'", limit=1)
        if found.data:
            return found.data[0].id
    except Exception:  # noqa: BLE001 — search may be unavailable; create instead
        pass
    return stripe.Product.create(name="Pale Diamond", type="service").id


def _price_id(plan: str, interval: str) -> str:
    lookup = f"pd_{plan.lower()}_{interval}"
    existing = stripe.Price.list(lookup_keys=[lookup], active=True, limit=5)
    if existing.data:
        return existing.data[0].id
    monthly = PLAN_PRICES[plan]
    amount = monthly if interval == "monthly" else _yearly_amount(monthly)
    price = stripe.Price.create(
        product=_product_id(),
        unit_amount=amount,
        currency="usd",
        recurring={"interval": "month" if interval == "monthly" else "year"},
        lookup_key=lookup,
        nickname=f"Pale Diamond {plan} {interval}",
    )
    return price.id


class CheckoutRequest(BaseModel):
    action: str  # "create" | "verify"
    plan: str | None = None
    interval: str = "monthly"
    sessionId: str | None = None


@app.post("/")
@app.post("/api/checkout")
def checkout(req: CheckoutRequest):
    if not _stripe_ready():
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
        try:
            base = public_url() or "http://localhost:4173"
            session = stripe.checkout.Session.create(
                mode="subscription",
                line_items=[{"price": _price_id(plan, interval), "quantity": 1}],
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