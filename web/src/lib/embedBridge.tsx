import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { isPluginsPage, type PluginsPage } from './api'

export const EMBED_BRIDGE_PROTOCOL = 'dsh1024-bridge'
export const EMBED_BRIDGE_VERSION = 1

export interface BridgeInstalledPlugin {
  id: string
  name: string
  owner: string
  url: string
  category: string
  categoryLabel: { en: string; zh: string }
  description: { en: string; zh: string }
  install: string
  added: string
  stars: number | null
}

interface BridgeResult {
  ok: boolean
  error?: string
  pluginIds?: string[]
  plugins?: BridgeInstalledPlugin[]
  catalogPage?: PluginsPage | null
  /** Tail of the official CLI's output, forwarded by the local shell. */
  stdout?: string
  stderr?: string
  exitCode?: number | null
  /** The exact official command the shell executed (uninstall replies). */
  command?: string
  /** Live progress snapshot from the local /dsh1024/status endpoint. */
  status?: BridgeOperationStatus
}

export interface BridgeOperationStatus {
  active: boolean
  action: string | null
  target: string
  seconds: number
  lastLine: string
}

/**
 * The one install the store is running or has just finished, kept for the
 * install console: the exact command, its live output line, and — once it
 * ends — the full captured output, so a failure is debuggable from the page.
 */
export interface InstallActivity {
  kind: 'install' | 'uninstall'
  pluginId: string
  command: string | null
  state: 'running' | 'ok' | 'failed'
  error: string | null
  stdout: string
  stderr: string
  startedAt: number
}

interface PendingRequest {
  resolve: (value: BridgeResult) => void
  reject: (reason: Error) => void
  timer: number
}

interface EmbedBridgeValue {
  embedded: boolean
  connected: boolean
  activation: number
  installedPluginIds: string[] | null
  installedPlugins: BridgeInstalledPlugin[] | null
  installedError: string
  refreshInstalled: () => Promise<void>
  install: (pluginId: string, command?: string) => Promise<BridgeResult>
  uninstall: (pluginId: string) => Promise<BridgeResult>
  installActivity: InstallActivity | null
  clearInstallActivity: () => void
  bridgeStatus: () => Promise<BridgeOperationStatus | null>
  readCatalogPageCache: () => Promise<PluginsPage | null>
  writeCatalogPageCache: (page: PluginsPage) => Promise<void>
}

const EmbedBridgeContext = createContext<EmbedBridgeValue>({
  embedded: false,
  connected: false,
  activation: 0,
  installedPluginIds: null,
  installedPlugins: null,
  installedError: '',
  refreshInstalled: async () => undefined,
  install: async () => ({ ok: false, error: 'Local DSH bridge is not connected.' }),
  uninstall: async () => ({ ok: false, error: 'Local DSH bridge is not connected.' }),
  installActivity: null,
  clearInstallActivity: () => undefined,
  bridgeStatus: async () => null,
  readCatalogPageCache: async () => null,
  writeCatalogPageCache: async () => undefined,
})

function messageObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function bridgeInstalledPlugin(value: unknown): BridgeInstalledPlugin | null {
  const plugin = messageObject(value)
  const description = messageObject(plugin?.description)
  const categoryLabel = messageObject(plugin?.categoryLabel)
  if (plugin === null || typeof plugin.id !== 'string' || typeof plugin.name !== 'string'
    || typeof plugin.owner !== 'string' || typeof plugin.url !== 'string'
    || typeof plugin.category !== 'string' || typeof plugin.install !== 'string'
    || typeof plugin.added !== 'string'
    || (plugin.stars !== null && typeof plugin.stars !== 'number')
    || description === null || typeof description.en !== 'string' || typeof description.zh !== 'string'
    || categoryLabel === null || typeof categoryLabel.en !== 'string' || typeof categoryLabel.zh !== 'string') return null
  return {
    id: plugin.id,
    name: plugin.name,
    owner: plugin.owner,
    url: plugin.url,
    category: plugin.category,
    categoryLabel: { en: categoryLabel.en, zh: categoryLabel.zh },
    description: { en: description.en, zh: description.zh },
    install: plugin.install,
    added: plugin.added,
    stars: plugin.stars,
  }
}

function initialEmbeddedState(): boolean {
  if (typeof window === 'undefined') return false
  return window.self !== window.top || window.location.pathname.startsWith('/embed/')
}

