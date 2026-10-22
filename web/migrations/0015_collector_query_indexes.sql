-- Query indexes for the install-metrics reads (worker/lib/install-metrics.ts).
-- Both lookups compare plugin_id COLLATE NOCASE, which the BINARY-collated
-- primary keys cannot serve, so every batch used to scan the whole table.
--
-- Production already has both indexes: the collector Worker
-- (dsh1024-private-monorepo, apps/collector/migrations/0016_collector_query_indexes.sql)
-- created them directly against the shared database on 2026-10-15, outside
-- this migration ledger. This file records them so local and rebuilt
-- databases match production; there it is a no-op.
CREATE INDEX IF NOT EXISTS collector_hourly_window
  ON plugin_hourly_stats (plugin_id COLLATE NOCASE, bucket_hour);
CREATE INDEX IF NOT EXISTS collector_client_installed
  ON plugin_client_state (plugin_id COLLATE NOCASE, client_hash)
  WHERE first_installed_at IS NOT NULL;
