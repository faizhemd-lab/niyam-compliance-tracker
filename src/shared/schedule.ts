import { RULES } from './catalogue'
import { addDays, daysBetween, makeDate, monthKey, parseDate, plural } from './format'
import { effectiveSchedule } from './rules'
import type { Colour, Deadline, Obligation, Profile, Rule, Schedule } from './types'

export type StatusMap = Record<string, { status: 'open' | 'done'; done_at?: string; done_by?: 'founder' | 'ca' }>

/** The calendar window: 60 days back so overdue items are visible, 12 months ahead. */
export function windowFor(today: string) {
  return { start: addDays(today, -60), end: addDays(today, 365) }
}

function yearsBetween(start: string, end: string): number[] {
  const a = parseDate(start).getUTCFullYear()
  const b = parseDate(end).getUTCFullYear()
  const years: number[] = []
  for (let y = a; y <= b; y++) years.push(y)
  return years
}

function inWindow(date: string, start: string, end: string) {
  return date >= start && date <= end
}

/** All dated occurrences for a schedule inside the window. */
export function datesFor(schedule: Schedule, profile: Profile, start: string, end: string): string[] {
  const out: string[] = []
  switch (schedule.type) {
    case 'monthly': {
      const s = parseDate(start)
      const cursor = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1))
      while (cursor.getTime() <= parseDate(end).getTime()) {
        const iso = makeDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, schedule.day)
        if (inWindow(iso, start, end)) out.push(iso)
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
      }
      return out
    }
    case 'yearly': {
      for (const year of yearsBetween(start, end)) {
        const iso = makeDate(year, schedule.month, schedule.day)
        if (inWindow(iso, start, end)) out.push(iso)
      }
      return out
    }
    case 'multi': {
      for (const year of yearsBetween(start, end)) {
        for (const d of schedule.dates) {
          const iso = makeDate(year, d.month, d.day)
          if (inWindow(iso, start, end)) out.push(iso)
        }
      }
      return out
    }
    case 'relative': {
      if (!profile.incorporated_on) return []
      const iso = addDays(profile.incorporated_on, schedule.days)
      return inWindow(iso, start, end) ? [iso] : []
    }
    case 'derived': {
      // The AGM is assumed on 30 September of the relevant year (see the catalogue).
      for (const year of yearsBetween(start, end)) {
        const iso = addDays(makeDate(year, 9, 30), schedule.days)
        if (inWindow(iso, start, end)) out.push(iso)
      }
      return out
    }
    case 'event':
      return []
  }
}

/** Colour and a text label, so colour is never the only signal. */
export function urgencyFor(
  due: string | null,
  status: 'open' | 'done',
  today: string,
): { colour: Colour; urgency: string; days_left: number | null } {
  if (status === 'done') return { colour: 'grey', urgency: 'Done', days_left: due ? daysBetween(today, due) : null }
  if (!due) return { colour: 'blue', urgency: 'Waiting on an event', days_left: null }
  const left = daysBetween(today, due)
  if (left < 0) return { colour: 'red', urgency: `Overdue by ${plural(Math.abs(left), 'day')}`, days_left: left }
  if (left === 0) return { colour: 'red', urgency: 'Due today', days_left: 0 }
  if (left <= 3) return { colour: 'red', urgency: `Due in ${plural(left, 'day')}`, days_left: left }
  if (left <= 30) return { colour: 'amber', urgency: `Due in ${plural(left, 'day')}`, days_left: left }
  return { colour: 'green', urgency: `Due in ${plural(left, 'day')}`, days_left: left }
}

export type CalendarResult = {
  deadlines: Deadline[]
  /** Rules we could not date because the incorporation date is missing. */
  needsIncorporation: string[]
}

/**
 * Build the dated calendar from the obligations that apply. Done deadlines keep
 * their status, which is what makes correcting a profile safe.
 */
export function buildCalendar(
  profile: Profile,
  obligations: Obligation[],
  today: string,
  statuses: StatusMap = {},
  rules: Rule[] = RULES,
): CalendarResult {
  const { start, end } = windowFor(today)
  const deadlines: Deadline[] = []
  const needsIncorporation: string[] = []
  const byId = new Map(rules.map((r) => [r.id, r]))

  for (const obligation of obligations) {
    const rule = byId.get(obligation.rule_id)
    if (!rule) continue
    const schedule = effectiveSchedule(rule, profile)
    const dated = datesFor(schedule, profile, start, end)

    if (schedule.type === 'event') {
      const state = statuses[`${obligation.rule_id}@event`] ?? { status: 'open' as const }
      deadlines.push({
        id: `${obligation.rule_id}@event`,
        rule_id: obligation.rule_id,
        rule_version: obligation.rule_version,
        name: obligation.name,
        short: obligation.short,
        authority: obligation.authority,
        group: obligation.group,
        reason: obligation.reason,
        facts: obligation.facts,
        penalty: obligation.penalty.text,
        penalty_example: obligation.penalty_example,
        documents: obligation.documents,
        plain: obligation.plain,
        how_to_file: obligation.how_to_file,
        verified: obligation.verified,
        source_url: obligation.source_url,
        due_date: null,
        event_label: schedule.label,
        status: state.status,
        done_at: state.done_at,
        done_by: state.done_by,
        ...urgencyFor(null, state.status, today),
      })
      continue
    }

    if (schedule.type === 'relative' && !profile.incorporated_on) {
      needsIncorporation.push(obligation.name)
      continue
    }

    for (const due of dated) {
      if (profile.incorporated_on && due < profile.incorporated_on) continue
      const id = `${obligation.rule_id}@${due}`
      const state = statuses[id] ?? { status: 'open' as const }
      deadlines.push({
        id,
        rule_id: obligation.rule_id,
        rule_version: obligation.rule_version,
        name: obligation.name,
        short: obligation.short,
        authority: obligation.authority,
        group: obligation.group,
        reason: obligation.reason,
        facts: obligation.facts,
        penalty: obligation.penalty.text,
        penalty_example: obligation.penalty_example,
        documents: obligation.documents,
        plain: obligation.plain,
        how_to_file: obligation.how_to_file,
        verified: obligation.verified,
        source_url: obligation.source_url,
        due_date: due,
        status: state.status,
        done_at: state.done_at,
        done_by: state.done_by,
        ...urgencyFor(due, state.status, today),
      })
    }
  }

  deadlines.sort((a, b) => {
    if (!a.due_date && !b.due_date) return a.name.localeCompare(b.name)
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date.localeCompare(b.due_date) || a.name.localeCompare(b.name)
  })

  return { deadlines, needsIncorporation }
}

/** "14 obligations: 3 need attention now, 6 this quarter, 5 later." */
export function summarise(deadlines: Deadline[]) {
  const urgent = deadlines.filter((d) => d.colour === 'red').length
  const soon = deadlines.filter((d) => d.colour === 'amber').length
  const later = deadlines.filter((d) => d.colour === 'green').length
  const events = deadlines.filter((d) => d.colour === 'blue').length
  const done = deadlines.filter((d) => d.status === 'done').length
  return { total: deadlines.length, urgent, soon, later, events, done, open: deadlines.length - done }
}

export function groupByMonth(deadlines: Deadline[]) {
  const groups = new Map<string, Deadline[]>()
  for (const d of deadlines) {
    if (!d.due_date) continue
    const key = monthKey(d.due_date)
    const list = groups.get(key) ?? []
    list.push(d)
    groups.set(key, list)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export function nextDeadline(deadlines: Deadline[], today: string): Deadline | undefined {
  return deadlines.find((d) => d.status === 'open' && d.due_date && d.due_date >= today)
}
