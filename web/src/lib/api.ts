import { offeredInstallCommand, type PluginInstallMethod } from '../../worker/lib/install-methods'
import {
  normalizePluginId,
  parsePluginId,
  pluginDetailPath,
  pluginInstallSpec,
} from '../../worker/lib/plugin-id'

export type Language = 'en' | 'zh'

export interface RegistryPlugin {
  /** Full plugin id: `owner/repository[/sub/dir]`. */
  id: string
  /** Per-method install verification; absent on pre-verification snapshots. */
  installMethods?: PluginInstallMethod[]
  name: string
  owner: string
  url: string
  category: string
  description: Record<Language, string>
  install: string
  added: string
}

export interface InstallMetrics {
  /** Successful install operations, including first installs and reinstalls. */
  installCount?: number
  /** Anonymous installation instances, not verified or named people. */
  installerCount?: number
  firstInstallCount?: number
  reinstallCount?: number
  updateCount?: number
  removeCount?: number
  failureCount?: number
  installs24h?: number
  installs7d?: number
  installs30d?: number
  latestInstallAt?: string | null
}

export interface CatalogPlugin extends RegistryPlugin, InstallMetrics {
  repository: string
  stars: number | null
  forks: number | null
  pushedAt: string | null
  updatedAt: string | null
  latestReleaseAt: string | null
  growth24h: number | null
  growth7d: number | null
  growth30d: number | null
  npmDownloads7d?: number | null
  npmDownloadsStart?: string | null
  npmDownloadsEnd?: string | null
}

export interface CategoryResult {
  id: string
  en: string
  zh: string
  count: number
}

export type CatalogSort =
  | 'installs'
  | 'installs24h'
  | 'installs7d'
  | 'installs30d'
  | 'npmDownloads7d'
  | 'stars'
  | 'growth24h'
  | 'growth7d'
  | 'growth30d'
  | 'newest'
  | 'active'
  | 'name'
export type RankingMode = Exclude<CatalogSort, 'name'>

/** Mirrors RankedPlugin in worker/types.ts. */
export interface RankedPlugin extends CatalogPlugin {
  /** Further plugins of the same repository this board left out. */
  repositorySiblings: number
}

export interface CatalogResponse {
  packages: CatalogPlugin[]
  rankings: Record<RankingMode, RankedPlugin[]>
  categories: CategoryResult[]
  meta: {
    total: number
    catalogTotal: number
    updated: string
    generatedAt: string
    revision: string
    source: 'd1' | 'kv' | 'stale' | 'empty'
    metricCoverage: number
  }
}

export type CatalogSource = 'd1' | 'kv' | 'stale' | 'empty'

/** One page of the directory from `/api/v2/plugins`. */
export interface PluginsPage {
  plugins: CatalogPlugin[]
  page: number
  limit: number
  total: number
  totalPages: number
  catalogTotal: number
  categories: CategoryResult[]
  generatedAt: string
  source: CatalogSource
}

/** The leaderboards from `/api/v3/rankings`, with their sibling groups. */
export interface RankingsData {
  rankings: Record<RankingMode, RankedPlugin[]>
  siblingsByRepository: Record<string, CatalogPlugin[]>
  catalogTotal: number
  categories: CategoryResult[]
  generatedAt: string
  source: CatalogSource
}

export interface PluginsPageParams {
  q?: string
  category?: string
  sort?: CatalogSort
  page?: number
  limit?: number
}

function apiRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Runtime guard for a plugin-owned cached v2 page received over the embed bridge. */
export function isPluginsPage(value: unknown): value is PluginsPage {
  const page = apiRecord(value)
  return page !== null && page.page === 1 && page.limit === 100
    && typeof page.total === 'number' && Number.isSafeInteger(page.total) && page.total >= 0
    && typeof page.totalPages === 'number' && Number.isSafeInteger(page.totalPages) && page.totalPages >= 0
    && typeof page.catalogTotal === 'number' && Number.isSafeInteger(page.catalogTotal) && page.catalogTotal >= 0
    && typeof page.generatedAt === 'string'
    && Array.isArray(page.plugins) && page.plugins.length <= 100
    && Array.isArray(page.categories) && page.categories.length <= 100
}

