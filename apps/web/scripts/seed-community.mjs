/**
 * Fill the local D1 with a handful of posts so the dev server shows a feed
 * rather than an empty state.
 *
 * Local only, by construction: it opens the miniflare SQLite file under
 * `apps/web/.wrangler/state` directly. There is no code path from here to a
 * deployed database, and the rows it writes use negative GitHub ids, which the
 * real OAuth flow can never mint.
 *
 *   npm run seed:community            # from the repository root
 *   node apps/web/scripts/seed-community.mjs --reset
 */
import { readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const D1_DIRECTORY = fileURLToPath(
  new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url),
)

function openLocalDatabase() {
  const files = readdirSync(D1_DIRECTORY).filter(
    (name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite',
  )
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one local D1 file in ${D1_DIRECTORY}, found ${files.length}. ` +
      'Run `npm run db:migrate:local` from the repository root first.',
    )
  }
  return new DatabaseSync(`${D1_DIRECTORY}${files[0]}`)
}

const AUTHORS = [
  { login: 'octocat', name: '章北海' },
  { login: 'hubot', name: 'Hubot' },
  { login: 'mona', name: 'Mona Lisa' },
  { login: 'liuyu', name: '刘宇' },
]

const POSTS = [
  {
    author: 'octocat',
    key: 'profile',
    hoursAgo: 1,
    likes: 12,
    body: `刚把 harness 的 profile 切换脚本重写了一遍，从 300 行 bash 降到 40 行。

关键是别自己解析 \`~/.dsh/config\`，直接调 \`dsh profile list --json\` 再管道给 fzf。早知道有这个 flag 我能少写两天。`,
  },
  {
    author: 'mona',
    key: 'refactor',
    hoursAgo: 3,
    likes: 31,
    body: `有人拿 @acme/tool 做过大仓库的批量重构吗？

我这边 4000 个文件跑下来大概 6 分钟，想知道这个量级正常不正常。`,
  },
  {
    author: 'liuyu',
    key: 'pnpm',
    hoursAgo: 7,
    likes: 5,
    body: `记一个坑：插件里 \`prepare\` 脚本装 native 依赖的话，pnpm 默认不会跑，第一次安装会静默失败。

需要在 \`pnpm-workspace.yaml\` 里显式 allow。报错信息完全没提这件事，我查了一晚上。`,
  },
  {
    author: 'hubot',
    key: 'export',
    hoursAgo: 20,
    likes: 48,
    body: `## 周末做了个小东西

把 harness 的会话记录导出成 markdown，按天分文件，代码块保留语言标注。

还很糙，但已经能用了。有需要的可以先拿去改。`,
  },
  {
    author: 'octocat',
    key: 'versions',
    hoursAgo: 30,
    likes: 3,
    body: '有没有人知道为什么 `--profile web` 和 `--profile cli` 装出来的插件版本会不一样？两个 lockfile 我对比过是一致的。',
  },
  {
    author: 'mona',
    key: 'shortlist',
    hoursAgo: 52,
    likes: 19,
    body: `整理了一份自己在用的插件清单，都是每天真的会打开的那几个：

1. 代码检索 —— 比内置 grep 快一个数量级
2. diff 审阅 —— 能直接在终端里 review
3. 会话导出

工具装太多反而不用了，留三个刚好。`,
  },
]

const REPLIES = [
  { on: 'refactor', author: 'liuyu', hoursAgo: 2, likes: 4, body: '4000 文件 6 分钟差不多，我这边 2500 个大概 3 分半。瓶颈基本都在 IO 上。' },
  { on: 'refactor', author: 'hubot', hoursAgo: 1, likes: 1, body: '可以试试 `--concurrency` 调到 CPU 核数的两倍，我这边快了差不多三成。' },
  { on: 'export', author: 'octocat', hoursAgo: 12, likes: 2, body: '正好需要这个，先用起来。' },
]

