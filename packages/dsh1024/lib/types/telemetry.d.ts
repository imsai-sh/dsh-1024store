/** Anonymous install telemetry: a thin wrapper over the shared locked-queue implementation. */
import { DEFAULT_TELEMETRY_URL, EVENT_KEYS, detectArch, detectCi, detectPlatform, environmentDisablesTelemetry, type InstallEvent } from './shared/telemetry.ts';
export { DEFAULT_TELEMETRY_URL, EVENT_KEYS, detectArch, detectCi, detectPlatform, environmentDisablesTelemetry, };
export type { InstallEvent };
export declare const TELEMETRY_SOURCE_CHANNEL = "dsh-1024store-plugin";
export interface InstallEventInput {
    pluginId: string;
    profile: string;
    operation: 'install' | 'update' | 'remove';
    status: 'success' | 'failed';
    startedAt: Date;
    completedAt: Date;
    errorCode: string | null;
    beforeVersion?: string | null;
    afterVersion?: string | null;
}
export interface TelemetryContext {
    env?: NodeJS.ProcessEnv;
    fetcher?: typeof fetch;
    now?: () => Date;
    uuid?: () => string;
    log?: (line: string) => void;
    platform?: string;
    arch?: string;
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
export declare function reportInstallEvent(input: InstallEventInput, context?: TelemetryContext): Promise<void>;
