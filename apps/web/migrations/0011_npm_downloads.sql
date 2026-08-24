-- npm exposes download activity as rolling windows rather than a trustworthy
-- all-time install counter. Keep the exact last-week window and its dates so
-- the UI can name the metric honestly and never mix it with Store telemetry.
ALTER TABLE catalog_plugins ADD COLUMN npm_downloads_7d INTEGER
  CHECK (npm_downloads_7d IS NULL OR npm_downloads_7d >= 0);
ALTER TABLE catalog_plugins ADD COLUMN npm_downloads_start TEXT;
ALTER TABLE catalog_plugins ADD COLUMN npm_downloads_end TEXT;
ALTER TABLE catalog_plugins ADD COLUMN npm_downloads_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (npm_downloads_status IN ('pending', 'found', 'error'));
ALTER TABLE catalog_plugins ADD COLUMN npm_downloads_checked_at TEXT;

CREATE INDEX catalog_plugins_npm_downloads_queue_idx
  ON catalog_plugins (npm_downloads_checked_at, normalized_plugin_id);
