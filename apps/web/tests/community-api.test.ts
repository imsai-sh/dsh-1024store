import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createSession, upsertGitHubUser } from '../worker/lib/auth'
import { hotScore } from '../worker/community/posts'
import { isAdmin } from '../worker/community/session'
import { communityApp, communityDatabase, seedPlugin, sqliteD1 } from './community-fixtures'
import type { FeedResponse, Post, ThreadResponse } from '../worker/community/contract'

const NOW = Date.parse('2026-08-17T08:00:00Z')
const ORIGIN = 'https://community.deepseek1024.com'

function env(database: DatabaseSync, adminLogins = ''): Env {
  return {
    CATALOG_DB: sqliteD1(database),
    COMMUNITY_ADMIN_LOGINS: adminLogins,
  } as unknown as Env
}

function app(clock: () => number = () => NOW) {
  return communityApp({ clock })
}

/** A signed-in browser: the cookie the main site's OAuth callback would have set. */
async function signIn(database: DatabaseSync, login: string, githubId: number): Promise<string> {
  const db = sqliteD1(database)
  const user = await upsertGitHubUser(
    db,
    { id: githubId, login, name: null, avatarUrl: null },
    new Date(NOW).toISOString(),
  )
  const session = await createSession(db, user.id, NOW)
  return `dsh_session=${session.token}`
}

function post(cookie: string | null, body: unknown, path = '/api/v1/community/posts') {
  return [
    `${ORIGIN}${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    },
  ] as const
}

async function publish(
  instance: ReturnType<typeof app>,
  environment: Env,
  cookie: string,
  body: string,
  replyToId: number | null = null,
): Promise<Post> {
  const response = await instance.request(...post(cookie, { body, replyToId }), environment)
  expect(response.status).toBe(201)
  return ((await response.json()) as { post: Post }).post
}

describe('posting', () => {
  it('requires a session', async () => {
    const database = communityDatabase()
    const response = await app().request(...post(null, { body: 'hello' }), env(database))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' })
    database.close()
  })

  it('rejects a cross-origin write even with a valid cookie', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const response = await app().request(
      `${ORIGIN}/api/v1/community/posts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: cookie },
        body: JSON.stringify({ body: 'hello' }),
      },
      env(database),
    )
    expect(response.status).toBe(403)
    database.close()
  })

  it('stores a post and returns it ready to render', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const created = await publish(app(), env(database), cookie, '  Hello **世界**  ')

    expect(created).toMatchObject({
      body: 'Hello **世界**',
      author: { login: 'octocat' },
      likeCount: 0,
      replyCount: 0,
      liked: false,
      replyToId: null,
      // The author can always remove their own post.
      deletable: true,
    })
    database.close()
  })

  it('rejects a body that is empty or over the limit', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)

    for (const body of ['   ', 'x'.repeat(2001)]) {
      const response = await app().request(...post(cookie, { body }), environment)
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_REQUEST' })
    }
    database.close()
  })
})

describe('plugin mentions', () => {
  it('stores a card only for a plugin the catalog publishes', async () => {
    const database = communityDatabase()
    seedPlugin(database, {
      pluginId: 'acme/tool',
      stars: 128,
      curatedName: 'Acme Tool',
      category: 'workflow',
    })
    seedPlugin(database, { pluginId: 'acme/rejected', published: false })
    const cookie = await signIn(database, 'octocat', 1)

    const created = await publish(
      app(),
      env(database),
      cookie,
      'try @acme/tool, skip @acme/rejected, and @nobody/ghost does not exist',
    )

    expect(created.plugins).toEqual([{
      id: 'acme/tool',
      name: 'Acme Tool',
      owner: 'acme',
      category: 'workflow',
      stars: 128,
      url: 'https://deepseek1024.com/plugins/acme/tool',
    }])
    database.close()
  })

  it('matches a mention case-insensitively but shows the catalog spelling', async () => {
    const database = communityDatabase()
    seedPlugin(database, { pluginId: 'Acme/Tool', stars: null })
    const cookie = await signIn(database, 'octocat', 1)
    const created = await publish(app(), env(database), cookie, 'love @acme/TOOL')
    expect(created.plugins.map((plugin) => plugin.id)).toEqual(['Acme/Tool'])
    database.close()
  })
})

