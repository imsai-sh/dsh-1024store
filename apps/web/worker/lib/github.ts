import type {
  GitHubSummary,
  PackageDetail,
  PackageManifestSummary,
  RegistryPlugin,
} from '../types'
import { repositoryName } from './catalog'
import { emptyInstallMetrics } from './install-metrics'
import { parsePluginId } from './plugin-id'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function dependencyCount(value: unknown): number {
  return isObject(value) ? Object.keys(value).length : 0
}

function summarizeManifest(value: unknown): PackageManifestSummary | null {
  if (!isObject(value)) return null
  const dsh = isObject(value.dsh) ? value.dsh : null
  const bundle = dsh && isObject(dsh.bundle) ? dsh.bundle : null
  const engines = isObject(value.engines)
    ? Object.fromEntries(
        Object.entries(value.engines).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    : null

  return {
    name: nullableString(value.name),
    version: nullableString(value.version),
    license: nullableString(value.license),
    bundlePatch: bundle ? nullableString(bundle.patch) : null,
    dependencies: dependencyCount(value.dependencies),
    peerDependencies: dependencyCount(value.peerDependencies),
    engines,
  }
}

async function boundedText(
  fetcher: typeof fetch,
  url: string,
  maximumBytes: number,
): Promise<string | null> {
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok || !response.body) return null
    const declaredLength = Number.parseInt(response.headers.get('Content-Length') ?? '', 10)
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return null

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (total < maximumBytes) {
      const result = await reader.read()
      if (result.done) break
      const remaining = maximumBytes - total
      const chunk = result.value.byteLength > remaining ? result.value.slice(0, remaining) : result.value
      chunks.push(chunk)
      total += chunk.byteLength
      if (chunk.byteLength < result.value.byteLength) {
        await reader.cancel()
        break
      }
    }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function githubHeaders(token?: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-1024store-worker',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function githubSummary(data: unknown, plugin: RegistryPlugin): GitHubSummary | null {
  if (!isObject(data)) return null
  const license = isObject(data.license) ? data.license : null
  const owner = isObject(data.owner) ? data.owner : null
  const spdxId = license ? nullableString(license.spdx_id) : null
  return {
    stars: finiteNumber(data.stargazers_count),
    forks: finiteNumber(data.forks_count),
    openIssues: finiteNumber(data.open_issues_count),
    defaultBranch: nullableString(data.default_branch) ?? 'main',
    updatedAt: nullableString(data.updated_at) ?? plugin.added,
    pushedAt: nullableString(data.pushed_at) ?? plugin.added,
    license: spdxId && spdxId !== 'NOASSERTION' ? spdxId : null,
    homepage: nullableString(data.homepage),
    avatarUrl: (owner && nullableString(owner.avatar_url)) ?? `https://github.com/${plugin.owner}.png?size=160`,
  }
}

export async function fetchPackageDetail(
  plugin: RegistryPlugin,
  token?: string,
  fetcher: typeof fetch = fetch,
): Promise<PackageDetail> {
  const repository = repositoryName(plugin)
  let github: GitHubSummary | null = null
  try {
    const response = await fetcher(`https://api.github.com/repos/${plugin.owner}/${repository}`, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) {
      const data: unknown = await response.json()
      github = githubSummary(data, plugin)
    }
  } catch {
    github = null
  }

  const branch = github?.defaultBranch ?? 'main'
  const rawBase = `https://raw.githubusercontent.com/${plugin.owner}/${repository}/${encodeURIComponent(branch)}`
  // A monorepo subpackage's manifest and README live in its own directory;
  // reading the repository root would report the wrong bundle declaration.
  const pluginPath = parsePluginId(plugin.id)?.path ?? ''
  const prefix = pluginPath.length === 0
    ? ''
    : `/${pluginPath.split('/').map(encodeURIComponent).join('/')}`
  const [manifestText, subdirectoryReadme] = await Promise.all([
    boundedText(fetcher, `${rawBase}${prefix}/package.json`, 128 * 1024),
    boundedText(fetcher, `${rawBase}${prefix}/README.md`, 256 * 1024),
  ])
  const rootReadme = subdirectoryReadme !== null || prefix === ''
    ? null
    : await boundedText(fetcher, `${rawBase}/README.md`, 256 * 1024)
  const readme = subdirectoryReadme ?? rootReadme
  const readmeBasePath = subdirectoryReadme === null ? '' : pluginPath

  let manifest: PackageManifestSummary | null = null
  if (manifestText) {
    try {
      manifest = summarizeManifest(JSON.parse(manifestText))
    } catch {
      manifest = null
    }
  }

  return {
    ...plugin,
    ...emptyInstallMetrics(),
    github,
    manifest,
    readme,
    readmeBasePath,
    verification: {
      repositoryReachable: github !== null,
      bundleDeclared: manifest?.bundlePatch !== null && manifest?.bundlePatch !== undefined,
    },
  }
}
