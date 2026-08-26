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
        className="mydsh-banner"
        href="https://mydsh.run/"
        target="_blank"
        rel="noreferrer"
        aria-label={t('mydshBannerAria')}
      >
        <span className="mydsh-banner-inner">
          <span className="mydsh-banner-message">
            <img
              className="mydsh-banner-icon"
              src={publicAsset('mydsh-icon.svg')}
              alt=""
              aria-hidden="true"
            />
            <strong>MyDSH</strong>
            <span className="mydsh-banner-separator" aria-hidden="true">/</span>
            <span className="mydsh-banner-copy">{t('mydshBannerCopy')}</span>
            <span className="mydsh-banner-separator" aria-hidden="true">·</span>
            <span className="mydsh-banner-domain">
              mydsh.run
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