export function fetchPluginsPage(params: PluginsPageParams, signal?: AbortSignal): Promise<PluginsPage> {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.category) search.set('category', params.category)
  // 'stars' is the server default; omitting it keeps the cache key canonical.
  if (params.sort && params.sort !== 'stars') search.set('sort', params.sort)
  if (params.page && params.page > 1) search.set('page', String(params.page))
  if (params.limit) search.set('limit', String(params.limit))
  const query = search.toString()
  return requestJson<PluginsPage>(`${API_ORIGIN}/api/v2/plugins${query ? `?${query}` : ''}`, signal)
}

export async function fetchRankings(signal?: AbortSignal): Promise<RankingsData> {
  try {
    return await requestJson<RankingsData>(`${API_ORIGIN}/api/v3/rankings`, signal)
  } catch (error) {
    // During a rolling deployment an old Worker can briefly serve the new
    // client. Its v2 shape is still valid; only the new board is absent.
    if (!(error instanceof ApiError) || error.status !== 404) throw error
    const compatible = await requestJson<Omit<RankingsData, 'rankings'> & {
      rankings: Omit<RankingsData['rankings'], 'npmDownloads7d'>
    }>(`${API_ORIGIN}/api/v2/rankings`, signal)
    return {
      ...compatible,
      rankings: { ...compatible.rankings, npmDownloads7d: [] },
    }
  }
}

export interface CategoryDescriptor {
  id: string
  order: number
  label: Record<Language, string>
}

/** Snapshot-only detail data. It is intentionally enough to render the useful
 * page shell without waiting for GitHub's API or raw-content domains. */
export interface PackageSummaryDetail extends Omit<CatalogPlugin, 'category'> {
  category: CategoryDescriptor | null
}

export interface PackageDetail extends Omit<RegistryPlugin, 'category'>, InstallMetrics {
  /** Category descriptor resolved by the Worker from the D1 catalog_categories table (migration 0014), carried on the catalog snapshot as categoryList. */
  category: CategoryDescriptor | null
  github: {
    stars: number
    forks: number
    openIssues: number
    defaultBranch: string
    updatedAt: string
    pushedAt: string
    license: string | null
    homepage: string | null
    avatarUrl: string
  } | null
  manifest: {
    name: string | null
    version: string | null
    license: string | null
    bundlePatch: string | null
    dependencies: number
    peerDependencies: number
    engines: Record<string, string> | null
  } | null
  readme: string | null
  /** Directory the README came from, relative to the repository root. */
  readmeBasePath?: string
  verification: {
    repositoryReachable: boolean
    bundleDeclared: boolean
  }
}

export interface LiveStats {
  type: 'stats'
  views: number
  online: number
  updatedAt: string
}

interface ErrorResponse {
  error?: string
}

// Absolute origin for the plugin API; empty keeps same-origin requests for the default deployment.
export const API_ORIGIN: string = (import.meta.env.VITE_API_ORIGIN ?? '').trim().replace(/\/+$/, '')

