import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CLI_VERSION } from '../cli/constants.js'

test('CLI_VERSION mirrors the package manifest version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(CLI_VERSION, manifest.version)
  assert.match(CLI_VERSION, /^\d+\.\d+\.\d+(?:[-+].+)?$/)
})
