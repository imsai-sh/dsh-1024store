import { describe, expect, it, vi } from 'vitest'
import { fetchRankings, getPackageSummary, npmPackageUrl, pluginListIdentity, repositoryInstallTarget } from './api'

describe('npm package URL', () => {
  it('preserves scoped package path segments', () => {
    expect(npmPackageUrl('@scope/plugin')).toBe('https://www.npmjs.com/package/%40scope/plugin')
  })
})

describe('ranking API rollout', () => {
  it('falls back to the compatible v2 response when v3 is not deployed yet', async () => {
    const v2 = {
      rankings: { stars: [] },
      siblingsByRepository: {},
      catalogTotal: 0,
      categories: [],
      generatedAt: '2026-08-20T00:00:00.000Z',
      source: 'kv',
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'Not found' }, { status: 404 }))
      .mockResolvedValueOnce(Response.json(v2))
    vi.stubGlobal('fetch', fetcher)
    try {
      const response = await fetchRankings()
      expect(response.rankings.npmDownloads7d).toEqual([])
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        '/api/v3/rankings',
        '/api/v2/rankings',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('package detail loading', () => {
  it('loads the first-party v2 summary independently of GitHub enrichment', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'owner/plugin' }))
    vi.stubGlobal('fetch', fetcher)
    try {
      await getPackageSummary('owner/plugin')
      expect(fetcher).toHaveBeenCalledWith(
        '/api/v2/plugins/owner/plugin',
        expect.objectContaining({ headers: { Accept: 'application/json' } }),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('plugin list identity', () => {
  it('gives discovered monorepo siblings distinct titles', () => {
    expect(pluginListIdentity({
      id: 'zhu1090093659/dsh-web-ui/packages/dsh-aionui-panel',
      name: 'dsh-web-ui',
      owner: 'zhu1090093659',
    })).toEqual({
      displayName: 'dsh-aionui-panel',
      sourceLabel: 'zhu1090093659 / dsh-web-ui',
    })
    expect(pluginListIdentity({
      id: 'zhu1090093659/dsh-web-ui/packages/dsh-web-ui-all',
      name: 'dsh-web-ui',
      owner: 'zhu1090093659',
    })).toEqual({
      displayName: 'dsh-web-ui-all',
      sourceLabel: 'zhu1090093659 / dsh-web-ui',
    })
  })

  it('keeps repository plugins and already-specific package names unchanged', () => {
    expect(pluginListIdentity({
      id: 'owner/repository',
      name: 'repository',
      owner: 'owner',
    })).toEqual({ displayName: 'repository', sourceLabel: 'owner' })
    expect(pluginListIdentity({
      id: 'owner/repository/packages/plugin',
      name: 'specific-plugin-name',
      owner: 'owner',
    })).toEqual({
      displayName: 'specific-plugin-name',
      sourceLabel: 'owner / repository',
    })
  })
})

describe('repository install target', () => {
  const plugin = (id: string) => ({ id })

  it('offers no command when a repository only publishes subdirectories', () => {
    // `dsh plugin add github:owner/repo` would install the repository root,
    // which in this shape carries no bundle at all.
    expect(repositoryInstallTarget([
      plugin('owner/mono/packages/pet'),
      plugin('owner/mono/packages/ssh'),
    ])).toBeUndefined()
  })

  it('offers the root plugin when the repository is itself installable', () => {
    expect(repositoryInstallTarget([
      plugin('owner/mono/packages/pet'),
      plugin('owner/mono'),
      plugin('owner/mono/packages/ssh'),
    ])).toEqual(plugin('owner/mono'))
  })

  it('ignores an id no plugin id grammar accepts', () => {
    expect(repositoryInstallTarget([plugin('not-an-id')])).toBeUndefined()
  })
})