describe('likes', () => {
  it('is idempotent and never drifts the counter', async () => {
    const database = communityDatabase()
    const author = await signIn(database, 'octocat', 1)
    const reader = await signIn(database, 'hubot', 2)
    const environment = env(database)
    const instance = app()
    const created = await publish(instance, environment, author, 'like me')

    const like = () => instance.request(
      `${ORIGIN}/api/v1/community/posts/${created.id}/like`,
      { method: 'POST', headers: { Origin: ORIGIN, Cookie: reader } },
      environment,
    )

    await expect((await like()).json()).resolves.toEqual({ likeCount: 1, liked: true })
    // A double tap must not count twice.
    await expect((await like()).json()).resolves.toEqual({ likeCount: 1, liked: true })

    const unlike = () => instance.request(
      `${ORIGIN}/api/v1/community/posts/${created.id}/like`,
      { method: 'DELETE', headers: { Origin: ORIGIN, Cookie: reader } },
      environment,
    )
    await expect((await unlike()).json()).resolves.toEqual({ likeCount: 0, liked: false })
    // ...and neither must a double un-tap drive it negative.
    await expect((await unlike()).json()).resolves.toEqual({ likeCount: 0, liked: false })
    database.close()
  })

  it('reports the caller’s own like state, not somebody else’s', async () => {
    const database = communityDatabase()
    const author = await signIn(database, 'octocat', 1)
    const reader = await signIn(database, 'hubot', 2)
    const environment = env(database)
    const instance = app()
    const created = await publish(instance, environment, author, 'like me')
    await instance.request(
      `${ORIGIN}/api/v1/community/posts/${created.id}/like`,
      { method: 'POST', headers: { Origin: ORIGIN, Cookie: reader } },
      environment,
    )

    const asReader = await instance.request(
      `${ORIGIN}/api/v1/community/feed`, { headers: { Cookie: reader } }, environment)
    const asAuthor = await instance.request(
      `${ORIGIN}/api/v1/community/feed`, { headers: { Cookie: author } }, environment)
    const anonymous = await instance.request(`${ORIGIN}/api/v1/community/feed`, {}, environment)

    expect(((await asReader.json()) as FeedResponse).posts[0]!.liked).toBe(true)
    expect(((await asAuthor.json()) as FeedResponse).posts[0]!.liked).toBe(false)
    expect(((await anonymous.json()) as FeedResponse).posts[0]!.liked).toBe(false)
    database.close()
  })

  it('requires a session', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()
    const created = await publish(instance, environment, cookie, 'hello')
    const response = await instance.request(
      `${ORIGIN}/api/v1/community/posts/${created.id}/like`,
      { method: 'POST', headers: { Origin: ORIGIN } },
      environment,
    )
    expect(response.status).toBe(401)
    database.close()
  })
})

describe('replies', () => {
  it('threads under a post and keeps the parent’s count in step', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()
    const root = await publish(instance, environment, cookie, 'root')
    await publish(instance, environment, cookie, 'first', root.id)
    await publish(instance, environment, cookie, 'second', root.id)

    const thread = (await (await instance.request(
      `${ORIGIN}/api/v1/community/posts/${root.id}`, {}, environment)).json()) as ThreadResponse
    expect(thread.post.replyCount).toBe(2)
    expect(thread.replies.map((reply) => reply.body)).toEqual(['first', 'second'])

    // Replies never appear as their own entries in the feed.
    const feed = (await (await instance.request(
      `${ORIGIN}/api/v1/community/feed`, {}, environment)).json()) as FeedResponse
    expect(feed.posts).toHaveLength(1)
    database.close()
  })

  it('refuses to nest a reply under a reply', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()
    const root = await publish(instance, environment, cookie, 'root')
    const reply = await publish(instance, environment, cookie, 'reply', root.id)

    const response = await instance.request(
      ...post(cookie, { body: 'nested', replyToId: reply.id }), environment)
    expect(response.status).toBe(404)
    database.close()
  })

  it('applies the shorter length limit to a reply', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()
    const root = await publish(instance, environment, cookie, 'root')

    const long = 'x'.repeat(1001)
    expect((await instance.request(...post(cookie, { body: long, replyToId: root.id }), environment)).status)
      .toBe(400)
    // The same text is fine as a top-level post.
    expect((await instance.request(...post(cookie, { body: long }), environment)).status).toBe(201)
    database.close()
  })
})

