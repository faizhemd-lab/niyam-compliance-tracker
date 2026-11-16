import { describe, expect, it } from 'vitest'

import { evaluateRules } from '../src/shared/rules'
import { buildCalendar } from '../src/shared/schedule'
import { createShareToken, hashToken, inScope, shareAccess, visibleDeadlines } from '../src/shared/sharing'
import type { Profile, ShareLink } from '../src/shared/types'
import app from '../src/worker/index'

const TODAY = '2026-11-16'

const link = (patch: Partial<ShareLink> = {}): ShareLink => ({
  id: 's1',
  token_hash: 'x',
  permission: 'view',
  scope: 'all',
  expires_at: null,
  revoked_at: null,
  created_at: '2026-11-01T00:00:00.000Z',
  ...patch,
})

const PROFILE: Profile = { entity: 'private_limited', state: 'Telangana', turnover: 6_000_000, employees: 12, sells: 'services', gst_registered: true, interstate: false, foreign_investment: false, incorporated_on: '2026-04-01' }
const deadlines = buildCalendar(PROFILE, evaluateRules(PROFILE), TODAY).deadlines

describe('tokens', () => {
  it('are 128 bits of hex and differ every time', async () => {
    const a = await createShareToken()
    const b = await createShareToken()
    expect(a.token).toMatch(/^[0-9a-f]{32}$/)
    expect(a.token).not.toBe(b.token)
  })

  it('hash with SHA-256', async () => {
    // The standard test vector for "abc".
    expect(await hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('are stored only as their hash', async () => {
    const { token, token_hash } = await createShareToken()
    expect(token_hash).toBe(await hashToken(token))
    expect(token_hash).not.toContain(token)
  })
})

describe('access', () => {
  it('a fresh link is active', () => {
    expect(shareAccess(link(), TODAY)).toEqual({ state: 'active', active: true, canMarkDone: false })
  })

  it('works through its expiry date and fails the day after', () => {
    expect(shareAccess(link({ expires_at: TODAY }), TODAY).active).toBe(true)
    expect(shareAccess(link({ expires_at: '2026-11-15' }), TODAY)).toEqual({ state: 'expired', active: false, canMarkDone: false })
  })

  it('fails at once when revoked, even before it expires', () => {
    expect(shareAccess(link({ revoked_at: '2026-11-16T10:00:00.000Z', expires_at: '2027-01-01' }), TODAY).state).toBe('revoked')
  })

  it('view-only links can never mark done', () => {
    expect(shareAccess(link({ permission: 'view' }), TODAY).canMarkDone).toBe(false)
  })

  it('mark-done links lose that right once revoked or expired', () => {
    expect(shareAccess(link({ permission: 'mark_done' }), TODAY).canMarkDone).toBe(true)
    expect(shareAccess(link({ permission: 'mark_done', revoked_at: TODAY }), TODAY).canMarkDone).toBe(false)
    expect(shareAccess(link({ permission: 'mark_done', expires_at: '2026-11-01' }), TODAY).canMarkDone).toBe(false)
  })
})

describe('scope', () => {
  it('a whole-company link sees everything', () => {
    expect(visibleDeadlines(link(), deadlines, TODAY)).toHaveLength(deadlines.length)
  })

  it('a scoped link sees only its groups', () => {
    const gstOnly = link({ scope: ['gst', 'payroll'] })
    const seen = visibleDeadlines(gstOnly, deadlines, TODAY)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((d) => d.group === 'gst' || d.group === 'payroll')).toBe(true)
    expect(inScope(gstOnly, 'company_law')).toBe(false)
  })

  it('an inactive link sees nothing', () => {
    expect(visibleDeadlines(link({ revoked_at: TODAY }), deadlines, TODAY)).toEqual([])
  })
})

describe('POST /api/share', () => {
  const post = (body: unknown) => app.request('/api/share', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

  it('returns a token with its hash, defaulting to view-only and the whole company', async () => {
    const res = await post({})
    expect(res.status).toBe(201)
    const json = (await res.json()) as { token: string; token_hash: string; permission: string; scope: unknown; expires_at: unknown }
    expect(json.token_hash).toBe(await hashToken(json.token))
    expect(json).toMatchObject({ permission: 'view', scope: 'all', expires_at: null })
  })

  it('only grants mark-done when asked for exactly that', async () => {
    const res = await post({ permission: 'admin' })
    expect(((await res.json()) as { permission: string }).permission).toBe('view')
  })

  it('rejects a body that is not a JSON object', async () => {
    const res = await app.request('/api/share', { method: 'POST', body: '[1,2]' })
    expect(res.status).toBe(400)
  })
})
