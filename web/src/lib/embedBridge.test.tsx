// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMBED_BRIDGE_PROTOCOL,
  EMBED_BRIDGE_VERSION,
  EmbedBridgeProvider,
  useEmbedBridge,
} from './embedBridge'

function Probe() {
  const bridge = useEmbedBridge()
  return (
    <>
      <output data-testid="installed">{bridge.installedPluginIds?.join(',') ?? 'loading'}</output>
      <output data-testid="activation">{bridge.activation}</output>
      <button
        type="button"
        data-connected={bridge.connected}
        onClick={() => {
          void bridge.install('owner/repository').then((result) => {
            document.body.dataset.result = JSON.stringify(result)
          })
        }}
      >
        install
      </button>
    </>
  )
}

function fakePort() {
  return {
    close: vi.fn(),
    postMessage: vi.fn(),
    start: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
  }
}

describe('EmbedBridgeProvider', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    delete document.body.dataset.result
    window.history.replaceState({}, '', '/embed/store?bridge=dsh1024-v1')
    let request = 0
    vi.stubGlobal('crypto', { randomUUID: () => `request-${++request}` })
  })

  it('accepts one parent-owned port and sends only a structured install intent', async () => {
    const root = createRoot(document.getElementById('root')!)
    await act(async () => {
      root.render(<EmbedBridgeProvider><Probe /></EmbedBridgeProvider>)
    })
    const button = document.querySelector('button')!
    expect(button.dataset.connected).toBe('false')

    const ignored = fakePort()
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { protocol: EMBED_BRIDGE_PROTOCOL, version: EMBED_BRIDGE_VERSION, type: 'connect' },
        ports: [ignored as unknown as MessagePort],
      }))
    })
    expect(ignored.start).not.toHaveBeenCalled()

    const port = fakePort()
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { protocol: EMBED_BRIDGE_PROTOCOL, version: EMBED_BRIDGE_VERSION, type: 'connect' },
        source: window,
        ports: [port as unknown as MessagePort],
      }))
    })
    expect(button.dataset.connected).toBe('true')
    expect(port.start).toHaveBeenCalledOnce()
    expect(port.postMessage).toHaveBeenCalledWith({
      protocol: EMBED_BRIDGE_PROTOCOL,
      version: EMBED_BRIDGE_VERSION,
      type: 'ready',
      capabilities: ['install', 'installed', 'catalog-cache', 'status', 'uninstall'],
    })

    expect(port.postMessage).toHaveBeenLastCalledWith({
      protocol: EMBED_BRIDGE_PROTOCOL,
      version: EMBED_BRIDGE_VERSION,
      type: 'request',
      requestId: 'request-1',
      action: 'installed',
    })

    await act(async () => {
      port.onmessage?.(new MessageEvent('message', {
        data: {
          protocol: EMBED_BRIDGE_PROTOCOL,
          version: EMBED_BRIDGE_VERSION,
          type: 'activate',
        },
      }))
    })
    expect(document.querySelector('[data-testid="activation"]')?.textContent).toBe('1')

    await act(async () => {
      port.onmessage?.(new MessageEvent('message', {
        data: {
          type: 'result',
          requestId: 'request-1',
          ok: true,
          pluginIds: ['owner/already-installed'],
          plugins: [{
            id: 'owner/already-installed',
            name: 'already-installed',
            owner: 'owner',
            url: 'https://github.com/owner/already-installed',
            category: 'tools',
            categoryLabel: { en: 'Tools', zh: '工具' },
            description: { en: 'Installed plugin', zh: '已安装插件' },
            install: 'dsh plugin add github:owner/already-installed',
            added: '2026-01-01',
            stars: 10,
          }],
        },
      }))
    })
    expect(document.querySelector('[data-testid="installed"]')?.textContent).toBe('owner/already-installed')

    await act(async () => { button.click() })
    expect(port.postMessage).toHaveBeenLastCalledWith({
      protocol: EMBED_BRIDGE_PROTOCOL,
      version: EMBED_BRIDGE_VERSION,
      type: 'request',
      requestId: 'request-2',
      action: 'install',
      pluginId: 'owner/repository',
    })

    await act(async () => {
      port.onmessage?.(new MessageEvent('message', {
        data: { type: 'result', requestId: 'request-2', ok: true },
      }))
    })
    expect(document.body.dataset.result).toBe('{"ok":true}')
    expect(document.querySelector('[data-testid="installed"]')?.textContent).toBe(
      'owner/already-installed,owner/repository',
    )
  })
})
