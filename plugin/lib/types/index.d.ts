/** 1024 Store market host plugin. */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh1024";
export declare const DEFAULT_EMBED_URL = "https://deepseek1024.com/embed/store?bridge=dsh1024-v1";
export interface Config {
    /** DSH profile that owns plugin mutations. Defaults to the booted profile. */
    profile?: string;
    /** HTTPS registry endpoint. */
    registryUrl?: string;
    /** HTTPS endpoint that reports the latest dsh1024 version. */
    updateUrl?: string;
    /** Store page embedded by the local shell. HTTP is accepted only on loopback for development. */
    embedUrl?: string;
    /** Show the 1024 Store entry in the main sidebar. The settings tabs stay either way. */
    sidebarEntry?: boolean;
}
/**
 * Mount the market routes after the web server service becomes available.
 * @param ctx - Cordis host context.
 * @param config - optional profile and registry overrides.
 */
export declare function apply(ctx: Context, config?: Config): void;
