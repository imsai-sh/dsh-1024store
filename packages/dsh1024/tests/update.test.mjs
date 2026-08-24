import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CURRENT_VERSION,
  DEFAULT_RELEASE_URL,
  DEFAULT_UPDATE_FALLBACK_URL,
  DEFAULT_UPDATE_LAST_RESORT_URL,
  DEFAULT_UPDATE_URL,
  checkForUpdate,
  compareVersions,
} from '../lib/update.js'

test('the 1024 Store API is preferred over public registry fallbacks', () => {
  assert.equal(DEFAULT_UPDATE_URL, 'https://deepseek1024.com/api/v1/self/update')
  assert.equal(DEFAULT_UPDATE_FALLBACK_URL, 'https://registry.npmjs.org/dsh1024/latest')
  assert.match(DEFAULT_UPDATE_LAST_RESORT_URL, /contents\/packages\/dsh1024\/package\.json/)
  assert.equal(
    DEFAULT_RELEASE_URL,
    'https://deepseek1024.com/plugins/imsai-sh/awesome-deepseek-harness-plugins/packages/dsh1024',
  )
})

test('semantic version comparison handles releases and prereleases', () => {
  assert.equal(compareVersions('0.2.0', '0.1.9') > 0, true)
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1') > 0, true)
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.10') < 0, true)
})

test('automatic update check reads the configured primary manifest first', async () => {
  const requested = []
  const fetcher = async (url) => {
    requested.push(String(url))
    return new Response(JSON.stringify({
      name: 'dsh1024',
      version: '99.0.0',
      dist: { tarball: 'https://registry.npmjs.org/dsh1024/-/dsh1024-99.0.0.tgz' },
    }), { status: 200 })
  }
  const result = await checkForUpdate(
    'https://deepseek1024.com/api/v1/self/update',
    'https://fallback.example/package.json',
    fetcher,
  )
  assert.deepEqual(requested, ['https://deepseek1024.com/api/v1/self/update'])
  assert.equal(result.currentVersion, CURRENT_VERSION)
  assert.equal(result.latestVersion, '99.0.0')
  assert.equal(result.updateAvailable, true)
  assert.equal(result.releaseUrl, DEFAULT_RELEASE_URL)
})

test('published npm manifest sends legacy 0.3 clients to the domestic update page', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.releaseUrl, DEFAULT_RELEASE_URL)

  const result = await checkForUpdate(
    'https://registry.npmjs.org/dsh1024/latest',
    'https://fallback.example/package.json',
    async () => new Response(JSON.stringify(manifest), { status: 200 }),
  )

  assert.equal(result.releaseUrl, DEFAULT_RELEASE_URL)
})

test('update check falls back when the primary source is unavailable', async () => {
  let calls = 0
  const fetcher = async () => {
    calls += 1
    return calls === 1
      ? new Response('missing', { status: 404 })
      : new Response(JSON.stringify({ version: CURRENT_VERSION }), { status: 200 })
  }
  const result = await checkForUpdate(
    'https://deepseek1024.com/api/v1/self/update',
    'https://fallback.example/package.json',
    fetcher,
  )
  assert.equal(calls, 2)
  assert.equal(result.checked, true)
  assert.equal(result.updateAvailable, false)
})

test('an unavailable update service never blocks the market', async () => {
  const fetcher = async () => new Response('unavailable', { status: 503 })
  const result = await checkForUpdate(
    'https://deepseek1024.com/api/v1/self/update',
    'https://fallback.example/package.json',
    fetcher,
  )
  assert.equal(result.checked, false)
  assert.equal(result.updateAvailable, false)
  assert.match(result.error, /HTTP 503/)
})
