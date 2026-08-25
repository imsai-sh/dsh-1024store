#!/usr/bin/env node

import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const rootManifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const client = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const registrySource = await readFile(new URL('../src/registry.ts', import.meta.url), 'utf8')
const failures = []

if (!client.startsWith(`window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}`)) {
  failures.push(`client module id must be ${manifest.name}`)
}
if (!patch.includes(`name: '${manifest.name}'`)) failures.push('bundle patch package name is stale')
if (manifest.version !== rootManifest.version) failures.push('plugin and monorepo versions must stay synchronized')
if (manifest.releaseUrl !== 'https://deepseek1024.com/plugins/imsai-sh/awesome-deepseek-harness-plugins/packages/dsh1024') {
  failures.push('published manifest releaseUrl must send legacy clients to the domestic update page')
}
if (!registrySource.includes('https://deepseek1024.com/api/v1/registry')) failures.push('catalog must use the dynamic v1 registry API')
if (registrySource.includes('registry-snapshot')) failures.push('catalog must not bundle a fixed plugin snapshot')
if (!client.includes('/dsh1024/update')) failures.push('client update self-check is missing')
if (!client.includes('/dsh1024/self-update')) failures.push('one-click self-update route is missing')
if (!client.includes('/dsh1024/embed-config')) failures.push('embedded store configuration is missing')
if (!client.includes("const BRIDGE_PROTOCOL = 'dsh1024-bridge'")) failures.push('versioned local install bridge is missing')
if (!client.includes("message.action === 'install'")) failures.push('bridge must allow only the install action')
if (!client.includes('event.origin !== embedOrigin')) failures.push('bridge must validate the embedded page origin')
if (!client.includes('event.source !== iframeRef.current?.contentWindow')) failures.push('bridge must validate the embedded frame source')
if (manifest.exports?.['./package.json'] === undefined) failures.push('exports["./package.json"] must exist so the harness loads the client half')
if (!client.includes("const SITE_URL = 'https://deepseek1024.com/'")) failures.push('1024 main website link is missing')
if (!client.includes("const BRAND_ICON_URL = '/dsh1024/icon'")) failures.push('sidebar icon must be served by the local plugin')
if (client.includes("SITE_URL + 'deepseek1024.png'")) failures.push('sidebar icon must not depend on the remote website')
if (!client.includes("name: 'settings.section'")) failures.push('left settings navigation entry is missing')
// 三个入口全留:设置页导航行、设置-插件标签页、侧边栏底部动作。任一被误删都要拦下。
if (!client.includes("name: 'sidebar.footer.action'")) failures.push('sidebar footer entry is missing')
if (!client.includes("id: 'dsh1024-store'")) failures.push('sidebar footer entry must keep its own slot id')

if (failures.length > 0) {
  console.error(`preflight failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log(`preflight ok: ${manifest.name}@${manifest.version}, dynamic catalog API`)
