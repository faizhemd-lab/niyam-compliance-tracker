import { CAS } from './catalogue'
import { compileDeadline } from './documents'
import { formatDate } from './format'
import { explain, maskIdentifiers } from './gateway'
import { matchCAs } from './matching'
import { evaluateRules } from './rules'
import { buildCalendar, type StatusMap } from './schedule'
import {
  FIELDS,
  applyFacts,
  extractFacts,
  factValue,
  hasFact,
  knowledgeForPrompt,
  knowledgeToCompany,
  missingFacts,
  suggestedFacts,
  type FactSource,
  type Knowledge,
  type KnowledgeField,
} from './knowledge'
import type { BudgetBand, Deadline, GeneratedFile, Language } from './types'

/**
 * The agent. One brain, two engines behind it:
 *
 * - a self-hosted OpenAI-compatible model (Ollama, llama.cpp, vLLM) reached
 *   through the model gateway, using tool calls to read and update the company
 *   knowledge base and to draft documents;
 * - an on-server deterministic brain, used when no model is configured or the
 *   model is unreachable, so the product still works.
 *
 * In both engines every write goes through the same validation. The model can
 * propose facts, never a deadline: rules and dates still come from the engine.
 */

export type ModelEnv = { MODEL_BASE_URL?: string; MODEL_NAME?: string; MODEL_API_KEY?: string }

export type ModelStatus = {
  configured: boolean
  connected: boolean
  engine: string
  model?: string
  models?: string[]
  detail?: string
}

export type AgentToolName =
  | 'update_company'
  | 'read_company'
  | 'list_obligations'
  | 'get_calendar'
  | 'draft_documents'
  | 'explain_item'
  | 'mark_done'
  | 'find_ca'
  | 'answer'

export type AgentCall = { name: AgentToolName; summary: string; ok: boolean }
export type AgentAction = { label: string; to: string }

export type AgentFactChange = { key: KnowledgeField; label: string; from?: string; to: string; source: FactSource }

export type AgentReply = {
  reply: string
  knowledge: Knowledge
  calls: AgentCall[]
  actions: AgentAction[]
  changes: AgentFactChange[]
  errors: { key: KnowledgeField; message: string }[]
  missing: { key: KnowledgeField; label: string; ask: string }[]
  model: ModelStatus
  drafted?: { files: GeneratedFile[]; folder_count: number; missing: string[] }
  mark_done?: string
}

export type AgentInput = {
  knowledge: Knowledge
  message: string
  history: { role: 'founder' | 'agent'; text: string }[]
  today: string
  statuses: StatusMap
  budget?: BudgetBand
  language?: Language
}

type Ctx = {
  input: AgentInput
  knowledge: Knowledge
  calls: AgentCall[]
  actions: AgentAction[]
  changes: AgentFactChange[]
  errors: AgentReply['errors']
  drafted?: AgentReply['drafted']
  markDone?: string
}

const MODEL_TIMEOUT = 25_000

export async function modelStatus(env: ModelEnv): Promise<ModelStatus> {
  const baseUrl = env.MODEL_BASE_URL?.replace(/\/$/, '')
  if (!baseUrl) {
    return { configured: false, connected: false, engine: 'on-server deterministic brain' }
  }
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: env.MODEL_API_KEY ? { authorization: `Bearer ${env.MODEL_API_KEY}` } : undefined,
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return { configured: true, connected: false, engine: 'local model', model: env.MODEL_NAME, detail: `The model server answered ${res.status}.` }
    const body = (await res.json()) as { data?: { id?: string }[] }
    const models = (body.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
    return { configured: true, connected: true, engine: 'self-hosted model', model: env.MODEL_NAME ?? models[0], models }
  } catch (error) {
    return {
      configured: true,
      connected: false,
      engine: 'local model',
      model: env.MODEL_NAME,
      detail: error instanceof Error ? error.message.slice(0, 160) : 'The model server is unreachable.',
    }
  }
}

// ---------------------------------------------------------------------------
// Tools

function deadlinesFor(input: AgentInput): Deadline[] {
  const profile = knowledgeToCompany(input.knowledge)
  const obligations = evaluateRules(profile)
  return buildCalendar(profile, obligations, input.today, input.statuses).deadlines
}