describe('deletion', () => {
  it('lets an author remove their own post and nobody else’s', async () => {
    const database = communityDatabase()
    const author = await signIn(database, 'octocat', 1)
    const stranger = await signIn(database, 'hubot', 2)
    const environment = env(database)
    const instance = app()
    const created = await publish(instance, environment, author, 'mine')

    const byStranger = await instance.request(
      `${ORIGIN}/api/v1/community/posts/${created.id}`,
      { method: 'DELETE', headers: { Origin: ORIGIN, Cookie: stranger } },
      environment,
    )
    // 404 rather than 403: a stranger must not learn which post ids exist.
    expect(byStranger.status).toBe(404)

    const byAuthor = await instance.request(
      `${ORIGIN}/api/v1/community/posts/${created.id}`,
      { method: 'DELETE', headers: { Origin: ORIGIN, Cookie: author } },
      environment,
    )
    expect(byAuthor.status).toBe(200)
    database.close()
  })

  it('drops a deleted reply rather than leaving a tombstone the count denies', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()
    const root = await publish(instance, environment, cookie, 'root')
    const doomed = await publish(instance, environment, cookie, 'regrettable', root.id)
    await publish(instance, environment, cookie, 'kept', root.id)
    await instance.request(
      `${ORIGIN}/api/v1/community/posts/${doomed.id}`,
      { method: 'DELETE', headers: { Origin: ORIGIN, Cookie: cookie } },
      environment,
    )

    const thread = (await (await instance.request(
      `${ORIGIN}/api/v1/community/posts/${root.id}`, {}, environment)).json()) as ThreadResponse
    expect(thread.replies.map((reply) => reply.body)).toEqual(['kept'])
    // The count and what is on screen have to agree.
    expect(thread.post.replyCount).toBe(thread.replies.length)
    database.close()
  })

  it('keeps a deleted post out of the timeline entirely', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()
    const kept = await publish(instance, environment, cookie, 'kept')
    const removed = await publish(instance, environment, cookie, 'removed')
    await instance.request(
      `${ORIGIN}/api/v1/community/posts/${removed.id}`,
      { method: 'DELETE', headers: { Origin: ORIGIN, Cookie: cookie } },
      environment,
    )

    for (const path of ['/feed', '/feed?tab=hot', '/users/octocat']) {
      const page = (await (await instance.request(
        `${ORIGIN}/api/v1/community${path}`, {}, environment)).json()) as FeedResponse
      expect(page.posts.map((entry) => entry.id), path).toEqual([kept.id])
    }
    database.close()
  })

  it('keeps the thread readable and stops serving the text', async () => {
    const database = communityDatabase()
    seedPlugin(database, { pluginId: 'acme/tool' })
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()
    const root = await publish(instance, environment, cookie, 'root about @acme/tool')
    await publish(instance, environment, cookie, 'a reply worth keeping', root.id)

    await instance.request(
      `${ORIGIN}/api/v1/community/posts/${root.id}`,
      { method: 'DELETE', headers: { Origin: ORIGIN, Cookie: cookie } },
      environment,
    )

    const thread = (await (await instance.request(
      `${ORIGIN}/api/v1/community/posts/${root.id}`, {}, environment)).json()) as ThreadResponse
    expect(thread.post.body).toBeNull()
    // Deleting the text must also retract the cards derived from it.
    expect(thread.post.plugins).toEqual([])
    expect(thread.replies.map((reply) => reply.body)).toEqual(['a reply worth keeping'])
    database.close()
  })

  it('decrements the parent count when a reply is removed', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()
    const root = await publish(instance, environment, cookie, 'root')
    const reply = await publish(instance, environment, cookie, 'reply', root.id)

    await instance.request(
      `${ORIGIN}/api/v1/community/posts/${reply.id}`,
      { method: 'DELETE', headers: { Origin: ORIGIN, Cookie: cookie } },
      environment,
    )
    const thread = (await (await instance.request(
      `${ORIGIN}/api/v1/community/posts/${root.id}`, {}, environment)).json()) as ThreadResponse
    expect(thread.post.replyCount).toBe(0)
    database.close()
  })

  it('lets a configured admin remove anybody’s post', async () => {
    const database = communityDatabase()
    const author = await signIn(database, 'octocat', 1)
    const admin = await signIn(database, 'Moderator', 2)
    const environment = env(database, 'someone-else, moderator')
    const instance = app()
    const created = await publish(instance, environment, author, 'spam')

    const response = await instance.request(
      `${ORIGIN}/api/v1/community/posts/${created.id}`,
      { method: 'DELETE', headers: { Origin: ORIGIN, Cookie: admin } },
      environment,
    )
    expect(response.status).toBe(200)
    database.close()
  })
})

