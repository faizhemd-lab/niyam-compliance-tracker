import { deadlinesFor, runAutopilot } from './autopilot'
import { DOC_LABELS } from './catalogue'
import { checklistFor, compileDeadline } from './documents'
import { addDays, formatDate, plural } from './format'
import { BRAIN_STATUS, enginesFor, engineStatus, type Engine, type ModelEnv, type ModelStatus, type ToolSpec, type Turn } from './engines'
import { explain, maskIdentifiers } from './gateway'
import { checkGrounding, looksLikeToolSyntax, unbackedClaims } from './grounding'
import {
  FIELDS,
  applyFacts,
  deriveProfile,
  extractFacts,
  factValue,
  knowledgeForPrompt,
  knowledgeToCompany,
  missingFacts,
  suggestedFacts,
  type FactSource,
  type Knowledge,
  type KnowledgeField,
} from './knowledge'
import {
  addFiles,
  addMessages,
  logActivity,
  newId,
  type AgentAction,
  type AgentCall,
  type AgentChatMessage,
  type CompanyRecord,
  type PendingAction,
} from './record'
import { runReminderJob } from './reminders'
import { evaluateRules } from './rules'
import { summarise } from './schedule'
import type { BudgetBand, Deadline, DocKey, Language, ObligationGroup, ShareLink, SharePermission } from './types'

/**
 * The agent that runs the tracker.
 *
 * It lives in the Worker next to the record store. On every turn it loads the
 * client's record from D1, works on it through tools — one for every area of
 * the site — and saves the result back. The browser only sends the message.
 *
 * Two engines drive the same tools:
 * - a self-hosted OpenAI-compatible model (Ollama, llama.cpp, vLLM) chooses
 *   tools in a loop of up to six steps;
 * - a deterministic brain picks them from the message when no model is
 *   configured or reachable, so every feature still works.
 *
 * Guardrails hold whichever engine is driving:
 * - every fact write goes through the field registry's validation;
 * - dates, applicability and penalties only come from the rules engine;
 * - sharing the record or revoking access is only ever *proposed*; the founder
 *   approves it (see `resolvePending`);
 * - marking a filing done needs the founder to have said it is filed.
 */

export type { AgentAction, AgentCall, AgentChatMessage }

export type { ModelEnv, ModelStatus }

export type AgentFactChange = { key: KnowledgeField; label: string; from?: string; to: string; source: FactSource }

export type AgentReply = {
  reply: string
  /** The whole record after this turn, including both chat messages. */
  record: CompanyRecord
  calls: AgentCall[]
  actions: AgentAction[]
  changes: AgentFactChange[]
  errors: { key: KnowledgeField; message: string }[]
  missing: { key: KnowledgeField; label: string; ask: string }[]
  model: ModelStatus
  drafted?: { files: number; folders: number; missing: string[] }
  /** Actions waiting for the founder's approval that this turn added. */
  proposed: PendingAction[]
  /** Set when the model's own reply was not used, and why. */
  fallback?: 'no_engine' | 'engine_down' | 'engine_failed' | 'ungrounded' | 'out_of_steps'
}

export type AgentInput = {
  record: CompanyRecord
  message: string
  /** Defaults to the record's own (possibly simulated) clock. */
  today?: string
  language?: Language
}

type Ctx = {
  record: CompanyRecord
  message: string
  today: string
  language: Language
  calls: AgentCall[]
  actions: AgentAction[]
  changes: AgentFactChange[]
  errors: AgentReply['errors']
  drafted?: AgentReply['drafted']
  proposed: PendingAction[]
}

/** Hard limits on one turn, whatever the model asks for. */
export const LIMITS = {
  /** Model calls per founder message. */
  steps: 6,
  /** Tool calls the model may make in one step; extra ones are refused. */
  callsPerStep: 6,
  /** Tool calls across the whole turn. */
  callsPerTurn: 16,
} as const

export function modelStatus(env: ModelEnv): Promise<ModelStatus> {
  return engineStatus(env)
}

// ---------------------------------------------------------------------------
// Helpers

const GROUPS: ObligationGroup[] = ['gst', 'company_law', 'income_tax', 'payroll', 'fema', 'labour']
const BUDGETS: BudgetBand[] = ['under_10k', '10k_30k', '30k_60k', 'above_60k']
const FILED_WORDS = /\b(filed|file[d]? it|done|completed?|paid|submitted|finished|sorted)\b/i

function deadlines(ctx: Ctx): Deadline[] {
  return deadlinesFor(ctx.record, ctx.today)
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?'
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(20\\d{2}))?`, 'g')
const MONTH_DAY = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(20\\d{2}))?`, 'g')

/**
 * Dates a founder wrote: "20 October", "Oct 20", "20 Oct 2026", "2026-10-20",
 * "20/10/2026". A bare month ("for October") is not a date: for GST it usually
 * names the period, not the due date, so it is ignored rather than guessed.
 */
export function datesMentioned(text: string): { month: number; day: number; year?: number }[] {
  const out: { month: number; day: number; year?: number }[] = []
  const lower = text.toLowerCase()
  for (const m of lower.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) out.push({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) })
  for (const m of lower.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/g)) out.push({ day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) })
  for (const m of lower.matchAll(DAY_MONTH)) out.push({ day: Number(m[1]), month: MONTH_NAMES.indexOf(m[2]) + 1, ...(m[3] ? { year: Number(m[3]) } : {}) })
  for (const m of lower.matchAll(MONTH_DAY)) out.push({ day: Number(m[2]), month: MONTH_NAMES.indexOf(m[1]) + 1, ...(m[3] ? { year: Number(m[3]) } : {}) })
  return out.filter((d) => d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= 31)
}

/**
 * Find the deadline a query names. When the query or the founder's message
 * names a date, only deadlines due on that date can match: "the GSTR-3B due on
 * 20 October" never resolves to the September one.
 */