const database = openLocalDatabase()
const now = Date.now()
const iso = (hoursAgo) => new Date(now - hoursAgo * 3_600_000).toISOString()

if (process.argv.includes('--reset')) {
  database.exec('DELETE FROM community_posts; DELETE FROM community_likes; DELETE FROM community_post_plugins;')
}

const existing = database.prepare('SELECT COUNT(*) AS count FROM community_posts').get()
if (Number(existing.count) > 0) {
  console.log(`Local community already has ${existing.count} posts; nothing seeded. Pass --reset to replace them.`)
  database.close()
  process.exit(0)
}

const authorIds = new Map()
for (const [index, author] of AUTHORS.entries()) {
  // Negative ids can never collide with a real GitHub account.
  const githubId = -(1000 + index)
  database.prepare(
    `INSERT INTO api_users (github_id, github_login, github_name, avatar_url, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)
     ON CONFLICT(github_id) DO UPDATE SET github_login = excluded.github_login`,
  ).run(githubId, author.login, author.name, iso(72), iso(72), iso(72))
  const row = database.prepare('SELECT id FROM api_users WHERE github_id = ?').get(githubId)
  authorIds.set(author.login, Number(row.id))
}

function insert({ author, hoursAgo, likes, body }, replyToId = null) {
  database.prepare(
    `INSERT INTO community_posts (author_id, body, reply_to_id, like_count, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(authorIds.get(author), body, replyToId, likes, iso(hoursAgo))
  return Number(database.prepare('SELECT last_insert_rowid() AS id').get().id)
}

// Oldest first. The feed pages on id, which is only equivalent to time order
// because rows are inserted when they are written; seeding out of order would
// produce a timeline that reads as shuffled and make the feed look broken when
// it is not.
const byOldest = [...POSTS].sort((left, right) => right.hoursAgo - left.hoursAgo)
const postIds = new Map()
for (const post of byOldest) postIds.set(post.key, insert(post))

for (const reply of [...REPLIES].sort((left, right) => right.hoursAgo - left.hoursAgo)) {
  insert(reply, postIds.get(reply.on))
  database.prepare('UPDATE community_posts SET reply_count = reply_count + 1 WHERE id = ?')
    .run(postIds.get(reply.on))
}

// Only a plugin the catalog actually publishes renders a card, so the mention in
// the second post needs a matching catalog row to demonstrate anything. A local
// database that never ran a catalog sync has none, so put one there.
const existingPlugin = database.prepare(
  "SELECT repository_id FROM catalog_plugins WHERE normalized_plugin_id = 'acme/tool'",
).get()
if (!existingPlugin) {
  database.prepare(
    `INSERT INTO catalog_repositories
       (full_name, normalized_full_name, owner, repository_name, html_url, stars, forks,
        from_topic, first_seen_at, last_seen_at, created_at, updated_at)
     VALUES ('acme/tool', 'acme/tool', 'acme', 'tool', 'https://github.com/acme/tool', 1284, 63,
             1, ?, ?, ?, ?)`,
  ).run(iso(72), iso(72), iso(72), iso(72))
  const repositoryId = Number(database.prepare('SELECT last_insert_rowid() AS id').get().id)
  database.prepare(
    `INSERT INTO catalog_plugins
       (repository_id, plugin_id, normalized_plugin_id, plugin_path, from_pr,
        curated_name, curated_category, validation_status,
        first_seen_at, last_seen_at, created_at, updated_at)
     VALUES (?, 'acme/tool', 'acme/tool', '', 0, 'Acme Refactor', 'workflow', 'accepted', ?, ?, ?, ?)`,
  ).run(repositoryId, iso(72), iso(72), iso(72), iso(72))
}
database.prepare(
  'INSERT OR IGNORE INTO community_post_plugins (post_id, normalized_plugin_id, position) VALUES (?, ?, 0)',
).run(postIds.get('refactor'), 'acme/tool')

console.log(`Seeded ${postIds.size} posts and ${REPLIES.length} replies.`)
database.close()
