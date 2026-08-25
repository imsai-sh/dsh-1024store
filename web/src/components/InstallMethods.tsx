import type { PluginInstallMethod } from '../../worker/lib/install-methods'
import { isSelfPlugin, SELF_OFFICIAL_COMMAND, SELF_TRACKED_COMMAND } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { InstallCommand } from './InstallCommand'
import { BridgeInstallButton } from './BridgeInstallButton'
import { useEmbedBridge } from '../lib/embedBridge'

/**
 * The install methods a plugin offers, each with what the catalog actually
 * knows about it, and under each one the two ways to run it.
 *
 * Only npm methods are offered: source installs are no longer an install
 * method, so a github method still present in a pre-switch snapshot is
 * filtered out here rather than rendered. The two rows under each method
 * decide *how* you invoke the official CLI — through the wrapper, which
 * counts the install, or directly. The wrapper forwards its arguments
 * verbatim, so both rows install exactly the same thing.
 *
 * The badges describe installability only — never the plugin's quality or
 * safety.
 */
export function InstallMethods({ methods, pluginId }: {
  methods: PluginInstallMethod[]
  pluginId: string
}) {
  const { t } = useI18n()
  const { connected } = useEmbedBridge()
  // npm only, one card per package: v1-shaped data may duplicate the npm
  // method under both legacy verdict codes (withLegacyNpmCodeAliases), and a
  // pre-switch snapshot may still carry a github method.
  const offered = methods
    .filter((method) => method.kind === 'npm')
    .filter((method, index, list) => list.findIndex((other) => other.spec === method.spec) === index)
  if (offered.length === 0) return null
  // The store's own entry installs from its published package, not from a spec
  // pointing at this catalog repository.
  const selfPlugin = isSelfPlugin({ id: pluginId })

  if (connected) {
    const preferred = offered[0]!
    const status = preferred.verification === 'verified'
      ? t('installVerified')
      : preferred.verification === 'unverified'
        ? t('installUnverified')
        : t('installChecking')
    return (
      <div className="bridge-install-panel">
        <BridgeInstallButton pluginId={pluginId} command={preferred.command} />
        <p>npm · {status}</p>
      </div>
    )
  }

  return (
    <div className="install-methods">
      {offered.map((method, index) => {
        const preferred = index === 0
        const label = method.verification === 'verified'
          ? t('installVerified')
          : method.verification === 'unverified'
            ? t('installUnverified')
            : t('installChecking')
        const hint = method.verification === 'verified'
          ? t('installVerifiedHint')
          : method.verification === 'unverified'
            ? t('installUnverifiedHint')
            : t('installCheckingHint')
        return (
          <div className="install-method" key={`${method.kind}-${method.spec}`}>
            <div className="install-method-head">
              <span className="install-method-kind">npm</span>
              <span
                className={`install-badge install-badge-${method.verification}`}
                title={hint}
              >
                {label}
              </span>
            </div>
            <div className="install-options">
              <div className={`install-option${preferred ? ' install-option-recommended' : ''}`}>
                {preferred
                  ? <span className="install-option-badge">{t('recommendedInstall')}</span>
                  : <span className="install-option-label">{t('trackedCliCommand')}</span>}
                <InstallCommand
                  command={selfPlugin ? SELF_TRACKED_COMMAND : method.command.replace(/^dsh\b/, 'dsh1024')}
                  prominent={preferred}
                />
                {preferred && <p className="install-benefits">{t('installBenefitsLine')}</p>}
                {preferred && <p className="install-first-run">{t('installFirstRunHint')}</p>}
              </div>
              <div className="install-option install-option-official">
                <span className="install-option-label">{t('officialCliCommand')}</span>
                <InstallCommand command={selfPlugin ? SELF_OFFICIAL_COMMAND : method.command} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
