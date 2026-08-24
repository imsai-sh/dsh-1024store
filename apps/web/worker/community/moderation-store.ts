import { normalizeForMatching, type BlockedTerm } from './moderation'
import type { ModerationCategory } from './contract'

/**
 * 词表的读写。
 *
 * 词表不大（几千条量级）但每次发帖都要用，所以在 isolate 里缓存一份。
 * Worker isolate 的寿命有限，缓存过期后自然重载，不需要显式失效 —— 代价
 * 是灌入新词后最多一个 TTL 才全面生效，对这个用途可以接受。
 */
const CACHE_TTL_MS = 5 * 60 * 1000

let cache: { terms: BlockedTerm[]; loadedAt: number } | null = null

export async function loadBlockedTerms(db: D1Database, nowMs: number): Promise<BlockedTerm[]> {
  if (cache && nowMs - cache.loadedAt < CACHE_TTL_MS) return cache.terms

  const { results } = await db.prepare(
    'SELECT term_normalized, category FROM community_blocked_terms',
  ).all<{ term_normalized: string; category: ModerationCategory }>()

  const terms = results.map((row) => ({ normalized: row.term_normalized, category: row.category }))
  cache = { terms, loadedAt: nowMs }
  return terms
}

/** 测试用：isolate 级缓存会跨用例串味。 */
export function resetBlockedTermCache(): void {
  cache = null
}

export interface TermInput {
  term: string
  category: ModerationCategory
}

export const MAX_TERMS_PER_SYNC = 5000

/**
 * 全量替换词表。
 *
 * 全量而不是增量：词表是一份策略快照，增量接口会让线上实际生效的内容
 * 慢慢偏离任何一份可审计的源文件。入库前统一归一化，保证和比对时用的
 * 是同一套规则 —— 两边各归一化一次、规则再稍有出入，就会出现「明明加了
 * 却拦不住」这种最难查的问题。
 */
export async function replaceBlockedTerms(
  db: D1Database,
  inputs: readonly TermInput[],
  nowAtIso: string,
): Promise<{ stored: number; skipped: number }> {
  const seen = new Set<string>()
  const rows: { normalized: string; category: ModerationCategory }[] = []
  let skipped = 0

  for (const input of inputs) {
    const normalized = normalizeForMatching(input.term)
    // 归一化后为空的词会命中一切正文，必须挡掉。
    if (normalized.length === 0 || seen.has(normalized)) {
      skipped += 1
      continue
    }
    seen.add(normalized)
    rows.push({ normalized, category: input.category })
  }

  const statements = [db.prepare('DELETE FROM community_blocked_terms')]
  for (const row of rows) {
    statements.push(db.prepare(
      'INSERT INTO community_blocked_terms (term_normalized, category, created_at) VALUES (?, ?, ?)',
    ).bind(row.normalized, row.category, nowAtIso))
  }
  await db.batch(statements)
  cache = null
  return { stored: rows.length, skipped }
}

/** 审核事件。只记事实，不记正文 —— 见迁移文件里的说明。 */
export async function recordModerationEvent(
  db: D1Database,
  authorId: number,
  category: string,
  source: 'lexicon' | 'classifier',
  nowAtIso: string,
): Promise<void> {
  await db.prepare(
    'INSERT INTO community_moderation_events (author_id, category, source, created_at) VALUES (?, ?, ?, ?)',
  ).bind(authorId, category, source, nowAtIso).run()
}
