import { Code2 } from 'lucide-react'
import { useEmbedBridge } from '../lib/embedBridge'
import { useI18n } from '../lib/i18n'

/**
 * Shown in the install section when a plugin cannot be installed from the
 * store: only published npm packages are offered, and this plugin has none.
 * The repository link keeps the plugin reachable — listed, linked, just not
 * installable here.
 *
 * Inside the embedded store the one-click install button's place is taken by
 * a "source install" button that opens the repository, so the panel keeps a
 * primary action instead of a dead end.
 */
export function InstallUnavailable({ repositoryUrl }: { repositoryUrl: string }) {
  const { t } = useI18n()
  const { connected } = useEmbedBridge()

  if (connected) {
    return (
      <div className="bridge-install-panel">
        <a
          className="button button-secondary"
          href={repositoryUrl}
          target="_blank"
          rel="noreferrer"
        >
          <Code2 size={16} aria-hidden="true" />
          <span>{t('sourceInstall')}</span>
        </a>
        <p>{t('installUnavailableBody')}</p>
      </div>
    )
  }

  return (
    <div className="install-unavailable">
      <p>{t('installUnavailableBody')}</p>
      <a href={repositoryUrl} target="_blank" rel="noopener noreferrer">
        {t('installUnavailableRepoLink')}
      </a>
    </div>
  )
}
