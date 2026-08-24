CREATE TABLE IF NOT EXISTS installation_events (
  event_id TEXT PRIMARY KEY,
  client_hash TEXT NOT NULL CHECK (length(client_hash) = 64),
  plugin_id TEXT NOT NULL,
  profile TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('install', 'reinstall', 'update', 'remove')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  client_started_at TEXT NOT NULL,
  client_completed_at TEXT NOT NULL,
  server_received_at TEXT NOT NULL,
  server_received_hour INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0 AND duration_ms <= 86400000),
  before_version TEXT,
  after_version TEXT,
  requested_ref TEXT,
  cli_version TEXT,
  dsh_version TEXT,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  is_ci INTEGER NOT NULL CHECK (is_ci IN (0, 1)),
  error_code TEXT,
  source_channel TEXT
);

CREATE INDEX IF NOT EXISTS installation_events_plugin_received
  ON installation_events (plugin_id, server_received_hour, server_received_at);

CREATE INDEX IF NOT EXISTS installation_events_client_plugin_profile
  ON installation_events (client_hash, plugin_id, profile, server_received_at);

CREATE INDEX IF NOT EXISTS installation_events_client_received_hour
  ON installation_events (client_hash, server_received_hour);

CREATE TABLE IF NOT EXISTS plugin_client_state (
  client_hash TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  profile TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  first_installed_at TEXT,
  last_installed_at TEXT,
  install_count INTEGER NOT NULL DEFAULT 0,
  reinstall_count INTEGER NOT NULL DEFAULT 0,
  update_count INTEGER NOT NULL DEFAULT 0,
  remove_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  current_state TEXT NOT NULL CHECK (current_state IN ('unknown', 'installed', 'removed')),
  current_version TEXT,
  PRIMARY KEY (client_hash, plugin_id, profile)
);

CREATE INDEX IF NOT EXISTS plugin_client_state_plugin_installed
  ON plugin_client_state (plugin_id, first_installed_at, client_hash);

CREATE TABLE IF NOT EXISTS plugin_hourly_stats (
  plugin_id TEXT NOT NULL,
  bucket_hour INTEGER NOT NULL,
  install_count INTEGER NOT NULL DEFAULT 0,
  first_install_count INTEGER NOT NULL DEFAULT 0,
  reinstall_count INTEGER NOT NULL DEFAULT 0,
  update_count INTEGER NOT NULL DEFAULT 0,
  remove_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  unique_client_count INTEGER NOT NULL DEFAULT 0,
  latest_install_at TEXT,
  PRIMARY KEY (plugin_id, bucket_hour)
);

CREATE TABLE IF NOT EXISTS plugin_hourly_clients (
  plugin_id TEXT NOT NULL,
  bucket_hour INTEGER NOT NULL,
  client_hash TEXT NOT NULL,
  PRIMARY KEY (plugin_id, bucket_hour, client_hash)
);

CREATE TRIGGER IF NOT EXISTS installation_events_rollup_state
AFTER INSERT ON installation_events
BEGIN
  INSERT INTO plugin_client_state (
    client_hash,
    plugin_id,
    profile,
    first_seen_at,
    last_seen_at,
    first_installed_at,
    last_installed_at,
    install_count,
    reinstall_count,
    update_count,
    remove_count,
    failure_count,
    current_state,
    current_version
  ) VALUES (
    NEW.client_hash,
    NEW.plugin_id,
    NEW.profile,
    NEW.server_received_at,
    NEW.server_received_at,
    CASE
      WHEN NEW.status = 'success' AND NEW.operation IN ('install', 'reinstall', 'update')
        THEN NEW.server_received_at
      ELSE NULL
    END,
    CASE
      WHEN NEW.status = 'success' AND NEW.operation IN ('install', 'reinstall', 'update')
        THEN NEW.server_received_at
      ELSE NULL
    END,
    CASE
      WHEN NEW.status = 'success' AND NEW.operation IN ('install', 'reinstall') THEN 1
      ELSE 0
    END,
    CASE WHEN NEW.status = 'success' AND NEW.operation = 'reinstall' THEN 1 ELSE 0 END,
    CASE WHEN NEW.status = 'success' AND NEW.operation = 'update' THEN 1 ELSE 0 END,
    CASE WHEN NEW.status = 'success' AND NEW.operation = 'remove' THEN 1 ELSE 0 END,
    CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END,
    CASE
      WHEN NEW.status = 'success' AND NEW.operation = 'remove' THEN 'removed'
      WHEN NEW.status = 'success' AND NEW.operation IN ('install', 'reinstall', 'update') THEN 'installed'
      ELSE 'unknown'
    END,
    CASE
      WHEN NEW.status = 'success' AND NEW.operation IN ('install', 'reinstall', 'update')
        THEN NEW.after_version
      ELSE NULL
    END
  )
  ON CONFLICT (client_hash, plugin_id, profile) DO UPDATE SET
    first_seen_at = MIN(plugin_client_state.first_seen_at, excluded.first_seen_at),
    last_seen_at = MAX(plugin_client_state.last_seen_at, excluded.last_seen_at),
    first_installed_at = COALESCE(plugin_client_state.first_installed_at, excluded.first_installed_at),
    last_installed_at = CASE
      WHEN excluded.last_installed_at IS NULL THEN plugin_client_state.last_installed_at
      WHEN plugin_client_state.last_installed_at IS NULL THEN excluded.last_installed_at
      ELSE MAX(plugin_client_state.last_installed_at, excluded.last_installed_at)
    END,
    install_count = plugin_client_state.install_count + excluded.install_count,
    reinstall_count = plugin_client_state.reinstall_count + excluded.reinstall_count,
    update_count = plugin_client_state.update_count + excluded.update_count,
    remove_count = plugin_client_state.remove_count + excluded.remove_count,
    failure_count = plugin_client_state.failure_count + excluded.failure_count,
    current_state = CASE
      WHEN NEW.status = 'success' AND NEW.operation = 'remove' THEN 'removed'
      WHEN NEW.status = 'success' AND NEW.operation IN ('install', 'reinstall', 'update') THEN 'installed'
      ELSE plugin_client_state.current_state
    END,
    current_version = CASE
      WHEN NEW.status = 'success' AND NEW.operation = 'remove' THEN NULL
      WHEN NEW.status = 'success' AND NEW.operation IN ('install', 'reinstall', 'update')
        THEN COALESCE(NEW.after_version, plugin_client_state.current_version)
      ELSE plugin_client_state.current_version
    END;
