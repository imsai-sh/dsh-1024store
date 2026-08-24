# dsh-1024store

The source of [deepseek1024.com](https://deepseek1024.com/) — the DSH 1024Store website and Cloudflare Worker — and the [`dsh1024`](https://www.npmjs.com/package/dsh1024) npm package (the wrapper CLI plus the in-harness 1024Store plugin).

deepseek1024.com（DSH 1024Store 网站与 Cloudflare Worker）以及 [`dsh1024`](https://www.npmjs.com/package/dsh1024) npm 包（包装 CLI + DSH 内嵌 1024Store 插件）的源码仓库。

## Layout

| Path | What it is |
| --- | --- |
| `apps/web/` | React site + Cloudflare Worker serving deepseek1024.com (catalog UI, community, public API) |
| `packages/dsh1024/` | The publishable `dsh1024` npm package: wrapper CLI and the in-DSH marketplace plugin |
| `catalog/categories.json` | Vendored copy of the category definitions — must stay in lockstep with the catalog repo (see below) |
| `docs/` | API reference, install analytics, deployment runbook |

The plugin catalog itself — the awesome list, plugin submission PRs, and README generation — lives in [imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins). Submit plugins there, not here.

插件目录（awesome 清单、插件收录 PR、README 生成）在 [imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins)。提交插件请去那边，不要提到本仓库。

## Development

```bash
npm ci
npm run dev            # vite dev server for apps/web
npm run typecheck
npm test               # dsh1024 package tests + web vitest suite
npm run build
```

See [AGENTS.md](AGENTS.md) for the invariants that must hold (frozen API surface, bound hostnames, deploy runbook) and [docs/api.md](docs/api.md) for the public API reference.

## Relationship with the catalog repository

- The catalog repo's CI POSTs curated entries to this Worker's `POST /api/v1/catalog/sync` (bearer `CATALOG_SYNC_TOKEN`).
- `catalog/categories.json` here is a vendored copy of the same file in the catalog repo; a category change must land in both and ships only when this Worker is redeployed.
- `GET /api/v1/plugins` and `GET /api/v1/registry` response shapes are frozen — external consumers depend on them.

## License

MIT — see [LICENSE](LICENSE).