describe('rate limiting', () => {
  it('stops a burst of posts and says when to come back', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()

    for (let index = 0; index < 5; index += 1) {
      const allowed = await instance.request(...post(cookie, { body: `post ${index}` }), environment)
      expect(allowed.status).toBe(201)
    }
    const blocked = await instance.request(...post(cookie, { body: 'one too many' }), environment)
    expect(blocked.status).toBe(429)
    await expect(blocked.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' })
    database.close()
  })

  it('counts posts and replies against separate allowances', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()
    const root = await publish(instance, environment, cookie, 'root')

    for (let index = 0; index < 4; index += 1) {
      await publish(instance, environment, cookie, `reply ${index}`, root.id)
    }
    // Five posts already used the post window; replies still have room.
    const reply = await instance.request(...post(cookie, { body: 'still fine', replyToId: root.id }), environment)
    expect(reply.status).toBe(201)
    database.close()
  })
})

describe('feed ranking', () => {
  it('ranks engagement against age', () => {
    const older = { likeCount: 10, replyCount: 0, createdAt: new Date(NOW - 48 * 3_600_000).toISOString() }
    const newer = { likeCount: 3, replyCount: 0, createdAt: new Date(NOW - 3_600_000).toISOString() }
    expect(hotScore(newer, NOW)).toBeGreaterThan(hotScore(older, NOW))

    // A reply is worth more than a like: writing one costs more than tapping.
    const liked = { likeCount: 2, replyCount: 0, createdAt: new Date(NOW).toISOString() }
    const discussed = { likeCount: 0, replyCount: 2, createdAt: new Date(NOW).toISOString() }
    expect(hotScore(discussed, NOW)).toBeGreaterThan(hotScore(liked, NOW))
  })

})

describe('stats', () => {
  it('counts posts, not replies', async () => {
    const database = communityDatabase()
    const author = await signIn(database, 'octocat', 1)
    const other = await signIn(database, 'hubot', 2)
    const environment = env(database)
    const instance = app()
    const root = await publish(instance, environment, author, 'root')
    await publish(instance, environment, other, 'a reply', root.id)
    await publish(instance, environment, other, 'another reply', root.id)

    const stats = await (await instance.request(
      `${ORIGIN}/api/v1/community/stats`, {}, environment)).json()
    // One post and two replies is one post. Counting rows would say three, and
    // the rail would disagree with what the reader can count in the feed.
    expect(stats).toEqual({ posts: 1, authors: 1, postsToday: 1 })
    database.close()
  })
})

describe('pagination', () => {
  it('walks the feed without repeating or skipping a post', async () => {
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()
    // Straight to D1: the HTTP path is rate limited well below this count.
    const db = sqliteD1(database)
    const user = await upsertGitHubUser(
      db, { id: 1, login: 'octocat', name: null, avatarUrl: null }, new Date(NOW).toISOString())
    for (let index = 0; index < 45; index += 1) {
      await db.prepare(
        'INSERT INTO community_posts (author_id, body, created_at) VALUES (?, ?, ?)',
      ).bind(user.id, `post ${index}`, new Date(NOW + index).toISOString()).run()
    }

    const seen: number[] = []
    let cursor: string | null = null
    for (let page = 0; page < 5; page += 1) {
      const url = `${ORIGIN}/api/v1/community/feed${cursor ? `?cursor=${cursor}` : ''}`
      const body = (await (await instance.request(url, { headers: { Cookie: cookie } }, environment))
        .json()) as FeedResponse
      seen.push(...body.posts.map((entry) => entry.id))
      cursor = body.nextCursor
      if (cursor === null) break
    }

    expect(seen).toHaveLength(45)
    expect(new Set(seen).size).toBe(45)
    // Newest first, all the way down.
    expect([...seen].sort((left, right) => right - left)).toEqual(seen)
    database.close()
  })
})