function findDeadline(deadlines: Deadline[], query: string): Deadline | undefined {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  let best: { deadline: Deadline; score: number } | undefined
  for (const deadline of deadlines) {
    const haystack = `${deadline.rule_id} ${deadline.name} ${deadline.short} ${deadline.authority}`.toLowerCase()
    const score = words.reduce((n, word) => n + (haystack.includes(word) ? 1 : 0), 0)
    if (score > 0 && (!best || score > best.score)) best = { deadline, score }
  }
  return best?.deadline
}

function runUpdate(ctx: Ctx, patch: Partial<Record<KnowledgeField, unknown>>, source: FactSource): string {
  const result = applyFacts(ctx.knowledge, patch, source, new Date().toISOString())
  ctx.knowledge = result.knowledge
  ctx.changes.push(...result.changed.map((c) => ({ ...c, source })))
  ctx.errors.push(...result.errors)
  ctx.calls.push({
    name: 'update_company',
    summary: result.changed.length
      ? `Updated ${result.changed.map((c) => `${c.label} to ${c.to}`).join(', ')}`
      : result.errors.length
        ? `Rejected ${result.errors.length} value${result.errors.length === 1 ? '' : 's'}`
        : 'No change',
    ok: result.errors.length === 0,
  })
  return result.changed.map((c) => `${c.label}: ${c.to}`).join('; ')
}

function runDraft(ctx: Ctx, args: { scope?: string; rule_id?: string; query?: string }): string {
  const deadlines = deadlinesFor(ctx.input).filter((d) => d.status !== 'done')
  const company = knowledgeToCompany(ctx.knowledge)
  let chosen: Deadline[] = []
  if (args.rule_id) chosen = deadlines.filter((d) => d.rule_id === args.rule_id || d.id === args.rule_id)
  else if (args.scope === 'all' || args.scope === 'everything') chosen = deadlines.filter((d) => d.due_date).slice(0, 12)
  else if (args.scope === 'overdue') chosen = deadlines.filter((d) => (d.days_left ?? 0) < 0)
  else if (args.query) {
    const match = findDeadline(deadlines, args.query)
    if (match) chosen = [match]
  }
  if (!chosen.length) {
    ctx.calls.push({ name: 'draft_documents', summary: 'Nothing matched that filing', ok: false })
    return 'I could not find that filing on your calendar. Tell me its name, or ask for all documents.'
  }

  const files: GeneratedFile[] = []
  const missing = new Set<string>()
  for (const deadline of chosen) {
    const result = compileDeadline(company, deadline, ctx.input.today, [], ctx.knowledge)
    files.push(...result.files)
    result.missing.forEach((m) => missing.add(m))
  }
  ctx.drafted = { files, folder_count: chosen.length, missing: [...missing] }
  ctx.actions.push({ label: 'Open the compiled folders', to: '/documents' })
  ctx.calls.push({
    name: 'draft_documents',
    summary: `Drafted ${files.length} files across ${chosen.length} folder${chosen.length === 1 ? '' : 's'}`,
    ok: true,
  })
  return `${files.length} files for ${chosen.length} folder${chosen.length === 1 ? '' : 's'}`
}

