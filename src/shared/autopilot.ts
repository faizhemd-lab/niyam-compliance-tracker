import { compileDeadline, folderFor } from './documents'
import { formatDate, plural } from './format'
import { deriveProfile, knowledgeToCompany, missingFacts } from './knowledge'
import { addFiles, addMessages, logActivity, newId, type AgentChatMessage, type CompanyRecord } from './record'
import { runReminderJob } from './reminders'
import { evaluateRules } from './rules'
import { buildCalendar } from './schedule'
import type { Deadline } from './types'

/**
 * The autopilot: what the agent does every morning without being asked.
 *
 * It only takes actions that are safe to take alone — writing the reminder
 * log, drafting folders, and leaving a briefing in the chat. It never marks a
 * filing done, never shares the record and never changes a company fact:
 * those need the founder (or the CA through a share link).
 *
 * Deterministic on purpose, so the scheduled job behaves the same whether or
 * not a model server is reachable at 09:00.
 */

export type AutopilotReport = {
  ran: boolean
  skipped?: 'disabled' | 'already_ran' | 'empty'
  reminders: number
  drafted_folders: number
  drafted_files: number
  overdue: Deadline[]
  due_soon: Deadline[]
  missing: string[]
  briefing?: AgentChatMessage
}

/** Upper bound on folders drafted in one run, so a fresh record does not flood Documents. */
const MAX_FOLDERS_PER_RUN = 6

export function deadlinesFor(record: CompanyRecord, today: string): Deadline[] {
  const profile = deriveProfile(record.knowledge)
  return buildCalendar(profile, evaluateRules(profile), today, record.statuses).deadlines
}

export function runAutopilot(input: CompanyRecord, today: string, options: { force?: boolean } = {}): { record: CompanyRecord; report: AutopilotReport } {
  const empty: AutopilotReport = { ran: false, reminders: 0, drafted_folders: 0, drafted_files: 0, overdue: [], due_soon: [], missing: [] }
  if (!options.force && !input.autopilot.enabled) return { record: input, report: { ...empty, skipped: 'disabled' } }
  if (!options.force && input.autopilot.last_run === today) return { record: input, report: { ...empty, skipped: 'already_ran' } }

  let record: CompanyRecord = { ...input, autopilot: { ...input.autopilot, last_run: today } }
  if (!Object.keys(record.knowledge.facts).length) return { record, report: { ...empty, ran: true, skipped: 'empty' } }

  const company = knowledgeToCompany(record.knowledge)
  const deadlines = deadlinesFor(record, today)
  const open = deadlines.filter((d) => d.status !== 'done' && d.due_date)
  const overdue = open.filter((d) => (d.days_left ?? 0) < 0)
  const dueSoon = open.filter((d) => (d.days_left ?? 99) >= 0 && (d.days_left ?? 99) <= 7)

  // 1. Reminders: the delivery log is the idempotency key, so this never duplicates.
  const sent = runReminderJob(deadlines, today, record.reminders, company, company.email || 'no email on file')
  if (sent.length) record = { ...record, reminders: [...sent, ...record.reminders].slice(0, 200) }

  // 2. Drafts: compile folders for anything due soon (or overdue) that has none yet.
  const horizon = record.autopilot.draft_within_days
  const generated = record.generated
  const haveFolder = (d: Deadline) => generated.some((f) => f.path.startsWith(`${folderFor(d)}/`))
  const toDraft = open.filter((d) => (d.days_left ?? 99) <= horizon && !haveFolder(d)).slice(0, MAX_FOLDERS_PER_RUN)
  let draftedFiles = 0
  const missingFromDrafts = new Set<string>()
  for (const deadline of toDraft) {
    const result = compileDeadline(company, deadline, today, record.ticked[deadline.id] ?? [], record.knowledge)
    record = addFiles(record, result.files)
    draftedFiles += result.files.length
    result.missing.forEach((m) => missingFromDrafts.add(m))
  }

  const missing = [...new Set([...missingFacts(record.knowledge).map((f) => f.label), ...missingFromDrafts])]

  // 3. A briefing in the chat, only when there is something to say.
  let briefing: AgentChatMessage | undefined
  if (sent.length || toDraft.length || overdue.length) {
    const lines: string[] = [`Morning check for ${formatDate(today)}.`]
    if (overdue.length) {
      lines.push(`Overdue: ${overdue.slice(0, 4).map((d) => `${d.short} (${plural(Math.abs(d.days_left ?? 0), 'day')} late)`).join(', ')}${overdue.length > 4 ? ` and ${overdue.length - 4} more` : ''}.`)
    }
    if (dueSoon.length) {
      lines.push(`Due this week: ${dueSoon.slice(0, 4).map((d) => `${d.short} on ${formatDate(d.due_date)}`).join(', ')}${dueSoon.length > 4 ? ` and ${dueSoon.length - 4} more` : ''}.`)
    }
    if (sent.length) lines.push(`I queued ${plural(sent.length, 'reminder')} in the reminder log.`)
    if (toDraft.length) lines.push(`I drafted ${plural(toDraft.length, 'folder')} (${plural(draftedFiles, 'file')}) for ${toDraft.map((d) => d.short).join(', ')}. Every file is marked DRAFT.`)
    if (missing.length) lines.push(`The drafts would be better with: ${missing.slice(0, 4).join(', ')}.`)
    lines.push('Tell me when something is filed and I will mark it done.')

    briefing = {
      id: newId(),
      role: 'agent',
      text: lines.join('\n'),
      at: new Date().toISOString(),
      autopilot: true,
      engine: 'autopilot',
      calls: [
        { name: 'run_reminders', summary: sent.length ? `Queued ${sent.length}` : 'Nothing due', ok: true },
        ...(toDraft.length ? [{ name: 'draft_documents', summary: `Drafted ${draftedFiles} files across ${toDraft.length} folders`, ok: true }] : []),
      ],
      actions: [
        ...(overdue.length || dueSoon.length ? [{ label: 'Open the calendar', to: '/calendar' }] : []),
        ...(toDraft.length ? [{ label: 'Open the compiled folders', to: '/documents' }] : []),
        ...(sent.length ? [{ label: 'See the reminder log', to: '/reminders' }] : []),
      ],
    }
    record = addMessages(record, [briefing])
  }

  record = logActivity(
    record,
    'agent',
    'Autopilot ran',
    `${plural(sent.length, 'reminder')}, ${plural(toDraft.length, 'folder')} drafted, ${overdue.length} overdue`,
  )

  return {
    record,
    report: {
      ran: true,
      reminders: sent.length,
      drafted_folders: toDraft.length,
      drafted_files: draftedFiles,
      overdue,
      due_soon: dueSoon,
      missing,
      briefing,
    },
  }
}