function findDeadline(list: Deadline[], query: string, hint = ''): Deadline | undefined {
  const dates = [...datesMentioned(query), ...datesMentioned(hint)]
  if (dates.length) {
    const onDate = list.filter((d) => {
      if (!d.due_date) return false
      const [y, m, day] = d.due_date.split('-').map(Number)
      return dates.some((x) => x.month === m && x.day === day && (x.year === undefined || x.year === y))
    })
    if (!onDate.length) return undefined
    if (onDate.length === 1) return onDate[0]
    list = onDate
  }
  const exact = list.find((d) => d.id === query || d.rule_id === query)
  if (exact) {
    // A rule id names many occurrences; prefer the nearest open one.
    if (exact.id === query) return exact
    return list.filter((d) => d.rule_id === query && d.status !== 'done').sort(byDue)[0] ?? exact
  }
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  let best: { deadline: Deadline; score: number } | undefined
  for (const deadline of [...list].sort(byDue)) {
    const haystack = `${deadline.rule_id.replace(/_/g, ' ')} ${deadline.name} ${deadline.short} ${deadline.authority}`.toLowerCase()
    let score = words.reduce((n, word) => n + (haystack.includes(word) ? 1 : 0), 0)
    if (score > 0 && deadline.status !== 'done') score += 0.5
    if (score > 0 && (!best || score > best.score)) best = { deadline, score }
  }
  return best?.deadline
}

/** Nearest first; undated (event) items last. */
function byDue(a: Deadline, b: Deadline) {
  if (!a.due_date) return 1
  if (!b.due_date) return -1
  return a.due_date.localeCompare(b.due_date)
}

function line(d: Deadline) {
  const when = d.due_date ? `${formatDate(d.due_date)} (${d.urgency})` : d.event_label ?? 'on event'
  return `[${d.id}] ${d.name} — ${d.authority} — ${when} — ${d.status}${d.status === 'open' ? ` — penalty: ${d.penalty}` : ''}`
}

function findDoc(query: string): DocKey | undefined {
  const q = query.toLowerCase().replace(/[_-]/g, ' ')
  const entries = Object.entries(DOC_LABELS) as [DocKey, string][]
  const exact = entries.find(([key]) => key.replace(/_/g, ' ') === q)
  if (exact) return exact[0]
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  let best: { key: DocKey; score: number } | undefined
  for (const [key, label] of entries) {
    const hay = `${key.replace(/_/g, ' ')} ${label}`.toLowerCase()
    const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0)
    if (score > 0 && (!best || score > best.score)) best = { key, score }
  }
  return best?.key
}

function activeShares(record: CompanyRecord) {
  return record.shares.filter((s) => !s.revoked_at)
}

function call(ctx: Ctx, name: string, summary: string, ok = true) {
  ctx.calls.push({ name, summary, ok })
}

function action(ctx: Ctx, label: string, to: string) {
  if (!ctx.actions.some((a) => a.to === to)) ctx.actions.push({ label, to })
}

// ---------------------------------------------------------------------------
// Tools: one per area of the site

function runUpdate(ctx: Ctx, patch: Partial<Record<KnowledgeField, unknown>>, source: FactSource): string {
  const result = applyFacts(ctx.record.knowledge, patch, source, new Date().toISOString())
  ctx.record = { ...ctx.record, knowledge: result.knowledge }
  ctx.changes.push(...result.changed.map((c) => ({ ...c, source })))
  ctx.errors.push(...result.errors)
  if (result.changed.length) {
    ctx.record = logActivity(ctx.record, 'agent', 'Agent updated the record', result.changed.map((c) => `${c.label} → ${c.to}`).join(', '))
  }
  // A partial save is a success: what was valid is stored, and the rejections are named.
  const rejectedNote = result.errors.length ? ` (rejected ${result.errors.map((e) => e.key).join(', ')})` : ''
  call(
    ctx,
    'update_company',
    result.changed.length
      ? `Updated ${result.changed.map((c) => `${c.label} to ${c.to}`).join(', ')}${rejectedNote}`
      : result.errors.length
        ? `Rejected ${plural(result.errors.length, 'value')}: ${result.errors.map((e) => e.key).join(', ')}`
        : 'No change',
    result.changed.length > 0 || result.errors.length === 0,
  )
  const saved = result.changed.map((c) => `${c.label}: ${c.to}`).join('; ')
  const rejected = result.errors.map((e) => `${e.key}: ${e.message}`).join('; ')
  return [saved && `Saved ${saved}.`, rejected && `Rejected ${rejected}.`].filter(Boolean).join(' ') || 'No change.'
}

function runDraft(ctx: Ctx, args: { scope?: string; query?: string; item?: string }): string {
  const open = deadlines(ctx).filter((d) => d.status !== 'done')
  const company = knowledgeToCompany(ctx.record.knowledge)
  let chosen: Deadline[] = []
  const query = args.item ?? args.query
  if (args.scope === 'all' || args.scope === 'everything') chosen = open.filter((d) => d.due_date).sort(byDue).slice(0, 12)
  else if (args.scope === 'overdue') chosen = open.filter((d) => (d.days_left ?? 0) < 0)
  else if (args.scope === 'due_soon') chosen = open.filter((d) => d.due_date && (d.days_left ?? 99) <= 30).sort(byDue)
  else if (query) {
    const match = findDeadline(open, query, ctx.message)
    if (match) chosen = [match]
  }
  if (!chosen.length) {
    call(ctx, 'draft_documents', 'Nothing matched that filing', false)
    return 'No open filing matched. Ask for a filing by name, or for all, overdue or due-soon documents.'
  }

  let files = 0
  const missing = new Set<string>()
  for (const deadline of chosen) {
    const result = compileDeadline(company, deadline, ctx.today, ctx.record.ticked[deadline.id] ?? [], ctx.record.knowledge)
    ctx.record = addFiles(ctx.record, result.files)
    files += result.files.length
    result.missing.forEach((m) => missing.add(m))
  }
  ctx.drafted = { files, folders: chosen.length, missing: [...missing] }
  ctx.record = logActivity(ctx.record, 'agent', 'Agent drafted documents', chosen.map((d) => d.short).join(', '))
  action(ctx, 'Open the compiled folders', '/documents')
  call(ctx, 'draft_documents', `Drafted ${files} files across ${plural(chosen.length, 'folder')}`)
  return `Drafted ${files} files for ${chosen.map((d) => d.short).join(', ')}.${missing.size ? ` Missing from the record: ${[...missing].join(', ')}.` : ''}`
}

function propose(ctx: Ctx, pending: PendingAction): string {
  ctx.record = { ...ctx.record, pending: [...ctx.record.pending, pending] }
  ctx.proposed.push(pending)
  call(ctx, pending.tool, `Waiting for your approval: ${pending.summary}`)
  return `I need your approval before I do this: ${pending.summary}. Approve or decline it in the “Waiting for your approval” card beside the chat.`
}

