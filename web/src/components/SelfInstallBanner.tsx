import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  getSelfInstallStats,
  SELF_OFFICIAL_COMMAND,
  SELF_TRACKED_COMMAND,
  type InstallMetrics,
} from '../lib/api'
import { formatNumber } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { useEmbedBridge } from '../lib/embedBridge'
import { InstallCommand } from './InstallCommand'

// Module-level cache so the catalog's 5-minute auto reload (which remounts the
// page content) does not refetch the self install stats on every cycle.
let cachedStats: InstallMetrics | null | undefined

export function SelfInstallBanner() {
  const { embedded } = useEmbedBridge()
  const { language, t } = useI18n()
  const [stats, setStats] = useState<InstallMetrics | null>(cachedStats ?? null)

  useEffect(() => {
    if (embedded || cachedStats !== undefined) return
    const controller = new AbortController()
    getSelfInstallStats(controller.signal)
      .then((value) => {
        cachedStats = value
        if (value) setStats(value)
      })
      // Failures (network errors, unmount aborts) stay silent: the count keeps
      // showing the "--" placeholder.
      .catch(() => {})
    return () => controller.abort()
  }, [embedded])

  // Compact hero strip: a one-line invitation with both install commands and a
  // small install-count badge; the hero stays the shared home of both views.
  if (embedded) return null

  return (
    <aside className="self-install-banner" aria-labelledby="self-install-heading">
      <div className="self-install-copy">
        <h2 id="self-install-heading">{t('selfInstallTitle')}</h2>
        <span className="self-install-count" title={t('installOperations')}>
          <Download size={12} aria-hidden="true" />
          {stats ? formatNumber(stats.installCount ?? 0, language) : '--'}
        </span>
      </div>
      <div className="self-install-commands">
        <div className="self-install-recommended">
          <span className="install-option-badge">{t('recommendedInstall')}</span>
          <InstallCommand command={SELF_TRACKED_COMMAND} />
        </div>
        <div className="self-install-official">
          <span className="install-option-label">{t('officialCliCommand')}</span>
          <InstallCommand command={SELF_OFFICIAL_COMMAND} />
        </div>
      </div>
    </aside>
  )
}
