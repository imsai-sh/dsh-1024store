PRAGMA foreign_keys = ON;

CREATE TABLE catalog_repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER UNIQUE,
  full_name TEXT NOT NULL,
  normalized_full_name TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  html_url TEXT NOT NULL,
  description TEXT,
  default_branch TEXT,
  stars INTEGER,
  forks INTEGER,
  language TEXT,
  license TEXT,
  github_updated_at TEXT,
  pushed_at TEXT,
  package_name TEXT,
  package_version TEXT,
  package_path TEXT,
  bundle_patch TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'accepted', 'rejected', 'error')),
  validation_code TEXT,
  validation_reason TEXT,
  topic_present INTEGER NOT NULL DEFAULT 0 CHECK (topic_present IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX catalog_repositories_validation_idx
  ON catalog_repositories (validation_status, topic_present);
CREATE INDEX catalog_repositories_pushed_idx
  ON catalog_repositories (pushed_at);

CREATE TABLE catalog_repository_sources (
  repository_id INTEGER NOT NULL
    REFERENCES catalog_repositories (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('github_topic', 'github_pr')),
  source_reference TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_seen_run_id TEXT,
  PRIMARY KEY (repository_id, source)
);

CREATE INDEX catalog_repository_sources_run_idx
  ON catalog_repository_sources (source, last_seen_run_id);

CREATE TABLE catalog_metadata (
  repository_id INTEGER PRIMARY KEY
    REFERENCES catalog_repositories (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  description_en TEXT NOT NULL,
  description_zh TEXT NOT NULL,
  added TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'github_pr' CHECK (source = 'github_pr'),
  updated_at TEXT NOT NULL
);

CREATE TABLE catalog_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE catalog_scan_runs (
  run_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('incremental', 'full')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX catalog_scan_runs_started_idx
  ON catalog_scan_runs (started_at DESC);
