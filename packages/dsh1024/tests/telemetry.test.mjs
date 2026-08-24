import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  DEFAULT_TELEMETRY_URL,
  EVENT_KEYS,
  TELEMETRY_SOURCE_CHANNEL,
  reportInstallEvent,
} from '../lib/telemetry.js'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function temporaryDshHome() {
  return mkdtempSync(join(tmpdir(), 'dsh1024-telemetry-'))
}

function recordingFetcher(status = 200) {
  const calls = []
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response('{}', { status })
  }
  return { calls, fetcher }
}

function installInput(overrides = {}) {
  return {
    pluginId: 'owner/repo',
    profile: 'web',
    operation: 'install',
    status: 'success',
    startedAt: new Date('2026-08-15T00:00:00Z'),
    completedAt: new Date('2026-08-15T00:00:12Z'),
    errorCode: null,
    ...overrides,
  }
}

test('a first report creates the shared CLI identity and posts the 19-field event', async () => {
  const dshHome = temporaryDshHome()
  const { calls, fetcher } = recordingFetcher()
  const logged = []
  await reportInstallEvent(installInput(), {
    env: { DSH_HOME: dshHome },
    fetcher,
    log: line => logged.push(line),
    platform: 'darwin',
    arch: 'arm64',
  })

  const clientPath = join(dshHome, '.dsh-1024store', 'client.json')
  const client = JSON.parse(readFileSync(clientPath, 'utf8'))
  assert.equal(client.schemaVersion, 1)
  assert.equal(client.enabled, true)
  assert.match(client.clientId, /^[0-9a-f-]{36}$/)
  assert.equal(logged.length, 1)
  assert.match(logged[0], /anonymous plugin install outcomes/)
  assert.match(logged[0], /DO_NOT_TRACK=1/)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, DEFAULT_TELEMETRY_URL)
  assert.equal(calls[0].init.method, 'POST')
  const event = JSON.parse(calls[0].init.body)
  assert.deepEqual(Object.keys(event), [...EVENT_KEYS])
  assert.equal(event.clientId, client.clientId)
  assert.equal(event.pluginId, 'owner/repo')
  assert.equal(event.profile, 'web')
  assert.equal(event.operation, 'install')
  assert.equal(event.status, 'success')
  assert.equal(event.durationMs, 12_000)
  assert.equal(event.beforeVersion, null)
  assert.equal(event.afterVersion, null)
  assert.equal(event.requestedRef, null)
  assert.equal(event.cliVersion, manifest.version)
  assert.equal(event.dshVersion, null)
  assert.equal(event.errorCode, null)
  assert.equal(event.sourceChannel, TELEMETRY_SOURCE_CHANNEL)
  assert.equal(event.sourceChannel, 'dsh-1024store-plugin')
  assert.equal(event.platform, 'darwin')
  assert.equal(event.arch, 'arm64')
  assert.equal(event.isCi, false)
})

test('an existing CLI identity is reused without repeating the privacy notice', async () => {
  const dshHome = temporaryDshHome()
  const clientPath = join(dshHome, '.dsh-1024store', 'client.json')
  mkdirSync(join(dshHome, '.dsh-1024store'), { recursive: true })
  writeFileSync(clientPath, JSON.stringify({
    schemaVersion: 1,
    clientId: '11111111-2222-3333-4444-555555555555',
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    noticeVersion: 1,
  }))
  const { calls, fetcher } = recordingFetcher()
  const logged = []
  await reportInstallEvent(installInput({ operation: 'remove' }), {
    env: { DSH_HOME: dshHome },
    fetcher,
    log: line => logged.push(line),
  })
  assert.equal(logged.length, 0)
  assert.equal(calls.length, 1)
  const event = JSON.parse(calls[0].init.body)
  assert.equal(event.clientId, '11111111-2222-3333-4444-555555555555')
  assert.equal(event.operation, 'remove')
})

test('failed operations are reported with a short error code', async () => {
  const dshHome = temporaryDshHome()
  const { calls, fetcher } = recordingFetcher()
  await reportInstallEvent(installInput({ status: 'failed', errorCode: 'OFFICIAL_CLI_FAILED' }), {
    env: { DSH_HOME: dshHome },
    fetcher,
    log: () => {},
  })
  assert.equal(calls.length, 1)
  const event = JSON.parse(calls[0].init.body)
  assert.equal(event.status, 'failed')
  assert.equal(event.errorCode, 'OFFICIAL_CLI_FAILED')
})

test('DO_NOT_TRACK disables reporting and never creates an identity', async () => {
  const dshHome = temporaryDshHome()
  const { calls, fetcher } = recordingFetcher()
  await reportInstallEvent(installInput(), {
    env: { DSH_HOME: dshHome, DO_NOT_TRACK: '1' },
    fetcher,
    log: () => {},
  })
  assert.equal(calls.length, 0)
  assert.equal(existsSync(join(dshHome, '.dsh-1024store', 'client.json')), false)
})

test('DSH_1024STORE_TELEMETRY=0 disables reporting and never creates an identity', async () => {
  const dshHome = temporaryDshHome()
  const { calls, fetcher } = recordingFetcher()
  await reportInstallEvent(installInput(), {
    env: { DSH_HOME: dshHome, DSH_1024STORE_TELEMETRY: '0' },
    fetcher,
    log: () => {},
  })
  assert.equal(calls.length, 0)
  assert.equal(existsSync(join(dshHome, '.dsh-1024store', 'client.json')), false)
})

test('an opted-out client.json is honored and left untouched', async () => {
  const dshHome = temporaryDshHome()
  const clientPath = join(dshHome, '.dsh-1024store', 'client.json')
  mkdirSync(join(dshHome, '.dsh-1024store'), { recursive: true })
  const optedOut = JSON.stringify({
    schemaVersion: 1,
    clientId: '11111111-2222-3333-4444-555555555555',
    enabled: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    noticeVersion: 1,
  })
  writeFileSync(clientPath, optedOut)
  const { calls, fetcher } = recordingFetcher()
  await reportInstallEvent(installInput(), {
    env: { DSH_HOME: dshHome },
    fetcher,
    log: () => {},
  })
  assert.equal(calls.length, 0)
  assert.equal(readFileSync(clientPath, 'utf8'), optedOut)
})

test('the telemetry endpoint can be overridden through the CLI environment variable', async () => {
  const dshHome = temporaryDshHome()
  const { calls, fetcher } = recordingFetcher()
  await reportInstallEvent(installInput(), {
    env: { DSH_HOME: dshHome, DSH_1024STORE_TELEMETRY_URL: 'https://collector.example/events' },
    fetcher,
    log: () => {},
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://collector.example/events')
})

test('a failing endpoint is silent and never throws', async () => {
  const dshHome = temporaryDshHome()
  const fetcher = async () => { throw new Error('offline') }
  await assert.doesNotReject(reportInstallEvent(installInput(), {
    env: { DSH_HOME: dshHome },
    fetcher,
    log: () => {},
  }))
})