export function executeTool(ctx: Ctx, name: AgentToolName, args: Record<string, unknown>): string {
  const input = ctx.input
  const deadlines = deadlinesFor(input)
  const company = knowledgeToCompany(ctx.knowledge)

  switch (name) {
    case 'update_company': {
      const patch = (args.facts ?? args.patch ?? {}) as Partial<Record<KnowledgeField, unknown>>
      const safe: Partial<Record<KnowledgeField, unknown>> = {}
      for (const [key, value] of Object.entries(patch)) {
        if (FIELDS.some((f) => f.key === key)) safe[key as KnowledgeField] = value
      }
      if (!Object.keys(safe).length) {
        ctx.calls.push({ name: 'update_company', summary: 'No valid facts in that call', ok: false })
        return 'Nothing to update.'
      }
      return runUpdate(ctx, safe, 'agent')
    }
    case 'read_company': {
      ctx.calls.push({ name: 'read_company', summary: `Read ${Object.keys(ctx.knowledge.facts).length} facts`, ok: true })
      return knowledgeForPrompt(ctx.knowledge)
    }
    case 'list_obligations': {
      const obligations = evaluateRules(company)
      ctx.calls.push({ name: 'list_obligations', summary: `${obligations.length} obligations apply`, ok: true })
      return obligations.map((o) => `${o.name} (${o.authority}, rule ${o.rule_version})`).join('\n')
    }
    case 'get_calendar': {
      const open = deadlines.filter((d) => d.status !== 'done')
      const next = open.filter((d) => d.due_date).slice(0, 6)
      ctx.actions.push({ label: 'Open the calendar', to: '/calendar' })
      ctx.calls.push({ name: 'get_calendar', summary: `${open.length} open deadlines`, ok: true })
      return next.map((d) => `${d.due_date}: ${d.name} — ${d.authority} (${d.penalty})`).join('\n')
    }
    case 'draft_documents':
      return runDraft(ctx, args as { scope?: string; rule_id?: string; query?: string })
    case 'explain_item': {
      const deadline = findDeadline(deadlines, String(args.item ?? args.query ?? '')) ?? deadlines.find((d) => d.due_date)
      if (!deadline) {
        ctx.calls.push({ name: 'explain_item', summary: 'Nothing to explain yet', ok: false })
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
        input.language ?? 'en',
        String(args.question ?? ''),
      )
      ctx.calls.push({ name: 'explain_item', summary: `Explained ${deadline.short}`, ok: true })
      return result.text
    }
    case 'mark_done': {
      const deadline = findDeadline(deadlines, String(args.item ?? args.query ?? ''))
      if (!deadline) {
        ctx.calls.push({ name: 'mark_done', summary: 'No matching deadline', ok: false })
        return 'I could not match that to a deadline.'
      }
      ctx.markDone = deadline.id
      ctx.calls.push({ name: 'mark_done', summary: `Marked ${deadline.short} done`, ok: true })
      return `${deadline.short} is marked done; reminders for it stop.`
    }
    case 'find_ca': {
      const matches = matchCAs(company, deadlines, CAS, input.budget).slice(0, 3)
      if (!matches.length) {
        ctx.calls.push({ name: 'find_ca', summary: 'No firms in the directory', ok: true })
        return 'The CA directory is not open yet, so there are no firms for me to match you with. You can still give your own CA a scoped share link from the Share page.'
      }
      ctx.actions.push({ label: 'See all matched CAs', to: '/ca' })
      ctx.calls.push({ name: 'find_ca', summary: `Scored ${CAS.length} accountants`, ok: true })
      return matches.map((m) => `${m.ca.name} (${m.ca.city}, score ${m.score}): ${m.reasons[0]}`).join('\n')
    }
    case 'answer':
    default: {
      ctx.calls.push({ name: 'answer', summary: 'Replied from the record', ok: true })
      return String(args.text ?? '')
    }
  }
}

// ---------------------------------------------------------------------------
// The deterministic brain

