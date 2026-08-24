# dsh1024

[中文](README.zh.md) | English

`dsh1024` is the DSH 1024Store package for DeepSeek Harness. One npm package
provides two entry points:

- **In-app 1024 Store plugin** — browse and install the curated
  [1024 catalog](https://deepseek1024.com/) from inside DeepSeek Harness. It
  appears both as a dedicated **1024 Store** entry in Settings and as a
  **1024 Store (count)** tab under **Settings → Plugins**.
- **Tracked installer CLI** — a thin, verifiable wrapper around the official
  DeepSeek Harness plugin command. It installs a catalog plugin, checks that
  the selected DSH profile really contains it, and submits an anonymous
  installation outcome to the DSH 1024Store statistics API.

## Install the CLI

Install it once, globally, and `dsh1024` is then available the same way the
official `dsh` command is:

```sh
npm install -g dsh1024
```

`npx dsh1024 …` keeps working if you would rather not install anything.

## Install the in-app store

```sh
npm install -g dsh1024 && dsh1024 plugin --profile web add dsh1024@latest
```

Installing directly with the official CLI is the same command under a different
name:

```sh
dsh plugin --profile web add dsh1024@latest
```

Restart DeepSeek Harness after installation.

The in-app store is a small local shell around the live
`https://deepseek1024.com/embed/store` page. Catalog presentation can therefore
ship with the website without requiring a new npm release. The title bar,
version check, one-click self-update, install bridge, and failure screen remain
local and keep working even when the remote page cannot be framed.

The embedded page has no shell access. Its versioned `MessageChannel` bridge
accepts only an `install` intent containing a catalog `pluginId` and a
parameter-free `installed` read; it cannot send a command, URL, path, or arbitrary
arguments. The local backend asks the trusted `/api/v1/registry` endpoint for
that id and derives the official DSH CLI argument array itself. The installed
view receives only matching catalog ids and their already-public catalog
summaries, never local dependency names, versions, specs, or paths. Every install
still requires local confirmation, same-origin POST requests, and the shared
operation mutex. Plugin changes take effect after restarting DeepSeek Harness.

Self-update checks prefer `/api/v1/self/update` on deepseek1024.com, then fall
back to the npm registry and the repository package manifest. The update button
runs the fixed target `dsh plugin --profile <profile> add dsh1024@<version>`;
remote content cannot select the package or version.

The store is reachable from three places: the sidebar footer (with a live
catalog count, and a popover it opens itself), the Settings navigation, and the
Settings → Plugins tab. Removing any of them fails the package preflight.

The catalog renders from the last response immediately, then silently
revalidates in the background every time the panel opens or the window becomes
visible again, so a newly listed plugin appears without any refresh button and
without a loading state. Concurrent refreshes collapse onto one request, and a
failed one leaves the visible catalog untouched.

## CLI usage

Node.js 22 or newer is required.

`dsh1024 plugin ...` **is** `dsh plugin ...` under a different name. Everything
from `plugin` onwards is forwarded to the official CLI exactly as written —
nothing is added, removed, reordered, or defaulted:

```sh
dsh1024 plugin --profile web add @scope/dsh-plugin
dsh plugin      --profile web add @scope/dsh-plugin
```

The two lines above run the same official operation. The wrapper's only job is
what happens around it: check the resulting profile and record one anonymous
install event.

Because nothing is defaulted, options behave exactly as the official CLI
documents them. Omitting `--profile` is passed on as written rather than
silently filled in, and `--`, refs, and every other official argument keep their
official meaning:

```sh
dsh1024 plugin --profile web add @scope/dsh-plugin@1.2.0
dsh1024 plugin --profile web add @scope/dsh-plugin -- \
  --ignore-scripts --reporter append-only --config.confirmModulesPurge=false
```

The wrapper executes the first example without a shell as:

```sh
npx --yes @deepseek-ai/dsh plugin --profile web add @scope/dsh-plugin@1.2.0
```

When an official `dsh` is already on PATH the wrapper runs that binary directly
instead of going through npx, which removes npx's resolution step from every
install. Pinning a version with `DSH1024_DSH_PACKAGE` always uses the npx form.
Only the way the official CLI is located differs; arguments, ordering, exit
codes, and stdio are unchanged.

Arguments never enter the telemetry event or the local receipt.

### What gets counted

The wrapper reads the argument vector to attribute the event; it never rewrites
it. An install is counted only when the vector is unambiguous and the target
resolves to a catalog repository. Everything else installs exactly the same way
and goes uncounted — a missing count is preferred over a wrong one.

The vector must name a profile (`--profile <name>` or `--profile=<name>`; the
official CLI has no `-p` alias), use an installing verb (`add`, `i`, `install`),
and install into the profile's own dependencies (`-D`, `--save-dev`, `-O`,
`--save-optional`, `--save-peer`, `-g` and `--global` are not counted).

Extra arguments pass through and behave exactly as the official CLI documents
them; `--reporter append-only` and friends change nothing about the install.
They matter to counting only when they leave more than one possible install
target — two repositories in one command, or an option the wrapper does not know
takes a separate value — in which case the install is not counted rather than
attributed to a guess.

| Target | Counted as | Where the id comes from |
| --- | --- | --- |
| `github:owner/repository`, `owner/repository` (optionally `#ref`, `.git`) | `owner/repository` | the argument itself |
| `github:owner/repository#path:sub/dir`, `owner/repository/sub/dir` | `owner/repository/sub/dir` | the argument itself |
| `dsh1024`, `dsh1024@<version>` | this catalog repository | fixed |
| Published package names, with or without a version/tag/range | the repository in the installed manifest | `repository` field of `node_modules/<name>/package.json`, read after a successful install |
| Local paths, `file:`, `link:`, `portal:`, URLs, drive letters, `~` | never reported | — |
| `gitlab:`, `bitbucket:`, `gist:`, `jsr:`, `workspace:`, `catalog:`, npm aliases, full git URLs | not counted | — |

