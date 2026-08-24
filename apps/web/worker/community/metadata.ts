import { COMMUNITY_BASE_PATH } from './routes'

const SITE_NAME = 'DSH 讨论区'

/** First line of prose, flattened, for a share card. */
function summarise(body: string, maximum = 120): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const characters = [...flat]
  return characters.length <= maximum ? flat : `${characters.slice(0, maximum).join('')}…`
}

/**
 * Share cards for a single post, resolved in the Worker.
 *
 * A post is a link people paste into chat, so its `<title>` and `og:` tags have
 * to be right in the first response — a SPA that fills them in after hydration
 * is invisible to every crawler and every chat unfurler. Only the metadata is
 * rendered here; the body itself still arrives with the app.
 */

/**
 * Override the page title and description for a single community post.
 *
 * Everything else on the site gets its metadata from `seo-templates.ts`, which
 * is static copy. A post's title is not copy — it is a row in D1 — so it is
 * resolved here and layered over the static community metadata. Returns null
 * when the path is not a post, or the post is gone.
 */
export async function communityPostMetadata(
  url: URL,
  env: Env,
): Promise<{ title: string; description: string } | null> {
  const path = url.pathname.slice(COMMUNITY_BASE_PATH.length) || '/'
  const postMatch = /^\/p\/(\d+)$/.exec(path)
  if (!postMatch) return null
  const id = Number(postMatch[1])
  if (!Number.isSafeInteger(id)) return null

  const row = await env.CATALOG_DB.prepare(
    `SELECT p.body, u.github_login
       FROM community_posts p
       JOIN api_users u ON u.id = p.author_id
      WHERE p.id = ? AND p.reply_to_id IS NULL AND p.deleted_at IS NULL`,
  ).bind(id).first<{ body: string; github_login: string }>()
  if (!row) return null

  return {
    title: `${summarise(row.body, 40)} — @${row.github_login} · ${SITE_NAME}`,
    description: summarise(row.body),
  }
}
