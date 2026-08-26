# Contributing

This repository holds the DSH 1024Store application: the deepseek1024.com site + Worker
(`web`) and the published `dsh1024` npm package (`plugin`). **Plugin
submissions do not belong here** — submit plugins to the catalog repository,
[imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins/blob/main/CONTRIBUTING.md).

## Before you open a pull request

1. Create a focused branch from `main`.
2. For any API-related change, register the route and compatibility evidence in
   `web/contracts/` and preserve every existing-version contract. Breaking behavior
   requires a new versioned route while the previous version remains available. Run
   `npm run test:api-contract`.
3. Run `npm run cf-typecheck`, `npm run typecheck`, `npm test`, and `npm run build`.
4. For visible UI changes, run `npm run test:visual` and verify both desktop and mobile
   viewports (see [AGENTS.md](AGENTS.md) for the responsive requirements).
5. Never commit `.dev.vars`, GitHub tokens, Cloudflare credentials, or other secrets.

`GET /api/v1/plugins` and `GET /api/v1/registry` response shapes are frozen — third-party
consumers depend on them. Additive changes go to versioned v2/v3 routes. See
[web/docs/api.md](web/docs/api.md) and [AGENTS.md](AGENTS.md) for the full invariants, and
[web/docs/deployment.md](web/docs/deployment.md) for how deploys work (merging to `main`
auto-deploys production via Workers Builds, so D1 migrations must be applied BEFORE the
code that needs them merges).

## License

Code contributions are provided under the [MIT License](LICENSE).
