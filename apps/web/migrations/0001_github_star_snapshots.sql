CREATE TABLE IF NOT EXISTS github_star_snapshots (
  repository TEXT NOT NULL,
  bucket_hour INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  star_count INTEGER NOT NULL CHECK (star_count >= 0),
  PRIMARY KEY (repository, bucket_hour)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_github_star_snapshots_bucket
  ON github_star_snapshots(bucket_hour);
