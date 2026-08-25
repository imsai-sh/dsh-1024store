import assert from 'node:assert/strict'
import { spawn as spawnChild } from 'node:child_process'
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { enqueueEvent, ensureTelemetryConfig, flushPending } from '../lib/shared/telemetry.js'
import { EVENT_KEYS } from '../cli/constants.js'

function event(eventId) {
  return Object.fromEntries(EVENT_KEYS.map((key) => [key, ({
    eventId,
    clientId: '11111111-1111-4111-8111-111111111111',
    pluginId: 'owner/repo',
    profile: 'web',
    operation: 'install',
    status: 'success',
    clientStartedAt: '2026-08-15T00:00:00.000Z',
    clientCompletedAt: '2026-08-15T00:00:01.000Z',
    durationMs: 1000,
    beforeVersion: null,
    afterVersion: '1.0.0',
    requestedRef: null,
    cliVersion: '0.1.0',
    dshVersion: null,
    errorCode: null,
    sourceChannel: 'dsh-1024store-cli',
    platform: 'linux',
    arch: 'x64',
    isCi: false,
  })[key]]))
}

function runChild(script, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(process.execPath, ['--input-type=module', '--eval', script], {
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`child exited ${code}: ${stderr}`))
    })
  })
}

test('preserves identity, events, and receipt counts across concurrent processes', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh1024-concurrency-'))
  const telemetryModule = new URL('../lib/shared/telemetry.js', import.meta.url).href
  const receiptsModule = new URL('../cli/receipts.js', import.meta.url).href
  const childScript = `
    const { enqueueEvent, ensureTelemetryConfig } = await import(process.env.DSH_TEST_TELEMETRY_MODULE)
    const { saveReceipt } = await import(process.env.DSH_TEST_RECEIPTS_MODULE)
    const candidateId = process.env.DSH_TEST_CLIENT_ID
    const { config } = await ensureTelemetryConfig(process.env.DSH_TEST_HOME, {
      now: () => new Date('2026-08-15T00:00:00.000Z'),
      uuid: () => candidateId,
    })
    const event = JSON.parse(process.env.DSH_TEST_EVENT)
    event.clientId = config.clientId
    await enqueueEvent(process.env.DSH_TEST_HOME, event)
    await saveReceipt(process.env.DSH_TEST_HOME, { schemaVersion: 1, plugins: {} }, JSON.parse(process.env.DSH_TEST_RECEIPT))
  `

  await Promise.all(Array.from({ length: 8 }, (_, index) => {
    const suffix = String(index).padStart(12, '0')
    const timestamp = `2026-08-15T00:00:0${index}.000Z`
    return runChild(childScript, {
      DSH_TEST_HOME: dshHome,
      DSH_TEST_TELEMETRY_MODULE: telemetryModule,
      DSH_TEST_RECEIPTS_MODULE: receiptsModule,
      DSH_TEST_CLIENT_ID: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
      DSH_TEST_EVENT: JSON.stringify(event(`bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`)),
      DSH_TEST_RECEIPT: JSON.stringify({
        pluginId: 'owner/repo',
        profile: 'web',
        source: 'github:owner/repo',
        packageNames: ['@demo/plugin'],
        packages: { '@demo/plugin': { requested: 'github:owner/repo', version: String(index) } },
        firstInstalledAt: timestamp,
        lastInstalledAt: timestamp,
        installCount: 1,
      }),
    })
  }))

  const directory = join(dshHome, '.dsh-1024store')
  const config = JSON.parse(await readFile(join(directory, 'client.json'), 'utf8'))
  const pending = JSON.parse(await readFile(join(directory, 'pending.json'), 'utf8'))
  const receipts = JSON.parse(await readFile(join(directory, 'receipts.json'), 'utf8'))
  assert.equal(new Set(pending.events.map((item) => item.eventId)).size, 8)
  assert.equal(new Set(pending.events.map((item) => item.clientId)).size, 1)
  assert.equal(pending.events[0].clientId, config.clientId)
  assert.equal(receipts.plugins['web:owner/repo'].installCount, 8)
  assert.equal(receipts.plugins['web:owner/repo'].firstInstalledAt, '2026-08-15T00:00:00.000Z')
  assert.equal(receipts.plugins['web:owner/repo'].lastInstalledAt, '2026-08-15T00:00:07.000Z')
  assert.equal(receipts.plugins['web:owner/repo'].packages['@demo/plugin'].version, '7')
})

