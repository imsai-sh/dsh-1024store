import { join } from 'node:path'
import { pluginIdFromRepositoryField } from './args.js'
import { readJson } from '../lib/shared/files.js'

function normalizeBundles(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === 'string') return [entry]
      if (entry && typeof entry === 'object' && typeof entry.name === 'string') return [entry.name]
      return []
    })
  }
  if (value && typeof value === 'object') return Object.keys(value)
  return []
}

/**
 * Read one installed package manifest out of a profile's node_modules.
 *
 * `packageName` must come from the profile's own manifest (a dependency key) or
 * from an npm target the caller already validated as a package name. It must
 * never be an argv-derived path: the guard below rejects traversal segments,
 * but the rule is what keeps this function from becoming a file reader.
 */
async function readPackageManifest(profileDirectory, packageName) {
  const safeParts = packageName.split('/')
  const safe = safeParts.every((part) => (
    part !== '.' && part !== '..' && /^[A-Za-z0-9_.@-]+$/.test(part)
  ))
  if (!safe) return null
  return readJson(join(profileDirectory, 'node_modules', ...safeParts, 'package.json'), null)
}

async function readInstalledVersion(profileDirectory, packageName) {
  const manifest = await readPackageManifest(profileDirectory, packageName)
  return typeof manifest?.version === 'string' ? manifest.version : null
}

/**
 * Resolve a published package name to a catalog plugin id after it is installed.
 *
 * The official CLI forwards the target to the package manager verbatim, so the
 * dependency key in the profile manifest is the package's real name — its own
 * `repository` field is the only local source for the GitHub identity the
 * catalog is keyed by. Reads one local file and nothing else.
 *
 * @returns the lowercased `owner/repository`, or null when it cannot be
 *   resolved, in which case the install is simply not counted.
 */
export async function readInstalledPluginId(dshHome, profile, packageName) {
  const manifest = await readPackageManifest(join(dshHome, 'profiles', profile), packageName)
  if (manifest === null) return null
  return pluginIdFromRepositoryField(manifest.repository)
}

export async function readProfileState(dshHome, profile) {
  const profileDirectory = join(dshHome, 'profiles', profile)
  const manifest = await readJson(join(profileDirectory, 'package.json'), null)
  const dependencies = manifest?.dependencies && typeof manifest.dependencies === 'object'
    ? Object.fromEntries(Object.entries(manifest.dependencies).filter(([, spec]) => typeof spec === 'string'))
    : {}
  const bundles = normalizeBundles(manifest?.dsh?.profile?.bundles)
  const installedVersions = {}

  await Promise.all(Object.keys(dependencies).map(async (packageName) => {
    installedVersions[packageName] = await readInstalledVersion(profileDirectory, packageName)
  }))

  return { exists: Boolean(manifest), profileDirectory, dependencies, bundles, installedVersions }
}

function dependencyMatchesPlugin(spec, pluginId) {
  const normalized = spec.toLowerCase().replaceAll('\\', '/')
  const segments = pluginId.toLowerCase().split('/')
  const repository = segments.slice(0, 2).join('/')
  // Bounded on both sides: a bare substring test made `nest/plug` match
  // `github:nest/plugin-x`, which would file an install under the wrong plugin.
  const escaped = repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!new RegExp(`(?:^|[:/])${escaped}(?:\\.git)?(?:[#&]|$)`).test(normalized)) return false
  // Monorepo siblings share a repository, so the spec's `path:` fragment is
  // what tells them apart. A repository-root plugin (no path) must likewise not
  // match a dependency installed from one of its subdirectories.
  const specPath = (/[#&]path:\/*([^&]*)/.exec(normalized)?.[1] ?? '').replace(/\/+$/, '')
  return specPath === segments.slice(2).join('/')
}

function receiptNamesPresent(state, names) {
  return names.some((name) => name in state.dependencies || state.bundles.includes(name))
}

export function inspectInstallation(before, after, pluginId, previousReceipt = null, knownPackageNames = []) {
  const knownNames = [...new Set([...(previousReceipt?.packageNames ?? []), ...knownPackageNames])]
  const beforeMatches = Object.entries(before.dependencies)
    .filter(([, spec]) => dependencyMatchesPlugin(spec, pluginId))
    .map(([name]) => name)
  const afterMatches = Object.entries(after.dependencies)
    .filter(([, spec]) => dependencyMatchesPlugin(spec, pluginId))
    .map(([name]) => name)
  const changed = Object.keys(after.dependencies)
    .filter((name) => before.dependencies[name] !== after.dependencies[name])
  const changedBundles = changed.filter((name) => after.bundles.includes(name))
  const receiptMatches = knownNames
    .filter((name) => name in after.dependencies || after.bundles.includes(name))
  const packageNames = [...new Set([...afterMatches, ...changedBundles, ...receiptMatches])].sort()
  const beforePresent = beforeMatches.length > 0 || receiptNamesPresent(before, knownNames)
  const afterPresent = after.exists && packageNames.length > 0

  return {
    beforePresent,
    afterPresent,
    packageNames,
    beforeVersion: selectVersion(before, [...beforeMatches, ...knownNames]),
    afterVersion: selectVersion(after, packageNames),
  }
}

function selectVersion(state, names) {
  for (const name of names) {
    const version = state.installedVersions[name]
    if (version) return version.slice(0, 128)
  }
  for (const name of names) {
    const spec = state.dependencies[name]
    if (spec) return spec.slice(0, 128)
  }
  return null
}

export function createReceipt({ previousReceipt, pluginId, profile, source, packageNames, state, completedAt }) {
  const packages = Object.fromEntries(packageNames.map((name) => [name, {
    requested: state.dependencies[name] ?? null,
    version: state.installedVersions[name] ?? null,
  }]))
  return {
    pluginId,
    profile,
    source,
    packageNames,
    packages,
    firstInstalledAt: previousReceipt?.firstInstalledAt ?? completedAt,
    lastInstalledAt: completedAt,
    installCount: (previousReceipt?.installCount ?? 0) + 1,
  }
}
