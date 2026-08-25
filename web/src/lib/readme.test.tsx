import { describe, expect, it } from 'vitest'
import { readmeImage, readmeLink, type ReadmeLocation } from './readme'

const location: ReadmeLocation = {
  owner: 'owner',
  repository: 'repo',
  branch: 'feature/docs',
  basePath: 'packages/plugin',
}

describe('README URL resolution', () => {
  it('normalizes nested links and repository-root paths', () => {
    expect(readmeLink('../docs/guide.md#setup', location)).toBe(
      'https://github.com/owner/repo/blob/feature%2Fdocs/packages/docs/guide.md#setup',
    )
    expect(readmeLink('/CONTRIBUTING.md', location)).toBe(
      'https://github.com/owner/repo/blob/feature%2Fdocs/CONTRIBUTING.md',
    )
  })

  it('resolves images against the README directory', () => {
    expect(readmeImage('./assets/demo.png?raw=1', location)).toBe(
      'https://raw.githubusercontent.com/owner/repo/feature%2Fdocs/packages/plugin/assets/demo.png?raw=1',
    )
  })

  it('keeps safe external and fragment URLs and rejects active schemes', () => {
    expect(readmeLink('#usage', location)).toBe('#usage')
    expect(readmeLink('https://example.com/docs', location)).toBe('https://example.com/docs')
    expect(readmeImage('//images.example.com/demo.png', location)).toBe('https://images.example.com/demo.png')
    expect(readmeLink('javascript:alert(1)', location)).toBeUndefined()
    expect(readmeImage('data:image/svg+xml,x', location)).toBeUndefined()
  })
})