function greeting(kb: Knowledge) {
  const known = Object.keys(kb.facts).length
  if (!known) {
    return 'I keep a record of your business and turn it into a compliance calendar. To start: what is the company called, what type is it, and which state is it in? You can write it all in one line.'
  }
  const missing = missingFacts(kb)
  if (missing.length) {
    return `I have ${known} facts on file. To finish the picture: ${missing[0].ask}`
  }
  return 'Your record is complete. Ask me what is due, tell me a change (“we now have 25 employees”), or ask me to draft the documents for any filing.'
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

export function localBrain(input: AgentInput): AgentReply {
  const ctx: Ctx = { input, knowledge: input.knowledge, calls: [], actions: [], changes: [], errors: [] }
  const message = input.message.trim()
  const lower = message.toLowerCase()
  const extracted = extractFacts(message, ctx.knowledge)
  const hasFacts = Object.keys(extracted.patch).length > 0
  let reply = ''

  if (hasFacts) {
    runUpdate(ctx, extracted.patch, 'agent')
    const justNow = ctx.changes.map((c) => `${c.label.toLowerCase()} ${c.to}`).join(', ')
    const missing = missingFacts(ctx.knowledge)
    reply = ctx.changes.length
      ? `Saved: ${justNow}.${ctx.errors.length ? ` I skipped ${ctx.errors.map((e) => e.message).join(' ')}` : ''}${missing.length ? ` Next: ${missing[0].ask}` : ' Your record is complete.'}`
      : `I already had that.${missing.length ? ` Still needed: ${missing[0].ask}` : ''}`
  } else if (/draft|compile|prepare|paperwork|documents? for|generate/.test(lower)) {
    const result = runDraft(ctx, { query: message, scope: /all|everything|every|whole year/.test(lower) ? 'all' : undefined })
    reply = /\d+ files/.test(result) ? `Done: ${result}. Every file carries a DRAFT mark; I filled them from what I know.` : result
    if (ctx.drafted?.missing.length) reply += ` Missing from the record: ${ctx.drafted.missing.join(', ')}.`
  } else if (/mark .*(done|filed)|i (already )?filed|completed/.test(lower)) {
    const result = executeTool(ctx, 'mark_done', { query: message })
    reply = result
  } else if (/\bdue\b|calendar|deadline|what.?s next|next up|when is/.test(lower)) {
    const result = executeTool(ctx, 'get_calendar', {})
    const lines = result.split('\n').filter(Boolean)
    reply = lines.length ? `Next up:\n${lines.slice(0, 4).map((l) => `• ${l}`).join('\n')}` : 'Nothing dated is open right now.'
  } else if (/explain|what does|what is .*(mean|for)|why|mean\b/.test(lower)) {
    reply = executeTool(ctx, 'explain_item', { query: message, question: message })
  } else if (/\bca\b|accountant|chartered/.test(lower)) {
    reply = `Here is who fits your filings:\n${executeTool(ctx, 'find_ca', {})}`
  } else if (/^(hi|hello|hey|namaste)\b/.test(lower) || lower.length < 4) {
    reply = greeting(ctx.knowledge)
  } else if (/what do you know|profile|record|summary|remember/.test(lower)) {
    const known = Object.keys(ctx.knowledge.facts).length
    const bits = summaryOf(ctx.knowledge)
    reply = `${bits.length ? `I have ${bits.join(' · ')}. ` : ''}${known} facts on file.${suggestedFacts(ctx.knowledge).length ? ` I could also note: ${suggestedFacts(ctx.knowledge)[0].label.toLowerCase()}.` : ''}`
  } else {
    const missing = missingFacts(ctx.knowledge)
    reply = missing.length
      ? `I did not find a company fact in that. ${missing[0].ask}`
      : 'I can update company facts, explain a filing, mark something done, draft documents or find a CA. For anything outside compliance, ask a CA.'
  }

  return {
    reply,
    knowledge: ctx.knowledge,
    calls: ctx.calls,
    actions: ctx.actions,
    changes: ctx.changes,
    errors: ctx.errors,
    missing: missingFacts(ctx.knowledge).map((f) => ({ key: f.key, label: f.label, ask: f.ask })),
    model: { configured: false, connected: false, engine: 'on-server deterministic brain' },
    drafted: ctx.drafted,
    mark_done: ctx.markDone,
  }
}

// ---------------------------------------------------------------------------
// The model path

const SYSTEM_PROMPT = `You are the compliance agent inside a tracker for Indian founders. You keep a record of the business and draft its filings.

Rules you must follow:
- Deadlines, applicability and penalties come only from the tools. Never invent a date, a form number or a penalty.
- Update the record only from what the founder actually said. If a value is unclear, ask a short question instead of guessing.
- Call update_company with facts as { "key": value } using exactly the fact keys in the record.
- Before drafting, you may need facts. Draft with draft_documents; if fields are missing, say which ones in plain words.
- Reply in short sentences a first-time founder can follow. At most one question per reply.
- You are guidance, not legal advice. Point to a CA for anything outside compliance.
- Never give legal advice, never claim to file anything.
`

const TOOL_SPECS = [
  {
    type: 'function',
    function: {
      name: 'update_company',
      description: 'Save validated facts about the company. Use only facts the founder stated.',
      parameters: {
        type: 'object',
        properties: {
          facts: {
            type: 'object',
            description: 'Fact key to value. Keys: legal_name, entity, state, cin, pan, gstin, incorporated_on, address, premises, website, contact_email, contact_phone, directors, employees, authorised_signatory, turnover, authorised_capital, paid_up_capital, fy_end, gst_registered, epf_registered, esic_registered, professional_tax_number, shop_licence_number, foreign_investment, investors, last_allotment_on, sells, interstate',
            additionalProperties: true,
          },
        },
        required: ['facts'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_documents',
      description: 'Draft the documents needed for one filing, or for all open filings.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Filing name the founder mentioned, for example "AGM" or "DIR-3 KYC".' },
          scope: { type: 'string', enum: ['all', 'overdue'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_calendar',
      description: 'Read the open deadlines with authority and penalty.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_obligations',
      description: 'List the obligations that apply to this company.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explain_item',
      description: 'Explain one filing using only its stored record.',
      parameters: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_done',
      description: 'Mark one deadline done. Use only when the founder says it is filed.',
      parameters: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_ca',
      description: 'Find accountants matched to this company.',
      parameters: { type: 'object', properties: {} },
    },
  },
  { type: 'function', function: { name: 'read_company', description: 'Read the facts on file.', parameters: { type: 'object', properties: {} } } },
]

type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: unknown }

async function callModel(
  env: ModelEnv,
  messages: ChatMessage[],
  withTools: boolean,
): Promise<{ content: string; tool_calls: { id: string; name: string; args: Record<string, unknown> }[] } | null> {
  const baseUrl = env.MODEL_BASE_URL?.replace(/\/$/, '')
  if (!baseUrl) return null
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.MODEL_API_KEY ? { authorization: `Bearer ${env.MODEL_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: env.MODEL_NAME ?? 'local-model',
        messages,
        ...(withTools ? { tools: TOOL_SPECS, tool_choice: 'auto' } : {}),
        temperature: 0.2,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(MODEL_TIMEOUT),
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      choices?: { message?: { content?: string; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[]
    }
    const message = body.choices?.[0]?.message
    if (!message) return null
    const calls = (message.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call-${index}`,
      name: call.function?.name ?? '',
      args: (() => {
        try {
          return JSON.parse(call.function?.arguments ?? '{}') as Record<string, unknown>
        } catch {
          return {}
        }
      })(),
    }))
    return { content: message.content ?? '', tool_calls: calls }
  } catch {
    return null
  }
}