export function executeTool(ctx: Ctx, name: string, args: Record<string, unknown>): string {
  const company = knowledgeToCompany(ctx.record.knowledge)
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : '')

  switch (name) {
    // --- Company record -------------------------------------------------
    case 'read_company': {
      call(ctx, 'read_company', `Read ${Object.keys(ctx.record.knowledge.facts).length} facts`)
      const missing = missingFacts(ctx.record.knowledge)
      return `${knowledgeForPrompt(ctx.record.knowledge)}${missing.length ? `\nRequired but missing: ${missing.map((f) => f.key).join(', ')}` : ''}`
    }
    case 'update_company': {
      const patch = (args.facts ?? args.patch ?? {}) as Record<string, unknown>
      const safe: Partial<Record<KnowledgeField, unknown>> = {}
      for (const [key, value] of Object.entries(patch && typeof patch === 'object' ? patch : {})) {
        if (FIELDS.some((f) => f.key === key)) safe[key as KnowledgeField] = value
      }
      if (!Object.keys(safe).length) {
        call(ctx, 'update_company', 'No valid facts in that call', false)
        return 'Nothing to update: use the exact fact keys.'
      }
      return runUpdate(ctx, safe, 'agent')
    }

    // --- Obligations and calendar ---------------------------------------
    case 'list_obligations': {
      const obligations = evaluateRules(deriveProfile(ctx.record.knowledge))
      action(ctx, 'See every obligation', '/obligations')
      call(ctx, 'list_obligations', `${obligations.length} obligations apply`)
      return obligations.map((o) => `${o.name} (${o.authority}) — why: ${o.reason} — rule ${o.rule_version}${o.verified ? '' : ', not yet verified'}`).join('\n') || 'No obligations yet: the record is missing required facts.'
    }
    case 'get_calendar': {
      const filter = str('filter') || 'open'
      const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 25)
      const all = deadlines(ctx).sort(byDue)
      const list =
        filter === 'overdue'
          ? all.filter((d) => d.status !== 'done' && (d.days_left ?? 0) < 0)
          : filter === 'next_30'
            ? all.filter((d) => d.status !== 'done' && d.due_date && (d.days_left ?? 99) >= 0 && (d.days_left ?? 99) <= 30)
            : filter === 'done'
              ? all.filter((d) => d.status === 'done')
              : filter === 'events'
                ? all.filter((d) => !d.due_date)
                : all.filter((d) => d.status !== 'done' && d.due_date)
      const s = summarise(all)
      action(ctx, 'Open the calendar', '/calendar')
      call(ctx, 'get_calendar', `${list.length} ${filter} deadlines`)
      return `${s.total} deadlines, ${s.urgent} urgent, ${s.events} waiting on an event.\n${list.slice(0, limit).map(line).join('\n') || `Nothing ${filter}.`}`
    }
    case 'get_deadline': {
      const deadline = findDeadline(deadlines(ctx), str('item'), ctx.message)
      if (!deadline) {
        call(ctx, 'get_deadline', 'No matching deadline', false)
        return 'No deadline matched that.'
      }
      const checklist = checklistFor(deadline, company, ctx.record.ticked[deadline.id] ?? [])
      const sent = ctx.record.reminders.filter((r) => r.deadline_id === deadline.id).length
      action(ctx, `Open ${deadline.short}`, `/deadline/${encodeURIComponent(deadline.id)}`)
      call(ctx, 'get_deadline', `Read ${deadline.short}`)
      return [
        line(deadline),
        `Why it applies: ${deadline.reason}`,
        `How to file: ${deadline.how_to_file}`,
        `Checklist: ${checklist.map((c) => `${c.label} [${c.key}] = ${c.state}`).join('; ')}`,
        `Reminders logged: ${sent}`,
      ].join('\n')
    }
    case 'explain_item': {
      const list = deadlines(ctx)
      const deadline = findDeadline(list, str('item') || ctx.message, ctx.message) ?? (datesMentioned(ctx.message).length ? undefined : list.find((d) => d.due_date))
      if (!deadline) {
        call(ctx, 'explain_item', 'Nothing to explain yet', false)
        return 'There is no calendar yet. Tell me about the business first.'
      }
      const result = explain(
        {
          name: deadline.name,
          authority: deadline.authority,
          plain: deadline.plain,
          reason: deadline.reason,
          penalty: deadline.penalty,
          how_to_file: deadline.how_to_file,
          due: deadline.due_date ? formatDate(deadline.due_date) : 'On event',
          rule_version: deadline.rule_version,
        },
        ctx.language,
        str('question') || ctx.message,
      )
      call(ctx, 'explain_item', `Explained ${deadline.short}`)
      return result.text
    }

    // --- Deadline status and checklists ---------------------------------
    case 'mark_done': {
      if (!FILED_WORDS.test(ctx.message)) {
        call(ctx, 'mark_done', 'Refused: the founder has not said it is filed', false)
        return 'Refused: only mark a filing done after the founder says it is filed or paid. Ask them.'
      }
      // One filing per message: a second mark_done is far more likely a guess than an instruction.
      if (ctx.calls.some((c) => c.name === 'mark_done' && c.ok)) {
        call(ctx, 'mark_done', 'Refused: one filing per message', false)
        return 'Refused: only one filing can be marked done per message. Tell the founder which one you marked, and ask them to name any other filing separately.'
      }
      const deadline = findDeadline(deadlines(ctx).filter((d) => d.status !== 'done'), str('item') || ctx.message, ctx.message)
      if (!deadline) {
        call(ctx, 'mark_done', 'No matching open deadline', false)
        return 'No open deadline matched that.'
      }
      ctx.record = {
        ...ctx.record,
        statuses: { ...ctx.record.statuses, [deadline.id]: { status: 'done', done_at: new Date().toISOString(), done_by: 'founder' } },
      }
      ctx.record = logActivity(ctx.record, 'agent', 'Marked done', `${deadline.id} (founder said it is filed)`)
      call(ctx, 'mark_done', `Marked ${deadline.short} (${formatDate(deadline.due_date)}) done`)
      return `${deadline.short} due ${formatDate(deadline.due_date)} is marked done; its reminders stop.`
    }
    case 'reopen': {
      const deadline = findDeadline(deadlines(ctx).filter((d) => d.status === 'done'), str('item') || ctx.message, ctx.message)
      if (!deadline) {
        call(ctx, 'reopen', 'No matching done deadline', false)
        return 'Nothing marked done matched that.'
      }
      const statuses = { ...ctx.record.statuses }
      delete statuses[deadline.id]
      ctx.record = logActivity({ ...ctx.record, statuses }, 'agent', 'Reopened', deadline.id)
      call(ctx, 'reopen', `Reopened ${deadline.short}`)
      return `${deadline.short} is open again and its reminders resume.`
    }
    case 'tick_document': {
      const deadline = findDeadline(deadlines(ctx).filter((d) => d.status !== 'done'), str('item'), ctx.message)
      const doc = findDoc(str('document'))
      if (!deadline || !doc || !deadline.documents.includes(doc)) {
        call(ctx, 'tick_document', 'No matching checklist item', false)
        return deadline ? `That filing's checklist has: ${deadline.documents.join(', ')}.` : 'No open deadline matched that.'
      }
      const have = args.have !== false
      const current = ctx.record.ticked[deadline.id] ?? []
      const next = have ? [...new Set([...current, doc])] : current.filter((d) => d !== doc)
      ctx.record = { ...ctx.record, ticked: { ...ctx.record.ticked, [deadline.id]: next } }
      call(ctx, 'tick_document', `${have ? 'Ticked' : 'Unticked'} ${DOC_LABELS[doc]} for ${deadline.short}`)
      return `${DOC_LABELS[doc]} is now ${have ? 'held' : 'missing'} for ${deadline.short}.`
    }

    // --- Documents ------------------------------------------------------
    case 'draft_documents':
      return runDraft(ctx, { scope: str('scope') || undefined, query: str('query') || undefined, item: str('item') || undefined })
    case 'list_documents': {
      const folders = new Map<string, number>()
      for (const f of ctx.record.generated) {
        const dir = f.path.split('/').slice(0, -1).join('/')
        folders.set(dir, (folders.get(dir) ?? 0) + 1)
      }
      action(ctx, 'Open the compiled folders', '/documents')
      call(ctx, 'list_documents', `${folders.size} folders, ${ctx.record.generated.length} files`)
      return [...folders.entries()].map(([dir, n]) => `${dir} (${plural(n, 'file')})`).join('\n') || 'No documents compiled yet.'
    }

    // --- Reminders ------------------------------------------------------
    case 'run_reminders': {
      const sent = runReminderJob(deadlines(ctx), ctx.today, ctx.record.reminders, company, company.email || 'no email on file')
      if (sent.length) ctx.record = { ...ctx.record, reminders: [...sent, ...ctx.record.reminders].slice(0, 200) }
      action(ctx, 'See the reminder log', '/reminders')
      call(ctx, 'run_reminders', sent.length ? `Queued ${plural(sent.length, 'reminder')}` : 'Nothing due today')
      return sent.length ? sent.map((r) => `${r.stage}: ${r.subject}`).join('\n') : 'No reminder is due today; nothing was sent twice.'
    }
    case 'list_reminders': {
      const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 25)
      call(ctx, 'list_reminders', `${ctx.record.reminders.length} in the log`)
      return ctx.record.reminders.slice(0, limit).map((r) => `${r.sent_at.slice(0, 10)} ${r.stage}: ${r.subject}`).join('\n') || 'The reminder log is empty.'
    }

    // --- Sharing (proposals only) ---------------------------------------
    case 'list_shares': {
      action(ctx, 'Manage share links', '/share')
      call(ctx, 'list_shares', `${activeShares(ctx.record).length} active links`)
      return (
        ctx.record.shares
          .map((s) => `[${s.id}] ${s.permission} — scope ${s.scope === 'all' ? 'all' : s.scope.join(', ')} — ${s.revoked_at ? 'revoked' : s.expires_at ? `expires ${s.expires_at}` : 'no expiry'}`)
          .join('\n') || 'No share links yet.'
      )
    }
    case 'propose_share': {
      const permission: SharePermission = args.permission === 'mark_done' ? 'mark_done' : 'view'
      const scopeArg = Array.isArray(args.scope) ? (args.scope as unknown[]).filter((g): g is ObligationGroup => GROUPS.includes(g as ObligationGroup)) : []
      const scope: ObligationGroup[] | 'all' = scopeArg.length ? scopeArg : 'all'
      const days = Number(args.expires_in_days)
      const expires_at = Number.isFinite(days) && days > 0 ? addDays(ctx.today, Math.min(Math.round(days), 365)) : null
      return propose(ctx, {
        id: newId(),
        tool: 'create_share',
        args: { permission, scope, expires_at },
        summary: `Create a ${permission === 'mark_done' ? 'view-and-mark-done' : 'view-only'} link for your CA covering ${scope === 'all' ? 'every filing' : scope.join(', ')}${expires_at ? `, expiring ${formatDate(expires_at)}` : ''}`,
        created_at: new Date().toISOString(),
      })
    }
    case 'propose_revoke_share': {
      const active = activeShares(ctx.record)
      const target = active.find((s) => s.id === str('share_id')) ?? (active.length === 1 || str('share_id') === 'latest' ? active[0] : undefined)
      if (!target) {
        call(ctx, 'propose_revoke_share', active.length ? 'Which link? Several are active' : 'No active links', false)
        return active.length ? `Several links are active; name one: ${active.map((s) => s.id).join(', ')}` : 'There is no active share link.'
      }
      return propose(ctx, {
        id: newId(),
        tool: 'revoke_share',
        args: { share_id: target.id },
        summary: `Revoke the ${target.permission === 'mark_done' ? 'view-and-mark-done' : 'view-only'} link created ${target.created_at.slice(0, 10)}`,
        created_at: new Date().toISOString(),
      })
    }

    // --- Activity, settings, autopilot ------------------------------
    case 'read_activity': {
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30)
      call(ctx, 'read_activity', `Read ${Math.min(limit, ctx.record.activity.length)} entries`)
      return ctx.record.activity.slice(0, limit).map((a) => `${a.at.slice(0, 16).replace('T', ' ')} ${a.actor}: ${a.action} — ${a.detail}`).join('\n') || 'Nothing in the activity log yet.'
    }
    case 'set_budget': {
      const budget = str('budget') as BudgetBand
      if (!BUDGETS.includes(budget)) {
        call(ctx, 'set_budget', 'Unknown budget band', false)
        return `Budget must be one of ${BUDGETS.join(', ')}.`
      }
      ctx.record = logActivity({ ...ctx.record, budget }, 'agent', 'Set CA budget', budget)
      call(ctx, 'set_budget', `Budget set to ${budget}`)
      return `CA budget set to ${budget}.`
    }
    case 'set_autopilot': {
      const enabled = args.enabled !== false
      ctx.record = logActivity({ ...ctx.record, autopilot: { ...ctx.record.autopilot, enabled } }, 'agent', enabled ? 'Autopilot on' : 'Autopilot off', '')
      call(ctx, 'set_autopilot', enabled ? 'Autopilot switched on' : 'Autopilot switched off')
      return enabled ? 'Autopilot is on: I check in every morning at 09:00 IST.' : 'Autopilot is off: I will only act when asked.'
    }
    case 'run_autopilot': {
      const { record, report } = runAutopilot(ctx.record, ctx.today, { force: true })
      // The briefing is the autopilot's own chat message; this turn's reply summarises it instead.
      ctx.record = report.briefing ? { ...record, agentMessages: record.agentMessages.filter((m) => m.id !== report.briefing?.id) } : record
      if (report.drafted_files) ctx.drafted = { files: report.drafted_files, folders: report.drafted_folders, missing: report.missing }
      call(ctx, 'run_autopilot', `${plural(report.reminders, 'reminder')}, ${plural(report.drafted_folders, 'folder')} drafted`)
      return report.briefing?.text ?? (report.skipped === 'empty' ? 'The record is empty, so there is nothing to check yet.' : 'Checked: nothing is due, overdue or needs drafting.')
    }
    default:
      call(ctx, name || 'unknown', 'Unknown tool', false)
      return `There is no tool called ${name}.`
  }
}

