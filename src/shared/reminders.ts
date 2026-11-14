import { formatDate, formatRupees, plural } from './format'
import type { Company, Deadline, ReminderEntry } from './types'

/** Reminders go out 30, 7, 3, 1 and 0 days before, then daily while overdue. */
export const STAGES = [30, 7, 3, 1, 0] as const

export function reminderStage(due: string | null, today: string): string | null {
  if (!due) return null
  const left = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  if ((STAGES as readonly number[]).includes(left)) return String(left)
  if (left < 0) return `overdue-${today}`
  return null
}

const TONE: Record<string, string> = {
  '30': 'Heads-up',
  '7': 'Prepare now',
  '3': 'Urgent',
  '1': 'Final',
  '0': 'Due today',
}

export function reminderMessage(deadline: Deadline, stage: string, company: Company) {
  const daysLeft = Number(stage)
  const overdue = stage.startsWith('overdue')
  const tone = overdue ? 'Overdue' : TONE[stage] ?? 'Reminder'
  const subject = `${tone}: ${deadline.name} — ${deadline.due_date ? formatDate(deadline.due_date) : 'on event'}`
  const lines = [
    `${tone} — ${deadline.name}`,
    `For ${company.name}. Authority: ${deadline.authority}.`,
    `Due: ${deadline.due_date ? formatDate(deadline.due_date) : deadline.event_label ?? 'on event'}.`,
    `If it is late: ${deadline.penalty}${deadline.penalty_example ? ` (${deadline.penalty_example})` : ''}`,
  ]
  if (overdue) {
    const late = Math.abs(Math.round((Date.parse(`${deadline.due_date}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000))
    lines.push(`${plural(late, 'day')} overdue. Reminders continue daily until this is marked done.`)
    lines.push('What to file first: ' + deadline.how_to_file)
  } else {
    lines.push(daysLeft === 0 ? 'Today is the last day.' : `${plural(daysLeft, 'day')} left. Open the checklist to see what to prepare.`)
  }
  lines.push('Mark it done in the tracker to stop these reminders.')
  lines.push('Guidance, not legal advice. Verify with your CA.')
  return { subject, body: lines.join('\n') }
}

/**
 * Run the daily reminder job for a simulated date. The log is the idempotency
 * key: the same stage for the same deadline is never sent twice.
 */
export function runReminderJob(deadlines: Deadline[], today: string, log: ReminderEntry[], company: Company, to = 'founder@example.com'): ReminderEntry[] {
  const sent = new Set(log.map((r) => `${r.deadline_id}:${r.stage}`))
  const out: ReminderEntry[] = []
  for (const deadline of deadlines) {
    if (deadline.status === 'done') continue
    const stage = reminderStage(deadline.due_date, today)
    if (!stage) continue
    const key = `${deadline.id}:${stage}`
    if (sent.has(key)) continue
    const { subject, body } = reminderMessage(deadline, stage, company)
    out.push({
      id: key,
      deadline_id: deadline.id,
      stage,
      channel: 'email',
      to,
      subject,
      body,
      sent_at: new Date().toISOString(),
      status: 'sent',
    })
    sent.add(key)
  }
  return out
}

/** Every reminder that would go out for this deadline across the window, for the UI. */
export function upcomingReminders(deadline: Deadline) {
  if (!deadline.due_date || deadline.status === 'done') return []
  return STAGES.map((stage) => ({
    stage,
    on: new Date(Date.parse(`${deadline.due_date}T00:00:00Z`) - stage * 86_400_000).toISOString().slice(0, 10),
    label: stage === 0 ? 'On the due date' : `${plural(stage, 'day')} before`,
  }))
}

export function estimateSoFar(deadline: Deadline): string | undefined {
  if (!deadline.penalty_example) return undefined
  return deadline.penalty_example.replace('30 days', String(Math.max(1, Math.abs(deadline.days_left ?? 5))) + ' days')
}

export const penaltyCash = formatRupees
