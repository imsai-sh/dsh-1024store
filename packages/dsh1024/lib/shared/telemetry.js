/**
 * Shared anonymous install telemetry: a file-locked client identity plus a
 * pending queue with retry. This is the single implementation used by both the
 * dsh1024 CLI and the in-app 1024 Store plugin.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { arch as nodeArch, platform as nodePlatform } from 'node:process';
import { readJson, storePaths, unlinkIfPresent, withFileLock, writeJsonAtomic, } from './files.js';
const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
export const CLI_VERSION = manifest.version;
export const DEFAULT_TELEMETRY_URL = 'https://deepseek1024.com/api/v1/install-events';
export const TELEMETRY_NOTICE_VERSION = 1;
/** Read a dsh1024 environment variable, preferring the modern name over the legacy one. */
export function readCliEnv(env, suffix) {
    const modern = env[`DSH1024_${suffix}`];
    return modern !== undefined ? modern : env[`DSH_1024STORE_${suffix}`];
}
/** The exact public event schema shared by the CLI, the plugin, the Worker, and the docs. */
export const EVENT_KEYS = [
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
    'errorCode',
    'sourceChannel',
    'platform',
    'arch',
    'isCi',
];
const PLATFORM_VALUES = new Set(['darwin', 'linux', 'win32', 'freebsd', 'aix', 'android']);
const ARCH_VALUES = new Set(['x64', 'arm64', 'arm', 'ia32', 'ppc64', 's390x', 'riscv64']);
const MAX_PENDING_EVENTS = 1000;
const PERMANENT_REJECTION_STATUSES = new Set([400, 404, 405, 413, 415, 422]);
function isFalse(value) {
    return ['0', 'false', 'off', 'no'].includes(String(value ?? '').toLowerCase());
}
function isTrue(value) {
    return ['1', 'true', 'on', 'yes'].includes(String(value ?? '').toLowerCase());
}
export function environmentDisablesTelemetry(env) {
    const telemetry = readCliEnv(env, 'TELEMETRY');
    return isTrue(env.DO_NOT_TRACK) || (telemetry !== undefined && isFalse(telemetry));
}
function createConfig(now, uuid) {
    const timestamp = now().toISOString();
    return {
        schemaVersion: 1,
        clientId: uuid(),
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        noticeVersion: 0,
    };
}
export async function loadTelemetryConfig(dshHome) {
    const config = await readJson(storePaths(dshHome).client, null);
    if (!config || config.schemaVersion !== 1 || typeof config.clientId !== 'string')
        return null;
    return config;
}
export async function ensureTelemetryConfig(dshHome, options = {}) {
    const now = options.now ?? (() => new Date());
    const uuid = options.uuid ?? randomUUID;
    const path = storePaths(dshHome).client;
    return withFileLock(path, async () => {
        const existing = await loadTelemetryConfig(dshHome);
        if (existing)
            return { config: existing, created: false };
        const config = createConfig(now, uuid);
        await writeJsonAtomic(path, config);
        return { config, created: true };
    });
}
export async function markNoticeShown(dshHome, config, now = () => new Date()) {
    const path = storePaths(dshHome).client;
    return withFileLock(path, async () => {
        const current = await loadTelemetryConfig(dshHome) ?? config;
        if ((current.noticeVersion ?? 0) >= TELEMETRY_NOTICE_VERSION) {
            Object.assign(config, current);
            return false;
        }
        current.noticeVersion = TELEMETRY_NOTICE_VERSION;
        current.noticeShownAt = now().toISOString();
        current.updatedAt = current.noticeShownAt;
        await writeJsonAtomic(path, current);
        Object.assign(config, current);
        return true;
    });
}
export async function setTelemetryEnabled(dshHome, enabled, options = {}) {
    const paths = storePaths(dshHome);
    const now = options.now ?? (() => new Date());
    const uuid = options.uuid ?? randomUUID;
    const config = await withFileLock(paths.client, async () => {
        const current = await loadTelemetryConfig(dshHome) ?? createConfig(now, uuid);
        current.enabled = enabled;
        current.updatedAt = now().toISOString();
        await writeJsonAtomic(paths.client, current);
        return current;
    });
    if (!enabled) {
        await withFileLock(paths.pending, () => unlinkIfPresent(paths.pending));
    }
    return config;
}
export async function resetTelemetry(dshHome, options = {}) {
    const paths = storePaths(dshHome);
    const now = options.now ?? (() => new Date());
    const uuid = options.uuid ?? randomUUID;
    const changedClient = await withFileLock(paths.client, async () => {
        const existing = await loadTelemetryConfig(dshHome);
        if (!existing)
            return unlinkIfPresent(paths.client);
        const rotated = createConfig(now, uuid);
        rotated.enabled = existing.enabled !== false;
        rotated.noticeVersion = existing.noticeVersion ?? 0;
        if (existing.noticeShownAt)
            rotated.noticeShownAt = existing.noticeShownAt;
        await writeJsonAtomic(paths.client, rotated);
        return true;
    });
    const removedPending = await withFileLock(paths.pending, () => unlinkIfPresent(paths.pending));
    return changedClient || removedPending;
}
export function effectiveTelemetryEnabled(config, env) {
    return config?.enabled !== false && !environmentDisablesTelemetry(env);
}
export function detectPlatform(value = nodePlatform) {
    return PLATFORM_VALUES.has(value) ? value : 'unknown';
}
export function detectArch(value = nodeArch) {
    return ARCH_VALUES.has(value) ? value : 'unknown';
}
export function detectCi(env) {
    return isTrue(env.CI) || Boolean(env.GITHUB_ACTIONS || env.BUILDKITE || env.TF_BUILD || env.JENKINS_URL);
}
export function assertEventShape(event) {
    const keys = Object.keys(event);
    if (keys.length !== EVENT_KEYS.length || EVENT_KEYS.some((key) => !keys.includes(key))) {
        throw new Error('telemetry event does not match the public event schema');
    }
}
export async function enqueueEvent(dshHome, event) {
    assertEventShape(event);
    const path = storePaths(dshHome).pending;
    await withFileLock(path, async () => {
        const existing = await readJson(path, { schemaVersion: 1, events: [] });
        const events = Array.isArray(existing?.events) ? existing.events : [];
        if (!events.some((queued) => queued.eventId === event.eventId))
            events.push(event);
        await writeJsonAtomic(path, { schemaVersion: 1, events: events.slice(-MAX_PENDING_EVENTS) });
    });
}
export async function flushPending(dshHome, options = {}) {
    const path = storePaths(dshHome).pending;
    const queued = await withFileLock(path, async () => {
        const document = await readJson(path, { schemaVersion: 1, events: [] });
        return Array.isArray(document?.events) ? document.events.slice(0, 50) : [];
    });
    if (queued.length === 0)
        return { sent: 0, pending: 0 };
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const env = options.env ?? process.env;
    const endpoint = readCliEnv(env, 'TELEMETRY_URL') || DEFAULT_TELEMETRY_URL;
    const timeoutMs = normalizedTimeout(readCliEnv(env, 'TELEMETRY_TIMEOUT_MS'));
    let sent = 0;
    let discarded = 0;
    const processedIds = new Set();
    for (const event of queued) {
        try {
            const response = await fetchImpl(endpoint, {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    'user-agent': `dsh1024/${CLI_VERSION}`,
                },
                body: JSON.stringify(event),
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (response.ok || response.status === 409) {
                sent += 1;
                processedIds.add(event.eventId);
                continue;
            }
            if (PERMANENT_REJECTION_STATUSES.has(response.status)) {
                discarded += 1;
                processedIds.add(event.eventId);
                continue;
            }
            break;
        }
        catch {
            break;
        }
    }
    const pending = await withFileLock(path, async () => {
        const current = await readJson(path, { schemaVersion: 1, events: [] });
        const events = Array.isArray(current?.events) ? current.events : [];
        const remaining = events.filter((event) => !processedIds.has(event.eventId));
        await writeJsonAtomic(path, { schemaVersion: 1, events: remaining });
        return remaining.length;
    });
    return { sent, discarded, pending };
}
function normalizedTimeout(value) {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 100 && parsed <= 30_000 ? parsed : 2_500;
}
