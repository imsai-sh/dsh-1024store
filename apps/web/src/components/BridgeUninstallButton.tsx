import { Check, LoaderCircle, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useEmbedBridge } from '../lib/embedBridge'
import { useI18n } from '../lib/i18n'

/**
 * One-click uninstall for the installed-plugins tab of the embedded store.
 *
 * Uninstalls by catalog id; the local endpoint resolves the actual package
 * name, which never reaches the page. The install console shows the executed
 * command and its output, same as installs. The store's own package cannot be
 * uninstalled here — the local endpoint refuses it — so its row keeps the
 * disabled installed state instead of a live trigger.
 */
export function BridgeUninstallButton({
  pluginId,
  className = 'split-install-main bridge-uninstall',
}: {
  pluginId: string
  className?: string
}) {
  const { uninstall } = useEmbedBridge()
  const { t } = useI18n()
  const [state, setState] = useState<'idle' | 'removing' | 'removed' | 'failed'>('idle')
  const [error, setError] = useState('')

  async function runUninstall() {
    setState('removing')
    setError('')
    try {
      const result = await uninstall(pluginId)
      if (!result.ok) throw new Error(result.error || t('bridgeUninstallFailed'))
      setState('removed')
    } catch (uninstallError) {
      setError(uninstallError instanceof Error ? uninstallError.message : String(uninstallError))
      setState('failed')
    }
  }

  const label = state === 'removing'
    ? t('bridgeUninstalling')
    : state === 'removed'
      ? t('bridgeUninstalled')
      : state === 'failed'
        ? t('retry')
        : t('bridgeUninstall')
  const Icon = state === 'removing' ? LoaderCircle : state === 'removed' ? Check : Trash2

  return (
    <button
      type="button"
      className={`${className}${state === 'removing' ? ' is-busy' : ''}`}
      data-state={state}
      onClick={runUninstall}
      disabled={state === 'removing' || state === 'removed'}
      aria-label={label}
      title={error || label}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}
