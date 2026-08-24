import { CheckCircle2, ChevronDown, ChevronUp, LoaderCircle, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useEmbedBridge } from '../lib/embedBridge'
import { useI18n } from '../lib/i18n'

const POLL_INTERVAL_MS = 1200
const MAX_LOG_LINES = 40

/**
 * Live console for the one install the embedded store is running.
 *
 * Shows the exact official command being executed, streams the CLI's last
 * output line while it runs, and keeps the full captured stdout/stderr after
 * it ends — a failing install is debuggable from the page instead of a
 * spinner with no explanation.
 */
export function InstallConsole() {
  const { connected, installActivity, clearInstallActivity, bridgeStatus } = useEmbedBridge()
  const { t } = useI18n()
  const [lines, setLines] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const activityKey = installActivity === null ? '' : `${installActivity.pluginId}:${installActivity.startedAt}`
  const lastKeyRef = useRef(activityKey)

  // A new install resets the collected log.
  useEffect(() => {
    if (activityKey !== lastKeyRef.current) {
      lastKeyRef.current = activityKey
      setLines([])
      setExpanded(false)
    }
  }, [activityKey])

  useEffect(() => {
    if (installActivity?.state !== 'running') return
    let cancelled = false
    const timer = window.setInterval(() => {
      void bridgeStatus().then((status) => {
        if (cancelled || status === null || status.lastLine === '') return
        setLines((current) => current.at(-1) === status.lastLine
          ? current
          : [...current, status.lastLine].slice(-MAX_LOG_LINES))
      })
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [bridgeStatus, installActivity?.state])

  if (!connected || installActivity === null) return null

  const { kind, state, command, pluginId, error, stdout, stderr } = installActivity
  const finishedOutput = [stderr, stdout].filter((text) => text.trim().length > 0).join('\n')
  const showDetails = expanded && (finishedOutput.length > 0 || lines.length > 0)

  return (
    <aside className="install-console" data-state={state} aria-live="polite">
      <div className="install-console-head">
        {state === 'running' && <LoaderCircle className="install-console-spin" size={15} aria-hidden="true" />}
        {state === 'ok' && <CheckCircle2 size={15} aria-hidden="true" />}
        {state === 'failed' && <XCircle size={15} aria-hidden="true" />}
        <span className="install-console-title">
          {kind === 'uninstall'
            ? state === 'running' ? t('uninstallConsoleRunning') : state === 'ok' ? t('uninstallConsoleDone') : t('uninstallConsoleFailed')
            : state === 'running' ? t('installConsoleRunning') : state === 'ok' ? t('installConsoleDone') : t('installConsoleFailed')}
          {' · '}
          {pluginId}
        </span>
        <button
          type="button"
          className="install-console-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
          <span>{t('installConsoleDetails')}</span>
        </button>
        {state !== 'running' && (
          <button
            type="button"
            className="install-console-close"
            onClick={clearInstallActivity}
            aria-label={t('installConsoleClose')}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {command !== null && <code className="install-console-command">{command}</code>}
      {state === 'running' && lines.length > 0 && (
        <p className="install-console-live">{lines.at(-1)}</p>
      )}
      {state === 'ok' && (
        <p className="install-console-hint">{t('consoleRestartHint')}</p>
      )}
      {state === 'failed' && error !== null && (
        <p className="install-console-error">{error}</p>
      )}
      {showDetails && (
        <pre className="install-console-log">
          {(finishedOutput || lines.join('\n')).trim()}
        </pre>
      )}
    </aside>
  )
}