test('does not overwrite an event enqueued while a flush is in flight', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh1024-telemetry-'))
  const first = event('11111111-1111-4111-8111-111111111116')
  const second = event('11111111-1111-4111-8111-111111111117')
  await enqueueEvent(dshHome, first)
  let releaseRequest
  let requestStarted
  const started = new Promise((resolve) => { requestStarted = resolve })
  const response = new Promise((resolve) => { releaseRequest = resolve })
  const flushing = flushPending(dshHome, {
    env: {},
    fetchImpl() {
      requestStarted()
      return response
    },
  })
  await started
  await enqueueEvent(dshHome, second)
  releaseRequest({ ok: true, status: 202 })
  const result = await flushing
  const pending = JSON.parse(await readFile(join(dshHome, '.dsh-1024store', 'pending.json'), 'utf8'))
  assert.equal(result.sent, 1)
  assert.equal(result.pending, 1)
  assert.deepEqual(pending.events.map((item) => item.eventId), [second.eventId])
})

test('concurrent config initialization returns one stable client identity', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh1024-telemetry-'))
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => ensureTelemetryConfig(dshHome, {
    uuid: () => `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, '0')}`,
  })))
  assert.equal(new Set(results.map(({ config }) => config.clientId)).size, 1)
  assert.equal(results.filter(({ created }) => created).length, 1)
})

test('recovers a half-created queue lock under concurrent takeover', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh1024-telemetry-'))
  const directory = join(dshHome, '.dsh-1024store')
  await mkdir(directory, { recursive: true })
  const abandonedLock = join(directory, 'pending.json.lock')
  await mkdir(abandonedLock)
  const staleTime = new Date(Date.now() - 10_000)
  await utimes(abandonedLock, staleTime, staleTime)
  const telemetryModule = new URL('../lib/shared/telemetry.js', import.meta.url).href
  const childScript = `
    const { enqueueEvent } = await import(process.env.DSH_TEST_TELEMETRY_MODULE)
    const waitMs = Math.max(0, Number(process.env.DSH_TEST_START_AT) - Date.now())
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
    await enqueueEvent(process.env.DSH_TEST_HOME, JSON.parse(process.env.DSH_TEST_EVENT))
  `
  const startAt = Date.now() + 500
  await Promise.all(Array.from({ length: 16 }, (_, index) => runChild(childScript, {
    DSH_TEST_HOME: dshHome,
    DSH_TEST_TELEMETRY_MODULE: telemetryModule,
    DSH_TEST_START_AT: String(startAt),
    DSH_TEST_EVENT: JSON.stringify(event(`dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`)),
  })))
  const pending = JSON.parse(await readFile(join(directory, 'pending.json'), 'utf8'))
  assert.equal(new Set(pending.events.map((item) => item.eventId)).size, 16)
})

test('recovers a queue owner left by a dead process', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh1024-telemetry-'))
  const directory = join(dshHome, '.dsh-1024store')
  const abandonedLock = join(directory, 'pending.json.lock')
  await mkdir(abandonedLock, { recursive: true })
  await writeFile(join(abandonedLock, 'abandoned.owner'), JSON.stringify({
    pid: 999_999_999,
    createdAt: new Date().toISOString(),
  }))
  const queued = event('11111111-1111-4111-8111-111111111118')
  await enqueueEvent(dshHome, queued)
  const pending = JSON.parse(await readFile(join(directory, 'pending.json'), 'utf8'))
  assert.deepEqual(pending.events.map((item) => item.eventId), [queued.eventId])
})

test('skips permanently rejected events and continues with newer events', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh1024-telemetry-'))
  await enqueueEvent(dshHome, event('11111111-1111-4111-8111-111111111112'))
  await enqueueEvent(dshHome, event('11111111-1111-4111-8111-111111111113'))
  const delivered = []
  let calls = 0
  const result = await flushPending(dshHome, {
    env: {},
    async fetchImpl(_url, options) {
      calls += 1
      delivered.push(JSON.parse(options.body).eventId)
      return calls === 1 ? { ok: false, status: 422 } : { ok: true, status: 202 }
    },
  })
  assert.equal(result.discarded, 1)
  assert.equal(result.sent, 1)
  assert.equal(result.pending, 0)
  assert.equal(delivered.length, 2)
})

test('retains a rate-limited event and every newer event', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh1024-telemetry-'))
  await enqueueEvent(dshHome, event('11111111-1111-4111-8111-111111111114'))
  await enqueueEvent(dshHome, event('11111111-1111-4111-8111-111111111115'))
  const result = await flushPending(dshHome, {
    env: {},
    async fetchImpl() { return { ok: false, status: 429 } },
  })
  assert.equal(result.sent, 0)
  assert.equal(result.pending, 2)
})
