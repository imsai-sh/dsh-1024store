import type { Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import {
  ApiKeyLimitError,
  buildGitHubAuthorizeUrl,
  createApiKey,
  createSession,
  deleteSession,
  exchangeGitHubCode,
  fetchGitHubProfile,
  getSessionUser,
  GitHubOAuthError,
  listApiKeys,
  MAX_API_KEY_NAME_LENGTH,
  OAUTH_STATE_COOKIE,
  randomHex,
  revokeApiKey,
  sanitizeReturnTo,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  timingSafeEqualStrings,
  upsertGitHubUser,
  type ApiUser,
} from './lib/auth'

export interface AuthDependencies {
  clock: () => number
  oauthFetcher: typeof fetch
}

const STATE_COOKIE_MAX_AGE_SECONDS = 600
const MAX_KEY_REQUEST_BYTES = 4 * 1024
const LOGIN_ERROR_REDIRECT = '/account?login=error'

/** Mirrors readBoundedBody in app.ts: null means the body exceeded the cap. */
async function boundedText(request: Request, maximumBytes: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maximumBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(result.value)
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

type AuthApp = Hono<{ Bindings: Env }>
type AuthContext = Context<{ Bindings: Env }>

function oauthConfig(context: AuthContext): { clientId: string; clientSecret: string } | null {
  const clientId = context.env?.GITHUB_OAUTH_CLIENT_ID?.trim()
  const clientSecret = context.env?.GITHUB_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

function callbackUrl(context: AuthContext): string {
  return `${new URL(context.req.url).origin}/api/v1/auth/github/callback`
}

/**
 * Cookie-authenticated mutations double-check the Origin header. SameSite=Lax
 * is the primary CSRF defence; this rejects the residual cases where a
 * cross-origin caller still attaches one.
 */
function crossOriginRejected(context: AuthContext): boolean {
  const origin = context.req.header('Origin')
  return Boolean(origin) && origin !== new URL(context.req.url).origin
}

async function sessionUser(context: AuthContext, clock: () => number): Promise<ApiUser | null> {
  if (!context.env?.CATALOG_DB) return null
  const token = getCookie(context, SESSION_COOKIE)
  if (!token) return null
  return getSessionUser(context.env.CATALOG_DB, token, clock())
}

function setSessionCookie(context: AuthContext, token: string): void {
  setCookie(context, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

export function registerAuthRoutes(app: AuthApp, dependencies: AuthDependencies): void {
  app.get('/api/v1/auth/github/login', (context) => {
    const config = oauthConfig(context)
    if (!config || !context.env?.CATALOG_DB) {
      return context.json({ error: 'GitHub login is not configured.', code: 'SERVICE_UNAVAILABLE' }, 503)
    }

    const returnTo = sanitizeReturnTo(context.req.query('returnTo'))
    const state = randomHex(16)
    setCookie(context, OAUTH_STATE_COOKIE, `${state}:${encodeURIComponent(returnTo)}`, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/api/v1/auth',
      maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    })
    return context.redirect(buildGitHubAuthorizeUrl(config.clientId, callbackUrl(context), state), 302)
  })

  app.get('/api/v1/auth/github/callback', async (context) => {
    const config = oauthConfig(context)
    if (!config || !context.env?.CATALOG_DB) {
      return context.json({ error: 'GitHub login is not configured.', code: 'SERVICE_UNAVAILABLE' }, 503)
    }

    const stateCookie = getCookie(context, OAUTH_STATE_COOKIE) ?? ''
    deleteCookie(context, OAUTH_STATE_COOKIE, { path: '/api/v1/auth' })

    const separator = stateCookie.indexOf(':')
    const expectedState = separator === -1 ? '' : stateCookie.slice(0, separator)
    let storedReturnTo: string | undefined
    if (separator !== -1) {
      try {
        storedReturnTo = decodeURIComponent(stateCookie.slice(separator + 1))
      } catch {
        storedReturnTo = undefined
      }
    }
    const returnTo = sanitizeReturnTo(storedReturnTo)
    const presentedState = context.req.query('state') ?? ''
    const code = context.req.query('code') ?? ''
    if (!expectedState || !code || !timingSafeEqualStrings(expectedState, presentedState)) {
      return context.redirect(LOGIN_ERROR_REDIRECT, 302)
    }

    try {
      const accessToken = await exchangeGitHubCode(
        dependencies.oauthFetcher,
        config.clientId,
        config.clientSecret,
        code,
        callbackUrl(context),
      )
      const profile = await fetchGitHubProfile(dependencies.oauthFetcher, accessToken)
      const nowMs = dependencies.clock()
      const user = await upsertGitHubUser(
        context.env.CATALOG_DB,
        profile,
        new Date(nowMs).toISOString(),
      )
      const session = await createSession(context.env.CATALOG_DB, user.id, nowMs)
      setSessionCookie(context, session.token)
      return context.redirect(returnTo, 302)
    } catch (error) {
      if (error instanceof GitHubOAuthError) {
        console.error(JSON.stringify({ message: 'github_oauth_failed', error: error.message }))
        return context.redirect(LOGIN_ERROR_REDIRECT, 302)
      }
      throw error
    }
  })

  app.get('/api/v1/auth/me', async (context) => {
    context.header('Cache-Control', 'no-store')
    const user = await sessionUser(context, dependencies.clock)
    if (!user) return context.json({ user: null })
    return context.json({
      user: {
        githubLogin: user.githubLogin,
        githubName: user.githubName,
        avatarUrl: user.avatarUrl,
      },
    })
  })

  app.post('/api/v1/auth/logout', async (context) => {
    if (crossOriginRejected(context)) {
      return context.json({ error: 'Cross-origin request rejected.', code: 'FORBIDDEN' }, 403)
    }
    const token = getCookie(context, SESSION_COOKIE)
    if (token && context.env?.CATALOG_DB) {
      await deleteSession(context.env.CATALOG_DB, token)
    }
    deleteCookie(context, SESSION_COOKIE, { path: '/' })
    return context.json({ ok: true })
  })

  app.get('/api/v1/api-keys', async (context) => {
    context.header('Cache-Control', 'no-store')
    const user = await sessionUser(context, dependencies.clock)
    if (!user) return context.json({ error: 'Login required.', code: 'UNAUTHORIZED' }, 401)
    return context.json({ apiKeys: await listApiKeys(context.env.CATALOG_DB, user.id) })
  })

  app.post('/api/v1/api-keys', async (context) => {
    if (crossOriginRejected(context)) {
      return context.json({ error: 'Cross-origin request rejected.', code: 'FORBIDDEN' }, 403)
    }
    const user = await sessionUser(context, dependencies.clock)
    if (!user) return context.json({ error: 'Login required.', code: 'UNAUTHORIZED' }, 401)

    const declaredLength = context.req.header('Content-Length')
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_KEY_REQUEST_BYTES)) {
      return context.json({ error: 'Request body is too large.', code: 'INVALID_REQUEST' }, 413)
    }

    let name = 'API Key'
    const rawBody = await boundedText(context.req.raw, MAX_KEY_REQUEST_BYTES)
    if (rawBody === null) {
      return context.json({ error: 'Request body is too large.', code: 'INVALID_REQUEST' }, 413)
    }
    if (rawBody.length > 0) {
      let parsed: unknown
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        return context.json({ error: 'Request body must be valid JSON.', code: 'INVALID_REQUEST' }, 400)
      }
      if (parsed && typeof parsed === 'object' && 'name' in parsed) {
        const requested = (parsed as { name: unknown }).name
        if (typeof requested !== 'string' || requested.trim().length === 0 ||
          requested.trim().length > MAX_API_KEY_NAME_LENGTH) {
          return context.json({ error: 'Invalid API key name.', code: 'INVALID_REQUEST' }, 400)
        }
        name = requested.trim()
      }
    }

    try {
      const created = await createApiKey(
        context.env.CATALOG_DB,
        user.id,
        name,
        new Date(dependencies.clock()).toISOString(),
      )
      return context.json({ apiKey: created }, 201)
    } catch (error) {
      if (error instanceof ApiKeyLimitError) {
        return context.json({ error: 'Active API key limit reached.', code: 'KEY_LIMIT_REACHED' }, 400)
      }
      throw error
    }
  })

  app.delete('/api/v1/api-keys/:id', async (context) => {
    if (crossOriginRejected(context)) {
      return context.json({ error: 'Cross-origin request rejected.', code: 'FORBIDDEN' }, 403)
    }
    const user = await sessionUser(context, dependencies.clock)
    if (!user) return context.json({ error: 'Login required.', code: 'UNAUTHORIZED' }, 401)

    const keyId = Number(context.req.param('id'))
    if (!Number.isInteger(keyId) || keyId <= 0) {
      return context.json({ error: 'Invalid API key id.', code: 'INVALID_REQUEST' }, 400)
    }
    const revoked = await revokeApiKey(
      context.env.CATALOG_DB,
      user.id,
      keyId,
      new Date(dependencies.clock()).toISOString(),
    )
    if (!revoked) return context.json({ error: 'API key not found.', code: 'NOT_FOUND' }, 404)
    return context.json({ ok: true })
  })
}
