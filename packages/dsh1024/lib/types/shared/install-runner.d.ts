/**
 * Shared asynchronous install runner used by both the dsh1024 CLI and the
 * in-app 1024 Store plugin. The official CLI invocation is injected by each
 * caller: the CLI passes an `npx --yes @deepseek-ai/dsh` prefix while the
 * plugin reuses the running dsh entry. The runner always spawns asynchronously;
 * it must never use spawnSync, which would freeze the harness event loop.
 */
import { spawn } from 'node:child_process';
/** How to start the official DSH CLI, minus the plugin subcommand itself. */
export interface InstallInvocation {
    file: string;
    prefixArgs: string[];
    cwd?: string;
    useShell?: boolean;
}
export interface RunPluginCommandOptions {
    /** CLI passes `npx --yes @deepseek-ai/dsh`; the plugin reuses the running dsh entry. */
    invocation: InstallInvocation;
    action: 'add' | 'remove';
    profile: string;
    target: string;
    extraArgs?: string[];
    /** CLI uses `inherit`; the plugin uses `capture` (64KB rolling buffers). */
    stdio: 'inherit' | 'capture';
    /** The plugin passes five minutes; the CLI sets no timeout. */
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    /** Progress callback fed the last meaningful line of each captured chunk. */
    onLine?: (line: string) => void;
    /** Test injection point for the child process implementation. */
    spawnImpl?: typeof spawn;
}
export interface RunOfficialCommandOptions {
    invocation: InstallInvocation;
    /** Argument vector appended to the invocation, verbatim. */
    args: string[];
    stdio: 'inherit' | 'capture';
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onLine?: (line: string) => void;
    spawnImpl?: typeof spawn;
}
export interface RunPluginCommandResult {
    /** Exit code of the official CLI; null when it could not run or was killed. */
    exitCode: number | null;
    timedOut: boolean;
    /** Spawn failure message; null when the process started normally. */
    error: string | null;
    stdout: string;
    stderr: string;
}
/**
 * Run one official `dsh plugin --profile <profile> <action> <target>` mutation.
 * @param options - injected invocation plus the plugin mutation to perform.
 * @returns the exit code with captured output; never rejects.
 */
export declare function runPluginCommand(options: RunPluginCommandOptions): Promise<RunPluginCommandResult>;
/**
 * Run the official CLI with a verbatim argument vector.
 *
 * The dsh1024 CLI is a pure wrapper: it forwards the user's own arguments
 * unchanged, so it cannot use the structured helper above.
 * @param options - injected invocation plus the exact arguments to forward.
 * @returns the exit code with captured output; never rejects.
 */
export declare function runOfficialCommand(options: RunOfficialCommandOptions): Promise<RunPluginCommandResult>;
