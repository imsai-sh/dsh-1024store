# Security Policy

## Reporting a vulnerability

Do not open a public issue for an exploitable vulnerability in DSH 1024Store — the deepseek1024.com site, its Cloudflare Worker API, or the `dsh1024` npm package. Use GitHub's private vulnerability reporting for this repository when available, and include affected routes or commands, reproduction steps, and impact.

## Scope notes

- The Worker's public API surface is documented in [web/docs/api.md](web/docs/api.md); the anonymous install telemetry the `dsh1024` CLI emits is documented in [web/docs/install-analytics.md](web/docs/install-analytics.md).
- Plugins listed on deepseek1024.com point to independently maintained repositories. Report vulnerabilities in a listed plugin to that plugin's maintainer — listing is not a security review or endorsement. The catalog itself is maintained in [imsai-sh/awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins).
