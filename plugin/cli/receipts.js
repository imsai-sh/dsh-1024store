import { readJson, storePaths, withFileLock, writeJsonAtomic } from '../lib/shared/files.js'

function receiptKey(profile, pluginId) {
  return `${encodeURIComponent(profile)}:${pluginId}`
}

export async function readReceipts(dshHome) {
  const paths = storePaths(dshHome)
  const document = await readJson(paths.receipts, { schemaVersion: 1, plugins: {} })
  return document?.schemaVersion === 1 && document.plugins && typeof document.plugins === 'object'
    ? document
    : { schemaVersion: 1, plugins: {} }
}

export function getReceipt(document, profile, pluginId) {
  return document.plugins[receiptKey(profile, pluginId)] ?? null
}

export async function saveReceipt(dshHome, _document, receipt) {
  const path = storePaths(dshHome).receipts
  await withFileLock(path, async () => {
    const latest = await readJson(path, { schemaVersion: 1, plugins: {} })
    const document = latest?.schemaVersion === 1 && latest.plugins && typeof latest.plugins === 'object'
      ? latest
      : { schemaVersion: 1, plugins: {} }
    const key = receiptKey(receipt.profile, receipt.pluginId)
    const previous = document.plugins[key]
    const firstInstalledAt = [previous?.firstInstalledAt, receipt.firstInstalledAt]
      .filter(Boolean)
      .sort()[0]
    const lastInstalledAt = [previous?.lastInstalledAt, receipt.lastInstalledAt]
      .filter(Boolean)
      .sort()
      .at(-1)
    const newest = previous?.lastInstalledAt > receipt.lastInstalledAt ? previous : receipt
    document.plugins[key] = {
      ...newest,
      firstInstalledAt,
      lastInstalledAt,
      installCount: (previous?.installCount ?? 0) + 1,
    }
    await writeJsonAtomic(path, document)
  })
}