describe('sign-in routing', () => {
  it('hands off to the site’s own GitHub sign-in, carrying the return path', async () => {
    const database = communityDatabase()
    const response = await app().request(
      `${ORIGIN}/api/v1/community/sign-in?returnTo=%2Fcommunity%2Fp%2F12`, {}, env(database))
    expect(response.headers.get('Location'))
      .toBe('/api/v1/auth/github/login?returnTo=%2Fcommunity%2Fp%2F12')
    database.close()
  })

  it('refuses to redirect anywhere the query string asks for', async () => {
    const database = communityDatabase()
    const environment = env(database)
    // Rejected values, and same-site paths outside the community, both land on
    // the community's own home rather than the catalog's.
    for (const hostile of ['https://evil.example/steal', '//evil.example', '/\\evil.example', '/account']) {
      const response = await app().request(
        `${ORIGIN}/api/v1/community/sign-in?returnTo=${encodeURIComponent(hostile)}`, {}, environment)
      expect(response.headers.get('Location'), hostile)
        .toBe('/api/v1/auth/github/login?returnTo=%2Fcommunity')
    }
    database.close()
  })
})

describe('admin list', () => {
  it('matches case-insensitively and ignores blanks', () => {
    expect(isAdmin('Octocat, hubot', 'octocat')).toBe(true)
    expect(isAdmin(' , hubot , ', 'hubot')).toBe(true)
    expect(isAdmin('', 'octocat')).toBe(false)
    expect(isAdmin(undefined, 'octocat')).toBe(false)
    expect(isAdmin('octocatx', 'octocat')).toBe(false)
  })
})

describe('development sign-in', () => {
  it('is unreachable on a public host even if the flag is somehow set', async () => {
    const database = communityDatabase()
    const environment = {
      ...env(database),
      COMMUNITY_DEV_LOGIN: '1',
    } as unknown as Env
    const response = await app().request(`${ORIGIN}/api/v1/community/dev-login`, {}, environment)
    expect(response.status).toBe(404)
    database.close()
  })

  it('is unreachable on localhost without the flag', async () => {
    const database = communityDatabase()
    const response = await app().request('http://localhost:5642/api/v1/community/dev-login', {}, env(database))
    expect(response.status).toBe(404)
    database.close()
  })

  it('mints a session on localhost with the flag', async () => {
    const database = communityDatabase()
    const environment = { ...env(database), COMMUNITY_DEV_LOGIN: '1' } as unknown as Env
    const response = await app().request(
      'http://localhost:5642/api/v1/community/dev-login?login=localdev', {}, environment)
    expect(response.status).toBe(302)
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith('dsh_session='))).toBe(true)
    // The stand-in row must never collide with a real GitHub account id.
    const row = database.prepare('SELECT github_id FROM api_users').get() as { github_id: number }
    expect(row.github_id).toBeLessThan(0)
    database.close()
  })
})

describe('hot feed hydration', () => {
  it('loads plugin cards for the page it returns, not every candidate it considered', async () => {
    // 排序在 Worker 里做，所以候选集比一页大得多。曾经有一版先 hydrate 全部
    // 候选再排序，扔掉绝大多数 —— 而那个 IN 列表会超过 D1 单条查询 100 个
    // 绑定参数的上限。node:sqlite 没有这个上限，所以只能靠数参数来守。
    const database = communityDatabase()
    const cookie = await signIn(database, 'octocat', 1)
    const environment = env(database)
    const instance = app()

    const db = sqliteD1(database)
    const user = await upsertGitHubUser(
      db, { id: 1, login: 'octocat', name: null, avatarUrl: null }, new Date(NOW).toISOString())
    for (let index = 0; index < 60; index += 1) {
      await db.prepare(
        'INSERT INTO community_posts (author_id, body, like_count, created_at) VALUES (?, ?, ?, ?)',
      ).bind(user.id, `post ${index}`, index, new Date(NOW - index * 1000).toISOString()).run()
    }

    let widestPluginLookup = 0
    const counting = {
      ...environment,
      CATALOG_DB: {
        ...db,
        prepare(sql: string) {
          const statement = db.prepare(sql)
          if (!sql.includes('community_post_plugins')) return statement
          return {
            ...statement,
            bind(...params: unknown[]) {
              widestPluginLookup = Math.max(widestPluginLookup, params.length)
              return statement.bind(...params)
            },
          }
        },
      },
    } as unknown as Env

    const response = await instance.request(
      `${ORIGIN}/api/v1/community/feed?tab=hot`, { headers: { Cookie: cookie } }, counting)
    const page = (await response.json()) as FeedResponse

    expect(page.posts.length).toBeLessThanOrEqual(20)
    // 上限是页大小，不是候选数。60 条候选、20 条一页 —— 若退回先 hydrate
    // 再排序，这里会是 60。
    expect(widestPluginLookup).toBeLessThanOrEqual(page.posts.length)
    database.close()
  })
})
