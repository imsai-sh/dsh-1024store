import type { InstallMetrics } from '../types'
import { isPluginId, PLUGIN_ID_MAX_LENGTH } from './plugin-id'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const MAX_QUERY_PLUGINS = 80
const MAX_EVENTS_PER_CLIENT_HOUR = 120
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// owner/repository, optionally extended with a monorepo subdirectory path;
// `.`/`..` segments are rejected by isPluginId (see lib/plugin-id.ts).
const PLUGIN_ID = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]*$/
const ERROR_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

const OPERATIONS = ['install', 'reinstall', 'update', 'remove'] as const
const STATUSES = ['success', 'failed'] as const
const PLATFORMS = ['darwin', 'linux', 'win32', 'freebsd', 'aix', 'android', 'unknown'] as const
const ARCHITECTURES = [
  'x64',
  'arm64',
  'arm',
  'ia32',
  'ppc64',
  's390x',
  'riscv64',
  'unknown',
] as const

const ALLOWED_EVENT_KEYS = new Set([
  'eventId',
  'clientId',
  'pluginId',
  'profile',
  'operation',
  'status',
  'clientStartedAt',
  'clientCompletedAt',
  'durationMs',
  'beforeVersion',
  'afterVersion',
  'requestedRef',
  'cliVersion',
  'dshVersion',
  'platform',
  'arch',
  'isCi',
  'errorCode',
  'sourceChannel',
])

type Operation = (typeof OPERATIONS)[number]
type EventStatus = (typeof STATUSES)[number]
type Platform = (typeof PLATFORMS)[number]
type Architecture = (typeof ARCHITECTURES)[number]

export interface InstallationEvent {
  eventId: string
  clientId: string
  pluginId: string
  profile: string
  operation: Operation
  status: EventStatus
  clientStartedAt: string
  clientCompletedAt: string
  durationMs: number
  beforeVersion: string | null
  afterVersion: string | null
  requestedRef: string | null
  cliVersion: string | null
  dshVersion: string | null
  platform: Platform
  arch: Architecture
  isCi: boolean
  errorCode: string | null
  sourceChannel: string | null
}

export type InstallationEventParseResult =
  | { ok: true; event: InstallationEvent }
  | { ok: false; error: string }

export interface RecordInstallationResult {
  duplicate: boolean
  eventId: string
  pluginId: string
  serverReceivedAt: string
}

interface HourlyStatsRow {
  plugin_id: string
  install_count: number | string | null
  first_install_count: number | string | null
  reinstall_count: number | string | null
  update_count: number | string | null
  remove_count: number | string | null
  failure_count: number | string | null
  installs_24h: number | string | null
  installs_7d: number | string | null
  installs_30d: number | string | null
  latest_install_at: string | null
}

interface InstallerCountRow {
  plugin_id: string
  installer_count: number | string | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isOneOf<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  pattern: RegExp,
  maxLength: number,
): string | null {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null
  if (value !== value.trim() || !pattern.test(value)) return null
  return value
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
  pattern: RegExp = SAFE_TEXT,
): { valid: boolean; value: string | null } {
  const value = record[key]
  if (value === undefined || value === null) return { valid: true, value: null }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value !== value.trim() ||
    !pattern.test(value)
  ) {
    return { valid: false, value: null }
  }
  return { valid: true, value }
}

function normalizedTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40 || value !== value.trim()) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

