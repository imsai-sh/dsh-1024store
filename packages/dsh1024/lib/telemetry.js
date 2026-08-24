/** Anonymous install telemetry: a thin wrapper over the shared locked-queue implementation. */
import { randomUUID } from 'node:crypto';
import { resolveDshHome } from './shared/files.js';
import { CLI_VERSION, DEFAULT_TELEMETRY_URL, EVENT_KEYS, detectArch, detectCi, detectPlatform, effectiveTelemetryEnabled, enqueueEvent, ensureTelemetryConfig, environmentDisablesTelemetry, flushPending, loadTelemetryConfig, markNoticeShown, } from './shared/telemetry.js';
export { DEFAULT_TELEMETRY_URL, EVENT_KEYS, detectArch, detectCi, detectPlatform, environmentDisablesTelemetry, };
export const TELEMETRY_SOURCE_CHANNEL = 'dsh-1024store-plugin';
const MAX_DURATION_MS = 86_400_000;
const PRIVACY_NOTICE = 'DSH 1024Store records anonymous plugin install outcomes and timestamps. '
    + 'Disable with `DO_NOT_TRACK=1`, `DSH1024_TELEMETRY=0`, or `npx dsh1024 telemetry disable`. '
    + 'Details: https://github.com/imsai-sh/dsh-1024store/blob/main/docs/install-analytics.md';
function boundedDuration(startedAt, completedAt) {
    return Math.min(MAX_DURATION_MS, Math.max(0, completedAt.getTime() - startedAt.getTime()));
}
/**
 * Report one plugin install/remove outcome to the public install-events API.
 * Delegates to the shared CLI implementation: the anonymous identity is
 * created and read under a file lock, and the event goes through the pending
 * queue so a failed delivery is retried on a later report. Every failure is
 * silent so telemetry can never affect a plugin operation. Respects
 * DO_NOT_TRACK, DSH1024_TELEMETRY / DSH_1024STORE_TELEMETRY, and an opted-out
 * shared CLI identity; when opted out no identity is created and nothing is
 * sent.
 */
export async function reportInstallEvent(input, context = {}) {
    try {
        const env = context.env ?? process.env;
        if (environmentDisablesTelemetry(env))
            return;
        const now = context.now ?? (() => new Date());
        const uuid = context.uuid ?? randomUUID;
        const dshHome = resolveDshHome(env);
        let config = await loadTelemetryConfig(dshHome);
        if (config !== null && config.enabled === false)
            return;
        if (config === null) {
            config = (await ensureTelemetryConfig(dshHome, { now, uuid })).config;
        }
        if (!effectiveTelemetryEnabled(config, env))
            return;
        if (await markNoticeShown(dshHome, config, now)) {
            ;
            (context.log ?? console.log)(PRIVACY_NOTICE);
        }
        const event = {
            eventId: uuid(),
            clientId: config.clientId,
            pluginId: input.pluginId,
            profile: input.profile,
            operation: input.operation,
            status: input.status,
            clientStartedAt: input.startedAt.toISOString(),
            clientCompletedAt: input.completedAt.toISOString(),
            durationMs: boundedDuration(input.startedAt, input.completedAt),
            beforeVersion: input.beforeVersion ?? null,
            afterVersion: input.afterVersion ?? null,
            requestedRef: null,
            cliVersion: CLI_VERSION,
            dshVersion: null,
            errorCode: input.errorCode,
            sourceChannel: TELEMETRY_SOURCE_CHANNEL,
            platform: detectPlatform(context.platform),
            arch: detectArch(context.arch),
            isCi: detectCi(env),
        };
        await enqueueEvent(dshHome, event);
        await flushPending(dshHome, { env, fetchImpl: context.fetcher });
    }
    catch {
        // Telemetry must never block or fail a plugin operation.
    }
}
