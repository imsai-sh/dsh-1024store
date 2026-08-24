import { describe, expect, it } from 'vitest'
import {
  matchBlockedTerms,
  moderate,
  normalizeForMatching,
  type BlockedTerm,
} from '../worker/community/moderation'
import {
  loadBlockedTerms,
  replaceBlockedTerms,
  resetBlockedTermCache,
} from '../worker/community/moderation-store'
import { communityDatabase, sqliteD1 } from './community-fixtures'

/**
 * 用例里不放任何真实敏感词。要验的是**机制**——归一化能不能折叠掉绕过
 * 写法、命中后拒不拒、分类器挂了怎么办——这些用占位词验完全等价，而把
 * 真词写进公开仓库的测试文件，和把词表提交进来是一回事。
 */
const PLACEHOLDER = 'zzqx'
const TERMS: BlockedTerm[] = [{ normalized: PLACEHOLDER, category: 'political' }]

describe('normalizeForMatching', () => {
  it('folds the ways a term gets disguised', () => {
    // 每一种都是实际会遇到的绕过写法，归一化后必须落到同一个串。
    const disguises = [
      'zzqx',
      'ZZQX',            // 大小写
      'ｚｚｑｘ',          // 全角
      'z z q x',         // 空格
      'z-z.q_x',         // 标点
      'zz​qx',            // 零宽空格
      'z*z*q*x',         // 符号
    ]
    for (const disguise of disguises) {
      expect(normalizeForMatching(disguise), disguise).toBe(PLACEHOLDER)
    }
  })

  it('strips separators inside CJK', () => {
    expect(normalizeForMatching('测-试-内-容')).toBe('测试内容')
  })

  it('does not collapse repeats, which would collide unrelated words', () => {
    // 压缩重复能挡住插字，但会让 apple→aple、shell→shel，正常词可能塌进
    // 敏感词。这一类绕过交给语义分类层。
    expect(normalizeForMatching('apple')).toBe('apple')
    expect(normalizeForMatching('shell')).toBe('shell')
  })

  it('never returns markup or whitespace that could re-enter the body', () => {
    // 归一化结果只用于比对；它丢信息，绝不能回写进正文。
    const normalized = normalizeForMatching('  <b>Hello</b>  世界  ')
    expect(normalized).toBe('bhellob世界')
    expect(normalized).not.toMatch(/\s/)
  })
})

describe('matchBlockedTerms', () => {
  it('catches a listed term however it is written', () => {
    for (const body of ['前面 zzqx 后面', 'ＺＺＱＸ', 'z.z.q.x!', '正常内容 zz​qx 正常内容']) {
      expect(matchBlockedTerms(body, TERMS), body).toBe('political')
    }
  })

  it('leaves ordinary text alone', () => {
    for (const body of ['今天把 profile 切换脚本重写了', 'npm install -g dsh1024', '']) {
      expect(matchBlockedTerms(body, TERMS), body).toBeNull()
    }
  })

  it('reports the category, never the term that matched', () => {
    // 回显命中的词等于告诉发帖人改哪个字能过。
    const verdict = matchBlockedTerms('zzqx', TERMS)
    expect(verdict).toBe('political')
    expect(String(verdict)).not.toContain(PLACEHOLDER)
  })

  it('is a no-op when the list is empty', () => {
    expect(matchBlockedTerms('anything at all', [])).toBeNull()
  })
})

function aiEnv(answer: string | Error): Env {
  return {
    AI: {
      run: async () => {
        if (answer instanceof Error) throw answer
        return { response: answer }
      },
    },
  } as unknown as Env
}

