# Deployment and operations

The configured D1 database is `dsh-store-star-history`; it stores both star history and the
primary catalog. The Worker name is `dsh-store`. Both are legacy identifiers deliberately
retained — renaming either detaches live production state (custom domains, D1/KV bindings,
the LiveStats Durable Object).

**Production deploys automatically from `main`** via Cloudflare Workers Builds (same stock
configuration as the UAT project below, with NO `CLOUDFLARE_ENV` variable — its absence
selects the top-level production config). Landing a change on `main` IS publishing it.
The manual path stays available as the emergency/fallback channel and behaves identically:

```bash
npm run deploy   # predeploy builds first; identical to what Builds runs
```

Because code reaches production on merge, changes carrying a D1 migration follow one of
two lanes. Reads never touch D1 (they serve the KV snapshot), so the exposure in either
lane is only seconds of failed WRITES — install events retry from the client's local
queue.

**Additive migrations** (new tables, nullable columns — the common case): migrate FIRST,
merge SECOND; the window is inherently harmless (migration 0014 + the categories code is
the reference example):

```bash
npx wrangler d1 export CATALOG_DB --remote --output=../catalog-backup-$(date +%Y%m%d-%H%M).sql --config web/wrangler.jsonc
npm run db:migrate:remote
# only then merge/push the code that relies on the new schema
```

**Destructive migrations** (dropping/renaming columns, rebuilding tables): pick a quiet
hour and run the migration and the deploy back-to-back via the manual channel — accept
the few seconds of failed writes in between; no multi-step expand/contract dance needed:

```bash
npx wrangler d1 export CATALOG_DB --remote --output=../catalog-backup-$(date +%Y%m%d-%H%M).sql --config web/wrangler.jsonc
npm run db:migrate:remote && npm run deploy   # back-to-back, seconds apart
```

The backup is the one non-negotiable in both lanes, and code must never PERSIST a bad
state during a window (the snapshot builder refusing a category-less catalog is the
pattern).

Take the export before every migration and check that it restores (`sqlite3 tmp.db < backup.sql`).
It is the only way back: a Worker cannot read a schema it predates, so rolling one back means
rolling back both.

`GITHUB_TOKEN` must be a Cloudflare Worker secret, never a Wrangler plaintext variable or a
committed `.dev.vars` value; the plugin detail endpoint uses it to read repository metadata.

## Staging worker (pre-release twin)

A staging Worker (`dsh-1024store-uat`) is bound to this repository's `uat` branch via
Cloudflare Workers Builds. It is the `uat` environment declared in `web/wrangler.jsonc` (`env.uat`):
the exact same bundle against the SAME production D1/KV, differing from production only in
Worker name and the explicitly-empty `routes` (it serves from workers.dev). The Builds
project uses stock commands — the environment is selected by a build variable, not a flag:

| Builds setting | Value |
| --- | --- |
| Root directory | `/web` |
| Build command | `npm install && npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build variable | `CLOUDFLARE_ENV=uat` — the only one needed (the staging env drops the required-secrets build gate, so no placeholder values are necessary) |

The Cloudflare vite plugin reads `CLOUDFLARE_ENV` at build time and emits the
staging-resolved deploy config, which the bare `npx wrangler deploy` then picks up.
Without the variable the same two commands build and target production — which is why the
variable lives in the staging Builds project and nowhere else.

Notes:

- Staging shares production data: install events, community writes, and quota counters
  from staging land in the production D1. `POST /api/v1/catalog/sync` on staging rebuilds
  the shared KV snapshot (idempotent, same data).
- UAT is a FULL production mirror, secrets included: set the SAME values production uses
  (`wrangler secret put … --env uat`, run from `web/`). `INSTALL_CLIENT_HASH_SECRET` in
  particular must equal production's — the D1 install-event ledger is shared, and a
  different salt would hash the same client to a different identity.
- GitHub OAuth reuses the PRODUCTION app: register the UAT callback
  (`https://<uat-host>/api/v1/auth/github/callback`) as an additional callback URL on the
  same GitHub app, then put the production `GITHUB_OAUTH_CLIENT_ID` /
  `GITHUB_OAUTH_CLIENT_SECRET` with `--env uat`. All five UAT secrets carry the exact
  production values.
- The LiveStats counters are SHARED with production: `env.uat` binds the Durable Object
  with `script_name: "dsh-store"`, so /api/live and the view counters are the same object
  production serves.
- Production (`dsh-store`) deploys from `main` through its own Builds project. The two
  projects differ in exactly two settings: the tracked branch (`uat` vs `main`) and the
  `CLOUDFLARE_ENV` variable (present on UAT, absent on production). The flow is: push to
  `uat` → verify on the UAT worker → merge to `main` → production deploys.

## Production via Workers Builds

Production (`dsh-store`) is connected to this repository's `main` as a Workers Builds
project ON THE EXISTING Worker (never recreate it: a new worker would not hold the
custom-domain bindings, the D1/KV attachments, or the LiveStats DO state):

- Root directory `/web`, build `npm install && npm run build`, deploy `npx wrangler deploy`
  — identical to UAT.
- **No `CLOUDFLARE_ENV` variable.** Its absence selects the top-level (production) config:
  `dsh-store`, the three custom domains, the five-secret deploy gate. This is the only
  intended difference from the UAT project.
- Runtime secrets live on the Worker and survive every deploy; the production
  `CATALOG_SYNC_TOKEN` must NEVER be replaced by the UAT one (it is paired with the
  catalog repo's Actions secret).
- The deploy gate validates the required secrets against the WORKER's stored secrets
  (verified empirically), so no build variables are needed.

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
