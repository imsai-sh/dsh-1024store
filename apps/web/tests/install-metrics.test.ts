import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import {
  emptyInstallMetrics,
  hashInstallationClient,
  loadInstallMetrics,
  parseInstallationEvent,
  recordInstallationEvent,
} from '../worker/lib/install-metrics'

const VALID_EVENT = {
  eventId: 'b8247a4e-3f87-4ebf-8a78-6a5a33f03648',
  clientId: 'd2b0d8a3-c636-4f34-b16f-2eb4f5f39965',
  pluginId: 'openma-ai/deepseek-harness-tui',
  profile: 'web',
  operation: 'install',
  status: 'success',
  clientStartedAt: '2026-08-14T12:00:00.000Z',
  clientCompletedAt: '2026-08-14T12:00:01.250Z',
  durationMs: 1250,
  beforeVersion: null,
  afterVersion: '1.2.3',
  requestedRef: 'github:openma-ai/deepseek-harness-tui',
  cliVersion: '0.1.0',
  dshVersion: '0.1.0-rc.5',
  platform: 'darwin',
  arch: 'arm64',
  isCi: false,
  errorCode: null,
  sourceChannel: 'dsh-1024store-cli',
} as const

interface PreparedCall {
  sql: string
  params: unknown[]
}

function recordDb(changes: number = 1) {
  const calls: PreparedCall[] = []
  const prepare = vi.fn((sql: string) => {
    const call: PreparedCall = { sql, params: [] }
    calls.push(call)
    const statement = {
      bind(...params: unknown[]) {
        call.params = params
        return statement
      },
      async first() {
        return sql.includes('COUNT(*)') ? { event_count: 0 } : null
      },
      async run() {
        return { meta: { changes } }
      },
    }
    return statement
  })
  return { db: { prepare } as unknown as D1Database, calls }
}

describe('installation event ingestion', () => {
  it('accepts the documented schema and rejects unexpected or malformed fields', () => {
    const parsed = parseInstallationEvent(VALID_EVENT)
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.event.clientCompletedAt).toBe('2026-08-14T12:00:01.250Z')

    expect(parseInstallationEvent({ ...VALID_EVENT, command: 'private command' })).toEqual({
      ok: false,
      error: 'Unexpected field: command.',
    })
    expect(parseInstallationEvent({ ...VALID_EVENT, clientCompletedAt: 'not-a-date' }).ok).toBe(false)
    expect(parseInstallationEvent({ ...VALID_EVENT, platform: 'plan9' }).ok).toBe(false)
  })

  it('HMACs client identity and only binds the hash into the detailed event ledger', async () => {
    const parsed = parseInstallationEvent(VALID_EVENT)
    if (!parsed.ok) throw new Error(parsed.error)
    const { db, calls } = recordDb()
    const secret = 'test-install-secret-that-is-at-least-32-bytes'
    const receivedAt = Date.parse('2026-08-14T12:05:00Z')

    const recorded = await recordInstallationEvent(
      db,
      secret,
      parsed.event,
      'openma-ai/deepseek-harness-tui',
      receivedAt,
    )

    const insert = calls.find((call) => call.sql.includes('INSERT OR IGNORE'))
    const expectedHash = await hashInstallationClient(secret, VALID_EVENT.clientId)
    expect(expectedHash).toMatch(/^[0-9a-f]{64}$/)
    expect(insert?.params[1]).toBe(expectedHash)
    expect(insert?.params).not.toContain(VALID_EVENT.clientId)
    expect(recorded).toMatchObject({ duplicate: false, eventId: VALID_EVENT.eventId })
    expect(recorded.serverReceivedAt).toBe('2026-08-14T12:05:00.000Z')
  })

  it('reports an idempotent insert as a duplicate', async () => {
    const parsed = parseInstallationEvent(VALID_EVENT)
    if (!parsed.ok) throw new Error(parsed.error)
    const { db } = recordDb(0)
    const result = await recordInstallationEvent(
      db,
      'test-install-secret-that-is-at-least-32-bytes',
      parsed.event,
      parsed.event.pluginId,
    )
    expect(result.duplicate).toBe(true)
  })
})