export function EmbedBridgeProvider({ children }: { children: ReactNode }) {
  const [embedded] = useState(initialEmbeddedState)
  const [connected, setConnected] = useState(false)
  const [activation, setActivation] = useState(0)
  const [installedPluginIds, setInstalledPluginIds] = useState<string[] | null>(null)
  const [installedPlugins, setInstalledPlugins] = useState<BridgeInstalledPlugin[] | null>(null)
  const [installedError, setInstalledError] = useState('')
  const [installActivity, setInstallActivity] = useState<InstallActivity | null>(null)
  const portRef = useRef<MessagePort | null>(null)
  const pendingRef = useRef(new Map<string, PendingRequest>())

  useEffect(() => {
    if (!embedded) return undefined
    document.documentElement.dataset.dsh1024Embed = 'true'
    return () => { delete document.documentElement.dataset.dsh1024Embed }
  }, [embedded])

  useEffect(() => {
    if (!embedded || typeof window === 'undefined') return undefined

    function disconnect(reason: string) {
      setConnected(false)
      portRef.current?.close()
      portRef.current = null
      for (const pending of pendingRef.current.values()) {
        window.clearTimeout(pending.timer)
        pending.reject(new Error(reason))
      }
      pendingRef.current.clear()
    }

    function onConnect(event: MessageEvent) {
      const message = messageObject(event.data)
      if (
        event.source !== window.parent
        || message?.protocol !== EMBED_BRIDGE_PROTOCOL
        || message.version !== EMBED_BRIDGE_VERSION
        || message.type !== 'connect'
        || event.ports.length !== 1
      ) return

      disconnect('Local DSH bridge reconnected.')
      const port = event.ports[0]!
      portRef.current = port
      port.onmessage = (portEvent) => {
        const payload = messageObject(portEvent.data)
        if (payload?.protocol === EMBED_BRIDGE_PROTOCOL
          && payload.version === EMBED_BRIDGE_VERSION
          && payload.type === 'activate') {
          setActivation(value => value + 1)
          return
        }
        if (payload?.type !== 'result' || typeof payload.requestId !== 'string') return
        const pending = pendingRef.current.get(payload.requestId)
        if (!pending) return
        pendingRef.current.delete(payload.requestId)
        window.clearTimeout(pending.timer)
        const ok = payload.ok === true
        const pluginIds = Array.isArray(payload.pluginIds)
          ? payload.pluginIds.filter((id): id is string => typeof id === 'string')
          : undefined
        const plugins = Array.isArray(payload.plugins)
          ? payload.plugins.flatMap(plugin => {
              const parsed = bridgeInstalledPlugin(plugin)
              return parsed === null ? [] : [parsed]
            })
          : undefined
        const catalogPage = payload.catalogPage === null
          ? null
          : isPluginsPage(payload.catalogPage) ? payload.catalogPage : undefined
        const statusObject = messageObject(payload.status)
        pending.resolve({
          ok,
          error: typeof payload.error === 'string' ? payload.error : undefined,
          pluginIds,
          plugins,
          catalogPage,
          stdout: typeof payload.stdout === 'string' ? payload.stdout : undefined,
          stderr: typeof payload.stderr === 'string' ? payload.stderr : undefined,
          exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : undefined,
          command: typeof payload.command === 'string' ? payload.command : undefined,
          status: statusObject === null ? undefined : {
            active: statusObject.active === true,
            action: typeof statusObject.action === 'string' ? statusObject.action : null,
            target: typeof statusObject.target === 'string' ? statusObject.target : '',
            seconds: typeof statusObject.seconds === 'number' ? statusObject.seconds : 0,
            lastLine: typeof statusObject.lastLine === 'string' ? statusObject.lastLine : '',
          },
        })
      }
      port.onmessageerror = () => disconnect('Local DSH bridge sent an invalid message.')
      port.start()
      setConnected(true)
      port.postMessage({
        protocol: EMBED_BRIDGE_PROTOCOL,
        version: EMBED_BRIDGE_VERSION,
        type: 'ready',
        capabilities: ['install', 'installed', 'catalog-cache', 'status', 'uninstall'],
      })
    }

    window.addEventListener('message', onConnect)
    // The local shell cannot know when React has installed this listener.
    // Announce readiness without transferring any capability; the parent then
    // validates this frame's source and origin before it sends a MessagePort.
    if (window.parent !== window) {
      window.parent.postMessage({
        protocol: EMBED_BRIDGE_PROTOCOL,
        version: EMBED_BRIDGE_VERSION,
        type: 'init',
      }, '*')
    }
    return () => {
      window.removeEventListener('message', onConnect)
      disconnect('Local DSH bridge closed.')
    }
  }, [embedded])

  const sendRequest = useCallback((
    action: 'install' | 'uninstall' | 'installed' | 'status' | 'catalog-cache-read' | 'catalog-cache-write',
    options: { pluginId?: string; command?: string; catalogPage?: PluginsPage } = {},
    timeoutMs = 6 * 60 * 1000,
  ): Promise<BridgeResult> => {
    const port = portRef.current
    if (port === null) {
      return Promise.resolve({ ok: false, error: 'Local DSH bridge is not connected.' })
    }
    const requestId = crypto.randomUUID()
    return new Promise<BridgeResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRef.current.delete(requestId)
        reject(new Error(action === 'install' ? 'Local installation timed out.' : 'Local DSH bridge request timed out.'))
      }, timeoutMs)
      pendingRef.current.set(requestId, { resolve, reject, timer })
      const message: Record<string, unknown> = {
        protocol: EMBED_BRIDGE_PROTOCOL,
        version: EMBED_BRIDGE_VERSION,
        type: 'request',
        requestId,
        action,
      }
      if (options.pluginId !== undefined) message.pluginId = options.pluginId
      if (options.command !== undefined) message.command = options.command
      if (options.catalogPage !== undefined) message.catalogPage = options.catalogPage
      port.postMessage(message)
    })
  }, [])

  const refreshInstalled = useCallback(async () => {
    setInstalledError('')
    try {
      const result = await sendRequest('installed')
      if (!result.ok || result.pluginIds === undefined || result.plugins === undefined) {
        throw new Error(result.error || 'Installed plugins are unavailable.')
      }
      setInstalledPluginIds([...new Set(result.pluginIds)].sort())
      setInstalledPlugins(result.plugins)
    } catch (error) {
      setInstalledError(error instanceof Error ? error.message : String(error))
    }
  }, [sendRequest])

  useEffect(() => {
    if (!connected) return
    void refreshInstalled()
  }, [connected, refreshInstalled])

  // The page hands over the full official command alongside the catalog id:
  // page and local endpoint read the same first-party catalog API, so the
  // endpoint forwards the command verbatim instead of re-fetching the
  // registry to re-derive it (issue #159's failure mode). Keeping the whole
  // command on the page side means the template can follow the official
  // CLI's evolution without a plugin release.
  const install = useCallback(async (pluginId: string, command?: string) => {
    setInstallActivity({
      kind: 'install',
      pluginId,
      command: command ?? null,
      state: 'running',
      error: null,
      stdout: '',
      stderr: '',
      startedAt: Date.now(),
    })
    let result: BridgeResult
    try {
      result = await sendRequest('install', { pluginId, command })
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    setInstallActivity((current) => current === null || current.pluginId !== pluginId ? current : {
      ...current,
      state: result.ok ? 'ok' : 'failed',
      error: result.ok ? null : result.error ?? 'Installation failed.',
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    })
    if (result.ok) {
      setInstalledPluginIds((current) => [...new Set([...(current ?? []), pluginId])].sort())
      void refreshInstalled()
    }
    return result
  }, [refreshInstalled, sendRequest])

  const uninstall = useCallback(async (pluginId: string) => {
    setInstallActivity({
      kind: 'uninstall',
      pluginId,
      command: null,
      state: 'running',
      error: null,
      stdout: '',
      stderr: '',
      startedAt: Date.now(),
    })
    let result: BridgeResult
    try {
      result = await sendRequest('uninstall', { pluginId })
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    setInstallActivity((current) => current === null || current.pluginId !== pluginId ? current : {
      ...current,
      state: result.ok ? 'ok' : 'failed',
      error: result.ok ? null : result.error ?? 'Uninstall failed.',
      command: result.command ?? current.command,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    })
    if (result.ok) {
      setInstalledPluginIds((current) => (current ?? []).filter((id) => id !== pluginId))
      void refreshInstalled()
    }
    return result
  }, [refreshInstalled, sendRequest])

  const clearInstallActivity = useCallback(() => setInstallActivity(null), [])

  // Short timeout and silent failure: an older local shell does not answer
  // status requests, and the console must degrade to command-only display.
  const bridgeStatus = useCallback(async () => {
    try {
      const result = await sendRequest('status', {}, 4000)
      return result.ok ? result.status ?? null : null
    } catch {
      return null
    }
  }, [sendRequest])

  const readCatalogPageCache = useCallback(async () => {
    const result = await sendRequest('catalog-cache-read')
    return result.ok ? result.catalogPage ?? null : null
  }, [sendRequest])

  const writeCatalogPageCache = useCallback(async (page: PluginsPage) => {
    const result = await sendRequest('catalog-cache-write', { catalogPage: page })
    if (!result.ok) throw new Error(result.error || 'Writing the local catalog cache failed.')
  }, [sendRequest])

  const value = useMemo(() => ({
    embedded,
    connected,
    activation,
    installedPluginIds,
    installedPlugins,
    installedError,
    refreshInstalled,
    install,
    uninstall,
    installActivity,
    clearInstallActivity,
    bridgeStatus,
    readCatalogPageCache,
    writeCatalogPageCache,
  }), [activation, bridgeStatus, clearInstallActivity, connected, embedded, install, installActivity, installedError, installedPluginIds, installedPlugins, readCatalogPageCache, refreshInstalled, uninstall, writeCatalogPageCache])
  return <EmbedBridgeContext.Provider value={value}>{children}</EmbedBridgeContext.Provider>
}

export function useEmbedBridge(): EmbedBridgeValue {
  return useContext(EmbedBridgeContext)
}
