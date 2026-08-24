-- Two tables: a repository, and the plugins it publishes.
--
-- The catalog used to spread one plugin across four tables — catalog_repositories,
-- catalog_repository_sources, catalog_metadata, plus discovery columns bolted
-- onto the repository row. Every read joined them back together, and the split
-- was wrong once a monorepo could publish several plugins: the repository row
-- holds only one package_name, so a repository with six plugins could record
-- only one of them.
--
-- The grain is now explicit. A repository is one row of GitHub facts. A plugin
-- is one row, and a repository has one or more of them. Facts that belong to
-- the repository (stars, forks, pushed_at) are stored once and shared by its
-- plugins; everything that differs per plugin — the manifest, the install
-- facts, the curated copy — lives on the plugin.
--
-- Which channel told us about it follows the same rule: the topic scan
-- discovers *repositories*, a submission contributes a *plugin*, so from_topic
-- sits on the repository and from_pr on the plugin.
--
-- Column ownership decides who may overwrite what, which is what the old table
-- split was really encoding:
--   curated_*  only a catalog submission writes these; the crawler never does
--   github_*   only the crawler writes these
--   git_/npm_  only the crawler writes these
-- so a nightly refresh cannot clobber a human-reviewed description.

PRAGMA foreign_keys = ON;

CREATE TABLE catalog_repositories_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Unique again: one row really is one GitHub repository now.
  github_id             INTEGER UNIQUE,
  full_name             TEXT NOT NULL,
  normalized_full_name  TEXT NOT NULL UNIQUE,
  owner                 TEXT NOT NULL,
  repository_name       TEXT NOT NULL,
  html_url              TEXT NOT NULL,

  -- GitHub facts: written only by the crawler, shared by every plugin here.
  github_description TEXT,
  default_branch     TEXT,
  stars              INTEGER,
  forks              INTEGER,
  language           TEXT,
  license            TEXT,
  github_updated_at  TEXT,
  pushed_at          TEXT,

  -- The topic scan discovers repositories, so its provenance lives here. A
  -- repository only loses the topic after a *full* scan misses it, which is
  -- what topic_last_run_id is for; an incremental run cannot retire it.
  from_topic         INTEGER NOT NULL DEFAULT 0 CHECK (from_topic IN (0, 1)),
  topic_last_run_id  TEXT,
  topic_last_seen_at TEXT,

  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  last_scanned_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX catalog_repositories_v2_topic_idx ON catalog_repositories_v2 (from_topic);
CREATE INDEX catalog_repositories_v2_pushed_idx ON catalog_repositories_v2 (pushed_at);

CREATE TABLE catalog_plugins (
  repository_id INTEGER NOT NULL
    REFERENCES catalog_repositories_v2 (id) ON DELETE CASCADE,

  -- owner/repository, or owner/repository/sub/dir for a monorepo subpackage.
  plugin_id            TEXT NOT NULL,
  -- Lowercased plugin_id: two ids differing only in case are the same plugin,
  -- even though the git path they contain is case-sensitive.
  normalized_plugin_id TEXT NOT NULL UNIQUE,
  -- In-repo directory; '' for a repository-level plugin. Raw case, because it
  -- is a git path and feeds pnpm's `#path:` install spec.
  plugin_path          TEXT NOT NULL DEFAULT '',

  -- A submission contributes one plugin, so its provenance lives here.
  from_pr      INTEGER NOT NULL DEFAULT 0 CHECK (from_pr IN (0, 1)),
  pr_reference TEXT,

  -- Curated: written only by a catalog submission. NULL means nobody curated
  -- this plugin, and the crawler must leave these alone rather than overwrite
  -- a reviewed description with a GitHub blurb.
  curated_name           TEXT,
  curated_category       TEXT,
  curated_description_en TEXT,
  curated_description_zh TEXT,
  curated_added          TEXT,
  curated_updated_at     TEXT,

  -- What a git install would produce. Facts, not a verdict: what the reader is
  -- told is derived from these at snapshot time (worker/lib/install-methods.ts),
  -- so changing the judgement is a deploy rather than a re-crawl.
  manifest_path       TEXT,
  package_name        TEXT,
  package_version     TEXT,
  bundle_patch        TEXT,
  git_entry_point     TEXT,
  git_entry_committed INTEGER NOT NULL DEFAULT 0 CHECK (git_entry_committed IN (0, 1)),
  git_has_prepare     INTEGER NOT NULL DEFAULT 0 CHECK (git_has_prepare IN (0, 1)),
  git_status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (git_status IN ('pending', 'ok', 'absent', 'error')),
  git_code            TEXT,
  git_reason          TEXT,
  git_head_sha        TEXT,
  git_checked_at      TEXT,

  -- npm_binding is the whole point: a name that merely exists on npm is not
  -- evidence. Only 'strict' — repository.url points back at this repository,
  -- repository.directory equals plugin_path exactly for a subpackage, and the
  -- published manifest declares a DSH bundle — may be recommended.
  npm_package_name         TEXT,
  npm_version              TEXT,
  npm_repository_url       TEXT,
  npm_repository_directory TEXT,
  npm_bundle_declared      INTEGER NOT NULL DEFAULT 0 CHECK (npm_bundle_declared IN (0, 1)),
  npm_binding              TEXT NOT NULL DEFAULT 'unknown'
    CHECK (npm_binding IN ('strict', 'name_only', 'mismatch', 'no_bundle', 'absent', 'unknown')),
  npm_status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (npm_status IN ('pending', 'found', 'absent', 'error')),
  npm_http_status          INTEGER,
  npm_checked_at           TEXT,

  -- Per plugin, not per repository: one subpackage of a monorepo can validate
  -- while its sibling does not.
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'accepted', 'rejected', 'error')),
  validation_code   TEXT,
  validation_reason TEXT,

  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,

  PRIMARY KEY (repository_id, plugin_path)
);

