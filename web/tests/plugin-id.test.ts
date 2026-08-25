import { describe, expect, it } from 'vitest'
import {
  buildPluginId,
  isPluginId,
  parsePluginId,
  pluginDetailPath,
  pluginInstallCommand,
  pluginInstallSpec,
  pluginPathFromPackagePath,
  pluginRepositoryFullName,
  pluginSourceUrl,
} from '../worker/lib/plugin-id'

describe('plugin identity', () => {
  it('parses repository-level and subdirectory ids', () => {
    expect(parsePluginId('owner/repo')).toEqual({ owner: 'owner', repository: 'repo', path: '' })
    expect(parsePluginId('owner/repo/packages/foo'))
      .toEqual({ owner: 'owner', repository: 'repo', path: 'packages/foo' })
    expect(pluginRepositoryFullName('owner/repo/packages/foo')).toBe('owner/repo')
  })

  it('rejects traversal, empty segments, and over-long ids', () => {
    for (const id of ['owner', 'owner/repo/..', 'owner/repo/../x', 'owner/repo/.', 'owner//foo', 'owner/repo/']) {
      expect(isPluginId(id), id).toBe(false)
    }
    expect(isPluginId(`owner/repo/${'a'.repeat(200)}`)).toBe(false)
  })

  it('derives install specs that pnpm can resolve', () => {
    expect(pluginInstallSpec('owner/repo')).toBe('github:owner/repo')
    expect(pluginInstallSpec('owner/repo/packages/foo')).toBe('github:owner/repo#path:packages/foo')
    expect(pluginInstallCommand('owner/repo/packages/foo'))
      .toBe('dsh plugin --profile web add github:owner/repo#path:packages/foo')
  })

  it('reads the plugin directory out of a discovered manifest path', () => {
    expect(pluginPathFromPackagePath('package.json')).toBe('')
    expect(pluginPathFromPackagePath('packages/foo/package.json')).toBe('packages/foo')
    expect(pluginPathFromPackagePath(null)).toBe('')
    // Anything that is not a manifest path, or that would smuggle a traversal,
    // falls back to the repository root rather than inventing a directory.
    expect(pluginPathFromPackagePath('packages/foo/other.json')).toBe('')
    expect(pluginPathFromPackagePath('../secret/package.json')).toBe('')
    expect(buildPluginId('owner/repo', 'packages/foo')).toBe('owner/repo/packages/foo')
    expect(buildPluginId('owner/repo', '')).toBe('owner/repo')
  })

  it('links source at the subdirectory but keeps the repository for plain ids', () => {
    const url = 'https://github.com/owner/repo'
    expect(pluginSourceUrl('owner/repo', url, 'main')).toBe(url)
    expect(pluginSourceUrl('owner/repo/packages/foo', url, 'main'))
      .toBe('https://github.com/owner/repo/tree/main/packages/foo')
    // HEAD stands in when the caller has not resolved the default branch.
    expect(pluginSourceUrl('owner/repo/packages/foo', url))
      .toBe('https://github.com/owner/repo/tree/HEAD/packages/foo')
    // A trailing slash on the repository URL must not double up.
    expect(pluginSourceUrl('owner/repo/packages/foo', `${url}/`))
      .toBe('https://github.com/owner/repo/tree/HEAD/packages/foo')
  })

  it('encodes each detail-path segment while keeping the separators', () => {
    expect(pluginDetailPath('owner/repo')).toBe('/plugins/owner/repo')
    expect(pluginDetailPath('owner/repo/packages/foo')).toBe('/plugins/owner/repo/packages/foo')
  })
})
