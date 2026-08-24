# Repository instructions

## Public URL stability

- Canonical public paths: `/` (rankings), `/plugins` (catalog), `/plugins/:owner/:name` (plugin detail), `/docs/api` (public API reference), `/community` (community feed), `/community/p/:id` (post), `/community/about` (rules), `/account` and `/community/u/:login` (noindex).
- Plugin API routes use the `/api/v1/` prefix with plural resources (`/api/v1/plugins`, `/api/v1/plugins/:owner/:name`). The outward-facing search API is `https://api.deepseek1024.com/v1/plugins/search`.
- `/plugin`, `/plugin/:owner/:name`, `/packages`, `/packages/:owner/:name` and `/rankings` are permanent 301 **sources only**. Do not cite them as live URLs.
- Treat public route paths as permanent SEO contracts. Do not rename or remove them without explicit user approval and a migration plan covering permanent redirects, canonical URLs, and existing inbound links.
- Page titles, descriptions, JSON-LD and the crawlable pre-hydration shell all come from `apps/web/worker/seo-templates.ts` and `apps/web/worker/seo-content.ts`. Both the Worker and the React app import them; never fork the copy into a page component or a translation file.
- When replacing an already-published route, keep a permanent redirect from the old path to the canonical path.

## API backward compatibility

- Every API is a published compatibility contract, whether it is currently used by the site, a non-Web client, a third party, an authenticated tool, an internal sync job or a WebSocket client. Never assume a site-only caller updates in lockstep with the Worker.
- Within an existing API version, do not remove or rename fields, change types or nullability, reinterpret values, change defaults, status/error codes, pagination, ordering, authentication behavior or important headers. Treat new response enum values as potentially breaking. Compatible additions must remain optional or ignorable to old clients.
- Breaking changes require a new versioned route while the previous route and its behavior remain available through an explicit migration and deprecation period.
- `apps/web/contracts/api-surface.json` is the exhaustive API inventory. Every Hono API route, Worker-owned API transport and public-host alias must be registered there. Versioned response schemas and golden semantic fixtures live beside it.
- Run `npm run test:api-contract` for every API-related change. Do not make a failure green by casually rewriting a historical schema or golden fixture; contract changes require explicit API-owner review. Keep the route coverage test, historical request behavior and known consumer-adapter tests current.

## Bound hostnames and the public API surface

The Worker answers on three custom domains, all declared in `apps/web/wrangler.jsonc`
under `routes`, and each host has a deliberately different surface. `apps/web/worker/public-api.ts`
is the single place that decides which is which; `apps/web/tests/public-api.test.ts` guards it.

- `deepseek1024.com` — the website and the full `/api/...` surface, including sign-in and API-key
  management. This is the only host that serves the site.
- `www.deepseek1024.com` — a bound custom domain that exists solely to `301` to the apex host
  (`wwwRedirect`). It is not an alias you can serve content from.
- `api.deepseek1024.com` — the public developer API. It exposes an **allow-list of two paths**,
  `PUBLIC_API_PATHS` in `public-api.ts`, rewritten onto the internal routes:
  `/v1/plugins/search` → `/api/v1/plugins/search`, and `/v1/health` → `/api/v1/health`.

That host exists for third-party consumers, and its one substantive endpoint is metered
independently of the site. `/v1/plugins/search` enforces a per-caller quota — `ANONYMOUS_QUOTA`
and `AUTHENTICATED_QUOTA` in `apps/web/worker/lib/api-quota.ts`, counters kept in D1 through
`consumeQuota`: 10/min and 50/day anonymous, 30/min and 500/day with a key. Anonymous callers are
keyed by `ip:<HMAC of CF-Connecting-IP>` so the raw address never reaches D1; authenticated callers
are keyed by `user:<id>` and not by key id, so rotating or minting keys cannot open a fresh window.
Every response carries `X-RateLimit-Daily-Limit` and `X-RateLimit-Daily-Remaining`; a rejection adds
`Retry-After` and returns `429`, with `DAILY_QUOTA_EXCEEDED` for the day window and `RATE_LIMITED`
for the minute window. `/v1/health` is deliberately unmetered.

