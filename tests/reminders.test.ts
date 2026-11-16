import { describe, expect, it } from 'vitest'

import { addDays, daysBetween } from '../src/shared/format'
import { reminderMessage, reminderStage, runReminderJob, upcomingReminders } from '../src/shared/reminders'
import { evaluateRules } from '../src/shared/rules'
import { buildCalendar } from '../src/shared/schedule'
import type { Company, Deadline, Profile, ReminderEntry } from '../src/shared/types'

const COMPANY: Company = { name: 'Northwind Labs Private Limited', email: 'founder@northwind.example' }

const PROFILE: Profile = {
  entity: 'private_limited',
  state: 'Telangana',
  turnover: 6_000_000,
  employees: 12,
  sells: 'services',
  gst_registered: true,
  interstate: false,
  foreign_investment: false,
  incorporated_on: '2026-04-01',
}

function deadlinesOn(today: string): Deadline[] {
  return buildCalendar(PROFILE, evaluateRules(PROFILE), today).deadlines
}

describe('reminderStage', () => {
  const today = '2026-11-16'
  it.each([30, 7, 3, 1, 0])('sends on %i days before', (left) => {
    expect(reminderStage(addDays(today, left), today)).toBe(String(left))
  })

  it.each([31, 29, 8, 6, 2])('stays quiet %i days before', (left) => {
    expect(reminderStage(addDays(today, left), today)).toBeNull()
  })

  it('sends every day once overdue, keyed by the day', () => {
    expect(reminderStage(addDays(today, -1), today)).toBe('overdue-2026-11-16')
    expect(reminderStage(addDays(today, -40), today)).toBe('overdue-2026-11-16')
  })

  it('never reminds about an event item', () => {
    expect(reminderStage(null, today)).toBeNull()
  })
})

describe('the daily job over a simulated year', () => {
  const START = '2026-11-01'
  const DAYS = 365
  // One fixed set of deadlines, as the job would see them across the year.
  const deadlines = deadlinesOn(START).filter((d) => d.due_date && d.due_date >= START)
  const target = deadlines.find((d) => d.rule_id === 'dir3_kyc' && d.due_date === '2027-09-30')!
  const DONE_ON = '2027-10-05'

  const LAST = addDays(START, DAYS - 1)
  const log: ReminderEntry[] = []
  let resent = 0
  for (let i = 0; i < DAYS; i++) {
    const today = addDays(START, i)
    const open = deadlines.map((d) => (d.id === target.id && today >= DONE_ON ? { ...d, status: 'done' as const } : d))
    log.push(...runReminderJob(open, today, log, COMPANY))
    // The job running a second time on the same day must send nothing new.
    resent += runReminderJob(open, today, log, COMPANY).length
  }

  it('never sends the same reminder twice, even if the job runs twice a day', () => {
    expect(resent).toBe(0)
    const keys = log.map((r) => `${r.deadline_id}:${r.stage}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('sends each lead-up stage exactly once', () => {
    const stages = log.filter((r) => r.deadline_id === target.id && !r.stage.startsWith('overdue')).map((r) => r.stage)
    expect(stages).toEqual(['30', '7', '3', '1', '0'])
  })

  it('reminds every day while overdue, then stops when marked done', () => {
    const overdue = log.filter((r) => r.deadline_id === target.id && r.stage.startsWith('overdue')).map((r) => r.stage)
    expect(overdue).toEqual(['overdue-2027-10-01', 'overdue-2027-10-02', 'overdue-2027-10-03', 'overdue-2027-10-04'])
  })

  it('keeps reminding about items that are never marked done', () => {
    const other = deadlines.find((d) => d.rule_id === 'gstr3b' && d.due_date === '2027-01-20')!
    const overdueDays = log.filter((r) => r.deadline_id === other.id && r.stage.startsWith('overdue')).length
    // One a day from the day after the due date to the last simulated day.
    expect(overdueDays).toBe(daysBetween(other.due_date!, LAST))
  })

  it('addresses every reminder and marks it sent by email', () => {
    expect(log.every((r) => r.to === 'founder@example.com' && r.channel === 'email' && r.status === 'sent')).toBe(true)
  })
})

describe('reminder messages', () => {
  const deadline = deadlinesOn('2026-11-16').find((d) => d.rule_id === 'gstr3b' && d.due_date === '2026-11-20')!

  it('states the authority, the penalty and how to stop the reminders', () => {
    const { subject, body } = reminderMessage(deadline, '3', COMPANY)
    expect(subject).toBe('Urgent: GSTR-3B (GST payment return) — 20 Nov 2026')
    expect(body).toContain('Authority: GST Portal')
    expect(body).toContain('If it is late: Late fee ₹50/day')
    expect(body).toContain('3 days left')
    expect(body).toContain('Mark it done')
  })

  it('counts overdue days from the simulated day, not the real clock', () => {
    const { body } = reminderMessage(deadline, 'overdue-2026-11-25', COMPANY)
    expect(body).toContain('5 days overdue')
  })

  it('lists the five lead-up dates for the deadline page', () => {
    expect(upcomingReminders(deadline).map((r) => r.on)).toEqual(['2026-10-21', '2026-11-13', '2026-11-17', '2026-11-19', '2026-11-20'])
    expect(upcomingReminders({ ...deadline, status: 'done' })).toEqual([])
  })
})
