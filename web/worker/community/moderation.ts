/**
 * 社区内容审核。
 *
 * 两层，缺一不可：
 *
 *   1. 归一化 + 词表。确定、可解释、可审计，命中即拒。
 *   2. Workers AI 语义分类。政治内容常常侧面表达（「那年那件事」「隔壁
 *      老王的那次运动」），词表天然挡不住，靠模型判语义。
 *
 * 词表本身**不在这个仓库里**。这是公开的 OSS：一份敏感词表提交进来，
 * 既是敏感内容本身，也等于把绕过手册发给所有人。仓库只放机制和几个
 * 通用脏话示例；真正的词表存在 D1 的 community_blocked_terms 里，通过
 * 带鉴权的接口灌入，和 catalog:sync 一个路子。
 */

import type { ModerationCategory, ModerationVerdict } from './contract'

/** 审核放行前必须过的两层。顺序固定：先便宜的，再贵的。 */
export const MODERATION_CATEGORIES = ['political', 'sexual', 'abuse', 'spam'] as const

/**
 * 归一化：把各种绕过写法折叠成同一个串再比对。
 *
 * 朴素的子串匹配几乎没有意义 —— 全角（ａｂｃ）、零宽字符（a​bc）、
 * 中间插标点（法-轮-功）、重复字符（法轮轮功）、繁简混写，任意一种都能
 * 绕过。这一步把它们都抹平。
 *
 * 注意它会**丢信息**：归一化后的串只用于比对，绝不回写进正文。
 *
 * 刻意**不做**的一件事：压缩连续重复字符。它能挡住「法轮轮功」这类插字，
 * 但会同时把 apple→aple、shell→shel，于是一个正常词可能塌进敏感词、
 * 或者反过来漏掉——为了一种绕过写法引入全局假阳性不划算。这一类交给
 * 语义分类那一层。
 */
export function normalizeForMatching(text: string): string {
  return text
    .normalize('NFKC')
    // 零宽、方向标记、变体选择符：肉眼看不见，但会切断子串
    .replace(/[​-‏‪-‮⁠-⁯︀-️﻿]/g, '')
    // 组合附加符号（拉丁字母加音标伪装）
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // 标点、空白、下划线、数字分隔：中文敏感词最常见的插入位
    .replace(/[\s\p{P}\p{S}_]+/gu, '')
}

export interface BlockedTerm {
  /** 已归一化的词，入库时就归一化好，查询时不必再算。 */
  normalized: string
  category: ModerationCategory
}

/**
 * 词表命中。返回第一个命中的分类，没有则返回 null。
 *
 * 返回分类而不是具体命中的词：调用方要拿它决定怎么回应，而把命中的词
 * 回显给发帖人等于告诉他改哪个字就能过。
 */
export function matchBlockedTerms(
  body: string,
  terms: readonly BlockedTerm[],
): ModerationCategory | null {
  if (terms.length === 0) return null
  const normalized = normalizeForMatching(body)
  if (normalized.length === 0) return null
  for (const term of terms) {
    if (term.normalized.length > 0 && normalized.includes(term.normalized)) {
      return term.category
    }
  }
  return null
}

/** 仓库里只留通用脏话示例，证明机制通了；真表在 D1。 */
export const SAMPLE_TERMS: readonly BlockedTerm[] = [
  { normalized: 'fuck', category: 'abuse' },
  { normalized: 'shit', category: 'abuse' },
]

const CLASSIFY_MODEL = '@cf/deepseek-ai/deepseek-v4-flash-0731'

/**
 * 分类提示词。要求模型只输出一个词，且明确列出「不算违规」的情形 ——
 * 否则技术讨论里的「攻击面」「杀进程」「注入」会被大量误伤。
 */
const CLASSIFY_PROMPT = `你是一个中文社区的内容审核器。这个社区讨论的是编程和开源插件。

判断下面这段用户发言属于哪一类，只输出一个词，不要解释：

political  —— 涉及中国大陆政治、领导人、政党、政治运动、历史政治事件、
              民族与宗教冲突、领土争议、政治性集会或抗议的内容
sexual     —— 色情、性描写、性交易、招嫖
abuse      —— 辱骂、人身攻击、仇恨言论、歧视
spam       —— 广告、引流、诈骗、无关推广
ok         —— 其余全部

重要：这是技术社区，下列一律判 ok：
- 编程术语，即使字面像暴力或攻击（攻击面、杀进程、注入、劫持、爆破、
  黑名单、白名单、主从、僵尸进程、中间人）
- 对软件、公司、技术方案的批评
- 非中国大陆语境下的一般时事讨论

发言：
"""
{{BODY}}
"""

只输出一个词：political / sexual / abuse / spam / ok`

/**
 * 语义分类。词表放行之后才跑。
 *
 * 失败时抛错而不是放行 —— 见 moderate() 里对失败的处理。
 */
async function classify(env: Env, body: string): Promise<ModerationCategory | null> {
  const response = await env.AI.run(CLASSIFY_MODEL, {
    messages: [{ role: 'user', content: CLASSIFY_PROMPT.replace('{{BODY}}', body) }],
    max_tokens: 8,
    temperature: 0,
  }) as { response?: string }

  const answer = (response.response ?? '').trim().toLowerCase()
  for (const category of MODERATION_CATEGORIES) {
    if (answer.startsWith(category)) return category
  }
  // 明确的 ok，或者模型答了别的东西 —— 后者当作没判出违规，
  // 因为词表已经过了一遍，这里再武断拒绝会误伤更多。
  return null
}

export interface ModerationDependencies {
  /** 词表，由调用方从 D1 载入并缓存。 */
  terms: readonly BlockedTerm[]
  /** 关掉语义分类（测试，或 AI 绑定不可用的环境）。 */
  skipClassifier?: boolean
}

/**
 * 审一段正文。
 *
 * 分类器不可用时**拒绝发布**，不是放行。这是刻意的：本站首要防的是
 * 中国大陆政治内容，模型挂掉期间放行的代价，远高于发帖短暂不可用。
 * 要改成放行只需动 catch 里的一行，但那是一个需要明确决定的取舍。
 */
export async function moderate(
  env: Env,
  body: string,
  dependencies: ModerationDependencies,
): Promise<ModerationVerdict> {
  const listed = matchBlockedTerms(body, dependencies.terms)
  if (listed) return { allowed: false, category: listed, source: 'lexicon' }

  if (dependencies.skipClassifier || !env.AI) return { allowed: true }

  try {
    const classified = await classify(env, body)
    if (classified) return { allowed: false, category: classified, source: 'classifier' }
    return { allowed: true }
  } catch (error) {
    console.error(JSON.stringify({
      message: 'community_moderation_classifier_failed',
      error: error instanceof Error ? error.message : String(error),
    }))
    return { allowed: false, category: 'unavailable', source: 'classifier' }
  }
}
