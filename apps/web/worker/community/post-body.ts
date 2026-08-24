import { normalizePluginId, parsePluginId } from '../lib/plugin-id'

export const MAX_POST_LENGTH = 2000
export const MAX_REPLY_LENGTH = 1000
/** Cards past the third stop being context and start being a billboard. */
export const MAX_PLUGIN_MENTIONS = 3

export type PostBodyRejection = 'empty' | 'too_long' | 'control_characters'

export type PostBodyResult =
  | { ok: true; body: string }
  | { ok: false; reason: PostBodyRejection }

/**
 * Newlines and tabs are legitimate in Markdown; every other C0 control and DEL
 * is not, and they exist in submitted text only to confuse a renderer or a log
 * reader. U+2028/U+2029 join them: they terminate a line in some parsers and
 * not others.
 */
function hasIllegalControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (code === 0x0a || code === 0x09) continue
    if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) return true
  }
  return false
}

/**
 * Length is counted in code points, not UTF-16 units, so a post of emoji is
 * measured the way its author sees it rather than at half the allowance.
 */
export function validatePostBody(value: unknown, maximum = MAX_POST_LENGTH): PostBodyResult {
  if (typeof value !== 'string') return { ok: false, reason: 'empty' }
  const body = value.replace(/\r\n/g, '\n').trim()
  if (body.length === 0) return { ok: false, reason: 'empty' }
  if (hasIllegalControlCharacter(body)) return { ok: false, reason: 'control_characters' }
  if ([...body].length > maximum) return { ok: false, reason: 'too_long' }
  return { ok: true, body }
}

const FENCED_CODE = /```[\s\S]*?(?:```|$)/g
const INLINE_CODE = /`[^`\n]*`/g
const MENTION = /@([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/g
const DETAIL_URL = /https?:\/\/(?:www\.)?deepseek1024\.com\/plugins\/([A-Za-z0-9_./-]+)/g

/**
 * Plugin ids mentioned in the body, in order of appearance, deduplicated by
 * normalised id and capped.
 *
 * Two spellings count: `@owner/name` (optionally with a monorepo subdirectory)
 * and a link to the plugin's page on the main site. Code spans are stripped
 * first so a shell snippet that happens to contain `@scope/pkg` does not sprout
 * a card. Whether the id exists in the catalog is decided later, against D1 —
 * this function only reads the text.
 */
export function extractPluginMentions(body: string, limit = MAX_PLUGIN_MENTIONS): string[] {
  const prose = body.replace(FENCED_CODE, ' ').replace(INLINE_CODE, ' ')
  const seen = new Set<string>()
  const ids: string[] = []

  const collect = (candidate: string): void => {
    const trimmed = candidate.replace(/[./]+$/, '')
    if (parsePluginId(trimmed) === null) return
    const key = normalizePluginId(trimmed)
    if (seen.has(key)) return
    seen.add(key)
    ids.push(trimmed)
  }

  const matches: { index: number; value: string }[] = []
  for (const match of prose.matchAll(MENTION)) matches.push({ index: match.index, value: match[1]! })
  for (const match of prose.matchAll(DETAIL_URL)) matches.push({ index: match.index, value: match[1]! })
  matches.sort((left, right) => left.index - right.index)
  for (const match of matches) {
    if (ids.length >= limit) break
    collect(match.value)
  }
  return ids
}