// ---------------------------------------------------------------------------
// The deterministic brain

function greeting(kb: Knowledge) {
  const known = Object.keys(kb.facts).length
  if (!known) {
    return 'I keep a record of your business and run the tracker from it. To start: what is the company called, what type is it, and which state is it in? You can write it all in one line.'
  }
  const missing = missingFacts(kb)
  if (missing.length) return `I have ${known} facts on file. To finish the picture: ${missing[0].ask}`
  return 'Your record is complete. Ask what is due, tell me a change (“we now have 25 employees”), say when something is filed, or ask me to draft, remind, share or run the morning check.'
}

function summaryOf(kb: Knowledge): string[] {
  const bits: string[] = []
  const name = factValue<string>(kb, 'legal_name')
  const entity = factValue<string>(kb, 'entity')
  const state = factValue<string>(kb, 'state')
  if (name) bits.push(name)
  if (entity) bits.push(entity.replace('_', ' '))
  if (state) bits.push(state)
  return bits
}

function brainReply(ctx: Ctx): string {
  const message = ctx.message.trim()
  const lower = message.toLowerCase()

  if (/\b(revoke|remove access|stop sharing|kill the link|disable the link)\b/.test(lower)) {
    return executeTool(ctx, 'propose_revoke_share', { share_id: 'latest' })
  }
  if (/\bshare\b.*\b(ca|accountant|link|calendar)\b|\bshare link\b|give .*(ca|accountant).* access|send .* to (my |our )?(ca|accountant)/.test(lower)) {
    const permission = /mark|tick|update|edit/.test(lower) ? 'mark_done' : 'view'
    const days = lower.match(/(\d{1,3})\s*days?/)
    const scope = GROUPS.filter((g) => lower.includes(g.replace('_', ' ')) || (g === 'gst' && /\bgst\b/.test(lower)))
    return executeTool(ctx, 'propose_share', { permission, scope, expires_in_days: days ? Number(days[1]) : 30 })
  }
  if (/\b(take care of|handle (it|this|everything)|sort (it|this|everything) out|do (it|everything) for me|manage (it|everything))\b/.test(lower)) {
    // Everything that is safe to do alone, then what still needs the founder.
    const drafted = executeTool(ctx, 'draft_documents', { scope: 'due_soon' })
    const reminded = executeTool(ctx, 'run_reminders', {})
    const overdue = deadlines(ctx).filter((d) => d.status !== 'done' && (d.days_left ?? 0) < 0)
    const missing = missingFacts(ctx.record.knowledge)
    return [
      drafted.startsWith('No open filing') ? 'Nothing is due in the next 30 days that needs drafting.' : drafted,
      reminded.startsWith('No reminder') ? 'No reminder was due today.' : `Queued ${plural(reminded.split('\n').length, 'reminder')}.`,
      overdue.length ? `Still needs you: ${overdue.map((d) => d.short).join(', ')} ${overdue.length === 1 ? 'is' : 'are'} overdue — tell me once filed.` : '',
      missing.length ? `To do more, I need: ${missing[0].ask}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }
  if (/\b(autopilot|morning check|daily check|check in|run everything|run the day)\b/.test(lower)) {
    if (/\b(off|pause|stop|disable)\b/.test(lower)) return executeTool(ctx, 'set_autopilot', { enabled: false })
    if (/\b(turn on|enable|resume|switch on)\b/.test(lower)) return executeTool(ctx, 'set_autopilot', { enabled: true })
    return executeTool(ctx, 'run_autopilot', {})
  }

  // Status changes before facts: "we filed the AGM from our office" is about the AGM, not the office.
  if (/\b(reopen|undo|not (actually )?(done|filed)|mark .* (open|not done))\b/.test(lower)) return executeTool(ctx, 'reopen', { item: message })
  if (/mark .*(done|filed|paid)|\b(i|we) (have |already )?(filed|paid|submitted|completed)\b|\bis (done|filed)\b/.test(lower)) {
    return executeTool(ctx, 'mark_done', { item: message })
  }

  const extracted = extractFacts(message, ctx.record.knowledge)
  if (Object.keys(extracted.patch).length) {
    runUpdate(ctx, extracted.patch, 'agent')
    const justNow = ctx.changes.map((c) => `${c.label.toLowerCase()} ${c.to}`).join(', ')
    const missing = missingFacts(ctx.record.knowledge)
    return ctx.changes.length
      ? `Saved: ${justNow}.${ctx.errors.length ? ` I skipped ${ctx.errors.map((e) => e.message).join(' ')}` : ''}${missing.length ? ` Next: ${missing[0].ask}` : ' Your record is complete and the calendar is up to date.'}`
      : `I already had that.${missing.length ? ` Still needed: ${missing[0].ask}` : ''}`
  }

  if (/draft|compile|prepare|paperwork|documents? for|generate/.test(lower)) {
    const scope = /all|everything|every|whole year/.test(lower) ? 'all' : /overdue|late/.test(lower) ? 'overdue' : /soon|this month|upcoming/.test(lower) ? 'due_soon' : undefined
    return executeTool(ctx, 'draft_documents', { scope, query: message })
  }
  if (/\b(remind|reminders?)\b/.test(lower)) {
    if (/\b(log|history|sent|list|show)\b/.test(lower)) return executeTool(ctx, 'list_reminders', {})
    const result = executeTool(ctx, 'run_reminders', {})
    return result.startsWith('No reminder') ? result : `Queued today’s reminders:\n${result}`
  }
  if (/\b(activity|history|what happened|audit|log)\b/.test(lower)) return `Latest activity:\n${executeTool(ctx, 'read_activity', { limit: 8 })}`
  // "What happens if I miss X?" is a question about X, not a request for the overdue list.
  if (/\bwhat happens\b|\bwhat if\b|\bif (i|we) (miss|skip|forget|am late|are late|don.?t file)\b|\bpenalt|\blate fee\b|\bfine for\b/.test(lower)) {
    return executeTool(ctx, 'explain_item', { item: message, question: message })
  }
  if (/\b(overdue|late|missed)\b/.test(lower)) return executeTool(ctx, 'get_calendar', { filter: 'overdue' })
  if (/\b(checklist|papers|which documents|what documents)\b/.test(lower)) return executeTool(ctx, 'get_deadline', { item: message })
  if (/\b(compiled|folders|my documents|list documents)\b/.test(lower)) return executeTool(ctx, 'list_documents', {})
  if (/\bdue\b|calendar|deadline|what.?s next|next up|when is|owe/.test(lower)) {
    return executeTool(ctx, 'get_calendar', { filter: /month|30 days|soon/.test(lower) ? 'next_30' : 'open', limit: 5 })
  }
  if (/\b(obligations?|what applies|which filings)\b/.test(lower)) return executeTool(ctx, 'list_obligations', {})
  if (/explain|what does|what is .*(mean|for)|why|mean\b/.test(lower)) return executeTool(ctx, 'explain_item', { item: message, question: message })
  if (/\bca\b|accountant|chartered/.test(lower)) return `To bring in your CA, give them a share link from the Share page.\n${executeTool(ctx, 'list_shares', {})}`
  if (/^(hi|hello|hey|namaste)\b/.test(lower) || lower.length < 4) return greeting(ctx.record.knowledge)
  if (/what do you know|profile|record|summary|remember/.test(lower)) {
    const known = Object.keys(ctx.record.knowledge.facts).length
    const bits = summaryOf(ctx.record.knowledge)
    const suggested = suggestedFacts(ctx.record.knowledge)
    call(ctx, 'read_company', `Read ${known} facts`)
    return `${bits.length ? `I have ${bits.join(' · ')}. ` : ''}${known} facts on file.${suggested.length ? ` I could also note: ${suggested[0].label.toLowerCase()}.` : ''}`
  }
  const missing = missingFacts(ctx.record.knowledge)
  return missing.length
    ? `I did not find a company fact in that. ${missing[0].ask}`
    : 'I can update the record, show what is due, draft filings, tick checklists, mark things filed, run reminders, share with your CA or run the morning check. For anything outside compliance, ask a CA.'
}

// ---------------------------------------------------------------------------
// The model path

const FACT_KEYS = FIELDS.map((f) => f.key).join(', ')

const SYSTEM_PROMPT = `You are the agent that runs a compliance tracker for an Indian startup. You run inside the tracker's app server, next to the company record, and you manage the whole tracker through tools: the company record, obligations, calendar, deadline checklists, document drafts, reminders, share links for the CA, the activity log and the daily autopilot.

How to work:
- Pull data with tools whenever you need it (read_company, get_calendar, get_deadline, list_documents, list_reminders, list_shares, read_activity). Do not guess what is in the record.
- Deadlines, applicability and penalties come only from tools. Never invent a date, form number or penalty.
- Update the record only from what the founder actually said, with update_company and the exact fact keys. If a value is unclear, ask one short question.
- Call mark_done only when the founder says a filing is filed or paid. Use the deadline id from get_calendar when you have it.
- Sharing the record or revoking a link is never done directly: propose_share / propose_revoke_share create a request the founder approves. Say that it is waiting for approval.
- When the founder asks you to "handle it", "take care of everything" or similar, do the safe things yourself: draft what is due soon, run reminders, tick documents they said they have, and report what still needs them.
- Reply in short sentences a first-time founder can follow. At most one question per reply. Guidance, not legal advice; you never file on a government portal.`

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) })
const tool = (name: string, description: string, parameters: Record<string, unknown> = obj()): ToolSpec => ({ name, description, parameters })
const item = { item: { type: 'string', description: 'Deadline id from get_calendar (best), or the filing name, e.g. "AGM" or "GSTR-3B".' } }

export const TOOL_SPECS: ToolSpec[] = [
  tool('read_company', 'Read every fact on the company record, with where it came from, and which required facts are missing.'),
  tool(
    'update_company',
    'Save validated facts the founder stated.',
    obj({ facts: { type: 'object', description: `Fact key to value. Keys: ${FACT_KEYS}`, additionalProperties: true } }, ['facts']),
  ),
  tool('list_obligations', 'List the obligations that apply, with the reason each applies.'),
  tool(
    'get_calendar',
    'Read dated deadlines with id, authority, due date, urgency, status and penalty.',
    obj({ filter: { type: 'string', enum: ['open', 'overdue', 'next_30', 'done', 'events'] }, limit: { type: 'number' } }),
  ),
  tool('get_deadline', 'Read one deadline in full: reason, how to file, checklist state of each document, reminders logged.', obj(item, ['item'])),
  tool('explain_item', 'Explain one filing in plain words from its stored record.', obj({ ...item, question: { type: 'string' } }, ['item'])),
  tool('mark_done', 'Mark one deadline done. Only when the founder says it is filed or paid. Stops its reminders.', obj(item, ['item'])),
  tool('reopen', 'Reopen a deadline that was marked done by mistake.', obj(item, ['item'])),
  tool(
    'tick_document',
    'Mark a checklist document as held (have=true) or missing (have=false) for one deadline.',
    obj({ ...item, document: { type: 'string', description: `Document key: ${Object.keys(DOC_LABELS).join(', ')}` }, have: { type: 'boolean' } }, ['item', 'document']),
  ),
  tool(
    'draft_documents',
    'Draft the documents for one filing (item) or a whole scope, into the Documents folders.',
    obj({ ...item, scope: { type: 'string', enum: ['all', 'overdue', 'due_soon'] } }),
  ),
  tool('list_documents', 'List the compiled document folders.'),
  tool('run_reminders', 'Run today’s reminder job. Idempotent: never sends the same reminder twice.'),
  tool('list_reminders', 'Read the reminder log, newest first.', obj({ limit: { type: 'number' } })),
  tool('list_shares', 'List the CA share links and their state.'),
  tool(
    'propose_share',
    'Propose a share link for the CA. The founder must approve it.',
    obj({
      permission: { type: 'string', enum: ['view', 'mark_done'] },
      scope: { type: 'array', items: { type: 'string', enum: GROUPS }, description: 'Omit for every filing.' },
      expires_in_days: { type: 'number' },
    }),
  ),
  tool('propose_revoke_share', 'Propose revoking a share link. The founder must approve it.', obj({ share_id: { type: 'string', description: 'Id from list_shares, or "latest".' } }, ['share_id'])),
  tool('read_activity', 'Read the activity log: record edits, shares, CA actions, autopilot runs.', obj({ limit: { type: 'number' } })),
  tool('set_budget', 'Set the yearly CA budget band.', obj({ budget: { type: 'string', enum: BUDGETS } }, ['budget'])),
  tool('set_autopilot', 'Switch the daily 09:00 IST autopilot on or off.', obj({ enabled: { type: 'boolean' } }, ['enabled'])),
  tool('run_autopilot', 'Run the morning check now: reminders, drafts for anything due soon, and a summary.'),
]

function situation(ctx: Ctx): string {
  const all = deadlines(ctx)
  const s = summarise(all)
  const overdue = all.filter((d) => d.status !== 'done' && (d.days_left ?? 0) < 0).length
  const name = factValue<string>(ctx.record.knowledge, 'legal_name')
  return [
    `Today is ${ctx.today}.`,
    `Company: ${name ?? 'not named yet'}. ${Object.keys(ctx.record.knowledge.facts).length} facts on file; ${missingFacts(ctx.record.knowledge).length} required facts missing.`,
    `Calendar: ${s.total} deadlines, ${s.urgent} urgent, ${overdue} overdue. ${ctx.record.generated.length} drafted files. ${activeShares(ctx.record).length} active share links. ${ctx.record.pending.length} actions awaiting approval. Autopilot ${ctx.record.autopilot.enabled ? 'on' : 'off'}.`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// One turn

function newCtx(input: AgentInput): Ctx {
  return {
    record: input.record,
    message: input.message.trim(),
    today: input.today ?? input.record.today,
    language: input.language ?? 'en',
    calls: [],
    actions: [],
    changes: [],
    errors: [],
    proposed: [],
  }
}

function finish(ctx: Ctx, reply: string, model: ModelStatus, engineLabel: string, founderAt: string): AgentReply {
  const founder: AgentChatMessage = { id: newId(), role: 'founder', text: ctx.message, at: founderAt }
  const agent: AgentChatMessage = {
    id: newId(),
    role: 'agent',
    text: reply,
    at: new Date().toISOString(),
    calls: ctx.calls,
    actions: ctx.actions,
    changes: ctx.changes.map((c) => ({ label: c.label, to: c.to })),
    engine: engineLabel,
  }
  return {
    reply,
    record: addMessages(ctx.record, [founder, agent]),
    calls: ctx.calls,
    actions: ctx.actions,
    changes: ctx.changes,
    errors: ctx.errors,
    missing: missingFacts(ctx.record.knowledge).map((f) => ({ key: f.key, label: f.label, ask: f.ask })),
    model,
    drafted: ctx.drafted,
    proposed: ctx.proposed,
  }
}

/** The deterministic engine; also runs in the browser when the Worker is unreachable. */
export function localBrain(input: AgentInput, engineLabel = BRAIN_STATUS.engine): AgentReply {
  const founderAt = new Date().toISOString()
  const ctx = newCtx(input)
  const reply = brainReply(ctx)
  return finish(ctx, reply, BRAIN_STATUS, engineLabel, founderAt)
}

/** Masked, content-free log line per turn: which engine, how long, which tools, why it fell back. */
function logTurn(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ event: 'agent_turn', ...entry }))
}

/**
 * The agent loop: a model chooses tools for up to LIMITS.steps steps; every
 * tool call is validated by the tool itself, and the final reply must be
 * grounded in what the tools returned. Any failure lands on the deterministic
 * brain or on a code-written summary, never on an unchecked answer.
 */
export async function runAgent(input: AgentInput, env: ModelEnv, engines: Engine | Engine[] | null = enginesFor(env)): Promise<AgentReply> {
  const started = Date.now()
  const candidates = engines === null ? [] : Array.isArray(engines) ? engines : [engines]
  if (!candidates.length) {
    const reply = { ...localBrain(input), fallback: 'no_engine' as const }
    logTurn({ engine: 'brain', ms: Date.now() - started, fallback: reply.fallback, tools: reply.calls.map((c) => c.name) })
    return reply
  }
  // The first reachable engine drives the turn: a company's own model, then Claude.
  let engine: Engine | undefined
  let status: ModelStatus | undefined
  let firstStatus: ModelStatus | undefined
  for (const candidate of candidates) {
    const s = await candidate.status()
    firstStatus ??= s
    if (s.connected) {
      engine = candidate
      status = s
      break
    }
  }
  if (!engine || !status) {
    const reply = { ...localBrain(input), model: firstStatus ?? BRAIN_STATUS, fallback: 'engine_down' as const }
    logTurn({ engine: candidates.map((c) => c.id).join('>'), ms: Date.now() - started, fallback: reply.fallback, tools: reply.calls.map((c) => c.name) })
    return reply
  }

  const founderAt = new Date().toISOString()
  const ctx = newCtx(input)
  const history: Turn[] = input.record.agentMessages
    .filter((m) => m.id !== 'greeting')
    .slice(-10)
    .map((m) => (m.role === 'founder' ? { role: 'user' as const, text: maskIdentifiers(m.text) } : { role: 'assistant' as const, text: maskIdentifiers(m.text) }))
  const context = `${situation(ctx)}\n\nCompany record:\n${maskIdentifiers(knowledgeForPrompt(ctx.record.knowledge))}`
  // The model only ever sees masked identifiers: in the message, the record, the history and every tool result.
  const turns: Turn[] = [...history, { role: 'user', text: maskIdentifiers(ctx.message) }]
  const sources: string[] = [context, ...turns.map((t) => (t.role === 'tool' ? t.output : t.text))]
  const seen = new Map<string, string>()

  let reply = ''
  let steps = 0
  let failed = false
  let totalCalls = 0
  for (; steps < LIMITS.steps; steps++) {
    const result = await engine.step({ system: [SYSTEM_PROMPT, context], turns, tools: TOOL_SPECS })
    if (!result) {
      failed = true
      break
    }
    if (!result.toolCalls.length) {
      reply = result.text.trim()
      break
    }
    turns.push({ role: 'assistant', text: result.text ?? '', toolCalls: result.toolCalls, raw: result.raw })
    result.toolCalls.forEach((c, index) => {
      let output: string
      if (index >= LIMITS.callsPerStep || totalCalls >= LIMITS.callsPerTurn) {
        output = 'Skipped: too many tool calls. Use fewer, and answer with what you already have.'
      } else {
        // The same call twice in one turn runs once: no double drafts, no repeated writes.
        const key = `${c.name}:${JSON.stringify(c.args)}`
        const previous = seen.get(key)
        if (previous !== undefined) output = `Already done this turn. Result: ${previous}`
        else {
          totalCalls++
          output = maskIdentifiers(executeTool(ctx, c.name, c.args))
          seen.set(key, output)
        }
      }
      turns.push({ role: 'tool', callId: c.id, name: c.name, output })
      sources.push(output)
    })
  }

  const label = status.model ?? 'model'
  const toolNames = ctx.calls.map((c) => c.name)
  const finishWith = (text: string, engineLabel: string, fallback?: AgentReply['fallback'], unsupported: string[] = []) => {
    logTurn({ engine: engine.id, model: status.model, ms: Date.now() - started, steps: steps + (reply ? 1 : 0), tools: toolNames, tool_errors: ctx.calls.filter((c) => !c.ok).length, fallback, unsupported: unsupported.length })
    return { ...finish(ctx, text, status, engineLabel, founderAt), ...(fallback ? { fallback } : {}) }
  }
  // Tool summaries are written by code from the tool results, so they are safe to show as-is.
  const summary = () => {
    const done = ctx.calls.filter((c) => c.ok).map((c) => c.summary)
    const refused = ctx.calls.filter((c) => !c.ok).map((c) => c.summary)
    return [done.length && `Done: ${done.join('; ')}.`, refused.length && `Not done: ${refused.join('; ')}.`].filter(Boolean).join(' ')
  }

  if (reply) {
    const numbers = checkGrounding(reply, sources)
    const claims = unbackedClaims(reply, ctx.calls)
    const syntax = looksLikeToolSyntax(reply, TOOL_SPECS.map((t) => t.name))
    const check = { grounded: numbers.grounded && !claims.length && !syntax, unsupported: [...numbers.unsupported, ...claims, ...(syntax ? ['tool syntax'] : [])] }
    if (check.grounded) return finishWith(reply, label)
    // An unsupported number: show what the tools did instead of the model's wording.
    if (ctx.calls.length) return finishWith(summary(), `${label} (checked)`, 'ungrounded', check.unsupported)
    const brain = localBrain(input)
    logTurn({ engine: engine.id, model: status.model, ms: Date.now() - started, steps: steps + 1, tools: [], fallback: 'ungrounded', unsupported: check.unsupported.length })
    return { ...brain, model: status, fallback: 'ungrounded' }
  }

  // The model failed or ran out of steps. Keep whatever its tools did;
  // if it did nothing, let the deterministic brain take the whole turn.
  const fallback = failed ? ('engine_failed' as const) : ('out_of_steps' as const)
  if (!ctx.calls.length) {
    const brain = localBrain(input)
    logTurn({ engine: engine.id, model: status.model, ms: Date.now() - started, steps, tools: [], fallback })
    return { ...brain, model: status, fallback }
  }
  return finishWith(summary() || 'I could not finish that. Try asking in a shorter way.', `${label} (summarised)`, fallback)
}

// ---------------------------------------------------------------------------
// Approvals

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Approve or decline one proposed action. Only the signed-in founder reaches this. */
export async function resolvePending(
  record: CompanyRecord,
  id: string,
  approve: boolean,
): Promise<{ record: CompanyRecord; ok: boolean; message: string; share?: ShareLink }> {
  const pending = record.pending.find((p) => p.id === id)
  if (!pending) return { record, ok: false, message: 'That request is no longer waiting.' }
  let next: CompanyRecord = { ...record, pending: record.pending.filter((p) => p.id !== id) }

  if (!approve) {
    next = logActivity(next, 'founder', 'Declined agent request', pending.summary)
    next = addMessages(next, [{ id: newId(), role: 'agent', text: `Understood, I did not do it: ${pending.summary.charAt(0).toLowerCase()}${pending.summary.slice(1)}.`, at: new Date().toISOString() }])
    return { record: next, ok: true, message: 'Declined.' }
  }

  if (pending.tool === 'create_share') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    const share: ShareLink = {
      id: newId(),
      token,
      token_hash: await sha256Hex(token),
      permission: pending.args.permission,
      scope: pending.args.scope,
      expires_at: pending.args.expires_at,
      revoked_at: null,
      created_at: new Date().toISOString(),
    }
    next = { ...next, shares: [share, ...next.shares] }
    next = logActivity(next, 'founder', 'Approved share link', pending.summary)
    next = addMessages(next, [
      {
        id: newId(),
        role: 'agent',
        text: `Approved. The link is ready: /s/${token}\nSend it to your CA. You can revoke it any time.`,
        at: new Date().toISOString(),
        calls: [{ name: 'create_share', summary: 'Created share link', ok: true }],
        actions: [{ label: 'Manage share links', to: '/share' }],
      },
    ])
    return { record: next, ok: true, message: 'Share link created.', share }
  }

  const target = next.shares.find((s) => s.id === pending.args.share_id)
  if (!target || target.revoked_at) return { record: next, ok: false, message: 'That link is already gone.' }
  next = { ...next, shares: next.shares.map((s) => (s.id === target.id ? { ...s, revoked_at: new Date().toISOString() } : s)) }
  next = logActivity(next, 'founder', 'Revoked share link', target.id)
  next = addMessages(next, [{ id: newId(), role: 'agent', text: 'Approved. That share link no longer works.', at: new Date().toISOString(), calls: [{ name: 'revoke_share', summary: 'Revoked share link', ok: true }] }])
  return { record: next, ok: true, message: 'Share link revoked.' }
}
