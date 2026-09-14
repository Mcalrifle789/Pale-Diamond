-- Pale Diamond database schema (SQLite).
--
-- Owns everything the front end cannot: password hashes, the authoritative
-- subscription tier, the pay-as-you-go credit balance, sessions, and a ledger
-- that records how every payment was split between the owner and API funding.
--
-- The OpenRouter API key is NOT stored here. It lives only in the process
-- environment (OPENROUTER_API_KEY) and is never returned to a client.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,          -- PBKDF2-HMAC-SHA256, salted
    plan          TEXT    NOT NULL DEFAULT 'free'
                          CHECK (plan IN ('free', 'plus', 'pro', 'mas')),
    credits       INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
    created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT    PRIMARY KEY,          -- opaque, sent as an httpOnly cookie
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL,
    expires_at TEXT    NOT NULL
);

-- One row per payment. owner_cents + api_funding_cents always equals gross_cents,
-- mirroring splitRevenue() on the TypeScript and Swift sides.
CREATE TABLE IF NOT EXISTS revenue_ledger (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind             TEXT    NOT NULL CHECK (kind IN ('subscription', 'credits')),
    gross_cents      INTEGER NOT NULL,
    owner_cents      INTEGER NOT NULL,
    api_funding_cents INTEGER NOT NULL,
    created_at       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user   ON revenue_ledger(user_id);