describe('moderate', () => {
  it('rejects on the lexicon without ever calling the classifier', async () => {
    let called = false
    const env = { AI: { run: async () => { called = true; return { response: 'ok' } } } } as unknown as Env
    const verdict = await moderate(env, 'zzqx', { terms: TERMS })
    expect(verdict).toEqual({ allowed: false, category: 'political', source: 'lexicon' })
    // 词表命中就该短路：分类器是这条路径上最贵的一步。
    expect(called).toBe(false)
  })

  it('rejects what the classifier flags', async () => {
    const verdict = await moderate(aiEnv('political'), '看起来正常的一段话', { terms: [] })
    expect(verdict).toEqual({ allowed: false, category: 'political', source: 'classifier' })
  })

  it('allows what both layers pass', async () => {
    const verdict = await moderate(aiEnv('ok'), '把 harness 的 profile 脚本重写了一遍', { terms: TERMS })
    expect(verdict).toEqual({ allowed: true })
  })

  it('allows an answer it cannot parse rather than guessing', async () => {
    // 词表已经过了一遍；模型答了不认识的东西时再武断拒绝会大量误伤。
    const verdict = await moderate(aiEnv('我认为这段内容没有问题'), '正常内容', { terms: [] })
    expect(verdict).toEqual({ allowed: true })
  })

  it('refuses to publish when the classifier is down', async () => {
    // 刻意 fail closed：本站首要防的是政治内容，模型挂掉期间放行的代价
    // 远高于发帖短暂不可用。改成放行只需动一行，但那是个明确的取舍。
    const verdict = await moderate(aiEnv(new Error('AI unavailable')), '正常内容', { terms: [] })
    expect(verdict).toEqual({ allowed: false, category: 'unavailable', source: 'classifier' })
  })

  it('falls back to the lexicon when there is no AI binding at all', async () => {
    expect(await moderate({} as Env, 'zzqx', { terms: TERMS }))
      .toEqual({ allowed: false, category: 'political', source: 'lexicon' })
    expect(await moderate({} as Env, '正常内容', { terms: TERMS })).toEqual({ allowed: true })
  })
})

describe('the blocked-term store', () => {
  it('normalises on the way in, so both sides use one rule', async () => {
    // 入库和比对各归一化一次、规则稍有出入，就会出现「明明加了却拦不住」。
    const database = communityDatabase()
    const db = sqliteD1(database)
    resetBlockedTermCache()

    await replaceBlockedTerms(db, [{ term: 'Ｚ-Ｚ.Ｑ_Ｘ', category: 'political' }], '2026-08-18T00:00:00Z')
    const terms = await loadBlockedTerms(db, Date.now())
    expect(terms).toEqual([{ normalized: PLACEHOLDER, category: 'political' }])
    expect(matchBlockedTerms('前面 zzqx 后面', terms)).toBe('political')
    database.close()
  })

  it('drops entries that would match everything', async () => {
    // 归一化后为空的词会命中每一条正文，等于全站禁言。
    const database = communityDatabase()
    const db = sqliteD1(database)
    resetBlockedTermCache()

    const result = await replaceBlockedTerms(db, [
      { term: '   ', category: 'abuse' },
      { term: '!!!', category: 'abuse' },
      { term: 'zzqx', category: 'political' },
      { term: 'Z Z Q X', category: 'political' },
    ], '2026-08-18T00:00:00Z')

    expect(result).toEqual({ stored: 1, skipped: 3 })
    expect(matchBlockedTerms('完全正常的一句话', await loadBlockedTerms(db, Date.now()))).toBeNull()
    database.close()
  })

  it('replaces rather than accumulates', async () => {
    // 词表是一份策略快照；增量会让线上内容慢慢偏离任何可审计的源文件。
    const database = communityDatabase()
    const db = sqliteD1(database)
    resetBlockedTermCache()

    await replaceBlockedTerms(db, [{ term: 'zzqx', category: 'political' }], '2026-08-18T00:00:00Z')
    await replaceBlockedTerms(db, [{ term: 'yyrw', category: 'abuse' }], '2026-08-18T01:00:00Z')

    resetBlockedTermCache()
    const terms = await loadBlockedTerms(db, Date.now())
    expect(terms).toEqual([{ normalized: 'yyrw', category: 'abuse' }])
    expect(matchBlockedTerms('zzqx', terms)).toBeNull()
    database.close()
  })
})