/**
 * Carries the HTTP status so callers can tell "this resource does not exist"
 * apart from "the request failed". Pages use that distinction to decide whether
 * to noindex themselves — a transport error must never deindex a real page.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorResponse
    throw new ApiError(body.error || `Request failed with HTTP ${response.status}`, response.status)
  }
  return (await response.json()) as T
}

export function getPackage(id: string, signal?: AbortSignal): Promise<PackageDetail> {
  const encoded = id.split('/').map(encodeURIComponent).join('/')
  return requestJson<PackageDetail>(`${API_ORIGIN}/api/v1/plugins/${encoded}`, signal)
}

export function getPackageSummary(id: string, signal?: AbortSignal): Promise<PackageSummaryDetail> {
  const encoded = id.split('/').map(encodeURIComponent).join('/')
  return requestJson<PackageSummaryDetail>(`${API_ORIGIN}/api/v2/plugins/${encoded}`, signal)
}

export function npmPackageUrl(packageName: string): string {
  return `https://www.npmjs.com/package/${packageName.split('/').map(encodeURIComponent).join('/')}`
}

export function packagePath(plugin: Pick<RegistryPlugin, 'id'>): string {
  return pluginDetailPath(plugin.id)
}

export interface PluginListIdentity {
  /** Distinguishes monorepo subpackages even when discovery only found the repository name. */
  displayName: string
  /** Keeps the repository provenance visible without competing with the plugin title. */
  sourceLabel: string
}

export function pluginListIdentity(
  plugin: Pick<RegistryPlugin, 'id' | 'name' | 'owner'>,
): PluginListIdentity {
  const parts = parsePluginId(plugin.id)
  if (parts === null || parts.path.length === 0) {
    return { displayName: plugin.name, sourceLabel: plugin.owner }
  }

  const pathLeaf = parts.path.split('/').at(-1) ?? plugin.name
  const discoveryOnlyFoundRepository =
    plugin.name.localeCompare(parts.repository, 'en-US', { sensitivity: 'accent' }) === 0

  return {
    displayName: discoveryOnlyFoundRepository ? pathLeaf : plugin.name,
    sourceLabel: `${plugin.owner} / ${parts.repository}`,
  }
}

/**
 * The plugin a repository row may offer an install command for.
 *
 * `dsh plugin add github:owner/repo` installs the repository root and nothing
 * else, so the command only exists when the repository publishes a bundle
 * there. A repository whose plugins all live in subdirectories has no command
 * of its own — each subdirectory carries its own, with its `#path:` — and
 * offering one anyway would hand the reader something that installs the wrong
 * thing.
 */
export function repositoryInstallTarget<T extends Pick<RegistryPlugin, 'id'>>(
  plugins: readonly T[],
): T | undefined {
  return plugins.find((plugin) => parsePluginId(plugin.id)?.path === '')
}

export function repositoryName(plugin: Pick<RegistryPlugin, 'name' | 'url'>): string {
  try {
    const segments = new URL(plugin.url).pathname.split('/').filter(Boolean)
    return (segments[1] ?? plugin.name.split('/').at(-1) ?? plugin.name).replace(/\.git$/, '')
  } catch {
    return plugin.name.split('/').at(-1) ?? plugin.name
  }
}

export const SELF_PLUGIN_ID = 'imsai-sh/awesome-deepseek-harness-plugins'
// Frozen identity: the historical `packages/dsh1024` path segment is a D1 data
// key shared with the Worker (see worker/app.ts SELF_CATALOG_PLUGIN_ID_LIST);
// it deliberately survives the directory rename to plugin/.
export const SELF_PACKAGE_PLUGIN_ID = `${SELF_PLUGIN_ID}/packages/dsh1024`
export const SELF_TRACKED_COMMAND = 'npm install -g dsh1024 && dsh1024 plugin --profile web add dsh1024@latest'
export const SELF_OFFICIAL_COMMAND = 'dsh plugin --profile web add dsh1024@latest'

// The catalog lists this repository itself as the store client plugin; the
// generic spec would tell people to install the whole catalog repository, so it
// gets the published package name instead.
export function isSelfPlugin(plugin: Pick<RegistryPlugin, 'id'>): boolean {
  const id = normalizePluginId(plugin.id)
  return id === SELF_PLUGIN_ID || id === SELF_PACKAGE_PLUGIN_ID
}

