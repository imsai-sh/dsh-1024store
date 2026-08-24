import { Check, ChevronDown, Code2, Copy } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { installOffered, officialInstallCommand, trackedInstallCommand, type RegistryPlugin } from '../lib/api'
import { pluginSourceUrl } from '../../worker/lib/plugin-id'
import { useI18n } from '../lib/i18n'
import { useEmbedBridge } from '../lib/embedBridge'
import { BridgeInstallButton } from './BridgeInstallButton'

type Kind = 'tracked' | 'official'

interface Placement {
  top: number
  left: number
}

// Distance kept between the menu and every viewport edge.
const VIEWPORT_MARGIN = 8
// The menu overlaps the toggle slightly, the way the anchored version did.
const ANCHOR_OVERLAP = 6

export function SplitInstallButton({ plugin }: { plugin: Pick<RegistryPlugin, 'id' | 'install' | 'url'> }) {
  const { t } = useI18n()
  const { connected, installedPluginIds } = useEmbedBridge()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<Kind | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(null), 1800)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const closeMenu = useCallback(() => {
    setOpen(false)
    setPlacement(null)
  }, [])

  // The menu renders into document.body, so no ancestor's overflow or stacking
  // context can clip or cover it. In exchange it cannot follow its anchor on its
  // own: place it under the toggle, flip above when the viewport bottom is too
  // close, clamp both axes inside the viewport, and recompute while scrolling.
  const updatePlacement = useCallback(() => {
    const menu = menuRef.current
    const toggle = toggleRef.current
    if (!menu || !toggle) return
    const anchor = toggle.getBoundingClientRect()
    if (anchor.bottom <= 0 || anchor.top >= window.innerHeight) {
      closeMenu()
      return
    }
    const { height, width } = menu.getBoundingClientRect()

    let top = anchor.bottom - ANCHOR_OVERLAP
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      const flipped = anchor.top - height + ANCHOR_OVERLAP
      top = flipped >= VIEWPORT_MARGIN
        ? flipped
        : Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
    }

    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN
    const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.right - width, maxLeft))

    setPlacement({ left: Math.round(left), top: Math.round(top) })
  }, [closeMenu])

  useLayoutEffect(() => {
    if (!open) return
    updatePlacement()
  }, [open, updatePlacement])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeMenu()
        toggleRef.current?.focus()
      }
    }
    // A fixed menu cannot follow its anchor on its own; keep it pinned to the
    // toggle while the page scrolls or resizes.
    function onViewportChange() {
      updatePlacement()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [closeMenu, open, updatePlacement])

  async function copy(kind: Kind) {
    const command = kind === 'tracked' ? trackedInstallCommand(plugin) : officialInstallCommand(plugin)
    await navigator.clipboard.writeText(command)
    setCopied(kind)
    closeMenu()
  }

  function onMenuKeyDown(event: ReactKeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length
    items[next]?.focus()
  }

  // Browse-only plugin: only npm installs are offered and this plugin has
  // none, so there is no command to copy and no local install to trigger.
  // Inside the embedded store the one-click button's place is taken by a
  // source-install link so the row keeps an action; on the site the empty
  // span keeps the grid cell, matching a command-less repository row.
  // Placed after the hooks so the hook order never varies.
  if (!installOffered(plugin)) {
    if (connected) {
      // Already installed (from source, before npm-only): the row says so —
      // offering "install from source" on something that is already on the
      // machine would be absurd. BridgeInstallButton renders the disabled
      // installed state for it.
      if (installedPluginIds?.includes(plugin.id)) {
        return (
          <div className="split-install">
            <BridgeInstallButton pluginId={plugin.id} className="split-install-main bridge-local-install" />
          </div>
        )
      }
      return (
        <div className="split-install">
          <a
            className="split-install-main bridge-source-install"
            href={pluginSourceUrl(plugin.id, plugin.url)}
            target="_blank"
            rel="noreferrer"
            aria-label={t('sourceInstall')}
            title={t('sourceInstall')}
          >
            <Code2 size={16} aria-hidden="true" />
            <span>{t('sourceInstall')}</span>
          </a>
        </div>
      )
    }
    return <span />
  }

  const menu = open ? createPortal(
    <div
      className="split-install-menu"
      ref={menuRef}
      role="menu"
      aria-label={t('installOptionsMenu')}
      onKeyDown={onMenuKeyDown}
      // Rendered offscreen for the measuring pass, then placed before paint.
      style={placement
        ? { left: `${placement.left}px`, top: `${placement.top}px` }
        : { left: '0px', top: '0px', visibility: 'hidden' }}
    >
      <button type="button" role="menuitem" ref={(el) => { itemRefs.current[0] = el }} onClick={() => copy('tracked')}>
        <span className="split-menu-badge">{t('recommendedInstall')}</span>
        <code>{trackedInstallCommand(plugin)}</code>
        {copied === 'tracked' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      <button type="button" role="menuitem" ref={(el) => { itemRefs.current[1] = el }} onClick={() => copy('official')}>
        <span className="split-menu-label">{t('officialCliCommand')}</span>
        <code>{officialInstallCommand(plugin)}</code>
        {copied === 'official' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </div>,
    document.body,
  ) : null

  if (connected) {
    return (
      <div className="split-install">
        <BridgeInstallButton
          pluginId={plugin.id}
          command={officialInstallCommand(plugin)}
          className="split-install-main bridge-local-install"
        />
      </div>
    )
  }

  return (
    <div className="split-install" ref={rootRef}>
      <button
        type="button"
        className="split-install-main icon-button"
        onClick={() => copy('tracked')}
        aria-label={copied === 'tracked' ? t('copied') : t('copyRecommendedCommand')}
        title={copied === 'tracked' ? t('copied') : t('copyRecommendedCommand')}
      >
        {copied === 'tracked' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      </button>
      <button
        type="button"
        ref={toggleRef}
        className="split-install-toggle icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('installOptionsMenu')}
        onClick={() => (open ? closeMenu() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
            window.setTimeout(() => itemRefs.current[0]?.focus(), 0)
          }
        }}
      >
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {menu}
    </div>
  )
}