The quota lives on the search handler in `apps/web/worker/app.ts`, not on the host check, so
`deepseek1024.com/api/v1/plugins/search` draws down the same counters.

Four ways this gets broken, in rough order of likelihood:

1. **Assuming a 404 on `api.deepseek1024.com` is a bug.** Every path outside the allow-list returns
   `404 {"code":"NOT_FOUND"}` on purpose, and `/` returns `302` to `/docs/api`. So
   `api.deepseek1024.com/v1/registry` and `.../api/v1/registry` both 404 while
   `deepseek1024.com/api/v1/registry` works — that is the design, not a routing fault. Verify the
   host is healthy with `/v1/health`, which returns `{"status":"ok"}`.
2. **Expecting a new internal endpoint to appear on the API host.** Adding `/api/v1/<thing>` to the
   Worker does *not* publish it at `api.deepseek1024.com/v1/<thing>`. Publishing is a separate,
   deliberate act: add the mapping to `PUBLIC_API_PATHS`. Keep sign-in, key management, and anything
   session- or cookie-bearing off this host.
3. **Publishing a public endpoint without metering it.** Adding a path to `PUBLIC_API_PATHS` only
   routes it; the quota is per-handler. A new public endpoint that never calls `consumeQuota` is
   unmetered on an unauthenticated host. Decide the tier deliberately, and keep `/v1/health` the
   only unmetered entry.
4. **Editing `routes` without listing every domain.** That array is the authoritative binding list,
   not a patch. Deploying with a custom domain missing unbinds it, and requests to the dropped
   hostname start failing with `522`. Always keep all three entries; only ever add.

Deploying is a deliberate local act, not a consequence of pushing: run `npm run deploy` (its
`predeploy` builds first). Landing a change on `main` publishes nothing until someone does.
When the change carries a D1 migration, export a backup first, apply the migration, and only
then deploy — the Worker and the schema must move together, and a Worker deployed against the
old schema cannot read the catalog:

```bash
npx wrangler d1 export CATALOG_DB --remote --output=catalog-backup-$(date +%Y%m%d-%H%M).sql
npm run db:migrate:remote --workspace @dsh-1024store/web
npm run deploy
```

Extend `apps/web/tests/public-api.test.ts` whenever you change which host serves what.

## The site is one app with four sections

`/` (rankings), `/plugins` (catalog), `/community`, `/docs/api` are sections of a
single React app behind one persistent sidebar (`src/components/AppShell.tsx`).
Switching between them is a client-side route change — no reload, so the reader
keeps their session, their language and their scroll position. There is one
Worker, one build, one deploy, one migration sequence.

The community's code is grouped rather than separated: `src/community/` for the
UI, `worker/community/` for its routes and D1 access, `tests/community-*.ts` for
its tests. It is not a package or a workspace, because nothing else consumes it.

Four things this depends on:

1. **`src/community/community.css` is scoped entirely under `.community`.** The
   section and the catalog share generic class names — `.button-primary`,
   `.back-link`, `.avatar-image` — and an unscoped rule here silently restyles the
   catalog. That has already happened once: the community's own `.language-switch`
   rules overrode the site's, and only `test:visual` noticed. Keep new rules
   scoped.
2. **Community links go through `src/community/lib/paths.ts`.** A bare `/p/12`
   was correct while the section had its own router basename; inside the site it
   lands on the catalog. `test:visual` asserts no `.post` link escapes the prefix.
3. **A post's title comes from D1, everything else from the templates.** Static
   community copy lives in `seo-templates.ts` with the rest of the site's; only
   `communityPostMetadata` (`worker/community/metadata.ts`) reads a row, and
   `worker/index.ts` layers it over the static metadata.
