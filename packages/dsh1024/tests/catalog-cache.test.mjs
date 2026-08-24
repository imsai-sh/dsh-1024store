import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isCatalogPage,
  readCatalogPageCache,
  writeCatalogPageCache,
} from '../lib/catalog-cache.js'

const page = {
  plugins: [{
    id: 'owner/repository',
    name: 'repository',
    owner: 'owner',
    url: 'https://github.com/owner/repository',
    category: 'tools',
    description: { en: 'Plugin', zh: '插件' },
  }],
  page: 1,
  limit: 100,
  total: 1,
  totalPages: 1,
  catalogTotal: 1,
  categories: [{ id: 'tools', en: 'Tools', zh: '工具', count: 1 }],
  generatedAt: '2026-08-20T00:00:00.000Z',
  source: 'd1',
}

test('the embedded catalog page cache is plugin-owned, atomic, and reusable', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh1024-page-cache-'))
  try {
    assert.equal(isCatalogPage(page), true)
    assert.equal(await readCatalogPageCache(dshHome), null)
    await writeCatalogPageCache(dshHome, page)
    assert.deepEqual(await readCatalogPageCache(dshHome), page)

    const path = join(dshHome, '.dsh-1024store', 'catalog-page-cache.json')
    const stored = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(stored.version, 1)
    assert.deepEqual(stored.page, page)
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('an invalid cached page can never reach the embedded frontend', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh1024-page-cache-'))
  try {
    await assert.rejects(
      writeCatalogPageCache(dshHome, { ...page, plugins: [{ id: '<script>' }] }),
      /payload is invalid/,
    )
    assert.equal(await readCatalogPageCache(dshHome), null)
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
})