The published-package lookup reads one local file — the installed package's own
`repository` field — and accepts npm's string and object spellings for
github.com hosts only. A monorepo `directory` becomes the id's path, so sibling
packages in one repository are counted separately. A missing or non-GitHub
field, a directory that escapes the repository, or a failed install with nothing
to read, means the install is not counted.

Local, `file:`, `link:` and `portal:` targets are a hard boundary: a filesystem
path can never reach an install event, a local receipt, or the retry queue.

## What is recorded

Each enabled attempt submits one event containing a random event UUID, a stable
random client UUID, plugin ID, DSH profile, install/reinstall result, client
timestamps and duration, before/after version when detectable, requested ref,
CLI/DSH versions when detectable, OS, CPU architecture, CI boolean, and a short
error code. The server receive time is added by the API.

After each install or uninstall performed inside the in-app store, the plugin
reports one anonymous outcome event of the same shape
(`sourceChannel: dsh-1024store-plugin`) to the same public endpoint as the CLI,
reusing the CLI's shared anonymous identity. Reporting is fire-and-forget and
silent on failure.

The client UUID belongs to this DSH home, not to a person or account. A person
using multiple DSH homes is counted as multiple anonymous installations; users
sharing one DSH home share one anonymous installation identity.

The package does **not** submit IP addresses, stderr/stdout, commands,
filesystem paths, usernames, environment values, session content, prompts, or
API keys. The service may see ordinary HTTP connection metadata while receiving
a POST; the event body contains only the documented fields above.

The identity is stored at `$DSH_HOME/.dsh-1024store/client.json` (default
`~/.dsh`). Installed package names and resolved versions stay in the local
`receipts.json` file and are not uploaded. Pending events stay in
`pending.json`, use idempotent event UUIDs, and are retried on the next install.
The queue keeps at most 1000 recent events. Network, rate-limit, and server
failures are retried; events permanently rejected as invalid are skipped so
they cannot block newer events. An upload failure never changes the plugin
install exit code. Client identity, queue, and receipt updates use short-lived
cross-process locks so concurrent installs sharing one `DSH_HOME` do not
overwrite each other; network requests run outside those locks.

Details: [docs/install-analytics.md](https://github.com/imsai-sh/dsh1024-oss/blob/main/docs/install-analytics.md).

## Controls

```sh
npx dsh1024 telemetry status
npx dsh1024 telemetry disable
npx dsh1024 telemetry enable
npx dsh1024 telemetry reset
```

`reset` rotates the local anonymous identity and clears the pending queue while
preserving the enabled or disabled preference; it does not uninstall plugins.
Persistently disabling telemetry also clears unsent events. Telemetry is also
disabled for a process when either
`DO_NOT_TRACK=1` or `DSH1024_TELEMETRY=0` is set.

## Configuration

- `DSH_HOME`: DSH data directory (default `~/.dsh`).
- `DSH1024_TELEMETRY`: set to `0` to disable telemetry for a process.
- `DSH1024_DSH_PACKAGE`: official CLI package spec (default
  `@deepseek-ai/dsh`; useful for pinning or tests).
- `DSH1024_DSH_VERSION`: explicit DSH version placed in the event when the
  package spec itself is unversioned.
- `DSH1024_TELEMETRY_URL`: complete event endpoint URL (default
  `https://deepseek1024.com/api/v1/install-events`).
- `DSH1024_TELEMETRY_TIMEOUT_MS`: upload timeout from 100 to 30000 ms
  (default 2500 ms).

The legacy `DSH_1024STORE_*` spellings of these variables (for example
`DSH_1024STORE_TELEMETRY=0`) remain supported permanently. When both spellings
are set, the `DSH1024_*` value wins.

## Local catalog cache

The DSH plugin keeps its last validated public registry and embedded catalog
page at `$DSH_HOME/.dsh-1024store/registry-cache.json` and
`catalog-page-cache.json`. The embedded view paints the local page first while
requesting the production API in parallel, then replaces the snapshot and
cache with the fresh response. Cached data can remain available for up to seven
days. These files belong to `dsh1024`, contain no account or installation
secrets, and can be removed safely while DSH is stopped.

## Migrating from the old packages

`dsh1024` replaces the deprecated `@dsh-1024store/cli` and `dsh-1024store` npm
packages. Replace `npx @dsh-1024store/cli ...` with `npx dsh1024 ...`, and
`dsh plugin --profile web add dsh-1024store` with
`dsh plugin --profile web add dsh1024@latest`; every command, option, and
pass-through behavior is unchanged. Existing telemetry preferences, the
anonymous identity, and local receipts are stored under
`$DSH_HOME/.dsh-1024store/` and are reused as-is, so no migration step is
needed and no environment variable has to be renamed.

## Development

From the repository root:

```sh
npm install
npm run market:test
```

Install the built package into an isolated profile:

```sh
DSH_HOME=/tmp/dsh-store-test dsh plugin --profile market-test add ./packages/dsh1024
DSH_HOME=/tmp/dsh-store-test dsh --profile market-test --port 14567
```

To test the local website inside the local shell, add an overlay and pass it at
boot (plain HTTP is accepted only for loopback hosts):

```yaml
- id: dsh1024
  config:
    embedUrl: http://127.0.0.1:14568/embed/store?bridge=dsh1024-v1
```

```sh
DSH_HOME=/tmp/dsh-store-test dsh --profile market-test --patch ./local-store.yml --port 14567
```

Inside `packages/dsh1024`:

```sh
npm test
npm run pack:check
```
