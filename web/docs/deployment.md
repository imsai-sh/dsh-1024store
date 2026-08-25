# Deployment and operations

The configured D1 database is `dsh-store-star-history`; it stores both star history and the
primary catalog. The Worker name is `dsh-store`. Both are legacy identifiers deliberately
retained — renaming either detaches live production state (custom domains, D1/KV bindings,
the LiveStats Durable Object). Apply migrations before deploying:

```bash
npm ci
npm run typecheck
npm test
npx wrangler d1 export CATALOG_DB --remote --output=catalog-backup-$(date +%Y%m%d-%H%M).sql
npm run db:migrate:remote --workspace @dsh-1024store/web
npm run deploy
```

Nothing deploys on a push: publishing is this local sequence, run deliberately, from an
up-to-date `main` checkout only.

Take the export before every migration and check that it restores (`sqlite3 tmp.db < backup.sql`).
It is the only way back: a Worker cannot read a schema it predates, so rolling one back means
rolling back both.

`GITHUB_TOKEN` must be a Cloudflare Worker secret, never a Wrangler plaintext variable or a
committed `.dev.vars` value; the plugin detail endpoint uses it to read repository metadata.

## Staging worker (pre-release twin)

A staging Worker (`dsh-1024store`) can be bound to this repository's `main` via Cloudflare
Workers Builds. It deploys the exact same bundle against the SAME production D1/KV, and
differs from production only in Worker name and the absence of `routes` (it serves from
workers.dev). Build command:

```
npm ci && npm run build --workspace @dsh-1024store/web && node web/scripts/make-staging-deploy-config.mjs
```

Deploy command:

```
npx wrangler deploy --config web/dist/dsh_store/wrangler.staging.json
```

Notes:

- Staging shares production data: install events, community writes, and quota counters
  from staging land in the production D1. `POST /api/v1/catalog/sync` on staging rebuilds
  the shared KV snapshot (idempotent, same data).
- Copy the production secret values onto the staging Worker (`wrangler secret put … --name
  dsh-1024store`) so hashing and sync behave identically. GitHub OAuth login needs its own
  OAuth App (the callback URL is origin-derived), so it stays unconfigured on staging
  unless deliberately set up.
- The LiveStats Durable Object is per-Worker, so staging keeps its own live counters.
- Production (`dsh-store`) still deploys ONLY via the manual runbook above; never point a
  Builds deploy command at the production config.

## Category-definitions rollout order (one-time, migration 0014)

Categories moved from bundled code into D1. Both wrong orders break the catalog repo's
CI, so the one-time rollout is strictly:

1. Apply migration 0014 to the production D1 (`npm run db:migrate:remote`, after the
   usual export/backup). The old Worker ignores the new table; nothing changes yet.
2. Deploy this Worker (staging deploys automatically on push; production via the runbook
   above). A Worker running this code WITHOUT the table refuses to rebuild the snapshot
   (degrading to the previous one, or an empty catalog on a cold start) and answers 503
   on sync — loud, not silently uncategorized.
3. Only then land the catalog repository's change that adds `categories` to its sync
   payload — an older deployed Worker rejects the whole request with
   `400 Unexpected field: categories.`

## Cross-repo contracts

The plugin catalog data is maintained in
[imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins),
whose CI depends on this Worker being deployed and healthy:

- `POST /api/v1/catalog/sync` — the catalog repo's `catalog-sync` workflow pushes curated
  entries here with `Bearer CATALOG_SYNC_TOKEN`. The token value lives in two places that
  must match: a secret on the `dsh-store` Worker (`wrangler secret put CATALOG_SYNC_TOKEN`)
  and an Actions secret in the catalog repo. Rotating it is a coordinated two-repo change.
- `GET /api/v2/plugins` — the catalog repo's README generator pages through this endpoint;
  its pagination metadata (`generatedAt`, `total`) is part of the contract.
- The catalog repo's CI also screenshots the live homepage for its README hero image.

A bad deploy from this repository therefore turns the catalog repo's `catalog-sync`
workflow red or stale. Deploy accordingly.
