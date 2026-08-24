-- npm download totals belong to a published package, not to every fork or
-- vendored repository that declares its name. Clear legacy values from rows
-- whose registry metadata explicitly points at a different repository.
UPDATE catalog_plugins
   SET npm_downloads_7d = NULL,
       npm_downloads_start = NULL,
       npm_downloads_end = NULL,
       npm_downloads_status = 'pending',
       npm_downloads_checked_at = NULL,
       updated_at = CURRENT_TIMESTAMP
 WHERE npm_binding = 'mismatch'
   AND (npm_downloads_7d IS NOT NULL
     OR npm_downloads_start IS NOT NULL
     OR npm_downloads_end IS NOT NULL
     OR npm_downloads_status <> 'pending'
     OR npm_downloads_checked_at IS NOT NULL);
