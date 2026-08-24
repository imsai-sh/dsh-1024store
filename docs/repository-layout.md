# Repository layout

## Decision

The DSH 1024Store **application** — the deepseek1024.com site + Worker (`apps/web/`) and the
publishable `dsh1024` npm package (`packages/dsh1024/`) — lives in this repository. The
**catalog** — the awesome list, plugin submission PRs, README generation, and the submission
review workflow — lives in
[imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins).
The two repositories were split on 2026-08-25 from a single monorepo (up to commit `0520539`
of the catalog repository) so each side has one clear responsibility.

## Directory responsibilities

| Path | Responsibility | Published? |
| --- | --- | --- |
| `apps/web/src/` | React front end of deepseek1024.com | Deployed to Cloudflare |
| `apps/web/worker/` | The `dsh-store` Worker: public API, catalog store, community, SEO | Deployed to Cloudflare |
| `apps/web/contracts/` | Frozen API surface manifest, golden fixtures, versioned schemas | Governs the API |
| `apps/web/migrations/` | D1 migrations for `dsh-store-star-history` | Applied to production D1 |
| `packages/dsh1024/` | The publishable `dsh1024` package: wrapper CLI + in-DSH marketplace plugin | Published to npm |
| `catalog/categories.json` | Vendored copy of the category definitions (see below) | Bundled into the Worker |
| `docs/` | API reference, install analytics, deployment runbook | Reference |

## Single sources of truth

| Data | Source of truth |
| --- | --- |
| Live catalog entries | Production D1 (`dsh-store-star-history`), fed by the catalog repo's sync workflow and the maintainer's out-of-band collection jobs |
| Catalog read path | KV snapshot (`CATALOG_CACHE`), rebuilt by the sync endpoint or on cold start |
| Curated entry files | `catalog/plugins/*.json` in the catalog repository |
| Category definitions | `catalog/categories.json` in the **catalog repository**; the copy here is a vendored mirror that must be updated in lockstep and redeployed |
| API shapes | `apps/web/contracts/api-surface.json` + `docs/api.md`; `GET /api/v1/plugins` and `GET /api/v1/registry` are frozen |

## Cross-repo invariants (no CI spans both repositories)

These pairs must stay aligned by hand; nothing fails locally when they drift:

- `apps/web/worker/lib/plugin-id.ts` (`isPluginId`/`normalizePluginId`) ↔ the catalog repo's `scripts/lib/catalog-entry.mjs` id validation. Drift means a PR passes review but the sync endpoint rejects it.
- `apps/web/worker/app.ts` (`ENTRY_ID`, `ENTRY_KEYS`) ↔ the catalog repo's `catalog/schema/plugin.schema.json`. A schema change there requires a coordinated Worker deploy from here.
- `apps/web/worker/lib/install-methods.ts` install classification ↔ the catalog repo's `scripts/review-plugin-submission.mjs` `classifyGitInstall`.
- `apps/web/worker/lib/categories.ts` (`UNCLASSIFIED_CATEGORY`) and `catalog/categories.json` ↔ the catalog repo's copy of `catalog/categories.json` and its README generator.

## Identity constants are data, not paths

The store's own plugin id `imsai-sh/awesome-deepseek-harness-plugins` (and
`…/packages/dsh1024`) keys live D1 rows, install analytics, `/api/v1/self/update`, and the
public release URL. It deliberately retains the catalog repository's name even though the
code now lives here. Do not "fix" it to name this repository — that would strand every
installed CLI and reset install-count continuity.