END;

CREATE TRIGGER IF NOT EXISTS installation_events_rollup_hourly
AFTER INSERT ON installation_events
BEGIN
  INSERT INTO plugin_hourly_stats (
    plugin_id,
    bucket_hour,
    install_count,
    first_install_count,
    reinstall_count,
    update_count,
    remove_count,
    failure_count,
    unique_client_count,
    latest_install_at
  ) VALUES (
    NEW.plugin_id,
    NEW.server_received_hour,
    CASE
      WHEN NEW.status = 'success' AND NEW.operation IN ('install', 'reinstall') THEN 1
      ELSE 0
    END,
    CASE
      WHEN NEW.status = 'success'
        AND NEW.operation IN ('install', 'reinstall')
        AND NOT EXISTS (
          SELECT 1
          FROM installation_events AS prior
          WHERE prior.client_hash = NEW.client_hash
            AND prior.plugin_id = NEW.plugin_id
            AND prior.profile = NEW.profile
            AND prior.status = 'success'
            AND prior.operation IN ('install', 'reinstall')
            AND prior.event_id <> NEW.event_id
        )
        THEN 1
      ELSE 0
    END,
    CASE WHEN NEW.status = 'success' AND NEW.operation = 'reinstall' THEN 1 ELSE 0 END,
    CASE WHEN NEW.status = 'success' AND NEW.operation = 'update' THEN 1 ELSE 0 END,
    CASE WHEN NEW.status = 'success' AND NEW.operation = 'remove' THEN 1 ELSE 0 END,
    CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END,
    0,
    CASE
      WHEN NEW.status = 'success' AND NEW.operation IN ('install', 'reinstall')
        THEN NEW.server_received_at
      ELSE NULL
    END
  )
  ON CONFLICT (plugin_id, bucket_hour) DO UPDATE SET
    install_count = plugin_hourly_stats.install_count + excluded.install_count,
    first_install_count = plugin_hourly_stats.first_install_count + excluded.first_install_count,
    reinstall_count = plugin_hourly_stats.reinstall_count + excluded.reinstall_count,
    update_count = plugin_hourly_stats.update_count + excluded.update_count,
    remove_count = plugin_hourly_stats.remove_count + excluded.remove_count,
    failure_count = plugin_hourly_stats.failure_count + excluded.failure_count,
    latest_install_at = CASE
      WHEN excluded.latest_install_at IS NULL THEN plugin_hourly_stats.latest_install_at
      WHEN plugin_hourly_stats.latest_install_at IS NULL THEN excluded.latest_install_at
      ELSE MAX(plugin_hourly_stats.latest_install_at, excluded.latest_install_at)
    END;

  INSERT OR IGNORE INTO plugin_hourly_clients (plugin_id, bucket_hour, client_hash)
  SELECT NEW.plugin_id, NEW.server_received_hour, NEW.client_hash
  WHERE NEW.status = 'success' AND NEW.operation IN ('install', 'reinstall');
END;

CREATE TRIGGER IF NOT EXISTS plugin_hourly_clients_rollup_unique
AFTER INSERT ON plugin_hourly_clients
BEGIN
  UPDATE plugin_hourly_stats
  SET unique_client_count = unique_client_count + 1
  WHERE plugin_id = NEW.plugin_id AND bucket_hour = NEW.bucket_hour;
END;
