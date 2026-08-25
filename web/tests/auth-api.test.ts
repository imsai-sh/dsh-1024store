import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../worker/app'
import {
  cleanupExpiredAuthRows,
  createSession,
  sanitizeReturnTo,
  upsertGitHubUser,
} from '../worker/lib/auth'
import { accountsDatabase, sqliteD1 } from './d1-sqlite'
import { testCatalogResult } from './fixtures'

const NOW = Date.parse('2026-08-16T08:00:00Z')
const ORIGIN = 'https://store.example'

function authEnv(database: DatabaseSync): Env {
  return {
    CATALOG_DB: sqliteD1(database),
    GITHUB_OAUTH_CLIENT_ID: 'test-client-id',
    GITHUB_OAUTH_CLIENT_SECRET: 'test-client-secret',
  } as unknown as Env
}

function githubFetcher(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return Response.json({ access_token: 'gho_test_token' })
    }
    if (url.startsWith('https://api.github.com/user')) {
      return Response.json({
        id: 4242,
        login: 'octocat',
        name: 'Octo Cat',
        avatar_url: 'https://avatars.example/u/4242',
      })
    }
    throw new Error(`Unexpected OAuth fetch: ${url}`)
  }) as unknown as typeof fetch
}

function authApp(fetcher = githubFetcher(), clock: () => number = () => NOW) {
  return createApp({
    catalogLoader: vi.fn(async () => testCatalogResult()),
    oauthFetcher: fetcher,
    clock,
  })
}

function setCookieValue(response: Response, name: string): string | null {
  for (const cookie of response.headers.getSetCookie()) {
    if (cookie.startsWith(`${name}=`)) return cookie.split(';', 1)[0]!.slice(name.length + 1)
  }
  return null
}

async function signedInCookie(database: DatabaseSync): Promise<string> {
  const user = await upsertGitHubUser(
    sqliteD1(database),
    { id: 4242, login: 'octocat', name: 'Octo Cat', avatarUrl: null },
    new Date(NOW).toISOString(),
  )
  const session = await createSession(sqliteD1(database), user.id, NOW)
  return `dsh_session=${session.token}`
}

describe('sanitizeReturnTo', () => {
  it('keeps same-site paths and rejects everything else', () => {
    expect(sanitizeReturnTo('/account')).toBe('/account')
    expect(sanitizeReturnTo('/docs/api?tab=1')).toBe('/docs/api?tab=1')
    expect(sanitizeReturnTo(undefined)).toBe('/')
    expect(sanitizeReturnTo('https://evil.example')).toBe('/')
    expect(sanitizeReturnTo('//evil.example')).toBe('/')
    expect(sanitizeReturnTo('/\\evil.example')).toBe('/')
    expect(sanitizeReturnTo('/a\r\nSet-Cookie: x=1')).toBe('/')
  })

})