/** The agent loop: at most three model turns, every tool call validated. */
export async function runAgent(input: AgentInput, env: ModelEnv): Promise<AgentReply> {
  const status = await modelStatus(env)
  if (!status.configured || !status.connected) return localBrain(input)

  const ctx: Ctx = { input, knowledge: input.knowledge, calls: [], actions: [], changes: [], errors: [] }
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Company record:\n${knowledgeForPrompt(ctx.knowledge)}` },
    ...input.history.slice(-8).map((m) => ({ role: m.role === 'founder' ? ('user' as const) : ('assistant' as const), content: m.text })),
    // The prompt only ever sees the masked message.
    { role: 'user', content: maskIdentifiers(input.message) },
  ]

  let reply = ''
  for (let step = 0; step < 3; step++) {
    const result = await callModel(env, messages, true)
    if (!result) break
    if (!result.tool_calls.length) {
      reply = result.content.trim()
      break
    }
    messages.push({ role: 'assistant', content: result.content ?? '', tool_calls: result.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) })
    for (const call of result.tool_calls) {
      const toolResult = executeTool(ctx, call.name as AgentToolName, call.args)
      messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult })
    }
  }

  if (!reply) {
    // The model answered only with tool calls, or failed mid-loop: answer from the record.
    const fallback = localBrain({ ...input, knowledge: ctx.knowledge, message: input.message })
    return {
      ...fallback,
      calls: [...ctx.calls, ...fallback.calls],
      actions: [...ctx.actions, ...fallback.actions],
      changes: [...ctx.changes, ...fallback.changes],
      knowledge: ctx.knowledge,
      drafted: ctx.drafted ?? fallback.drafted,
      model: status,
    }
  }

  return {
    reply,
    knowledge: ctx.knowledge,
    calls: ctx.calls,
    actions: ctx.actions,
    changes: ctx.changes,
    errors: ctx.errors,
    missing: missingFacts(ctx.knowledge).map((f) => ({ key: f.key, label: f.label, ask: f.ask })),
    model: status,
    drafted: ctx.drafted,
    mark_done: ctx.markDone,
  }
}

/** Everything the agent knows, for the panel beside the chat. */
export function knowledgeSnapshot(kb: Knowledge) {
  return {
    known: Object.keys(kb.facts).length,
    missing: missingFacts(kb),
    suggested: suggestedFacts(kb),
    hasPremises: hasFact(kb, 'premises'),
    name: factValue<string>(kb, 'legal_name'),
  }
}
