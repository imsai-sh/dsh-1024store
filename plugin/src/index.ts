/** 1024 Store market host plugin. */

import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_REGISTRY_URL } from './registry.ts'
import { mountMarketRoutes, type WebServerService } from './routes.ts'
import { DEFAULT_UPDATE_URL } from './update.ts'

export const name = 'dsh1024'
export const DEFAULT_EMBED_URL = 'https://deepseek1024.com/embed/store?bridge=dsh1024-v1'

export interface Config {
  /** DSH profile that owns plugin mutations. Defaults to the booted profile. */
  profile?: string
  /** HTTPS registry endpoint. */
  registryUrl?: string
  /** HTTPS endpoint that reports the latest dsh1024 version. */
  updateUrl?: string
  /** Store page embedded by the local shell. HTTP is accepted only on loopback for development. */
  embedUrl?: string
  /** Show the 1024 Store entry in the main sidebar. The settings tabs stay either way. */
  sidebarEntry?: boolean
}

interface MarketContext extends Context {
  webServer: WebServerService
}

function argvProfile(): string | undefined {
  const index = process.argv.indexOf('--profile')
  const candidate = index >= 0 ? process.argv[index + 1] : undefined
  return candidate !== undefined && !candidate.startsWith('-') ? candidate : undefined
}

/**
 * Mount the market routes after the web server service becomes available.
 * @param ctx - Cordis host context.
 * @param config - optional profile and registry overrides.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = {
    profile: config.profile ?? argvProfile() ?? 'web',
    registryUrl: config.registryUrl ?? DEFAULT_REGISTRY_URL,
    updateUrl: config.updateUrl ?? DEFAULT_UPDATE_URL,
    embedUrl: config.embedUrl ?? DEFAULT_EMBED_URL,
    sidebarEntry: config.sidebarEntry ?? true,
  }
  ctx.inject(['webServer'], hostContext => {
    const host = hostContext as MarketContext
    host.effect(
      () => mountMarketRoutes(host.webServer, resolved),
      'dsh1024: http routes',
    )
  })
}
