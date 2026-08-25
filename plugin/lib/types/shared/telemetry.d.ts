/**
 * Shared anonymous install telemetry: a file-locked client identity plus a
 * pending queue with retry. This is the single implementation used by both the
 * dsh1024 CLI and the in-app 1024 Store plugin.
 */
export declare const CLI_VERSION: string;
export declare const DEFAULT_TELEMETRY_URL = "https://deepseek1024.com/api/v1/install-events";
export declare const TELEMETRY_NOTICE_VERSION = 1;
/** Read a dsh1024 environment variable, preferring the modern name over the legacy one. */
export declare function readCliEnv(env: NodeJS.ProcessEnv, suffix: string): string | undefined;
/** The exact public event schema shared by the CLI, the plugin, the Worker, and the docs. */
export declare const EVENT_KEYS: readonly ['eventId', 'clientId', 'pluginId', 'profile', 'operation', 'status', 'clientStartedAt', 'clientCompletedAt', 'durationMs', 'beforeVersion', 'afterVersion', 'requestedRef', 'cliVersion', 'dshVersion', 'errorCode', 'sourceChannel', 'platform', 'arch', 'isCi'];
export interface InstallEvent {
    eventId: string;
    clientId: string;
    pluginId: string;
    profile: string;
    operation: 'install' | 'reinstall' | 'update' | 'remove';
    status: 'success' | 'failed';
    clientStartedAt: string;
    clientCompletedAt: string;
    durationMs: number;
    beforeVersion: string | null;
    afterVersion: string | null;
    requestedRef: string | null;
    cliVersion: string;
    dshVersion: string | null;
    errorCode: string | null;
    sourceChannel: string;
    platform: string;
    arch: string;
    isCi: boolean;
}
export interface TelemetryClientConfig {
    schemaVersion: number;
    clientId: string;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
    noticeVersion: number;
    noticeShownAt?: string;
}
export interface TelemetryConfigOptions {
    now?: () => Date;
    uuid?: () => string;
}
export interface FlushOptions {
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
}
export interface FlushResult {
    sent: number;
    discarded?: number;
    pending: number;
}
export declare function environmentDisablesTelemetry(env: NodeJS.ProcessEnv): boolean;
export declare function loadTelemetryConfig(dshHome: string): Promise<TelemetryClientConfig | null>;
export declare function ensureTelemetryConfig(dshHome: string, options?: TelemetryConfigOptions): Promise<{
    config: TelemetryClientConfig;
    created: boolean;
}>;
export declare function markNoticeShown(dshHome: string, config: TelemetryClientConfig, now?: () => Date): Promise<boolean>;
export declare function setTelemetryEnabled(dshHome: string, enabled: boolean, options?: TelemetryConfigOptions): Promise<TelemetryClientConfig>;
export declare function resetTelemetry(dshHome: string, options?: TelemetryConfigOptions): Promise<boolean>;
export declare function effectiveTelemetryEnabled(config: TelemetryClientConfig | null, env: NodeJS.ProcessEnv): boolean;
export declare function detectPlatform(value?: string): string;
export declare function detectArch(value?: string): string;
export declare function detectCi(env: NodeJS.ProcessEnv): boolean;
export declare function assertEventShape(event: InstallEvent): void;
export declare function enqueueEvent(dshHome: string, event: InstallEvent): Promise<void>;
export declare function flushPending(dshHome: string, options?: FlushOptions): Promise<FlushResult>;
