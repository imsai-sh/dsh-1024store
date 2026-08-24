import { describe, expect, it, vi } from 'vitest'
import { fetchPackageDetail } from '../worker/lib/github'
import { TEST_REGISTRY } from './fixtures'

describe('GitHub package details', () => {
  it('summarizes repository metadata and verifies a DSH bundle manifest', async () => {
    const plugin = TEST_REGISTRY.plugins[0]
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('https://api.github.com/')) {
        return Response.json({
          stargazers_count: 42,
          forks_count: 7,
          open_issues_count: 3,
          default_branch: 'master',
          updated_at: '2026-08-14T00:00:00Z',
          pushed_at: '2026-08-13T00:00:00Z',
          license: { spdx_id: 'MIT' },
          owner: { avatar_url: 'https://example.com/avatar.png' },
        })
      }
      if (url.endsWith('/package.json')) {
        return Response.json({
          name: plugin.name,
          version: '1.2.3',
          license: 'MIT',
          engines: { node: '>=22' },
          dependencies: { hono: '^4' },
          peerDependencies: { react: '^19' },
          dsh: { bundle: { patch: './cordis.patch.yml' } },
        })
      }
      return new Response('# Package readme')
    }) as unknown as typeof fetch

    const detail = await fetchPackageDetail(plugin, 'token', fetcher)
    expect(detail.github?.stars).toBe(42)
    expect(detail.github?.defaultBranch).toBe('master')
    expect(detail.manifest).toMatchObject({
      version: '1.2.3',
      bundlePatch: './cordis.patch.yml',
      dependencies: 1,
      peerDependencies: 1,
    })
    expect(detail.verification.bundleDeclared).toBe(true)
    expect(detail.readme).toBe('# Package readme')
  })
})