4. **`COMMUNITY_DEV_LOGIN` is read through a cast, not declared on `Env`.** It is
   not a binding: it appears in no wrangler config, only in git-ignored
   `.dev.vars`, which `wrangler deploy` does not read. Declaring it would invite
   someone to "fix" the missing binding by adding it to `wrangler.jsonc`, which is
   the one thing that must not happen — the loopback hostname check would then be
   all that stands between a visitor and a session for any login they name.

Seed the local community with `npm run seed:community` (writes only to the
miniflare SQLite file under `apps/web/.wrangler`).

## Responsive web support

- The website supports both desktop and mobile devices. Treat both layouts as first-class release requirements.
- Start from the narrow layout and progressively enhance it. Do not rely on fixed desktop widths, hover-only interactions, or desktop-only information hierarchy.
- For every UI, layout, spacing, or typography change, design and verify both desktop and touch-enabled mobile viewports; do not approve a change based on desktop appearance alone.
- As a minimum, run `npm run test:visual` and check representative viewports around 1440×900, 390×844, and 320×568. Confirm there is no unintended page-level horizontal overflow, clipping, overlap, or content hidden behind sticky UI or safe areas.
- Primary buttons, icon buttons, tabs, filters, and other repeated controls must provide at least a 44×44 CSS-pixel touch target on mobile. Inputs must use a 16px or larger font on mobile so iOS does not zoom the page on focus.
- Keep body and explanatory copy readable on mobile (normally at least 12px for compact metadata and 14px for prose). Prefer reflowing or intentionally scrollable local regions over shrinking text to make desktop layouts fit.
- Horizontal chip, tab, table, code, and README overflow must stay inside an intentional local scroller with touch panning; the document itself must never scroll horizontally.
- Preserve task priority when content stacks: primary actions and safety information come before secondary metadata, and long-form content comes afterward.
- When changing responsive behavior, extend `apps/web/scripts/visual-check.mjs` with a regression assertion for the affected mobile interaction or layout invariant.

## The two-repository split

This repository holds the DSH 1024Store application only: `apps/web` (the deepseek1024.com
site + `dsh-store` Worker) and `packages/dsh1024` (the published npm package). The plugin
catalog — `catalog/plugins/*.json`, the awesome-list README generation, and the plugin
submission review workflow — lives in
[imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins).
Rules that follow from the split:

- **Frozen external API.** `GET /api/v1/plugins` and `GET /api/v1/registry` response shapes
  are frozen: third-party consumers depend on them, and the dsh1024 validator rejects a
  registry response where `count` and `plugins.length` disagree. Additive changes go to
  versioned v2/v3 routes.
- **`catalog/categories.json` is a vendored mirror** of the catalog repository's file. A
  category change lands in both repositories and only reaches the site when this Worker is
  redeployed. Never let the two copies drift.
- **Identity constants are data, not paths.** `imsai-sh/awesome-deepseek-harness-plugins`
  (and `…/packages/dsh1024`) key live D1 rows, `/api/v1/self/update`, and install
  analytics. They deliberately keep the catalog repository's name; do not rename them to
  match this repository.
- **Cross-repo invariants with no shared CI** (drift fails silently — check the catalog
  repo when touching these): `worker/lib/plugin-id.ts` ↔ `scripts/lib/catalog-entry.mjs`;
  `worker/app.ts` `ENTRY_ID`/`ENTRY_KEYS` ↔ `catalog/schema/plugin.schema.json`;
  `worker/lib/install-methods.ts` ↔ `scripts/review-plugin-submission.mjs`;
  `worker/lib/categories.ts` `UNCLASSIFIED_CATEGORY` ↔ the catalog repo's README generator.
- **The catalog repo's CI depends on this Worker.** Its catalog-sync workflow POSTs to
  `POST /api/v1/catalog/sync` with `CATALOG_SYNC_TOKEN` (same value must exist as a Worker
  secret here and an Actions secret there), its README generator pages `/api/v2/plugins`,
  and it screenshots the live homepage. See `docs/deployment.md`.
