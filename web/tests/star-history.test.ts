import { describe, expect, it, vi } from 'vitest'
import {
  hourBucket,
  loadStarGrowth,
  recordStarSnapshots,
} from '../worker/lib/star-history'
import { TEST_PLUGINS } from './fixtures'

interface PreparedCall {
  sql: string
  params: unknown[]
}

interface SnapshotRowFixture {
  repository: string
  bucket_hour: number
  captured_at: number
  star_count: number
}

function mockD1(rows: unknown[] = [], earliestRows: SnapshotRowFixture[] = []) {
  const calls: PreparedCall[] = []
  const isEarliestLookup = (sql: string) => sql.includes('ORDER BY bucket_hour ASC')
  const prepare = vi.fn((sql: string) => {
    const call: PreparedCall = { sql, params: [] }
    calls.push(call)
    const statement = {
      call,
      bind(...params: unknown[]) {
        call.params = params
        return statement
      },
      async all() {
        if (isEarliestLookup(sql)) {
          const repository = String(call.params[0]).toLocaleLowerCase()
          const matches = earliestRows
            .filter((row) => row.repository.toLocaleLowerCase() === repository)
            .sort((left, right) => left.bucket_hour - right.bucket_hour)
          return { results: matches.slice(0, 1) }
        }
        return { results: rows }
      },
      async run() {
        return { success: true }
      },
    }
    return statement
  })
  const batch = vi.fn(async (statements: Array<{ all: () => Promise<{ results: unknown[] }> }>) =>
    Promise.all(statements.map((statement) => statement.all())),
  )
  return {
    db: { prepare, batch } as unknown as D1Database,
    batch,
    calls,
  }
}

