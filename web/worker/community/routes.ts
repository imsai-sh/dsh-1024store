import { consumeQuota, type QuotaLimits } from '../lib/api-quota'
import { sanitizeReturnTo, timingSafeEqualStrings } from '../lib/auth'
import { normalizePluginId, parsePluginId } from '../lib/plugin-id'
import { Hono } from 'hono'
import type { ApiError, CommunityStats, FeedResponse, ThreadResponse, Viewer } from './contract'
import {
  communityStats,
  createPost,
  deletePost,
  getThread,
  listByAuthor,
  listHot,
  listLatest,
  ParentNotFoundError,
  setLike,
  ThreadFullError,
  type ViewerContext,
} from './posts'
import { moderate } from './moderation'
import {
  loadBlockedTerms,
  MAX_TERMS_PER_SYNC,
  recordModerationEvent,
  replaceBlockedTerms,
} from './moderation-store'
import {
  extractPluginMentions,
  MAX_POST_LENGTH,
  MAX_REPLY_LENGTH,
  validatePostBody,
} from './post-body'
import {
  createDevSession,
  currentUser,
  devLoginEnabled,
  signOut,
  type CommunityContext,
} from './session'

const MAX_REQUEST_BYTES = 16 * 1024
const MODERATION_SYNC_CATEGORIES = new Set(['political', 'sexual', 'abuse', 'spam'])

/**
 * Writing costs more than tapping, so the windows differ. Reads are unmetered:
 * they are cacheable and carry no cost a signed-out visitor could not already
 * impose by reloading the page.
 */
const POST_QUOTA: QuotaLimits = { perMinute: 5, perDay: 50 }
const REPLY_QUOTA: QuotaLimits = { perMinute: 10, perDay: 200 }
const LIKE_QUOTA: QuotaLimits = { perMinute: 30, perDay: 500 }

export interface CommunityDependencies {
  clock: () => number
}

type CommunityApp = Hono<{ Bindings: Env }>

/** Where the community lives on the site. A permanent public path. */
export const COMMUNITY_BASE_PATH = '/community'

/**
 * Where a sign-in started from the community may return to.
 *
 * sanitizeReturnTo does the security half — it rejects absolute URLs, control
 * characters, and the protocol-relative forms — and collapses anything it does
 * not like to `/`. That is the catalog's home page, which is a confusing place
 * to land after signing in from the community, so anything outside the
 * community's own subtree comes back here instead.
 */
function communityReturnTo(raw: string | undefined): string {
  const safe = sanitizeReturnTo(raw)
  return safe === COMMUNITY_BASE_PATH || safe.startsWith(`${COMMUNITY_BASE_PATH}/`)
    ? safe
    : COMMUNITY_BASE_PATH
}

function fail(context: CommunityContext, status: 400 | 401 | 403 | 404 | 413 | 429 | 503, body: ApiError) {
  return context.json(body, status)
}

/**
 * Cookie-authenticated mutations double-check Origin. SameSite=Lax is the
 * primary CSRF defence; this rejects the residual cases where a cross-origin
 * caller still attaches one. Mirrors the main site's check.
 */
function crossOriginRejected(context: CommunityContext): boolean {
  const origin = context.req.header('Origin')
  return Boolean(origin) && origin !== new URL(context.req.url).origin
}

/**
 * Read at most MAX_REQUEST_BYTES and parse it, or give up.
 *
 * The declared Content-Length is checked first because it is free, but it is
 * not the enforcement: a chunked request declares nothing, so the body is read
 * incrementally and abandoned the moment it runs over. Buffering the whole
 * thing before measuring it would make the cap advisory.
 */
async function boundedJson(context: CommunityContext, maximumBytes = MAX_REQUEST_BYTES): Promise<unknown | undefined> {
  const declared = context.req.header('Content-Length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) return undefined

  const body = context.req.raw.body
  if (!body) return {}
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maximumBytes) {
      await reader.cancel()
      return undefined
    }
    chunks.push(result.value)
  }
  if (total === 0) return {}

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
}

async function meteredOrNull(
  context: CommunityContext,
  key: string,
  limits: QuotaLimits,
  nowMs: number,
): Promise<Response | null> {
  const decision = await consumeQuota(context.env.CATALOG_DB, key, limits, nowMs)
  if (decision.allowed) return null
  return fail(context, 429, {
    error: decision.reason === 'day'
      ? 'You have reached today’s limit. Try again tomorrow.'
      : 'You are posting too quickly. Try again shortly.',
    code: decision.reason === 'day' ? 'DAILY_QUOTA_EXCEEDED' : 'RATE_LIMITED',
    retryAfterSeconds: decision.retryAfterSeconds,
  })
}

