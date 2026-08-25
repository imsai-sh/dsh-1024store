PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS api_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  github_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id INTEGER NOT NULL REFERENCES api_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS api_sessions_user_idx
  ON api_sessions(user_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES api_users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE CHECK (length(key_hash) = 64),
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS api_keys_user_idx
  ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS api_request_counters (
  counter_key TEXT NOT NULL,
  window_kind TEXT NOT NULL CHECK (window_kind IN ('minute', 'day')),
  bucket_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (counter_key, window_kind, bucket_start)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS api_request_counters_bucket_idx
  ON api_request_counters(bucket_start);
