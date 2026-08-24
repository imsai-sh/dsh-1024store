/** Plugin-owned cache for the embedded catalog's first visible page. */
/** Validate the only v2 page shape the plugin persists and returns to the iframe. */
export declare function isCatalogPage(value: unknown): boolean;
/** Read a validated last-good snapshot. Expired or malformed data is ignored. */
export declare function readCatalogPageCache(dshHome: string): Promise<unknown | null>;
/** Atomically replace the snapshot after a successful production API response. */
export declare function writeCatalogPageCache(dshHome: string, page: unknown): Promise<void>;
