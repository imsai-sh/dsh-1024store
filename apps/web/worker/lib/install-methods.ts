/**
 * Install methods and their verification state.
 *
 * A plugin may be installable from GitHub, from npm, or both. Verification is a
 * LABEL, never an admission test: every plugin stays in the catalog regardless
 * of what this module concludes. The catalog stores observed *facts* (is the
 * entry point committed, does a prepare script exist, was a DSH bundle found
 * on npm) and this module derives the *verdicts* from them, so a
 * change of judgement costs a deploy rather than a re-crawl of every plugin.
 *
 * The github method stays derived and collected here, but no user-facing
 * surface OFFERS it any more: its `--allow-build` grant quoted a
 * repository-author-controlled package name, and one unvalidatable value
 * poisoned the whole registry for every client (issue #159). The front end
 * filters to npm via offeredInstallCommand below; re-opening source installs
 * later is a display-layer change, not a data change.
 *
 * Must stay aligned with the classifier in scripts/review-plugin-submission.mjs,
 * which reaches the same verdicts from the pull-request gate. The two are
 * cross-checked by tests/install-methods.test.ts.
 */

import { parsePluginId, pluginInstallSpec, pluginRepositoryFullName } from './plugin-id'

export type InstallMethodKind = 'github' | 'npm'

/**
 * `unknown` is distinct from `unverified` on purpose: a queue that has not
 * reached a plugin yet knows nothing about it, and rendering that as
 * "unverified" would be a false claim about somebody else's project.
 */
export type InstallVerification = 'verified' | 'unverified' | 'unknown'

export type GitInstallCode =
  | 'entry_committed'
  | 'no_entry_declared'
  | 'prepare_builds_entry'
  | 'entry_missing_no_prepare'
  | 'entry_outside_repository'
  | 'manifest_missing'
  | 'entry_unresolved'
  | 'tree_truncated'
  | 'repository_unreachable'
  | 'not_checked'

export type NpmInstallCode = 'published_package' | 'repository_backlink'

/** Diagnostic comparison between npm repository metadata and catalog source. */
export type NpmBinding = 'strict' | 'name_only' | 'mismatch' | 'no_bundle' | 'absent' | 'unknown'

export interface PluginInstallMethod {
  kind: InstallMethodKind
  /** The bare spec, e.g. `github:owner/repo#path:sub/dir` or `@scope/name`. */
  spec: string
  /** The full official command, ready to copy. */
  command: string
  verification: InstallVerification
  code: GitInstallCode | NpmInstallCode
  /**
   * pnpm >= 10 refuses to run a git dependency's `prepare` unless the package
   * is allowlisted. The generated command includes pnpm's `--allow-build`
   * option, so installation succeeds on the first run and persists the grant.
   */
  requiresBuildAllowance: boolean
  /** Package name passed to pnpm's `--allow-build`, when needed. */
  buildPackage?: string | null
  /** npm version, or the short default-branch sha the git facts came from. */
  revision: string | null
  checkedAt: string | null
}

/**
 * Keeps the frozen v1 response readable by consumers from both npm-verdict
 * generations. `repository_backlink` used to be the only verified npm code;
 * `published_package` is the current verdict. They describe the same target in
 * v1, so expose both aliases without changing the catalog snapshot or the v2
 * response used by our own UI.
 */
export function withLegacyNpmCodeAliases(
  methods: PluginInstallMethod[] | undefined,
): PluginInstallMethod[] | undefined {
  if (methods === undefined) return undefined

  let changed = false
  const projected = methods.flatMap((method) => {
    if (
      method.kind !== 'npm' ||
      (method.code !== 'published_package' && method.code !== 'repository_backlink')
    ) return [method]

    const aliasCode: NpmInstallCode = method.code === 'repository_backlink'
      ? 'published_package'
      : 'repository_backlink'
    const alreadyPresent = methods.some((candidate) =>
      candidate.kind === 'npm' &&
      candidate.code === aliasCode &&
      candidate.spec === method.spec &&
      candidate.revision === method.revision,
    )
    if (alreadyPresent) return [method]

    changed = true
    const alias = { ...method, code: aliasCode }
    // The current verdict stays preferred when projecting an old snapshot.
    return method.code === 'repository_backlink' ? [alias, method] : [method, alias]
  })

  return changed ? projected : methods
}

/**
 * A package that declares no entry point at all is the "carrier" pattern: its
 * patch mounts other packages as loader rows and nothing ever imports the
 * carrier itself, so it installs and starts with no loadable module of its own.
 *
 * The standard is functional — installs and starts — so this is `verified`.
 * Nothing here executes third-party code, so it is an inference rather than a
 * test run: a package that declares no entry AND whose patch names itself
 * would still fail at startup. That combination is a broken package for
 * everyone, not just for us, and telling the 12 carriers in the catalog
 * "unknown" to hedge against it would make the badge less useful than it is
 * worth. Distinguishing the two for certain means parsing cordis.patch.yml,
 * which the submission gate deliberately does not do.
 */
export const NO_ENTRY_DECLARED_VERIFICATION: InstallVerification = 'verified'

const GIT_VERIFICATION: Record<GitInstallCode, InstallVerification> = {
  entry_committed: 'verified',
  prepare_builds_entry: 'verified',
  no_entry_declared: NO_ENTRY_DECLARED_VERIFICATION,
  entry_missing_no_prepare: 'unverified',
  entry_outside_repository: 'unverified',
  manifest_missing: 'unverified',
  entry_unresolved: 'unknown',
  tree_truncated: 'unknown',
  repository_unreachable: 'unknown',
  not_checked: 'unknown',
}