/**
 * The bare official install spec for a plugin.
 *
 * Derived from the plugin id, never from the repository URL: a monorepo
 * subpackage's URL is its repository root, so reverse-engineering the spec from
 * it would silently install the wrong package.
 */
export function installSpec(plugin: Pick<RegistryPlugin, 'id'>): string {
  return pluginInstallSpec(plugin.id)
}

type InstallCommandPlugin = Pick<RegistryPlugin, 'id'> & Partial<Pick<RegistryPlugin, 'install'>>

export function trackedInstallCommand(plugin: InstallCommandPlugin): string {
  if (isSelfPlugin(plugin)) return SELF_TRACKED_COMMAND
  return officialInstallCommand(plugin).replace(/^dsh\b/, 'dsh1024')
}

export function officialInstallCommand(plugin: InstallCommandPlugin): string {
  if (isSelfPlugin(plugin)) return SELF_OFFICIAL_COMMAND
  return plugin.install ?? `dsh plugin --profile web add ${installSpec(plugin)}`
}

/**
 * Whether the site offers this plugin's install command at all.
 *
 * Only npm installs are offered; a plugin whose official command is still a
 * `github:` source install is browse-only, and every surface (copy buttons,
 * the detail page, the embedded store) hides the install affordance for it.
 * The rule itself lives in worker/lib/install-methods.ts so the crawlable
 * shell and the hydrated page can never disagree.
 */
export function installOffered(
  plugin: InstallCommandPlugin & Partial<Pick<RegistryPlugin, 'installMethods'>>,
): boolean {
  return offeredInstallCommand({
    install: officialInstallCommand(plugin),
    installMethods: plugin.installMethods,
  }) !== null
}


export async function getSelfInstallStats(signal?: AbortSignal): Promise<InstallMetrics | null> {
  const response = await fetch(`${API_ORIGIN}/api/v1/self/install-stats`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) return null
  return (await response.json()) as InstallMetrics
}

export function githubAvatar(owner: string): string {
  return `https://github.com/${encodeURIComponent(owner)}.png?size=96`
}

export interface AuthUser {
  githubLogin: string
  githubName: string | null
  avatarUrl: string | null
}

export interface ApiKeySummary {
  id: number
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
}

export interface CreatedApiKey extends ApiKeySummary {
  /** Full secret, returned exactly once at creation time. */
  key: string
}

async function requestMutation<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined
      ? { Accept: 'application/json' }
      : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const parsed = (await response.json().catch(() => ({}))) as ErrorResponse
    throw new Error(parsed.error || `Request failed with HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export function githubLoginUrl(returnTo: string): string {
  return `${API_ORIGIN}/api/v1/auth/github/login?returnTo=${encodeURIComponent(returnTo)}`
}

export async function getAuthUser(signal?: AbortSignal): Promise<AuthUser | null> {
  const payload = await requestJson<{ user: AuthUser | null }>(`${API_ORIGIN}/api/v1/auth/me`, signal)
  return payload.user
}

export async function logoutUser(): Promise<void> {
  await requestMutation<{ ok: boolean }>(`${API_ORIGIN}/api/v1/auth/logout`, 'POST')
}

export async function getApiKeys(signal?: AbortSignal): Promise<ApiKeySummary[]> {
  const payload = await requestJson<{ apiKeys: ApiKeySummary[] }>(`${API_ORIGIN}/api/v1/api-keys`, signal)
  return payload.apiKeys
}

export async function createApiKey(name: string): Promise<CreatedApiKey> {
  const payload = await requestMutation<{ apiKey: CreatedApiKey }>(
    `${API_ORIGIN}/api/v1/api-keys`,
    'POST',
    name.trim().length > 0 ? { name: name.trim() } : undefined,
  )
  return payload.apiKey
}

export async function revokeApiKey(id: number): Promise<void> {
  await requestMutation<{ ok: boolean }>(`${API_ORIGIN}/api/v1/api-keys/${id}`, 'DELETE')
}
