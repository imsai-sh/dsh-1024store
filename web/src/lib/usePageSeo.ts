import { useEffect } from 'react'
import { SITE_IMAGE, SITE_NAME, SITE_ORIGIN } from '../../worker/seo-templates'
import type { Language } from './api'

export { SITE_ORIGIN } from '../../worker/seo-templates'

interface PageSeoOptions {
  title: string
  description: string
  path: string
  language: Language
  robots?: 'index,follow' | 'noindex,follow'
  schema?: object | null
  /**
   * False while the page is still resolving its data. The Worker already
   * stamped correct metadata into the served HTML, so overwriting it with a
   * loading-state placeholder is strictly worse than leaving it alone — a
   * crawler that snapshots the DOM mid-flight would record the placeholder.
   *
   * Only the data-derived half is withheld. `robots` and `canonical` follow
   * from the URL alone, so they are always applied: a client-side filter has to
   * take effect even if the catalog request never finishes.
   */
  ready?: boolean
  /** null removes the canonical link, which is what a noindexed view wants. */
  canonical?: string | null
}

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.append(element)
  }
  element.content = content
}

function setCanonical(url: string | null) {
  const element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!url) {
    element?.remove()
    return
  }
  if (element) {
    element.href = url
    return
  }
  const created = document.createElement('link')
  created.rel = 'canonical'
  created.href = url
  document.head.append(created)
}

export function usePageSeo({
  title,
  description,
  path,
  language,
  robots = 'index,follow',
  schema = null,
  ready = true,
  canonical,
}: PageSeoOptions) {
  const schemaJson = schema ? JSON.stringify(schema) : ''
  const canonicalOverride = canonical === undefined ? undefined : canonical

  useEffect(() => {
    const resolved = canonicalOverride === undefined
      ? new URL(path, SITE_ORIGIN).toString()
      : canonicalOverride
    const locale = language === 'zh' ? 'zh_CN' : 'en_US'

    // URL-derived directives first, unconditionally.
    setCanonical(resolved)
    setMeta('name', 'robots', robots)
    if (!ready) return

    document.title = title
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    setMeta('name', 'description', description)
    setMeta('property', 'og:type', 'website')
    setMeta('property', 'og:site_name', SITE_NAME)
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    if (resolved) setMeta('property', 'og:url', resolved)
    setMeta('property', 'og:image', SITE_IMAGE)
    setMeta('property', 'og:image:alt', SITE_NAME)
    setMeta('property', 'og:locale', locale)
    setMeta('name', 'twitter:card', 'summary_large_image')
    setMeta('name', 'twitter:title', title)
    setMeta('name', 'twitter:description', description)
    setMeta('name', 'twitter:image', SITE_IMAGE)

    // Two different leftovers can be sitting in the head here. The Worker's own
    // node is correct for this URL and must survive a view that has no schema of
    // its own. A node this hook wrote for a *previous* view is stale the moment
    // the router moves, so it has to go — otherwise /docs/api reached in-app
    // keeps the homepage's CollectionPage graph.
    let schemaElement = document.head.querySelector<HTMLScriptElement>('script[data-seo-schema]')
    if (!schemaJson) {
      if (schemaElement?.dataset.seoSchema === 'client') schemaElement.remove()
      return
    }
    if (!schemaElement) {
      schemaElement = document.createElement('script')
      schemaElement.type = 'application/ld+json'
      document.head.append(schemaElement)
    }
    schemaElement.dataset.seoSchema = 'client'
    schemaElement.textContent = schemaJson
  }, [canonicalOverride, description, language, path, ready, robots, schemaJson, title])
}
