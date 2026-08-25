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

A staging Worker (`dsh-1024store-uat`) can be bound to this repository's `main` via Cloudflare
Workers Builds. It is the `uat` environment declared in `web/wrangler.jsonc` (`env.uat`):
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
- Copy the production secret values onto the staging Worker (`wrangler secret put … --env
  uat`, run from `web/`) so hashing and sync behave identically. GitHub OAuth login needs its own
  OAuth App (the callback URL is origin-derived), so it stays unconfigured on staging
  unless deliberately set up.
- The LiveStats Durable Object is per-Worker, so staging keeps its own live counters.
- Production (`dsh-store`) still deploys ONLY via the manual runbook above; never point a
  Builds deploy command at the production config.

## Planned: converting production to Workers Builds

Once the UAT worker has proven the Builds flow, production (`dsh-store`) is intended to
adopt the SAME configuration. The 1:1 mapping, with the deliberate differences:

- **Connect the repository to the EXISTING `dsh-store` Worker** (Connect repository on its
  page) — never create a new Builds project/worker for production: a new worker would not
  hold the custom-domain bindings, the D1/KV attachments, or the LiveStats DO state.
- Root directory `/web`, build `npm install && npm run build`, deploy `npx wrangler deploy`
  — identical to UAT.
- **No `CLOUDFLARE_ENV` variable.** Its absence selects the top-level (production) config:
  `dsh-store`, the three custom domains, the five-secret deploy gate. This is the only
  intended difference from the UAT project.
- Runtime secrets: production already carries its real values (`GITHUB_TOKEN`,
  `INSTALL_CLIENT_HASH_SECRET`, `CATALOG_SYNC_TOKEN`, both OAuth secrets) — connecting
  Builds does not touch them, and the production `CATALOG_SYNC_TOKEN` must NEVER be
  replaced by the UAT one (it is paired with the catalog repo's Actions secret).

Converting flips the deploy policy: pushes to `main` will deploy production, so the
"deploys are a deliberate local act" rule above is retired at that moment, and the
migration discipline REPLACING it becomes mandatory: apply D1 migrations BEFORE merging
the change that needs them, and write code that tolerates both the old and the new schema
(migration 0014 + the categories code is the reference example: table applied first, the
Worker degrades loudly but safely without it). Update this document and AGENTS.md in the
same change that flips the switch.

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