export function gitVerification(code: GitInstallCode): InstallVerification {
  return GIT_VERIFICATION[code] ?? 'unknown'
}

/** Facts recorded for the git install method, as stored per plugin. */
export interface GitInstallFacts {
  code: GitInstallCode
  hasPrepare: boolean
  /** Package name pnpm uses as the `allowBuilds` key. */
  packageName?: string | null
  headSha?: string | null
  checkedAt?: string | null
}

/** Facts recorded for a candidate npm package, as stored per plugin. */
export interface NpmInstallFacts {
  packageName: string | null
  binding: NpmBinding
  bundleDeclared: boolean
  version?: string | null
  checkedAt?: string | null
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9@/._-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'"'"'`)}'`
}

function command(spec: string, buildPackage?: string | null): string {
  const allowance = buildPackage ? ` --allow-build=${shellWord(buildPackage)}` : ''
  return `dsh plugin --profile web add${allowance} ${spec}`
}

/**
 * The install command the site and the store offer for a plugin, or null when
 * the plugin is browse-only.
 *
 * Offered means npm. A `github:` source command may still appear in the frozen
 * v1 `install` field — it is the official record for a plugin without an npm
 * package — but no surface offers it as an install method any more. Shared by
 * the worker's crawlable shell and the React app so the two can never disagree
 * about which plugins are installable.
 */
export function offeredInstallCommand(plugin: {
  install: string
  installMethods?: PluginInstallMethod[]
}): string | null {
  const npm = plugin.installMethods?.find((method) => method.kind === 'npm')
  if (npm) return npm.command
  // Crawled and no npm method: browse-only, even if the snapshot predates the
  // npm-only switch and still carries a github method.
  if (plugin.installMethods) return null
  // Pre-verification snapshots carry only the command string; a github: source
  // command is the record of a plugin nobody can install from the store.
  return /\bgithub:/.test(plugin.install) ? null : plugin.install
}

const SELF_PACKAGE_PLUGIN_ID = 'imsai-sh/awesome-deepseek-harness-plugins/packages/dsh1024'

/**
 * Derives the install methods recorded for a plugin. Pure: no I/O, so the
 * rules can be exercised exhaustively in tests and changed without a re-crawl.
 *
 * An npm method is emitted when the registry's latest package declares a DSH
 * bundle. Its repository metadata is retained as a diagnostic fact but is not
 * an installability rule: npm package names are the installation identity.
 * The github method stays derived as the source-install record, but only the
 * npm method is OFFERED to users — see offeredInstallCommand.
 */
export function deriveInstallMethods(
  id: string,
  git: GitInstallFacts,
  npm: NpmInstallFacts | null,
): PluginInstallMethod[] {
  const methods: PluginInstallMethod[] = []

  if (npm?.packageName && npm.bundleDeclared) {
    const installTarget = id.toLocaleLowerCase('en-US') === SELF_PACKAGE_PLUGIN_ID
      ? `${npm.packageName}@latest`
      : npm.packageName
    methods.push({
      kind: 'npm',
      spec: npm.packageName,
      command: command(installTarget),
      verification: 'verified',
      code: 'published_package',
      requiresBuildAllowance: false,
      buildPackage: null,
      revision: npm.version ?? null,
      checkedAt: npm.checkedAt ?? null,
    })
  }

  const gitSpec = pluginInstallSpec(id)
  methods.push({
    kind: 'github',
    spec: gitSpec,
    command: command(gitSpec, git.hasPrepare ? git.packageName : null),
    verification: gitVerification(git.code),
    code: git.code,
    requiresBuildAllowance: git.hasPrepare,
    buildPackage: git.hasPrepare ? git.packageName ?? null : null,
    revision: git.headSha ?? null,
    checkedAt: git.checkedAt ?? null,
  })

  return methods
}

function normalizeGitHubUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  const match = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?]|$)/.exec(url)
  return match ? `${match[1]}/${match[2]}`.toLocaleLowerCase('en-US') : null
}

/**
 * How closely an npm package's metadata points back to this plugin's source.
 *
 * `repository.directory` is npm's own field for "this package lives in that
 * subdirectory of that repository". This is retained for catalog diagnostics.
 * It no longer controls npm method
 * visibility or verification: a published package with `dsh.bundle` is a
 * verified npm install method even when repository metadata is absent or stale.
 */
export function classifyNpmBinding(
  id: string,
  published: { repository?: unknown; dsh?: unknown } | null,
): { binding: NpmBinding; bundleDeclared: boolean } {
  if (published === null) return { binding: 'absent', bundleDeclared: false }

  const repositoryField = published.repository
  const raw = typeof repositoryField === 'string'
    ? { url: repositoryField }
    : (repositoryField as { url?: unknown; directory?: unknown } | null) ?? {}
  const bundleDeclared = Boolean(
    raw && typeof published.dsh === 'object' && published.dsh !== null &&
    (published.dsh as { bundle?: unknown }).bundle,
  )

  const parts = parsePluginId(id)
  if (parts === null) return { binding: 'unknown', bundleDeclared }

  const declared = normalizeGitHubUrl(typeof raw.url === 'string' ? raw.url : null)
  if (declared === null) return { binding: 'name_only', bundleDeclared }
  if (declared !== pluginRepositoryFullName(id).toLocaleLowerCase('en-US')) {
    return { binding: 'mismatch', bundleDeclared }
  }

  const directory = typeof raw.directory === 'string'
    ? raw.directory.replace(/^\.?\/+/, '').replace(/\/+$/, '')
    : ''
  if (directory !== parts.path) return { binding: 'mismatch', bundleDeclared }
  if (!bundleDeclared) return { binding: 'no_bundle', bundleDeclared }
  return { binding: 'strict', bundleDeclared }
}
