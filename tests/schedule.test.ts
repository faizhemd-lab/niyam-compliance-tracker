import { describe, expect, it } from 'vitest'

import { addDays, daysBetween, financialYear, makeDate } from '../src/shared/format'
import { evaluateRules } from '../src/shared/rules'
import { buildCalendar, datesFor, summarise, urgencyFor, windowFor, type StatusMap } from '../src/shared/schedule'
import type { Profile } from '../src/shared/types'

const TODAY = '2026-11-16'
const { start, end } = windowFor(TODAY)

const DEMO: Profile = {
  entity: 'private_limited',
  state: 'Telangana',
  turnover: 6_000_000,
  employees: 12,
  sells: 'services',
  gst_registered: false,
  interstate: false,
  foreign_investment: false,
  incorporated_on: '2026-04-01',
}

const calendar = (profile: Profile, today = TODAY, statuses: StatusMap = {}) => buildCalendar(profile, evaluateRules(profile), today, statuses)

describe('date helpers', () => {
  it('clamps a day past month end to the last day', () => {
    expect(makeDate(2026, 9, 31)).toBe('2026-09-30')
    expect(makeDate(2027, 2, 31)).toBe('2027-02-28')
    expect(makeDate(2028, 2, 31)).toBe('2028-02-29')
  })

  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
    expect(daysBetween('2026-12-25', '2027-01-04')).toBe(10)
  })

  it('places dates in the April–March financial year', () => {
    expect(financialYear('2026-03-31')).toBe('FY2025-26')
    expect(financialYear('2026-04-01')).toBe('FY2026-27')
    expect(financialYear('2027-01-15')).toBe('FY2026-27')
  })
})

describe('the calendar window', () => {
  it('runs from 60 days back to 365 days ahead', () => {
    expect(start).toBe('2026-09-17')
    expect(end).toBe('2027-11-16')
  })

  it('generates monthly dates only inside the window', () => {
    const dates = datesFor({ type: 'monthly', day: 11 }, {}, start, end)
    expect(dates[0]).toBe('2026-10-11')
    expect(dates.at(-1)).toBe('2027-11-11')
    expect(dates).toHaveLength(14)
  })

  it('clamps a monthly day 31 in short months', () => {
    const dates = datesFor({ type: 'monthly', day: 31 }, {}, start, end)
    expect(dates).toContain('2027-02-28')
    expect(dates).toContain('2027-04-30')
  })

  it('keeps last year’s yearly date while it is still inside the window', () => {
    expect(datesFor({ type: 'yearly', month: 9, day: 30 }, {}, start, end)).toEqual(['2026-09-30', '2027-09-30'])
  })

  it('dates multi-date schedules across the year boundary', () => {
    const dates = datesFor({ type: 'multi', dates: [{ month: 6, day: 15 }, { month: 9, day: 15 }, { month: 12, day: 15 }, { month: 3, day: 15 }] }, {}, start, end)
    expect([...dates].sort()).toEqual(['2026-12-15', '2027-03-15', '2027-06-15', '2027-09-15'])
  })

  it('dates relative items from the incorporation date', () => {
    expect(datesFor({ type: 'relative', days: 180, from: 'incorporation' }, { incorporated_on: '2026-04-01' }, start, end)).toEqual(['2026-09-28'])
    expect(datesFor({ type: 'relative', days: 180, from: 'incorporation' }, {}, start, end)).toEqual([])
  })

  it('dates AGM-derived items from 30 September', () => {
    expect(datesFor({ type: 'derived', from: 'agm', days: 30 }, {}, start, end)).toEqual(['2026-10-30', '2027-10-30'])
    expect(datesFor({ type: 'derived', from: 'agm', days: 60 }, {}, start, end)).toEqual(['2026-11-29'])
  })

  it('never dates an event item', () => {
    expect(datesFor({ type: 'event', label: 'x' }, {}, start, end)).toEqual([])
  })
})

