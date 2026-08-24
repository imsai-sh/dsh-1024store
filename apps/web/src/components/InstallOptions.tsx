import { officialInstallCommand, trackedInstallCommand, type RegistryPlugin } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { InstallCommand } from './InstallCommand'
import { BridgeInstallButton } from './BridgeInstallButton'
import { useEmbedBridge } from '../lib/embedBridge'

export function InstallOptions({ plugin }: { plugin: Pick<RegistryPlugin, 'id' | 'install'> }) {
  const { t } = useI18n()
  const { connected } = useEmbedBridge()

  if (connected) {
    return <BridgeInstallButton pluginId={plugin.id} command={officialInstallCommand(plugin)} />
  }
  return (
    <div className="install-options">
      <div className="install-option install-option-recommended">
        <span className="install-option-badge">{t('recommendedInstall')}</span>
        <InstallCommand command={trackedInstallCommand(plugin)} prominent />
        <p className="install-benefits">{t('installBenefitsLine')}</p>
        <p className="install-first-run">{t('installFirstRunHint')}</p>
      </div>
      <div className="install-option install-option-official">
        <span className="install-option-label">{t('officialCliCommand')}</span>
        <InstallCommand command={officialInstallCommand(plugin)} />
      </div>
    </div>
  )
}
