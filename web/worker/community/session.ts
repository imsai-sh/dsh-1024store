import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import {
  createSession,
  deleteSession,
  getSessionUser,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  upsertGitHubUser,
  type ApiUser,
} from '../lib/auth'

export type CommunityContext = Context<{ Bindings: Env }>

export interface Signer {
  user: ApiUser
  admin: boolean
}

/**
 * The community runs inside the main Worker, on the main hostname, so a session
 * is just the site's session: the same cookie, the same `api_sessions` row, no
 * second sign-in and nothing to hand across an origin.
 */
export async function currentUser(context: CommunityContext): Promise<Signer | null> {
  if (!context.env?.CATALOG_DB) return null
  const token = getCookie(context, SESSION_COOKIE)
  if (!token) return null
  const user = await getSessionUser(context.env.CATALOG_DB, token, Date.now())
  if (!user) return null
  return { user, admin: isAdmin(context.env.COMMUNITY_ADMIN_LOGINS, user.githubLogin) }
}

export function isAdmin(configured: string | undefined, login: string): boolean {
  if (!configured) return false
  return configured
    .split(',')
    .map((entry) => entry.trim().toLocaleLowerCase('en-US'))
    .filter((entry) => entry.length > 0)
    .includes(login.toLocaleLowerCase('en-US'))
}

export async function signOut(context: CommunityContext): Promise<void> {
  const token = getCookie(context, SESSION_COOKIE)
  if (token && context.env?.CATALOG_DB) {
    await deleteSession(context.env.CATALOG_DB, token)
  }
  setCookie(context, SESSION_COOKIE, '', { path: '/', maxAge: 0 })
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/**
 * A sign-in that mints a session without GitHub, for local work only.
 *
 * Two independent gates, either of which alone is enough to disable it:
 * `COMMUNITY_DEV_LOGIN` is set nowhere but `.dev.vars` (git-ignored, never
 * uploaded, and absent from wrangler.jsonc so no deploy can carry it), and the
 * request must arrive on a loopback host, which no deployed Worker ever sees.
 * It exists because the real OAuth App's callback is registered against one
 * specific port, so a machine without those client secrets otherwise cannot
 * exercise a signed-in page at all.
 */
export function devLoginEnabled(context: CommunityContext): boolean {
  // Read through a cast rather than declared on Env, because it genuinely is not
  // a binding: it appears in no wrangler config, only in git-ignored `.dev.vars`,
  // which `wrangler deploy` does not read. Making it look like a normal binding
  // would invite someone to "fix" the missing declaration by adding it to
  // wrangler.jsonc, which is the one thing that must not happen.
  const flag = (context.env as { COMMUNITY_DEV_LOGIN?: string } | undefined)?.COMMUNITY_DEV_LOGIN
  return flag === '1' && isLoopback(new URL(context.req.url).hostname)
}

export async function createDevSession(context: CommunityContext, login: string): Promise<void> {
  const nowMs = Date.now()
  const user = await upsertGitHubUser(
    context.env.CATALOG_DB,
    {
      // Negative ids cannot collide with a real GitHub account id, so a
      // development row can never be mistaken for, or overwrite, a real user.
      id: -Math.abs([...login].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 1_000_000, 7)) - 1,
      login,
      name: login,
      avatarUrl: null,
    },
    new Date(nowMs).toISOString(),
  )
  const session = await createSession(context.env.CATALOG_DB, user.id, nowMs)
  setCookie(context, SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}
