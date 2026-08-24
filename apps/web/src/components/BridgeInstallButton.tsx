import { Check, Download, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useEmbedBridge } from '../lib/embedBridge'
import { useI18n } from '../lib/i18n'

/**
 * One-click install button for the embedded store.
 *
 * A single click installs — no blocking confirmation anywhere: the local
 * shell's `window.confirm` used to freeze the whole flow when the host
 * suppressed the native dialog. The install console shows the exact command
 * and its output while the install runs, which is where accountability
 * lives now.
 */
export function BridgeInstallButton({
  pluginId,
  command,
  className = 'button button-primary',
  iconOnly = false,
}: {
  pluginId: string
  /** Full official install command; the local endpoint forwards it verbatim. */
  command?: string
  className?: string
  iconOnly?: boolean
}) {
  const { install, installedPluginIds } = useEmbedBridge()
  const { t } = useI18n()
  const [state, setState] = useState<'idle' | 'installing' | 'installed' | 'failed'>('idle')
  const [error, setError] = useState('')

  const alreadyInstalled = installedPluginIds?.includes(pluginId) === true

  async function runInstall() {
    setState('installing')
    setError('')
    try {
      const result = await install(pluginId, command)
      if (!result.ok) throw new Error(result.error || t('bridgeInstallFailed'))
      setState('installed')
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError))
      setState('failed')
    }
  }

  const label = state === 'installing'
    ? t('bridgeInstalling')
    : alreadyInstalled || state === 'installed'
      ? t('bridgeInstalled')
      : state === 'failed'
        ? t('retry')
        : t('bridgeInstall')
  const Icon = state === 'installing' ? LoaderCircle : alreadyInstalled || state === 'installed' ? Check : Download

  return (
    <button
      type="button"
      className={`${className}${state === 'installing' ? ' is-busy' : ''}`}
      data-state={alreadyInstalled ? 'installed' : state}
      onClick={runInstall}
      disabled={state === 'installing' || alreadyInstalled}
      aria-label={label}
      title={error || command || label}
    >
      <Icon size={iconOnly ? 15 : 16} aria-hidden="true" />
      {!iconOnly && <span>{label}</span>}
    </button>
  )
}
