/** Automatic update checks for the 1024 Store plugin itself. */
export interface UpdateInfo {
    checked: boolean;
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    releaseUrl: string;
    error?: string;
}
export declare const DEFAULT_UPDATE_URL = "https://deepseek1024.com/api/v1/self/update";
export declare const DEFAULT_UPDATE_FALLBACK_URL = "https://registry.npmjs.org/dsh1024/latest";
export declare const DEFAULT_UPDATE_LAST_RESORT_URL = "https://api.github.com/repos/imsai-sh/dsh1024-oss/contents/packages/dsh1024/package.json?ref=main";
export declare const DEFAULT_RELEASE_URL = "https://deepseek1024.com/plugins/imsai-sh/awesome-deepseek-harness-plugins/packages/dsh1024";
export declare const CURRENT_VERSION: string;
/** Compare two semantic versions. Positive means left is newer. */
export declare function compareVersions(leftValue: string, rightValue: string): number;
/**
 * Query the npm registry for the published version and fall back to the repository API.
 * Failures are returned as state so an unavailable checker never blocks the market.
 */
export declare function checkForUpdate(updateUrl?: string, fallbackUrl?: string, fetcher?: typeof fetch, lastResortUrl?: string): Promise<UpdateInfo>;
