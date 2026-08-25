import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { upsertGitHubUser } from '../worker/lib/auth'
import { communityPostMetadata } from '../worker/community/metadata'
import { metadataForPath } from '../worker/seo'
import { communityDatabase, sqliteD1 } from './community-fixtures'
import { testCatalogResult } from './fixtures'

const NOW = Date.parse('2026-08-17T08:00:00Z')
const ORIGIN = 'https://deepseek1024.com'

function workerEnv(database: DatabaseSync): Env {
  return { CATALOG_DB: sqliteD1(database), COMMUNITY_ADMIN_LOGINS: '' } as unknown as Env
}

async function seedPost(database: DatabaseSync, body: string): Promise<number> {
  const db = sqliteD1(database)
  const user = await upsertGitHubUser(
    db, { id: 1, login: 'octocat', name: null, avatarUrl: null }, new Date(NOW).toISOString())
  await db.prepare('INSERT INTO community_posts (author_id, body, created_at) VALUES (?, ?, ?)')
    .bind(user.id, body, new Date(NOW).toISOString()).run()
  const row = await db.prepare('SELECT last_insert_rowid() AS id').first<{ id: number }>()
  return Number(row!.id)
}

function metadataFor(database: DatabaseSync, path: string) {
  return communityPostMetadata(new URL(`${ORIGIN}${path}`), workerEnv(database))
}

/**
 * A post is a link people paste into chat, so its title has to be right in the
 * first response — a SPA that fills it in after hydration is invisible to every
 * crawler and every unfurler. Static community copy lives in `seo-templates.ts`
 * with the rest of the site; only a post's own title is resolved from D1.
 */
describe('community post metadata', () => {
  it('titles a post with its own opening line and author', async () => {
    const database = communityDatabase()
    const id = await seedPost(database, '刚把 profile 切换脚本重写了一遍')
    await expect(metadataFor(database, `/community/p/${id}`)).resolves.toEqual({
      title: '刚把 profile 切换脚本重写了一遍 — @octocat · DSH 讨论区',
      description: '刚把 profile 切换脚本重写了一遍',
    })
    database.close()
  })

  it('flattens markdown and truncates rather than shipping a wall of text', async () => {
    const database = communityDatabase()
    const id = await seedPost(database, `# 标题\n\n正文一行\n\n\`\`\`js\nconst secret = 1\n\`\`\`\n\n${'长'.repeat(200)}`)
    const metadata = (await metadataFor(database, `/community/p/${id}`))!
    // Fenced code is stripped: it is not a description of anything.
    expect(metadata.description).not.toContain('const secret')
    expect(metadata.description).not.toContain('#')
    expect([...metadata.description].length).toBeLessThanOrEqual(121)
    expect(metadata.description.endsWith('…')).toBe(true)
    database.close()
  })

  it('returns nothing for a deleted post, a reply, or a missing id', async () => {
    const database = communityDatabase()
    const id = await seedPost(database, 'regrettable')
    database.prepare('UPDATE community_posts SET deleted_at = ? WHERE id = ?')
      .run(new Date(NOW).toISOString(), id)

    await expect(metadataFor(database, `/community/p/${id}`)).resolves.toBeNull()
    await expect(metadataFor(database, '/community/p/99999')).resolves.toBeNull()
    // Not a post path at all: the static templates handle these.
    await expect(metadataFor(database, '/community')).resolves.toBeNull()
    await expect(metadataFor(database, '/community/u/octocat')).resolves.toBeNull()
    await expect(metadataFor(database, '/plugins')).resolves.toBeNull()
    database.close()
  })
})

describe('community pages in the site’s SEO layer', () => {
  const catalog = testCatalogResult().snapshot

  it('indexes the feed and a post, and keeps profiles out', () => {
    const seo = { updated: '', revision: '', plugins: catalog.plugins, categories: catalog.categories }
    expect(metadataForPath('/community', seo).robots).toBe('index,follow')
    expect(metadataForPath('/community/p/12', seo).robots).toBe('index,follow')
    expect(metadataForPath('/community/about', seo).robots).toBe('index,follow')

    const profile = metadataForPath('/community/u/octocat', seo)
    expect(profile.robots).toBe('noindex,follow')
    // A noindexed page pointing a canonical anywhere is a conflicting pair of
    // signals; no canonical is the cleaner one.
    expect(profile.canonical).toBeNull()
  })

  it('gives a post its own canonical, not the feed’s', () => {
    const seo = { updated: '', revision: '', plugins: catalog.plugins, categories: catalog.categories }
    expect(metadataForPath('/community/p/12', seo).canonical)
      .toBe('https://deepseek1024.com/community/p/12')
    expect(metadataForPath('/community', seo).canonical)
      .toBe('https://deepseek1024.com/community')
  })
})
