import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../worker/app'
import { createApiKey, revokeApiKey, upsertGitHubUser } from '../worker/lib/auth'
import { accountsDatabase, sqliteD1 } from './d1-sqlite'
import { testCatalogResult } from './fixtures'

const NOW = Date.parse('2026-08-16T08:00:30Z')
const ORIGIN = 'https://store.example'
const SECRET = 'search-test-secret-0123456789abcdef!'

function searchEnv(database: DatabaseSync): Env {
  return {
    CATALOG_DB: sqliteD1(database),
    INSTALL_CLIENT_HASH_SECRET: SECRET,
  } as unknown as Env
}

function searchApp(clock: () => number = () => NOW) {
  return createApp({
    catalogLoader: vi.fn(async () => testCatalogResult()),
    clock,
  })
}

async function issueKey(database: DatabaseSync): Promise<string> {
  const db = sqliteD1(database)
  const user = await upsertGitHubUser(
    db,
    { id: 7, login: 'octocat', name: null, avatarUrl: null },
    new Date(NOW).toISOString(),
  )
  const created = await createApiKey(db, user.id, 'search key', new Date(NOW).toISOString())
  return created.key
}

describe('plugin search API', () => {
  it('requires the q parameter', async () => {
    const database = accountsDatabase()
    const response = await searchApp().request(`${ORIGIN}/api/v1/plugins/search`, {}, searchEnv(database))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'MISSING_QUERY' })
    database.close()
  })

  it('rejects unknown categories', async () => {
    const database = accountsDatabase()
    const response = await searchApp().request(
      `${ORIGIN}/api/v1/plugins/search?q=dsh&category=nope`,
      {},
      searchEnv(database),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_CATEGORY' })
    database.close()
  })

  it('returns paginated matches with rate-limit headers', async () => {
    const database = accountsDatabase()
    const response = await searchApp().request(
      `${ORIGIN}/api/v1/plugins/search?q=gomoku`,
      {},
      searchEnv(database),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('X-RateLimit-Daily-Limit')).toBe('50')
    expect(response.headers.get('X-RateLimit-Daily-Remaining')).toBe('49')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const payload = (await response.json()) as {
      query: string
      page: number
      limit: number
      sortBy: string
      total: number
      totalPages: number
      results: Array<{ name: string; id: string; install: string }>
    }
    expect(payload).toMatchObject({ query: 'gomoku', page: 1, limit: 20, sortBy: 'stars', total: 1, totalPages: 1 })
    expect(payload.results[0]?.name).toBe('dsh-gomoku')
    // The install field must stay the official dsh CLI command, matching the
    // registry projection (wrapper commands are presentation-layer only).
    expect(payload.results[0]?.install).toMatch(/^dsh plugin --profile web add \S+$/)
    database.close()
  })

  it('paginates and maps the recent alias onto the newest sort', async () => {
    const database = accountsDatabase()
    const app = searchApp()
    const env = searchEnv(database)
    const first = await app.request(`${ORIGIN}/api/v1/plugins/search?q=dsh&limit=2&sortBy=recent`, {}, env)
    const firstPayload = (await first.json()) as { results: Array<{ id: string }>; total: number; totalPages: number; sortBy: string }
    expect(firstPayload.sortBy).toBe('newest')
    expect(firstPayload.results).toHaveLength(2)
    expect(firstPayload.totalPages).toBe(Math.ceil(firstPayload.total / 2))

    const second = await app.request(`${ORIGIN}/api/v1/plugins/search?q=dsh&limit=2&page=2&sortBy=recent`, {}, env)
    const secondPayload = (await second.json()) as { results: Array<{ id: string }> }
    expect(secondPayload.results[0]?.id).not.toBe(firstPayload.results[0]?.id)
    database.close()
  })

  it('rejects invalid API keys outright', async () => {
    const database = accountsDatabase()
    const response = await searchApp().request(
      `${ORIGIN}/api/v1/plugins/search?q=dsh`,
      { headers: { Authorization: 'Bearer dsh_live_not_a_real_key' } },
      searchEnv(database),
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_API_KEY' })
    database.close()
  })

  it('grants API keys the authenticated quota and records key usage', async () => {
    const database = accountsDatabase()
    const key = await issueKey(database)
    const response = await searchApp().request(
      `${ORIGIN}/api/v1/plugins/search?q=dsh`,
      { headers: { Authorization: `Bearer ${key}` } },
      searchEnv(database),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('X-RateLimit-Daily-Limit')).toBe('500')
    expect(response.headers.get('X-RateLimit-Daily-Remaining')).toBe('499')
    expect(database.prepare('SELECT last_used_at FROM api_keys').get())
      .toEqual({ last_used_at: new Date(NOW).toISOString() })
    database.close()
  })

  it('keys the authenticated quota to the account, so key rotation continues the same window', async () => {
    const database = accountsDatabase()
    const db = sqliteD1(database)
    const nowIso = new Date(NOW).toISOString()
    const user = await upsertGitHubUser(db, { id: 7, login: 'octocat', name: null, avatarUrl: null }, nowIso)
    const firstKey = await createApiKey(db, user.id, 'first', nowIso)
    const app = searchApp()
    const env = searchEnv(database)

    const initial = await app.request(
      `${ORIGIN}/api/v1/plugins/search?q=dsh`,
      { headers: { Authorization: `Bearer ${firstKey.key}` } },
      env,
    )
    expect(initial.headers.get('X-RateLimit-Daily-Remaining')).toBe('499')

    await revokeApiKey(db, user.id, firstKey.id, nowIso)
    const secondKey = await createApiKey(db, user.id, 'second', nowIso)
    const rotated = await app.request(
      `${ORIGIN}/api/v1/plugins/search?q=dsh`,
      { headers: { Authorization: `Bearer ${secondKey.key}` } },
      env,
    )
    expect(rotated.headers.get('X-RateLimit-Daily-Remaining')).toBe('498')
    database.close()
  })

  it('enforces the per-minute window and recovers in the next minute', async () => {
    const database = accountsDatabase()
    let now = NOW
    const app = searchApp(() => now)
    const env = searchEnv(database)

    for (let index = 0; index < 10; index += 1) {
      const response = await app.request(`${ORIGIN}/api/v1/plugins/search?q=dsh`, {}, env)
      expect(response.status).toBe(200)
    }
    const blocked = await app.request(`${ORIGIN}/api/v1/plugins/search?q=dsh`, {}, env)
    expect(blocked.status).toBe(429)
    await expect(blocked.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' })
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0)
    // A minute-window rejection must not burn the daily quota.
    expect(blocked.headers.get('X-RateLimit-Daily-Remaining')).toBe('40')

    now += 60_000
    const recovered = await app.request(`${ORIGIN}/api/v1/plugins/search?q=dsh`, {}, env)
    expect(recovered.status).toBe(200)
    expect(recovered.headers.get('X-RateLimit-Daily-Remaining')).toBe('39')
    database.close()
  })

  it('reports daily quota exhaustion', async () => {
    const database = accountsDatabase()
    const dayBucket = Math.floor(NOW / 86_400_000) * 86_400_000
    // Pre-burn the whole anonymous daily quota for this client key.
    const probe = await searchApp().request(`${ORIGIN}/api/v1/plugins/search?q=dsh`, {}, searchEnv(database))
    expect(probe.status).toBe(200)
    database.prepare(
      `UPDATE api_request_counters SET count = 50 WHERE window_kind = 'day' AND bucket_start = ?`,
    ).run(dayBucket)

    const blocked = await searchApp().request(`${ORIGIN}/api/v1/plugins/search?q=dsh`, {}, searchEnv(database))
    expect(blocked.status).toBe(429)
    await expect(blocked.json()).resolves.toMatchObject({ code: 'DAILY_QUOTA_EXCEEDED' })
    expect(blocked.headers.get('X-RateLimit-Daily-Remaining')).toBe('0')
    database.close()
  })

  it('returns 503 when the database is unavailable', async () => {
    const response = await searchApp().request(`${ORIGIN}/api/v1/plugins/search?q=dsh`, {}, {} as Env)
    expect(response.status).toBe(503)
  })
})