describe('urgency', () => {
  it.each([
    [-5, 'red', 'Overdue by 5 days'],
    [-1, 'red', 'Overdue by 1 day'],
    [0, 'red', 'Due today'],
    [3, 'red', 'Due in 3 days'],
    [4, 'amber', 'Due in 4 days'],
    [30, 'amber', 'Due in 30 days'],
    [31, 'green', 'Due in 31 days'],
  ] as const)('%i days left is %s, labelled "%s"', (left, colour, label) => {
    const u = urgencyFor(addDays(TODAY, left), 'open', TODAY)
    expect(u.colour).toBe(colour)
    expect(u.urgency).toBe(label)
    expect(u.days_left).toBe(left)
  })

  it('done items are grey and event items blue', () => {
    expect(urgencyFor(addDays(TODAY, -10), 'done', TODAY).colour).toBe('grey')
    expect(urgencyFor(null, 'open', TODAY)).toEqual({ colour: 'blue', urgency: 'Waiting on an event', days_left: null })
  })
})

describe('buildCalendar', () => {
  it('gives every deadline a reason, authority, penalty and text label', () => {
    for (const d of calendar(DEMO).deadlines) {
      expect(d.reason).not.toBe('')
      expect(d.authority).not.toBe('')
      expect(d.penalty).not.toBe('')
      expect(d.urgency).not.toBe('')
    }
  })

  it('sorts dated deadlines first, by date, and event items last', () => {
    const { deadlines } = calendar(DEMO)
    const dated = deadlines.filter((d) => d.due_date)
    expect(dated.map((d) => d.due_date)).toEqual([...dated.map((d) => d.due_date)].sort())
    const firstEvent = deadlines.findIndex((d) => !d.due_date)
    expect(deadlines.slice(firstEvent).every((d) => !d.due_date)).toBe(true)
  })

  it('never dates a deadline before incorporation', () => {
    const young = { ...DEMO, incorporated_on: '2026-10-20' }
    for (const d of calendar(young).deadlines) {
      if (d.due_date) expect(d.due_date >= '2026-10-20').toBe(true)
    }
    expect(calendar(young).deadlines.some((d) => d.rule_id === 'agm' && d.due_date === '2026-09-30')).toBe(false)
  })

  it('reports first-year items it cannot date without an incorporation date', () => {
    const { incorporated_on: _drop, ...noDate } = DEMO
    void _drop
    const result = calendar(noDate)
    expect(result.needsIncorporation).toContain('INC-20A (commencement of business)')
    expect(result.deadlines.some((d) => d.rule_id === 'inc20a')).toBe(false)
  })

  it('puts event-driven items in the on-event lane', () => {
    const shops = calendar(DEMO).deadlines.find((d) => d.rule_id === 'shops_est')!
    expect(shops.due_date).toBeNull()
    expect(shops.colour).toBe('blue')
    expect(shops.event_label).toBeTruthy()
  })

  it('keeps done items done when the profile changes', () => {
    const before = calendar(DEMO)
    const tds = before.deadlines.find((d) => d.rule_id === 'tds_deposit')!
    const statuses: StatusMap = { [tds.id]: { status: 'done', done_at: TODAY, done_by: 'founder' } }

    const grown = calendar({ ...DEMO, employees: 25 }, TODAY, statuses)
    expect(grown.deadlines.find((d) => d.id === tds.id)?.status).toBe('done')
    expect(grown.deadlines.find((d) => d.id === tds.id)?.colour).toBe('grey')
    expect(grown.deadlines.some((d) => d.rule_id === 'epf')).toBe(true)
  })

  it('removes deadlines that no longer apply after a correction', () => {
    const solo = calendar({ ...DEMO, employees: 0 })
    expect(solo.deadlines.some((d) => d.rule_id === 'tds_deposit')).toBe(false)
    expect(solo.deadlines.some((d) => d.rule_id === 'esic')).toBe(false)
  })

  it('shows overdue items from the last 60 days', () => {
    const overdue = calendar(DEMO).deadlines.filter((d) => d.days_left !== null && d.days_left < 0)
    expect(overdue.length).toBeGreaterThan(0)
    expect(overdue.every((d) => d.colour === 'red' && d.urgency.startsWith('Overdue'))).toBe(true)
  })

  it('summarises by colour', () => {
    const { deadlines } = calendar(DEMO)
    const s = summarise(deadlines)
    expect(s.urgent + s.soon + s.later + s.events + s.done).toBe(s.total)
  })
})
