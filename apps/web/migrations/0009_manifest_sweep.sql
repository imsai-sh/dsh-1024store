-- A repository publishes as many plugins as it has bundles.
--
-- The crawler used to stop at the first `package.json` that declared
-- `dsh.bundle` and write it to the single plugin row `upsertDiscoveredRepositories`
-- had created, so a monorepo shipping 24 packages surfaced exactly one of them.
-- Everything the multi-plugin grain needed already existed in 0005 — the
-- primary key is (repository_id, plugin_path), and the snapshot reads rows, not
-- repositories. What was missing is the crawler's ability to sweep a whole tree
-- across more than one pass, which is what these two columns are for.
--
-- manifest_cursor  the last manifest path the previous pass read, or NULL when
--                  no sweep is in flight. The next pass resumes at the first
--                  manifest that sorts after it. Deliberately a path and not an
--                  index: a positional offset is measured against a manifest
--                  list rebuilt from a fresh git tree every pass, so one file
--                  removed ahead of the cursor shifts the window by one and the
--                  sweep skips a live package — which the reconciliation below
--                  would then read as "vanished" and retire. A path cursor is
--                  stable under insertions and deletions alike. It replaces a
--                  bare `.slice(0, 25)` that discarded the tail in silence.
-- sweep_started_at when the current sweep began. Plugin rows are stamped with
--                  it as they are re-confirmed, so when the sweep finishes the
--                  rows it never touched are exactly the plugins that vanished.
--                  Retiring them needs a full sweep, never a single pass.

ALTER TABLE catalog_repositories ADD COLUMN manifest_cursor TEXT;
ALTER TABLE catalog_repositories ADD COLUMN sweep_started_at TEXT;

CREATE INDEX catalog_repositories_sweep_idx ON catalog_repositories (manifest_cursor);

-- ---------------------------------------------------------------------------
-- One-time repair: the placeholder rows the old crawler could not stop making.
--
-- `upsertDiscoveredRepositories` inserted a plugin row at plugin_path '' for
-- every discovered repository, and inspection then *moved* that row to the
-- directory where it found the bundle. That vacated the (repository_id, '')
-- slot, so the next scan's ON CONFLICT DO NOTHING no longer matched and a fresh
-- root row was inserted — pending, unmovable (the move is guarded by NOT EXISTS
-- and the target path is now taken), and unreachable by the status write (which
-- targets the manifest's path). Every nested-bundle monorepo therefore kept one
-- permanently pending row, which kept the repository in the validation queue
-- forever and had the crawler re-fetch its tree and manifests on every single
-- run. The queue predicate is push-driven from here on, so these rows have no
-- job left; they were never published (that needs 'accepted' or from_pr = 1),
-- so deleting them is invisible to readers.
DELETE FROM catalog_plugins
 WHERE plugin_path = ''
   AND from_pr = 0
   AND package_name IS NULL
   AND validation_status = 'pending'
   AND EXISTS (
     SELECT 1 FROM catalog_plugins sibling
      WHERE sibling.repository_id = catalog_plugins.repository_id
        AND sibling.plugin_path <> ''
   );

-- Curated plugins were never given a verdict either: syncCuratedEntries does
-- not write validation_status (it must not — that column belongs to the
-- crawler), and the crawler only ever wrote the one path its inspection
-- returned. Leaving them 'pending' keeps their repository in the queue for the
-- same reason. Clearing the cursor here lets the new sweep re-confirm them
-- properly on its next pass.
UPDATE catalog_repositories SET manifest_cursor = NULL, sweep_started_at = NULL;