describe('GitHub star history', () => {
  it('upserts one idempotent snapshot per repository and hour', async () => {
    const capturedAt = Date.parse('2026-08-14T12:15:00Z')
    const { db, batch, calls } = mockD1()

    await recordStarSnapshots(db, TEST_PLUGINS.slice(0, 2), capturedAt)

    expect(batch).toHaveBeenCalledOnce()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toContain('ON CONFLICT(repository, bucket_hour) DO UPDATE')
    expect(calls[0]?.params.slice(0, 4)).toEqual([
      'openma-ai/deepseek-harness-tui',
      hourBucket(capturedAt),
      capturedAt,
      42,
    ])
  })

  it('uses the closest stored baseline for each growth window', async () => {
    const capturedAt = Date.parse('2026-08-14T12:15:00Z')
    const repository = 'openma-ai/deepseek-harness-tui'
    const { db } = mockD1([
      {
        repository,
        bucket_hour: hourBucket(capturedAt - 24 * 60 * 60 * 1000),
        captured_at: capturedAt - 24 * 60 * 60 * 1000,
        star_count: 39,
      },
      {
        repository,
        bucket_hour: hourBucket(capturedAt - 7 * 24 * 60 * 60 * 1000),
        captured_at: capturedAt - 7 * 24 * 60 * 60 * 1000,
        star_count: 31,
      },
      {
        repository,
        bucket_hour: hourBucket(capturedAt - 30 * 24 * 60 * 60 * 1000),
        captured_at: capturedAt - 30 * 24 * 60 * 60 * 1000,
        star_count: 12,
      },
    ])

    const growth = await loadStarGrowth(db, [TEST_PLUGINS[0]!], capturedAt)

    expect(growth.get(repository)).toEqual({
      growth24h: 3,
      growth7d: 11,
      growth30d: 30,
    })
  })

  it('skips the earliest-snapshot lookup when every window has a baseline', async () => {
    const capturedAt = Date.parse('2026-08-14T12:15:00Z')
    const repository = 'openma-ai/deepseek-harness-tui'
    const { db, batch } = mockD1(
      [24, 7 * 24, 30 * 24].map((hours) => ({
        repository,
        bucket_hour: hourBucket(capturedAt - hours * 60 * 60 * 1000),
        captured_at: capturedAt - hours * 60 * 60 * 1000,
        star_count: 10,
      })),
    )

    await loadStarGrowth(db, [TEST_PLUGINS[0]!], capturedAt)

    expect(batch).not.toHaveBeenCalled()
  })

  it('falls back to the earliest snapshot while history is shorter than the window', async () => {
    const capturedAt = Date.parse('2026-08-15T14:15:00Z')
    const repository = 'openma-ai/deepseek-harness-tui'
    const earliest = {
      repository,
      bucket_hour: hourBucket(capturedAt - 21 * 60 * 60 * 1000),
      captured_at: capturedAt - 21 * 60 * 60 * 1000,
      star_count: 39,
    }
    const { db } = mockD1([], [earliest])

    const growth = await loadStarGrowth(db, [TEST_PLUGINS[0]!], capturedAt)

    expect(growth.get(repository)).toEqual({
      growth24h: 3,
      growth7d: 3,
      growth30d: 3,
    })
  })

  it('keeps a window null when older history exists but the baseline hour is missing', async () => {
    const capturedAt = Date.parse('2026-08-15T14:15:00Z')
    const repository = 'openma-ai/deepseek-harness-tui'
    const monthOld = {
      repository,
      bucket_hour: hourBucket(capturedAt - 30 * 24 * 60 * 60 * 1000),
      captured_at: capturedAt - 30 * 24 * 60 * 60 * 1000,
      star_count: 12,
    }
    const { db } = mockD1([monthOld], [monthOld])

    const growth = await loadStarGrowth(db, [TEST_PLUGINS[0]!], capturedAt)

    expect(growth.get(repository)).toEqual({
      growth24h: null,
      growth7d: null,
      growth30d: 30,
    })
  })

  it('suppresses the fallback while the earliest snapshot is younger than an hour', async () => {
    const capturedAt = Date.parse('2026-08-15T14:15:00Z')
    const repository = 'openma-ai/deepseek-harness-tui'
    const { db } = mockD1([], [
      {
        repository,
        bucket_hour: hourBucket(capturedAt - 30 * 60 * 1000),
        captured_at: capturedAt - 30 * 60 * 1000,
        star_count: 41,
      },
    ])

    const growth = await loadStarGrowth(db, [TEST_PLUGINS[0]!], capturedAt)

    expect(growth.get(repository)).toEqual({
      growth24h: null,
      growth7d: null,
      growth30d: null,
    })
  })

  it('mixes exact baselines with per-repository fallbacks', async () => {
    const capturedAt = Date.parse('2026-08-15T14:15:00Z')
    const tuiRepository = 'openma-ai/deepseek-harness-tui'
    const crosstalkRepository = 'jesse-njx/dsh-crosstalk'
    const tuiDayBaseline = {
      repository: tuiRepository,
      bucket_hour: hourBucket(capturedAt - 24 * 60 * 60 * 1000),
      captured_at: capturedAt - 24 * 60 * 60 * 1000,
      star_count: 39,
    }
    const { db } = mockD1(
      [tuiDayBaseline],
      [
        tuiDayBaseline,
        {
          repository: crosstalkRepository,
          bucket_hour: hourBucket(capturedAt - 5 * 60 * 60 * 1000),
          captured_at: capturedAt - 5 * 60 * 60 * 1000,
          star_count: 111,
        },
      ],
    )

    const growth = await loadStarGrowth(
      db,
      [TEST_PLUGINS[0]!, TEST_PLUGINS[1]!],
      capturedAt,
    )

    expect(growth.get(tuiRepository)).toEqual({
      growth24h: 3,
      growth7d: 3,
      growth30d: 3,
    })
    expect(growth.get(crosstalkRepository)).toEqual({
      growth24h: 9,
      growth7d: 9,
      growth30d: 9,
    })
  })
})
