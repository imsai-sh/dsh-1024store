import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { withFileLock } from '../lib/shared/files.js'

test('does not enter an old generation after its empty lock directory is replaced', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh1024-lock-generation-'))
  const target = join(directory, 'state.json')
  let active = 0
  let maximumActive = 0
  let firstHook = true
  let resumeFirstOwner
  let reportFirstOwnerReady
  const firstOwnerReady = new Promise((resolve) => { reportFirstOwnerReady = resolve })
  const firstOwnerResume = new Promise((resolve) => { resumeFirstOwner = resolve })
  let releaseSecond
  let reportSecondEntered
  const secondEntered = new Promise((resolve) => { reportSecondEntered = resolve })
  const secondRelease = new Promise((resolve) => { releaseSecond = resolve })

  async function criticalSection(waitForRelease) {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    try {
      if (waitForRelease) await waitForRelease
    } finally {
      active -= 1
    }
  }

  const first = withFileLock(target, () => criticalSection(), {
    async beforeOwnerCommit() {
      if (!firstHook) return
      firstHook = false
      reportFirstOwnerReady()
      await firstOwnerResume
    },
  })
  await firstOwnerReady

  const second = withFileLock(target, async () => {
    reportSecondEntered()
    await criticalSection(secondRelease)
  })
  await secondEntered
  resumeFirstOwner()
  await delay(100)
  assert.equal(active, 1)
  assert.equal(maximumActive, 1)
  releaseSecond()
  await Promise.all([first, second])
  assert.equal(maximumActive, 1)
})
