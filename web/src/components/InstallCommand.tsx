import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n'

export function InstallCommand({
  command,
  prominent = false,
  compact = false,
}: {
  command: string
  prominent?: boolean
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const { t } = useI18n()

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timeout)
  }, [copied])

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      // Clipboard API can be missing or denied (e.g. sandboxed iframes);
      // fall back to the legacy selection-based copy.
      const helper = document.createElement('textarea')
      helper.value = command
      document.body.append(helper)
      helper.select()
      document.execCommand('copy')
      helper.remove()
    }
    setCopied(true)
  }

  return (
    <div className={`install-command${prominent ? ' install-command-prominent' : ''}${compact ? ' install-command-compact' : ''}`}>
      {!compact && (
        <>
          <span className="install-prompt" aria-hidden="true">$</span>
          <code>{command}</code>
        </>
      )}
      <button
        type="button"
        className="icon-button"
        onClick={copyCommand}
        aria-label={copied ? t('copied') : t('copy')}
        title={copied ? t('copied') : t('copy')}
      >
        {copied ? <Check size={compact ? 15 : 17} aria-hidden="true" /> : <Copy size={compact ? 15 : 17} aria-hidden="true" />}
      </button>
    </div>
  )
}
