"""SQLite persistence layer for Pale Diamond.

A thin wrapper around the standard-library ``sqlite3`` module so the rest of the
backend never writes raw SQL inline. The database file location defaults to
``pale_diamond.db`` next to this module and can be overridden with the
``PALE_DIAMOND_DB`` environment variable (use ``:memory:`` for tests).
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def _db_path() -> str:
    return os.environ.get("PALE_DIAMOND_DB", str(Path(__file__).with_name("pale_diamond.db")))


def now_iso() -> str:
    """Current UTC time as an ISO-8601 string (matches the front-end format)."""
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    """Open a connection with row access by column name and FKs enabled."""
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """Create tables from ``schema.sql`` if they do not already exist."""
    schema = _SCHEMA_PATH.read_text(encoding="utf-8")
    with connect() as conn:
        conn.executescript(schema)


# --- users -----------------------------------------------------------------

def create_user(email: str, password_hash: str) -> sqlite3.Row:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO users (email, password_hash, plan, credits, created_at) "
            "VALUES (?, ?, 'free', 0, ?)",
            (email, password_hash, now_iso()),
        )
        return get_user_by_id(conn, cur.lastrowid)


def get_user_by_email(email: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def get_user_by_id(conn: sqlite3.Connection, user_id: int) -> sqlite3.Row:
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def set_plan(user_id: int, plan: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE users SET plan = ? WHERE id = ?", (plan, user_id))


def add_credits(user_id: int, credits: int) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE users SET credits = credits + ? WHERE id = ?", (credits, user_id)
        )


# --- sessions --------------------------------------------------------------

def create_session(token: str, user_id: int, expires_at: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) "
            "VALUES (?, ?, ?, ?)",
            (token, user_id, now_iso(), expires_at),
        )


def get_session_user(token: str) -> Optional[sqlite3.Row]:
    """Return the user for a live (non-expired) session token, or None."""
    with connect() as conn:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token = ? AND s.expires_at > ?",
            (token, now_iso()),
        ).fetchone()
        return row


def delete_session(token: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


# --- revenue ledger --------------------------------------------------------

def record_split(user_id: int, kind: str, gross_cents: int, owner_cents: int,
                 api_funding_cents: int) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO revenue_ledger "
            "(user_id, kind, gross_cents, owner_cents, api_funding_cents, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, kind, gross_cents, owner_cents, api_funding_cents, now_iso()),
        )
