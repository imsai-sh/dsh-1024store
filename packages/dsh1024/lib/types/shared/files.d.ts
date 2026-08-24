/** Shared filesystem primitives for the 1024 Store state directory (locked, atomic). */
export interface StorePaths {
    directory: string;
    client: string;
    pending: string;
    receipts: string;
    registryCache: string;
    catalogPageCache: string;
    preferences: string;
}
export interface FileLockOptions {
    /** Test hook that runs after the lock directory exists but before this owner commits. */
    beforeOwnerCommit?: () => void | Promise<void>;
}
export declare function resolveDshHome(env?: NodeJS.ProcessEnv): string;
export declare function storePaths(dshHome: string): StorePaths;
export declare function readJson<T>(path: string, fallback?: T | null): Promise<T | null>;
export declare function writeJsonAtomic(path: string, value: unknown): Promise<void>;
export declare function withFileLock<T>(path: string, callback: () => T | Promise<T>, options?: FileLockOptions): Promise<T>;
export declare function unlinkIfPresent(path: string): Promise<boolean>;
