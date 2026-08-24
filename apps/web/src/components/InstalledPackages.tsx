import { AlertCircle, PackageCheck, RefreshCw, Search } from 'lucide-react'
import { useMemo } from 'react'
import type { CatalogPlugin, CategoryResult } from '../lib/api'
import type { BridgeInstalledPlugin } from '../lib/embedBridge'
import { useEmbedBridge } from '../lib/embedBridge'
import { useI18n } from '../lib/i18n'
import { LoadingState } from './LoadingState'
import { PackageRow } from './PackageRow'

function catalogPluginFromBridge(plugin: BridgeInstalledPlugin): CatalogPlugin {
  return {
    id: plugin.id,
    name: plugin.name,
    owner: plugin.owner,
    url: plugin.url,
    category: plugin.category,
    description: plugin.description,
    install: plugin.install,
    added: plugin.added,
    repository: plugin.id.split('/')[1] ?? plugin.name,
    stars: plugin.stars,
    forks: null,
    pushedAt: null,
    updatedAt: null,
    latestReleaseAt: null,
    growth24h: null,
    growth7d: null,
    growth30d: null,
  }
}

export function InstalledPackages({ query }: { query: string }) {
  const { language, t } = useI18n()
  const {
    installedPluginIds,
    installedPlugins,
    installedError,
    refreshInstalled,
  } = useEmbedBridge()
  const plugins = useMemo(
    () => installedPlugins?.map(catalogPluginFromBridge) ?? null,
    [installedPlugins],
  )

  const categories = useMemo(() => {
    const result = new Map<string, CategoryResult>()
    for (const plugin of plugins ?? []) {
      if (!plugin.category || result.has(plugin.category)) continue
      const bridgePlugin = installedPlugins?.find(item => item.id === plugin.id)
      result.set(plugin.category, {
        id: plugin.category,
        en: bridgePlugin?.categoryLabel.en ?? plugin.category,
        zh: bridgePlugin?.categoryLabel.zh ?? plugin.category,
        count: 1,
      })
    }
    return result
  }, [installedPlugins, plugins])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(language === 'zh' ? 'zh-CN' : 'en-US')
    if (!needle) return plugins ?? []
    return (plugins ?? []).filter(plugin => [
      plugin.name,
      plugin.owner,
      plugin.id,
      plugin.description[language],
    ].some(value => value?.toLocaleLowerCase(language === 'zh' ? 'zh-CN' : 'en-US').includes(needle)))
  }, [language, plugins, query])

  if (installedPluginIds === null) return <LoadingState rows={3} />

  if (installedError && installedPlugins === null) {
    return (
      <div className="state-panel" role="alert">
        <AlertCircle size={27} aria-hidden="true" />
        <h3>{t('installedLoadError')}</h3>
        <p>{installedError}</p>
        <button className="button button-secondary" type="button" onClick={() => void refreshInstalled()}>
          <RefreshCw size={15} aria-hidden="true" />
          {t('retry')}
        </button>
      </div>
    )
  }

  if (plugins === null) return <LoadingState rows={Math.min(installedPluginIds.length, 5)} />

  if (visible.length === 0) {
    return (
      <div className="state-panel">
        {query ? <Search size={27} aria-hidden="true" /> : <PackageCheck size={27} aria-hidden="true" />}
        <h3>{t(query ? 'emptyTitle' : 'installedEmptyTitle')}</h3>
        <p>{t(query ? 'emptyBody' : 'installedEmptyBody')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="package-list installed-list">
        {visible.map((plugin, index) => (
          <PackageRow
            key={plugin.id}
            plugin={plugin}
            category={categories.get(plugin.category)}
            index={index}
            uninstallable
          />
        ))}
      </div>
    </>
  )
}
