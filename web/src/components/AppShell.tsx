import { ExternalLink } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { publicAsset } from '../lib/assets'
import { FloatingNav } from './FloatingNav'
import { InstallConsole } from './InstallConsole'
import { KanbanGirl } from './KanbanGirl'
import { useEmbedBridge } from '../lib/embedBridge'

export function AppShell() {
  const { t } = useI18n()
  const { embedded } = useEmbedBridge()

  if (embedded) {
    return (
      <div className="embedded-site-shell">
        <Outlet />
        <InstallConsole />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <a
        className="fish-pocket-banner"
        href="https://github.com/imsai-sh/fish-pocket"
        target="_blank"
        rel="noreferrer"
        aria-label={t('fishPocketBannerAria')}
      >
        <span className="fish-pocket-banner-inner">
          <span className="fish-pocket-banner-message">
            <img
              className="fish-pocket-banner-icon"
              src={publicAsset('github-mark.svg')}
              alt=""
              aria-hidden="true"
            />
            <strong>Fish Pocket</strong>
            <span className="fish-pocket-banner-separator" aria-hidden="true">/</span>
            <span className="fish-pocket-banner-copy">{t('fishPocketBannerCopy')}</span>
            <span className="fish-pocket-banner-separator fish-pocket-banner-domain-separator" aria-hidden="true">·</span>
            <span className="fish-pocket-banner-domain">
              <span className="fish-pocket-banner-domain-label">GitHub</span>
              <ExternalLink size={14} aria-hidden="true" />
            </span>
          </span>
        </span>
      </a>

      <main>
        <Outlet />
      </main>

      <div className="site-bottom-link">
        <p>{t('unofficialNotice')}</p>
        <a href="https://www.deepseek.com/harness/" target="_blank" rel="noreferrer">
          {t('officialHarness')}
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>

      <FloatingNav />
      <KanbanGirl />
    </div>
  )
}
