/**
 * Plugin identity.
 *
 * A plugin id is `owner/repository` for a repository-level plugin, extended
 * with the in-repo directory for a monorepo subpackage
 * (`owner/repository/packages/foo`). The path portion becomes pnpm's
 * `#path:` install spec, so `.` and `..` segments are rejected wherever an id
 * is accepted. Repository-level facts (stars, forks, star history) belong to
 * the `owner/repository` prefix and are shared by sibling plugins; install
 * metrics belong to the full id.
 *
 * Must stay aligned with scripts/lib/catalog-entry.mjs in the catalog
 * repository (imsai-sh/awesome-deepseek-harness-plugins), which enforces the
 * same contract for the submission gate. No CI spans the two repositories:
 * drift means a submission passes review there but the sync endpoint here
 * rejects it.
 */

/** Matches the catalog sync entry-id bound and the install-event id bound. */
export const PLUGIN_ID_MAX_LENGTH = 201

const SEGMENT = /^[A-Za-z0-9_.-]+$/

export interface PluginIdParts {
  owner: string
  repository: string
  /** In-repo directory, `''` for a repository-level plugin. */
  path: string
}

export function parsePluginId(value: unknown): PluginIdParts | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > PLUGIN_ID_MAX_LENGTH) return null
  const segments = value.split('/')
  if (segments.length < 2) return null
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment === '.' || segment === '..') return null
  }
  const [owner, repository, ...rest] = segments
  return { owner, repository, path: rest.join('/') }
}

export function isPluginId(value: unknown): value is string {
  return parsePluginId(value) !== null
}

/** Case-insensitive identity key. Display and install specs keep their case. */
export function normalizePluginId(id: string): string {
  return id.trim().toLocaleLowerCase('en-US')
}

/** `owner/repository` prefix — the key for repository-level GitHub facts. */
export function pluginRepositoryFullName(id: string): string {
  const parts = parsePluginId(id)
  if (parts === null) return id
  return `${parts.owner}/${parts.repository}`
}

export function buildPluginId(repositoryFullName: string, path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, '')
  return trimmed.length === 0 ? repositoryFullName : `${repositoryFullName}/${trimmed}`
}

/** The plugin directory of a discovered manifest path (`''` when at the root). */
export function pluginPathFromPackagePath(packagePath: string | null | undefined): string {
  if (typeof packagePath !== 'string') return ''
  const trimmed = packagePath.trim().replace(/^\/+/, '')
  if (trimmed.length === 0 || trimmed === 'package.json') return ''
  if (!trimmed.endsWith('/package.json')) return ''
  const directory = trimmed.slice(0, -'/package.json'.length)
  return parsePluginId(`owner/repository/${directory}`) === null ? '' : directory
}

/** The official DeepSeek Harness install spec for an id. */
export function pluginInstallSpec(id: string): string {
  const parts = parsePluginId(id)
  if (parts === null) return `github:${id}`
  const base = `github:${parts.owner}/${parts.repository}`
  return parts.path.length === 0 ? base : `${base}#path:${parts.path}`
}

export function pluginInstallCommand(id: string): string {
  return `dsh plugin --profile web add ${pluginInstallSpec(id)}`
}

/** Detail-page path; every segment is encoded individually, slashes kept. */
export function pluginDetailPath(id: string): string {
  return `/plugins/${id.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Where a plugin's source actually lives: the repository for a
 * repository-level plugin, the subdirectory tree for a monorepo subpackage.
 *
 * Issue trackers and releases stay repository-level, so only source links use
 * this. `HEAD` resolves to the default branch when the caller has not fetched
 * the repository's branch name.
 */
export function pluginSourceUrl(id: string, repositoryUrl: string, branch = 'HEAD'): string {
  const path = parsePluginId(id)?.path ?? ''
  if (path.length === 0) return repositoryUrl
  const base = repositoryUrl.replace(/\/+$/, '')
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `${base}/tree/${encodeURIComponent(branch)}/${encodedPath}`
}