describe('installation aggregates', () => {
  it('combines all-time, rolling-window, and distinct anonymous installer counts', async () => {
    const prepare = vi.fn((sql: string) => {
      const statement = {
        bind() {
          return statement
        },
        async all() {
          if (sql.includes('plugin_hourly_stats')) {
            return {
              results: [{
                plugin_id: VALID_EVENT.pluginId,
                install_count: 12,
                first_install_count: 8,
                reinstall_count: 4,
                update_count: 3,
                remove_count: 2,
                failure_count: 1,
                installs_24h: 2,
                installs_7d: 7,
                installs_30d: 12,
                latest_install_at: '2026-08-14T12:05:00.000Z',
              }],
            }
          }
          return { results: [{ plugin_id: VALID_EVENT.pluginId, installer_count: 6 }] }
        },
      }
      return statement
    })
    const db = { prepare } as unknown as D1Database

    const result = await loadInstallMetrics(db, [VALID_EVENT.pluginId])
    expect(result.get(VALID_EVENT.pluginId)).toEqual({
      installCount: 12,
      installerCount: 6,
      firstInstallCount: 8,
      reinstallCount: 4,
      updateCount: 3,
      removeCount: 2,
      failureCount: 1,
      installs24h: 2,
      installs7d: 7,
      installs30d: 12,
      latestInstallAt: '2026-08-14T12:05:00.000Z',
    })
    expect(result.get('missing/plugin')).toBeUndefined()
  })

  it('returns zero-filled metrics for catalog entries without events', async () => {
    const prepare = vi.fn(() => {
      const statement = {
        bind() {
          return statement
        },
        async all() {
          return { results: [] }
        },
      }
      return statement
    })
    const metrics = await loadInstallMetrics(
      { prepare } as unknown as D1Database,
      ['example/empty'],
    )
    expect(metrics.get('example/empty')).toEqual(emptyInstallMetrics())
  })
})

describe('installation rollup migration', () => {
  it('updates detailed client state and hourly counters exactly once per eventId', () => {
    const database = new DatabaseSync(':memory:')
    const migration = readFileSync(
      new URL('../migrations/0003_installation_events.sql', import.meta.url),
      'utf8',
    )
    database.exec(migration)
    const insert = database.prepare(`
      INSERT OR IGNORE INTO installation_events (
        event_id, client_hash, plugin_id, profile, operation, status,
        client_started_at, client_completed_at, server_received_at, server_received_hour,
        duration_ms, before_version, after_version, requested_ref, cli_version, dsh_version,
        platform, arch, is_ci, error_code, source_channel
      ) VALUES (?, ?, ?, 'web', ?, ?, ?, ?, ?, ?, 100, NULL, '1.0.0', NULL, '0.1.0',
        '0.1.0-rc.5', 'linux', 'x64', 0, NULL, 'cli')
    `)
    const pluginId = 'example/plugin'
    const clientA = 'a'.repeat(64)
    const clientB = 'b'.repeat(64)
    const hour = Date.parse('2026-08-14T12:00:00Z')
    const eventTime = '2026-08-14T12:05:00.000Z'
    const event = (id: string, client: string, operation: string, status: string) =>
      insert.run(id, client, pluginId, operation, status, eventTime, eventTime, eventTime, hour)

    event('00000000-0000-4000-8000-000000000001', clientA, 'install', 'success')
    event('00000000-0000-4000-8000-000000000002', clientA, 'reinstall', 'success')
    event('00000000-0000-4000-8000-000000000003', clientA, 'update', 'failed')
    event('00000000-0000-4000-8000-000000000004', clientB, 'install', 'success')
    event('00000000-0000-4000-8000-000000000005', clientA, 'remove', 'success')
    event('00000000-0000-4000-8000-000000000001', clientA, 'install', 'success')

    const state = database.prepare(`
      SELECT install_count, reinstall_count, update_count, remove_count,
        failure_count, current_state, current_version
      FROM plugin_client_state
      WHERE client_hash = ? AND plugin_id = ? AND profile = 'web'
    `).get(clientA, pluginId)
    expect(state).toMatchObject({
      install_count: 2,
      reinstall_count: 1,
      update_count: 0,
      remove_count: 1,
      failure_count: 1,
      current_state: 'removed',
      current_version: null,
    })

    const hourly = database.prepare(`
      SELECT install_count, first_install_count, reinstall_count, update_count,
        remove_count, failure_count, unique_client_count
      FROM plugin_hourly_stats
      WHERE plugin_id = ? AND bucket_hour = ?
    `).get(pluginId, hour)
    expect(hourly).toMatchObject({
      install_count: 3,
      first_install_count: 2,
      reinstall_count: 1,
      update_count: 0,
      remove_count: 1,
      failure_count: 1,
      unique_client_count: 2,
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM installation_events').get()).toMatchObject({
      count: 5,
    })
    database.close()
  })
})

describe('monorepo plugin ids', () => {
  it('accepts a subdirectory id and keeps it in the stored event', () => {
    const parsed = parseInstallationEvent({ ...VALID_EVENT, pluginId: 'owner/mono/packages/foo' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.event.pluginId).toBe('owner/mono/packages/foo')
  })

  it('still refuses ids that could escape the repository', () => {
    for (const pluginId of ['owner/mono/../etc', 'owner/mono/./foo', 'owner', 'owner//foo']) {
      expect(parseInstallationEvent({ ...VALID_EVENT, pluginId }).ok, pluginId).toBe(false)
    }
  })
})