export function parseInstallationEvent(value: unknown): InstallationEventParseResult {
  if (!isObject(value)) return { ok: false, error: 'Request body must be a JSON object.' }
  const unexpected = Object.keys(value).find((key) => !ALLOWED_EVENT_KEYS.has(key))
  if (unexpected) return { ok: false, error: `Unexpected field: ${unexpected}.` }

  const eventId = requiredString(value, 'eventId', UUID, 36)
  if (!eventId) return { ok: false, error: 'Invalid eventId.' }
  const clientId = requiredString(value, 'clientId', UUID, 36)
  if (!clientId) return { ok: false, error: 'Invalid clientId.' }
  const pluginId = requiredString(value, 'pluginId', PLUGIN_ID, PLUGIN_ID_MAX_LENGTH)
  if (!pluginId || !isPluginId(pluginId)) return { ok: false, error: 'Invalid pluginId.' }
  const profile = requiredString(value, 'profile', PROFILE, 64)
  if (!profile) return { ok: false, error: 'Invalid profile.' }

  const operation = value.operation
  if (!isOneOf(operation, OPERATIONS)) return { ok: false, error: 'Invalid operation.' }
  const status = value.status
  if (!isOneOf(status, STATUSES)) return { ok: false, error: 'Invalid status.' }
  const platform = value.platform
  if (!isOneOf(platform, PLATFORMS)) return { ok: false, error: 'Invalid platform.' }
  const arch = value.arch
  if (!isOneOf(arch, ARCHITECTURES)) return { ok: false, error: 'Invalid architecture.' }
  if (typeof value.isCi !== 'boolean') return { ok: false, error: 'Invalid isCi.' }

  const clientStartedAt = normalizedTimestamp(value.clientStartedAt)
  if (!clientStartedAt) return { ok: false, error: 'Invalid clientStartedAt.' }
  const clientCompletedAt = normalizedTimestamp(value.clientCompletedAt)
  if (!clientCompletedAt || clientCompletedAt < clientStartedAt) {
    return { ok: false, error: 'Invalid clientCompletedAt.' }
  }
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 0 || (value.durationMs as number) > DAY_MS) {
    return { ok: false, error: 'Invalid durationMs.' }
  }

  const beforeVersion = optionalString(value, 'beforeVersion', 128)
  const afterVersion = optionalString(value, 'afterVersion', 128)
  const requestedRef = optionalString(value, 'requestedRef', 256)
  const cliVersion = optionalString(value, 'cliVersion', 64)
  const dshVersion = optionalString(value, 'dshVersion', 64)
  const errorCode = optionalString(value, 'errorCode', 80, ERROR_CODE)
  const sourceChannel = optionalString(value, 'sourceChannel', 32, /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/)
  const optionalValues = [
    beforeVersion,
    afterVersion,
    requestedRef,
    cliVersion,
    dshVersion,
    errorCode,
    sourceChannel,
  ]
  if (optionalValues.some((item) => !item.valid)) {
    return { ok: false, error: 'One or more optional fields are invalid.' }
  }

  return {
    ok: true,
    event: {
      eventId: eventId.toLocaleLowerCase(),
      clientId: clientId.toLocaleLowerCase(),
      pluginId,
      profile,
      operation,
      status,
      clientStartedAt,
      clientCompletedAt,
      durationMs: value.durationMs as number,
      beforeVersion: beforeVersion.value,
      afterVersion: afterVersion.value,
      requestedRef: requestedRef.value,
      cliVersion: cliVersion.value,
      dshVersion: dshVersion.value,
      platform,
      arch,
      isCi: value.isCi,
      errorCode: errorCode.value,
      sourceChannel: sourceChannel.value,
    },
  }
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function hashInstallationClient(secret: string, clientId: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(clientId)))
}

export class InstallationRateLimitError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super('Installation event rate limit exceeded.')
    this.name = 'InstallationRateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function hourBucket(timestamp: number): number {
  return Math.floor(timestamp / HOUR_MS) * HOUR_MS
}