describe('GitHub OAuth flow', () => {
  it('returns 503 when the OAuth app is not configured', async () => {
    const response = await authApp().request(
      `${ORIGIN}/api/v1/auth/github/login`,
      {},
      { CATALOG_DB: {} } as unknown as Env,
    )
    expect(response.status).toBe(503)
  })

  it('redirects to GitHub with a state cookie', async () => {
    const database = accountsDatabase()
    const response = await authApp().request(
      `${ORIGIN}/api/v1/auth/github/login?returnTo=/docs/api`,
      {},
      authEnv(database),
    )
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location') ?? '')
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe('test-client-id')
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/v1/auth/github/callback`)
    const state = location.searchParams.get('state') ?? ''
    expect(state).toMatch(/^[0-9a-f]{32}$/)
    const cookie = setCookieValue(response, 'dsh_oauth_state')
    expect(decodeURIComponent(cookie ?? '')).toBe(`${state}:${encodeURIComponent('/docs/api')}`)
    database.close()
  })

  it('creates a user and session on a valid callback and honours returnTo', async () => {
    const database = accountsDatabase()
    const app = authApp()
    const env = authEnv(database)

    const login = await app.request(`${ORIGIN}/api/v1/auth/github/login?returnTo=/docs/api`, {}, env)
    const stateCookie = setCookieValue(login, 'dsh_oauth_state') ?? ''
    const state = decodeURIComponent(stateCookie).split(':', 1)[0]

    const callback = await app.request(
      `${ORIGIN}/api/v1/auth/github/callback?code=test-code&state=${state}`,
      { headers: { Cookie: `dsh_oauth_state=${stateCookie}` } },
      env,
    )
    expect(callback.status).toBe(302)
    expect(callback.headers.get('Location')).toBe('/docs/api')
    const session = setCookieValue(callback, 'dsh_session')
    expect(session).toMatch(/^[0-9a-f]{64}$/)

    const me = await app.request(
      `${ORIGIN}/api/v1/auth/me`,
      { headers: { Cookie: `dsh_session=${session}` } },
      env,
    )
    await expect(me.json()).resolves.toEqual({
      user: { githubLogin: 'octocat', githubName: 'Octo Cat', avatarUrl: 'https://avatars.example/u/4242' },
    })

    const stored = database.prepare('SELECT github_id, github_login FROM api_users').all()
    expect(stored).toEqual([{ github_id: 4242, github_login: 'octocat' }])
    database.close()
  })

  it('rejects a callback whose state does not match the cookie', async () => {
    const database = accountsDatabase()
    const app = authApp()
    const env = authEnv(database)

    const login = await app.request(`${ORIGIN}/api/v1/auth/github/login`, {}, env)
    const stateCookie = setCookieValue(login, 'dsh_oauth_state') ?? ''

    const callback = await app.request(
      `${ORIGIN}/api/v1/auth/github/callback?code=test-code&state=${'0'.repeat(32)}`,
      { headers: { Cookie: `dsh_oauth_state=${stateCookie}` } },
      env,
    )
    expect(callback.status).toBe(302)
    expect(callback.headers.get('Location')).toBe('/account?login=error')
    expect(setCookieValue(callback, 'dsh_session')).toBeNull()
    expect(database.prepare('SELECT COUNT(*) AS user_count FROM api_users').get()).toEqual({ user_count: 0 })
    database.close()
  })

  it('reports the anonymous session and clears it on logout', async () => {
    const database = accountsDatabase()
    const app = authApp()
    const env = authEnv(database)
    const cookie = await signedInCookie(database)

    const me = await app.request(`${ORIGIN}/api/v1/auth/me`, { headers: { Cookie: cookie } }, env)
    const payload = (await me.json()) as { user: { githubLogin: string } | null }
    expect(payload.user?.githubLogin).toBe('octocat')

    const logout = await app.request(
      `${ORIGIN}/api/v1/auth/logout`,
      { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } },
      env,
    )
    expect(logout.status).toBe(200)
    expect(database.prepare('SELECT COUNT(*) AS session_count FROM api_sessions').get())
      .toEqual({ session_count: 0 })

    const after = await app.request(`${ORIGIN}/api/v1/auth/me`, { headers: { Cookie: cookie } }, env)
    await expect(after.json()).resolves.toEqual({ user: null })
    database.close()
  })

  it('ignores an expired session', async () => {
    const database = accountsDatabase()
    const app = authApp(githubFetcher(), () => NOW + 31 * 24 * 60 * 60 * 1000)
    const cookie = await signedInCookie(database)
    const me = await app.request(`${ORIGIN}/api/v1/auth/me`, { headers: { Cookie: cookie } }, authEnv(database))
    await expect(me.json()).resolves.toEqual({ user: null })
    database.close()
  })
})

describe('API key management', () => {
  it('requires a session', async () => {
    const database = accountsDatabase()
    const env = authEnv(database)
    const app = authApp()
    expect((await app.request(`${ORIGIN}/api/v1/api-keys`, {}, env)).status).toBe(401)
    expect((await app.request(`${ORIGIN}/api/v1/api-keys`, { method: 'POST' }, env)).status).toBe(401)
    database.close()
  })

  it('creates, lists, and revokes keys; the secret appears exactly once', async () => {
    const database = accountsDatabase()
    const env = authEnv(database)
    const app = authApp()
    const cookie = await signedInCookie(database)

    const created = await app.request(
      `${ORIGIN}/api/v1/api-keys`,
      {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'CI key' }),
      },
      env,
    )
    expect(created.status).toBe(201)
    const createdPayload = (await created.json()) as { apiKey: { id: number; key: string; keyPrefix: string; name: string } }
    expect(createdPayload.apiKey.key).toMatch(/^dsh_live_[0-9a-f]{40}$/)
    expect(createdPayload.apiKey.key.startsWith(createdPayload.apiKey.keyPrefix)).toBe(true)
    expect(createdPayload.apiKey.name).toBe('CI key')

    const listed = await app.request(`${ORIGIN}/api/v1/api-keys`, { headers: { Cookie: cookie } }, env)
    const listPayload = (await listed.json()) as { apiKeys: Array<Record<string, unknown>> }
    expect(listPayload.apiKeys).toHaveLength(1)
    expect(listPayload.apiKeys[0]).not.toHaveProperty('key')
    expect(listPayload.apiKeys[0]?.keyPrefix).toBe(createdPayload.apiKey.keyPrefix)

    const revoked = await app.request(
      `${ORIGIN}/api/v1/api-keys/${createdPayload.apiKey.id}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: ORIGIN } },
      env,
    )
    expect(revoked.status).toBe(200)
    const relisted = await app.request(`${ORIGIN}/api/v1/api-keys`, { headers: { Cookie: cookie } }, env)
    await expect(relisted.json()).resolves.toEqual({ apiKeys: [] })

    const again = await app.request(
      `${ORIGIN}/api/v1/api-keys/${createdPayload.apiKey.id}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: ORIGIN } },
      env,
    )
    expect(again.status).toBe(404)
    database.close()
  })

  it('enforces the active key limit', async () => {
    const database = accountsDatabase()
    const env = authEnv(database)
    const app = authApp()
    const cookie = await signedInCookie(database)

    for (let index = 0; index < 5; index += 1) {
      const response = await app.request(
        `${ORIGIN}/api/v1/api-keys`,
        { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } },
        env,
      )
      expect(response.status).toBe(201)
    }
    const sixth = await app.request(
      `${ORIGIN}/api/v1/api-keys`,
      { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } },
      env,
    )
    expect(sixth.status).toBe(400)
    await expect(sixth.json()).resolves.toMatchObject({ code: 'KEY_LIMIT_REACHED' })
    database.close()
  })

  it('rejects cross-origin cookie mutations', async () => {
    const database = accountsDatabase()
    const env = authEnv(database)
    const app = authApp()
    const cookie = await signedInCookie(database)
    const response = await app.request(
      `${ORIGIN}/api/v1/api-keys`,
      { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example' } },
      env,
    )
    expect(response.status).toBe(403)
    database.close()
  })
})

describe('cleanupExpiredAuthRows', () => {
  it('removes expired sessions and stale counters only', async () => {
    const database = accountsDatabase()
    const db = sqliteD1(database)
    const user = await upsertGitHubUser(
      db,
      { id: 1, login: 'octocat', name: null, avatarUrl: null },
      new Date(NOW).toISOString(),
    )
    await createSession(db, user.id, NOW)
    await createSession(db, user.id, NOW - 31 * 24 * 60 * 60 * 1000)
    database.prepare(
      `INSERT INTO api_request_counters (counter_key, window_kind, bucket_start, count) VALUES
       ('ip:aa', 'minute', ?, 3), ('ip:aa', 'day', ?, 3)`,
    ).run(NOW - 3 * 24 * 60 * 60 * 1000, NOW)

    await cleanupExpiredAuthRows(db, NOW)

    expect(database.prepare('SELECT COUNT(*) AS session_count FROM api_sessions').get())
      .toEqual({ session_count: 1 })
    expect(database.prepare('SELECT COUNT(*) AS counter_count FROM api_request_counters').get())
      .toEqual({ counter_count: 1 })
    database.close()
  })
})
