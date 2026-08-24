import { describe, expect, it } from 'vitest'
import {
  extractPluginMentions,
  MAX_POST_LENGTH,
  validatePostBody,
} from '../worker/community/post-body'

describe('validatePostBody', () => {
  it('trims, normalises newlines, and rejects an empty body', () => {
    expect(validatePostBody('  hello \n')).toEqual({ ok: true, body: 'hello' })
    expect(validatePostBody('a\r\nb')).toEqual({ ok: true, body: 'a\nb' })
    expect(validatePostBody('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(validatePostBody(undefined)).toEqual({ ok: false, reason: 'empty' })
    expect(validatePostBody(42)).toEqual({ ok: false, reason: 'empty' })
  })

  it('keeps newlines and tabs but rejects other control characters', () => {
    expect(validatePostBody('line\n\tindented').ok).toBe(true)
    expect(validatePostBody('null\u0000byte')).toEqual({ ok: false, reason: 'control_characters' })
    expect(validatePostBody('bell\u0007')).toEqual({ ok: false, reason: 'control_characters' })
    // U+2028 terminates a line in some parsers and not others.
    expect(validatePostBody('line\u2028separator')).toEqual({ ok: false, reason: 'control_characters' })
  })

  it('counts code points, so a post of emoji gets its full allowance', () => {
    // Each of these is two UTF-16 units; measuring with .length would halve the
    // limit for anyone writing in emoji or rarer CJK.
    const emoji = '\u{1F680}'.repeat(MAX_POST_LENGTH)
    expect(emoji.length).toBe(MAX_POST_LENGTH * 2)
    expect(validatePostBody(emoji).ok).toBe(true)
    expect(validatePostBody(`${emoji}\u{1F680}`)).toEqual({ ok: false, reason: 'too_long' })
  })

  it('honours a lower limit for replies', () => {
    expect(validatePostBody('x'.repeat(50), 40)).toEqual({ ok: false, reason: 'too_long' })
  })
})

describe('extractPluginMentions', () => {
  it('finds @owner/name and subdirectory ids in order', () => {
    expect(extractPluginMentions('try @acme/tool and @acme/mono/packages/cli'))
      .toEqual(['acme/tool', 'acme/mono/packages/cli'])
  })

  it('finds plugin detail links on the main site', () => {
    expect(extractPluginMentions('see https://deepseek1024.com/plugins/acme/tool for details'))
      .toEqual(['acme/tool'])
    expect(extractPluginMentions('see https://www.deepseek1024.com/plugins/acme/tool'))
      .toEqual(['acme/tool'])
  })

  it('deduplicates spellings of the same plugin', () => {
    expect(extractPluginMentions('@acme/tool and @ACME/Tool again')).toEqual(['acme/tool'])
  })

  it('ignores mentions inside code, where they are usually package names', () => {
    expect(extractPluginMentions('run `npm i @types/node` first')).toEqual([])
    expect(extractPluginMentions('```\nimport "@scope/pkg"\n```')).toEqual([])
    // An unterminated fence still swallows to the end rather than leaking.
    expect(extractPluginMentions('```\n@scope/pkg')).toEqual([])
  })

  it('rejects ids that could escape a path', () => {
    expect(extractPluginMentions('@acme/../secret')).toEqual([])
    expect(extractPluginMentions('@acme')).toEqual([])
  })

  it('drops trailing punctuation that belongs to the sentence', () => {
    expect(extractPluginMentions('I like @acme/tool.')).toEqual(['acme/tool'])
  })

  it('caps the number of cards a single post can produce', () => {
    const body = '@a/one @b/two @c/three @d/four @e/five'
    expect(extractPluginMentions(body)).toHaveLength(3)
    expect(extractPluginMentions(body, 1)).toEqual(['a/one'])
  })
})