export async function recordInstallationEvent(
  db: D1Database,
  secret: string,
  event: InstallationEvent,
  canonicalPluginId: string,
  receivedAt: number = Date.now(),
): Promise<RecordInstallationResult> {
  const clientHash = await hashInstallationClient(secret, event.clientId)
  const receivedHour = hourBucket(receivedAt)
  const rate = await db.prepare(`
    SELECT COUNT(*) AS event_count
    FROM installation_events
    WHERE client_hash = ? AND server_received_hour = ?
  `).bind(clientHash, receivedHour).first<{ event_count: number | string }>()
  if (Number(rate?.event_count ?? 0) >= MAX_EVENTS_PER_CLIENT_HOUR) {
    const existing = await db.prepare('SELECT event_id FROM installation_events WHERE event_id = ?')
      .bind(event.eventId)
      .first<{ event_id: string }>()
    if (!existing) {
      const retryAfterSeconds = Math.max(1, Math.ceil((receivedHour + HOUR_MS - receivedAt) / 1000))
      throw new InstallationRateLimitError(retryAfterSeconds)
    }
  }

  const serverReceivedAt = new Date(receivedAt).toISOString()
  const result = await db.prepare(`
    INSERT OR IGNORE INTO installation_events (
      event_id,
      client_hash,
      plugin_id,
      profile,
      operation,
      status,
      client_started_at,
      client_completed_at,
      server_received_at,
      server_received_hour,
      duration_ms,
      before_version,
      after_version,
      requested_ref,
      cli_version,
      dsh_version,
      platform,
      arch,
      is_ci,
      error_code,
      source_channel
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    event.eventId,
    clientHash,
    canonicalPluginId,
    event.profile,
    event.operation,
    event.status,
    event.clientStartedAt,
    event.clientCompletedAt,
    serverReceivedAt,
    receivedHour,
    event.durationMs,
    event.beforeVersion,
    event.afterVersion,
    event.requestedRef,
    event.cliVersion,
    event.dshVersion,
    event.platform,
    event.arch,
    event.isCi ? 1 : 0,
    event.errorCode,
    event.sourceChannel,
  ).run()

  return {
    duplicate: (result.meta.changes ?? 0) === 0,
    eventId: event.eventId,
    pluginId: canonicalPluginId,
    serverReceivedAt,
  }
}

export function emptyInstallMetrics(): InstallMetrics {
  return {
    installCount: 0,
    installerCount: 0,
    firstInstallCount: 0,
    reinstallCount: 0,
    updateCount: 0,
    removeCount: 0,
    failureCount: 0,
    installs24h: 0,
    installs7d: 0,
    installs30d: 0,
    latestInstallAt: null,
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size))
  }
  return result
}

function count(value: number | string | null): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export async function loadInstallMetrics(
  db: D1Database,
  pluginIds: string[],
  now: number = Date.now(),
): Promise<Map<string, InstallMetrics>> {
  const ids = [...new Set(pluginIds)]
  const metrics = new Map(ids.map((pluginId) => [pluginId.toLocaleLowerCase(), emptyInstallMetrics()]))
  const threshold24h = hourBucket(now - DAY_MS)
  const threshold7d = hourBucket(now - 7 * DAY_MS)
  const threshold30d = hourBucket(now - 30 * DAY_MS)

  for (const batch of chunks(ids, MAX_QUERY_PLUGINS)) {
    const placeholders = batch.map(() => '?').join(', ')
    const [hourly, installers] = await Promise.all([
      db.prepare(`
        SELECT
          plugin_id,
          SUM(install_count) AS install_count,
          SUM(first_install_count) AS first_install_count,
          SUM(reinstall_count) AS reinstall_count,
          SUM(update_count) AS update_count,
          SUM(remove_count) AS remove_count,
          SUM(failure_count) AS failure_count,
          SUM(CASE WHEN bucket_hour >= ? THEN install_count ELSE 0 END) AS installs_24h,
          SUM(CASE WHEN bucket_hour >= ? THEN install_count ELSE 0 END) AS installs_7d,
          SUM(CASE WHEN bucket_hour >= ? THEN install_count ELSE 0 END) AS installs_30d,
          MAX(latest_install_at) AS latest_install_at
        FROM plugin_hourly_stats
        WHERE plugin_id COLLATE NOCASE IN (${placeholders})
        GROUP BY plugin_id COLLATE NOCASE
      `).bind(threshold24h, threshold7d, threshold30d, ...batch).all<HourlyStatsRow>(),
      db.prepare(`
        SELECT plugin_id, COUNT(DISTINCT client_hash) AS installer_count
        FROM plugin_client_state
        WHERE first_installed_at IS NOT NULL AND plugin_id COLLATE NOCASE IN (${placeholders})
        GROUP BY plugin_id COLLATE NOCASE
      `).bind(...batch).all<InstallerCountRow>(),
    ])

    for (const row of hourly.results) {
      const key = row.plugin_id.toLocaleLowerCase()
      const previous = metrics.get(key) ?? emptyInstallMetrics()
      metrics.set(key, {
        ...previous,
        installCount: count(row.install_count),
        firstInstallCount: count(row.first_install_count),
        reinstallCount: count(row.reinstall_count),
        updateCount: count(row.update_count),
        removeCount: count(row.remove_count),
        failureCount: count(row.failure_count),
        installs24h: count(row.installs_24h),
        installs7d: count(row.installs_7d),
        installs30d: count(row.installs_30d),
        latestInstallAt: row.latest_install_at,
      })
    }
    for (const row of installers.results) {
      const key = row.plugin_id.toLocaleLowerCase()
      const previous = metrics.get(key) ?? emptyInstallMetrics()
      metrics.set(key, { ...previous, installerCount: count(row.installer_count) })
    }
  }

  return metrics
}

export async function loadPluginInstallStats(
  db: D1Database,
  pluginId: string,
  now: number = Date.now(),
): Promise<InstallMetrics> {
  const metrics = await loadInstallMetrics(db, [pluginId], now)
  return metrics.get(pluginId.toLocaleLowerCase()) ?? emptyInstallMetrics()
}
