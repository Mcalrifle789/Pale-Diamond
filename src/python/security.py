"""Security helpers: password hashing, tokens, and the request "security check".

The security check is the node drawn between OpenRouter and the user in the
architecture sketch: before any request is routed to the paid API, the backend
confirms the caller is authenticated and actually entitled to the model class
they are asking for. This keeps the hidden OpenRouter key from ever being spent
on an unauthorised or over-quota request.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

# PBKDF2 parameters. 200k iterations is a reasonable 2020s default for SHA-256.
_ITERATIONS = 200_000
_ALGO = "sha256"


def hash_password(password: str) -> str:
    """Return ``pbkdf2$<iterations>$<salt_hex>$<hash_hex>``."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(_ALGO, password.encode("utf-8"), salt, _ITERATIONS)
    return f"pbkdf2${_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time verification against a stored ``hash_password`` value."""
    try:
        scheme, iters, salt_hex, hash_hex = stored.split("$")
        if scheme != "pbkdf2":
            return False
        digest = hashlib.pbkdf2_hmac(
            _ALGO, password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters)
        )
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def new_session_token() -> str:
    """A URL-safe, unguessable opaque session token."""
    return secrets.token_urlsafe(32)


class SecurityError(Exception):
    """Raised when the security check refuses to route a request."""


# The model class each plan is allowed to reach. Free tier is capped to
# open-weight models unless it holds pay-as-you-go credits.
_PREMIUM_PLANS = {"plus", "pro", "mas"}


def authorise_model_class(plan: str, credits: int, requested_class: str) -> None:
    """Raise ``SecurityError`` if the caller may not use ``requested_class``.

    Mirrors the Omaris routing rules in ``public/rules/plans.oma`` so the same
    policy is enforced in code, not just documented.
    """
    if requested_class == "open-weight":
        return  # everyone may use open-weight models
    if requested_class == "premium":
        if plan in _PREMIUM_PLANS or credits > 0:
            return
        raise SecurityError("This model class requires a paid plan or credits.")
    raise SecurityError(f"Unknown model class: {requested_class!r}")