const BODY_MESSAGES: Record<string, string> = {
  empty: 'Write something first.',
  too_long: 'That post is longer than the limit.',
  control_characters: 'That post contains characters that are not allowed.',
}

/**
 * Mount the community API onto the site's Hono app.
 *
 * The community is a separate front-end in `apps/community/src`, but it is not a
 * separate service: it runs in the main Worker, on the main hostname, against
 * the same D1. That is what makes a session here the same session as on the
 * catalog, with no cookie scoping and no second OAuth app.
 */
export function registerCommunityRoutes(
  app: CommunityApp,
  dependencies: CommunityDependencies = { clock: () => Date.now() },
): void {

  async function viewerContext(context: CommunityContext): Promise<ViewerContext> {
    const signer = await currentUser(context)
    return { userId: signer?.user.id ?? null, admin: signer?.admin ?? false }
  }

  app.get('/api/v1/community/health', (context) => context.json({ status: 'ok' }))

  app.get('/api/v1/community/me', async (context) => {
    context.header('Cache-Control', 'no-store')
    const signer = await currentUser(context)
    if (!signer) return context.json({ viewer: null })
    const viewer: Viewer = {
      login: signer.user.githubLogin,
      name: signer.user.githubName,
      avatarUrl: signer.user.avatarUrl,
      admin: signer.admin,
    }
    return context.json({ viewer })
  })

  app.get('/api/v1/community/sign-in', (context) => {
    const safe = communityReturnTo(context.req.query('returnTo'))
    // On a developer's machine there is usually no OAuth app configured, so the
    // same button signs in locally instead of dead-ending. Both gates in
    // devLoginEnabled still apply.
    if (devLoginEnabled(context)) {
      return context.redirect(`/api/v1/community/dev-login?returnTo=${encodeURIComponent(safe)}`, 302)
    }
    // The site's own sign-in, same origin: no cross-host handoff to arrange.
    return context.redirect(`/api/v1/auth/github/login?returnTo=${encodeURIComponent(safe)}`, 302)
  })

  app.post('/api/v1/community/sign-out', async (context) => {
    if (crossOriginRejected(context)) {
      return fail(context, 403, { error: 'Cross-origin request rejected.', code: 'FORBIDDEN' })
    }
    await signOut(context)
    return context.json({ ok: true })
  })

  // Local-only. See devLoginEnabled for the two gates that keep it off anywhere
  // a real visitor could reach.
  app.get('/api/v1/community/dev-login', async (context) => {
    if (!devLoginEnabled(context)) {
      return fail(context, 404, { error: 'Not found.', code: 'NOT_FOUND' })
    }
    const login = (context.req.query('login') ?? 'localdev').trim()
    if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) {
      return fail(context, 400, { error: 'Invalid login.', code: 'INVALID_REQUEST' })
    }
    await createDevSession(context, login)
    return context.redirect(communityReturnTo(context.req.query('returnTo')), 302)
  })

  app.get('/api/v1/community/feed', async (context) => {
    context.header('Cache-Control', 'no-store')
    const viewer = await viewerContext(context)
    const tab = context.req.query('tab') === 'hot' ? 'hot' : 'latest'
    const page = tab === 'hot'
      ? await listHot(context.env.CATALOG_DB, viewer, dependencies.clock())
      : await listLatest(context.env.CATALOG_DB, viewer, context.req.query('cursor') ?? null)
    return context.json(page satisfies FeedResponse)
  })

  app.get('/api/v1/community/posts/:id', async (context) => {
    context.header('Cache-Control', 'no-store')
    const id = Number(context.req.param('id'))
    if (!Number.isSafeInteger(id) || id <= 0) {
      return fail(context, 400, { error: 'Invalid post id.', code: 'INVALID_REQUEST' })
    }
    const viewer = await viewerContext(context)
    const thread = await getThread(context.env.CATALOG_DB, id, viewer)
    if (!thread) return fail(context, 404, { error: 'Post not found.', code: 'NOT_FOUND' })
    return context.json(thread satisfies ThreadResponse)
  })

  app.get('/api/v1/community/users/:login', async (context) => {
    context.header('Cache-Control', 'no-store')
    const login = context.req.param('login')
    if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) {
      return fail(context, 400, { error: 'Invalid login.', code: 'INVALID_REQUEST' })
    }
    const viewer = await viewerContext(context)
    const page = await listByAuthor(
      context.env.CATALOG_DB,
      login,
      viewer,
      context.req.query('cursor') ?? null,
    )
    return context.json(page satisfies FeedResponse)
  })

  app.post('/api/v1/community/posts', async (context) => {
    if (crossOriginRejected(context)) {
      return fail(context, 403, { error: 'Cross-origin request rejected.', code: 'FORBIDDEN' })
    }
    const signer = await currentUser(context)
    if (!signer) return fail(context, 401, { error: 'Sign in to post.', code: 'UNAUTHORIZED' })

    const payload = await boundedJson(context)
    if (payload === undefined || typeof payload !== 'object' || payload === null) {
      return fail(context, 400, { error: 'Request body must be valid JSON.', code: 'INVALID_REQUEST' })
    }
    const { body: rawBody, replyToId: rawReplyTo } = payload as { body?: unknown; replyToId?: unknown }

    let replyToId: number | null = null
    if (rawReplyTo !== undefined && rawReplyTo !== null) {
      if (!Number.isSafeInteger(rawReplyTo) || (rawReplyTo as number) <= 0) {
        return fail(context, 400, { error: 'Invalid parent post.', code: 'INVALID_REQUEST' })
      }
      replyToId = rawReplyTo as number
    }

    const validated = validatePostBody(rawBody, replyToId === null ? MAX_POST_LENGTH : MAX_REPLY_LENGTH)
    if (!validated.ok) {
      return fail(context, 400, { error: BODY_MESSAGES[validated.reason]!, code: 'INVALID_REQUEST' })
    }

    const nowMs = dependencies.clock()
    const limited = await meteredOrNull(
      context,
      `community:${replyToId === null ? 'post' : 'reply'}:user:${signer.user.id}`,
      replyToId === null ? POST_QUOTA : REPLY_QUOTA,
      nowMs,
    )
    if (limited) return limited

    // 审核在写入之前，也在插件解析之前 —— 被拒的正文不该产生任何副作用。
    const verdict = await moderate(context.env, validated.body, {
      terms: await loadBlockedTerms(context.env.CATALOG_DB, nowMs),
    })
    if (!verdict.allowed) {
      await recordModerationEvent(
        context.env.CATALOG_DB,
        signer.user.id,
        verdict.category,
        verdict.source,
        new Date(nowMs).toISOString(),
      )
      // 不回显命中了什么。告诉发帖人踩了哪一类、哪个词，等于告诉他改哪个
      // 字能过；分类器不可用时也用同一句，免得可用性变成一个可探测的信号。
      return fail(context, 400, {
        error: verdict.category === 'unavailable'
          ? '内容审核暂时不可用，请稍后再发。'
          : '这条内容没有通过社区审核。',
        code: 'INVALID_REQUEST',
      })
    }

    // Mentions are resolved against the catalog now, not at render time: a card
    // is only stored for a plugin that exists, so the feed never has to decide
    // what to do with a dangling reference.
    const mentioned = extractPluginMentions(validated.body)
    const known = mentioned.length === 0
      ? []
      : await knownPluginIds(context.env.CATALOG_DB, mentioned)

    try {
      const post = await createPost(
        context.env.CATALOG_DB,
        {
          authorId: signer.user.id,
          body: validated.body,
          replyToId,
          pluginIds: known,
          now: new Date(nowMs).toISOString(),
        },
        { userId: signer.user.id, admin: signer.admin },
      )
      return context.json({ post }, 201)
    } catch (error) {
      if (error instanceof ParentNotFoundError) {
        return fail(context, 404, { error: 'That post no longer exists.', code: 'NOT_FOUND' })
      }
      if (error instanceof ThreadFullError) {
        return fail(context, 400, { error: 'This thread is full.', code: 'INVALID_REQUEST' })
      }
      throw error
    }
  })

  app.delete('/api/v1/community/posts/:id', async (context) => {
    if (crossOriginRejected(context)) {
      return fail(context, 403, { error: 'Cross-origin request rejected.', code: 'FORBIDDEN' })
    }
    const signer = await currentUser(context)
    if (!signer) return fail(context, 401, { error: 'Sign in first.', code: 'UNAUTHORIZED' })
    const id = Number(context.req.param('id'))
    if (!Number.isSafeInteger(id) || id <= 0) {
      return fail(context, 400, { error: 'Invalid post id.', code: 'INVALID_REQUEST' })
    }
    const removed = await deletePost(
      context.env.CATALOG_DB,
      id,
      { userId: signer.user.id, admin: signer.admin },
      new Date(dependencies.clock()).toISOString(),
    )
    if (!removed) return fail(context, 404, { error: 'Post not found.', code: 'NOT_FOUND' })
    return context.json({ ok: true })
  })

  for (const method of ['POST', 'DELETE'] as const) {
    app.on(method, '/api/v1/community/posts/:id/like', async (context) => {
      if (crossOriginRejected(context)) {
        return fail(context, 403, { error: 'Cross-origin request rejected.', code: 'FORBIDDEN' })
      }
      const signer = await currentUser(context)
      if (!signer) return fail(context, 401, { error: 'Sign in to react.', code: 'UNAUTHORIZED' })
      const id = Number(context.req.param('id'))
      if (!Number.isSafeInteger(id) || id <= 0) {
        return fail(context, 400, { error: 'Invalid post id.', code: 'INVALID_REQUEST' })
      }
      const nowMs = dependencies.clock()
      const limited = await meteredOrNull(context, `community:like:user:${signer.user.id}`, LIKE_QUOTA, nowMs)
      if (limited) return limited

      const likeCount = await setLike(
        context.env.CATALOG_DB,
        id,
        signer.user.id,
        method === 'POST',
        new Date(nowMs).toISOString(),
      )
      if (likeCount === null) return fail(context, 404, { error: 'Post not found.', code: 'NOT_FOUND' })
      return context.json({ likeCount, liked: method === 'POST' })
    })
  }

  // 词表灌入。全量替换，鉴权复用 CATALOG_SYNC_TOKEN —— 两者都是「把一份
  // 本地维护的清单推上线」，没必要再开一把钥匙。词表本身不在仓库里。
  app.post('/api/v1/community/moderation/terms', async (context) => {
    const configured = context.env?.CATALOG_SYNC_TOKEN?.trim()
    if (!configured || configured.length < 32 || !context.env?.CATALOG_DB) {
      return fail(context, 503, { error: 'Moderation sync is not configured.', code: 'SERVICE_UNAVAILABLE' })
    }
    const presented = (context.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!presented || !timingSafeEqualStrings(configured, presented)) {
      return fail(context, 403, { error: 'Forbidden.', code: 'FORBIDDEN' })
    }

    const payload = await boundedJson(context, 512 * 1024)
    const terms = (payload as { terms?: unknown })?.terms
    if (!Array.isArray(terms) || terms.length > MAX_TERMS_PER_SYNC) {
      return fail(context, 400, { error: 'Invalid term list.', code: 'INVALID_REQUEST' })
    }
    const parsed = terms.filter((entry): entry is { term: string; category: never } =>
      Boolean(entry) && typeof entry === 'object'
      && typeof (entry as { term?: unknown }).term === 'string'
      && MODERATION_SYNC_CATEGORIES.has((entry as { category?: unknown }).category as string))
    if (parsed.length !== terms.length) {
      return fail(context, 400, { error: 'Invalid term list.', code: 'INVALID_REQUEST' })
    }

    const result = await replaceBlockedTerms(
      context.env.CATALOG_DB, parsed, new Date(dependencies.clock()).toISOString())
    return context.json(result)
  })

  app.get('/api/v1/community/stats', async (context) => {
    context.header('Cache-Control', 'public, max-age=60')
    const stats = await communityStats(context.env.CATALOG_DB, dependencies.clock())
    return context.json(stats satisfies CommunityStats)
  })

}

/** The subset of the mentioned ids the catalog actually publishes. */
async function knownPluginIds(db: D1Database, ids: readonly string[]): Promise<string[]> {
  const normalized = ids.filter((id) => parsePluginId(id) !== null).map(normalizePluginId)
  if (normalized.length === 0) return []
  const placeholders = normalized.map(() => '?').join(', ')
  const { results } = await db.prepare(
    `SELECT cp.normalized_plugin_id
       FROM catalog_plugins cp
       JOIN catalog_repositories r ON r.id = cp.repository_id
      WHERE cp.normalized_plugin_id IN (${placeholders})
        AND (cp.from_pr = 1 OR (r.from_topic = 1 AND cp.validation_status = 'accepted'))`,
  ).bind(...normalized).all<{ normalized_plugin_id: string }>()
  const found = new Set(results.map((row) => row.normalized_plugin_id))
  return ids.filter((id) => found.has(normalizePluginId(id)))
}
