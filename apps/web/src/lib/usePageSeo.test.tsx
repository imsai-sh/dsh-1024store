// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePageSeo } from './usePageSeo'

function seedServerMetadata() {
  document.head.innerHTML = `
    <title>Server title</title>
    <meta name="description" content="Server description" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="https://deepseek1024.com/plugins/acme/widget" />
    <script type="application/ld+json" data-seo-schema>{"@type":"WebPage"}</script>
  `
}

function render(options: Parameters<typeof usePageSeo>[0]) {
  function Probe() {
    usePageSeo(options)
    return null
  }
  const container = document.createElement('div')
  document.body.append(container)
  act(() => {
    createRoot(container).render(<Probe />)
  })
}

describe('usePageSeo', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    seedServerMetadata()
  })

  it('leaves the server-rendered copy alone until the page has its data', () => {
    render({
      title: 'Loading placeholder',
      description: 'Loading placeholder description',
      path: '/plugins/acme/widget',
      language: 'en',
      ready: false,
    })

    expect(document.title).toBe('Server title')
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content'))
      .toBe('Server description')
    expect(document.querySelector('script[data-seo-schema]')?.textContent)
      .toBe('{"@type":"WebPage"}')
  })

  it('still applies the URL-derived directives while the data is pending', () => {
    // A client-side filter must take effect even if the catalog request never
    // finishes; robots and canonical follow from the URL, not from the data.
    render({
      title: 'Loading placeholder',
      description: 'Loading placeholder description',
      path: '/plugins',
      language: 'en',
      robots: 'noindex,follow',
      canonical: null,
      ready: false,
    })

    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content'))
      .toBe('noindex,follow')
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
  })

  it('keeps the server-rendered schema when the client has none to add', () => {
    render({
      title: 'Client title',
      description: 'Client description',
      path: '/plugins/acme/widget',
      language: 'en',
      schema: null,
    })

    expect(document.title).toBe('Client title')
    expect(document.querySelector('script[data-seo-schema]')?.textContent)
      .toBe('{"@type":"WebPage"}')
  })

  it('drops the canonical link when the view asks for none', () => {
    render({
      title: 'Filtered catalog',
      description: 'Filtered catalog description',
      path: '/plugins',
      language: 'en',
      robots: 'noindex,follow',
      canonical: null,
    })

    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content'))
      .toBe('noindex,follow')
  })
})
