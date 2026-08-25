export interface ReadmeLocation {
  owner: string
  repository: string
  branch: string
  basePath: string
}

function repositoryPath(location: ReadmeLocation): string {
  return [location.owner, location.repository].map(encodeURIComponent).join('/')
}

function relativePath(value: string, basePath: string): string {
  const root = new URL('https://readme.invalid/')
  const base = new URL(`${basePath.replace(/^\/+|\/+$/g, '')}${basePath ? '/' : ''}`, root)
  const resolved = new URL(value, base)
  return `${resolved.pathname.replace(/^\//, '')}${resolved.search}${resolved.hash}`
}

function externalUrl(value: string): string | undefined {
  if (/^https?:/i.test(value)) return value
  if (value.startsWith('//')) return `https:${value}`
  return undefined
}

/** Resolves README links the same way GitHub does, including `../` segments. */
export function readmeLink(href: string | undefined, location: ReadmeLocation): string | undefined {
  if (!href || href.startsWith('#') || /^mailto:/i.test(href)) return href
  const external = externalUrl(href)
  if (external) return external
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return undefined

  const path = relativePath(href, href.startsWith('/') ? '' : location.basePath)
  return `https://github.com/${repositoryPath(location)}/blob/${encodeURIComponent(location.branch)}/${path}`
}

/** Resolves relative README media to GitHub's raw content origin. */
export function readmeImage(src: string | undefined, location: ReadmeLocation): string | undefined {
  if (!src) return src
  const external = externalUrl(src)
  if (external) return external
  if (/^[a-z][a-z\d+.-]*:/i.test(src)) return undefined

  const path = relativePath(src, src.startsWith('/') ? '' : location.basePath)
  return `https://raw.githubusercontent.com/${repositoryPath(location)}/${encodeURIComponent(location.branch)}/${path}`
}
