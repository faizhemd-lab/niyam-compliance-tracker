import { describe, expect, it, vi } from 'vitest'

import { AGENT_QUOTA, takeAgentQuota } from '../src/worker/db'

/** Just enough of D1 for the usage counter: upsert-and-return, and the sweep. */
function fakeD1() {
  const counts = new Map<string, number>()
  const statement = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      sql,
      args,
      run: async () => ({ success: true }),
    }),
  })
  const db = {
    prepare: statement,
    batch: async (statements: { sql: string; args: unknown[] }[]) =>
      statements.map(({ args }) => {
        const key = `${args[0]}|${args[1]}`
        const count = (counts.get(key) ?? 0) + 1
        counts.set(key, count)
        return { results: [{ count }] }
      }),
  }
  return db as unknown as D1Database
}

describe('agent message limits', () => {
  it(`allows ${AGENT_QUOTA.perTenMinutes} messages in ten minutes, then asks to wait`, async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const db = fakeD1()
    const now = new Date('2026-11-16T10:03:20.000Z')
    for (let i = 0; i < AGENT_QUOTA.perTenMinutes; i++) expect(await takeAgentQuota(db, 'u1', now)).toEqual({ ok: true })
    // The window started at 10:00 and ends at 10:10: 6 min 40 s to go.
    expect(await takeAgentQuota(db, 'u1', now)).toEqual({ ok: false, window: 'ten_minutes', retryAfter: 400 })
  })

  it('counts each user separately', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const db = fakeD1()
    const now = new Date('2026-11-16T10:03:20.000Z')
    for (let i = 0; i <= AGENT_QUOTA.perTenMinutes; i++) await takeAgentQuota(db, 'u1', now)
    expect(await takeAgentQuota(db, 'u2', now)).toEqual({ ok: true })
  })

  it('opens again in the next ten-minute window', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const db = fakeD1()
    for (let i = 0; i <= AGENT_QUOTA.perTenMinutes; i++) await takeAgentQuota(db, 'u1', new Date('2026-11-16T10:09:00.000Z'))
    expect(await takeAgentQuota(db, 'u1', new Date('2026-11-16T10:10:00.000Z'))).toEqual({ ok: true })
  })

  it(`caps the day at ${AGENT_QUOTA.perDay} messages, until midnight UTC`, async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const db = fakeD1()
    // Spread over the day so the ten-minute window never trips.
    for (let i = 0; i < AGENT_QUOTA.perDay; i++) {
      const at = new Date(Date.parse('2026-11-16T00:00:00.000Z') + i * 4 * 60_000)
      expect((await takeAgentQuota(db, 'u1', at)).ok).toBe(true)
    }
    expect(await takeAgentQuota(db, 'u1', new Date('2026-11-16T23:00:00.000Z'))).toEqual({ ok: false, window: 'day', retryAfter: 3600 })
  })
})