-- Published = curated, or topic-discovered and accepted. One predicate, read by
-- the snapshot and by both crawler queues, so the old split where "published"
-- and "needs checking" disagreed — and left 316 curated plugins never
-- inspected — cannot recur.
CREATE INDEX catalog_plugins_published_idx ON catalog_plugins (from_pr, validation_status);
CREATE INDEX catalog_plugins_git_queue_idx ON catalog_plugins (git_status, git_checked_at);
CREATE INDEX catalog_plugins_npm_queue_idx ON catalog_plugins (npm_status, npm_checked_at);

-- ---------------------------------------------------------------------------
-- Carry the existing rows over. catalog_metadata is one-per-repository at this
-- point, so each repository yields exactly one plugin; subdirectory ids arrive
-- with the next catalog sync, which reconciles the full set anyway.
INSERT INTO catalog_repositories_v2 (
  id, github_id, full_name, normalized_full_name, owner, repository_name, html_url,
  github_description, default_branch, stars, forks, language, license,
  github_updated_at, pushed_at, from_topic, topic_last_run_id, topic_last_seen_at,
  first_seen_at, last_seen_at, last_scanned_at, created_at, updated_at
)
SELECT r.id, r.github_id, r.full_name, r.normalized_full_name, r.owner, r.repository_name, r.html_url,
       r.description, r.default_branch, r.stars, r.forks, r.language, r.license,
       r.github_updated_at, r.pushed_at, r.topic_present, tp.last_seen_run_id, tp.last_seen_at,
       r.first_seen_at, r.last_seen_at, r.last_scanned_at, r.created_at, r.updated_at
  FROM catalog_repositories r
  LEFT JOIN catalog_repository_sources tp
         ON tp.repository_id = r.id AND tp.source = 'github_topic';

INSERT INTO catalog_plugins (
  repository_id, plugin_id, normalized_plugin_id, plugin_path,
  from_pr, pr_reference,
  curated_name, curated_category, curated_description_en, curated_description_zh,
  curated_added, curated_updated_at,
  manifest_path, package_name, package_version, bundle_patch,
  validation_status, validation_code, validation_reason,
  first_seen_at, last_seen_at, created_at, updated_at
)
SELECT r.id, r.full_name, r.normalized_full_name, '',
       CASE WHEN pr.repository_id IS NULL THEN 0 ELSE 1 END, pr.source_reference,
       m.display_name, m.category, m.description_en, m.description_zh, m.added, m.updated_at,
       r.package_path, r.package_name, r.package_version, r.bundle_patch,
       r.validation_status, r.validation_code, r.validation_reason,
       r.first_seen_at, r.last_seen_at, r.created_at, r.updated_at
  FROM catalog_repositories r
  LEFT JOIN catalog_metadata m ON m.repository_id = r.id
  LEFT JOIN catalog_repository_sources pr
         ON pr.repository_id = r.id AND pr.source = 'github_pr';

DROP TABLE catalog_metadata;
DROP TABLE catalog_repository_sources;
DROP TABLE catalog_repositories;
ALTER TABLE catalog_repositories_v2 RENAME TO catalog_repositories;
