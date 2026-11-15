import { Hono } from 'hono'

import { modelStatus, runAgent } from '../shared/agent'
import { CAS, RULES, RULE_VERSION } from '../shared/catalogue'
import { compileDeadline } from '../shared/documents'
import { classify, explain, extract, GATEWAY, maskIdentifiers } from '../shared/gateway'
import { matchCAs } from '../shared/matching'
import { runReminderJob } from '../shared/reminders'
import { evaluateRules, missingFields, profileLine } from '../shared/rules'
import { buildCalendar, summarise } from '../shared/schedule'
import type { AgentInput } from '../shared/agent'
import type { Company, Deadline, Profile, ReminderEntry, SharePermission } from '../shared/types'
import { applyMapping, parseCsv, proposeMapping } from '../shared/validation'
import { createZip } from '../shared/zip'

/**
 * The Worker behind the app. It holds the rules engine, the calendar service,
 * the compiler, reminder job and matching — all deterministic, so the same
 * profile always produces the same calendar. The browser keeps the founder's
 * own record and statuses; every route here is a pure function of its payload.
 */
type Env = {
  ASSETS: Fetcher
  /** Point these at a self-hosted Ollama, llama.cpp or vLLM server. */
  MODEL_BASE_URL?: string
  MODEL_NAME?: string
  MODEL_API_KEY?: string
}

const app = new Hono<{ Bindings: Env }>()

const today = () => new Date().toISOString().slice(0, 10)

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text()
    if (text.length > 512_000) return null
    const body = JSON.parse(text)
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const badJson = () => Response.json({ error: 'Send a JSON object.' }, { status: 400 })

function profileFrom(body: Record<string, unknown>): Profile {
  return (body.profile ?? {}) as Profile
}

function validateProfile(profile: Profile) {
  const missing = missingFields(profile)
  return {
    complete: missing.length === 0,
    missing,
    assumptions: profile.incorporated_on ? [] : ['No incorporation date: first-year filings such as INC-20A are not dated.'],
  }
}

app.get('/api/health', (c) => c.json({ ok: true, rules: RULES.length, rule_version: RULE_VERSION, gateway: GATEWAY.engine }))

// 1. Interview: one message in, validated updates and the next question out.
app.post('/api/interview/message', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  const message = typeof body.message === 'string' ? maskIdentifiers(body.message.slice(0, 2000)) : ''
  if (!message.trim()) return c.json({ error: 'Say something for the tracker to read.' }, { status: 422 })
  const profile = profileFrom(body)
  const awaiting = typeof body.awaiting === 'string' ? (body.awaiting as Parameters<typeof extract>[1]) : null
  const result = extract(message, awaiting)
  const merged: Profile = { ...profile, ...result.updates }
  return c.json({
    updates: result.updates,
    rejected: result.rejected,
    notes: result.notes,
    profile: merged,
    state: validateProfile(merged),
    gateway: GATEWAY.engine,
  })
})

// 2. Read or correct the company profile; recomputation happens from the result.
// 1b. The agent: free-form conversation that keeps and updates the company record.
app.get('/api/agent/status', async (c) => c.json(await modelStatus(c.env)))

app.post('/api/agent/message', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  // The agent reads the raw message so it can store PAN/GSTIN in masked form;
  // masking happens again at the model boundary inside runAgent.
  const message = typeof body.message === 'string' ? body.message.slice(0, 4000).trim() : ''
  if (!message) return c.json({ error: 'Say something for the agent to work with.' }, { status: 422 })
  const knowledge = (body.knowledge ?? { facts: {} }) as AgentInput['knowledge']
  if (typeof knowledge !== 'object' || !knowledge || typeof knowledge.facts !== 'object') {
    return c.json({ error: 'Send the company record as { facts: {} }.' }, { status: 422 })
  }
  const history = Array.isArray(body.history) ? (body.history as AgentInput['history']).slice(-12) : []
  const reply = await runAgent(
    {
      knowledge,
      message,
      history: history.filter((m) => m && (m.role === 'founder' || m.role === 'agent') && typeof m.text === 'string'),
      today: typeof body.today === 'string' ? body.today : today(),
      statuses: (body.statuses ?? {}) as Record<string, { status: 'open' | 'done' }>,
      budget: body.budget as AgentInput['budget'],
      language: body.language === 'hi' ? 'hi' : 'en',
    },
    c.env,
  )
  return c.json(reply)
})

app.post('/api/company', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  const profile = profileFrom(body)
  const obligations = evaluateRules(profile)
  const { deadlines, needsIncorporation } = buildCalendar(profile, obligations, typeof body.today === 'string' ? body.today : today(), {})
  return c.json({
    profile,
    profile_line: profileLine(profile),
    state: validateProfile(profile),
    obligations,
    deadlines,
    summary: summarise(deadlines),
    needs_incorporation: needsIncorporation,
  })
})

// 3. Company database plug-in: upload, mapping preview, confirm.
app.post('/api/company/import', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body || typeof body.csv !== 'string') return c.json({ error: 'Upload a CSV as text.' }, { status: 422 })
  const table = parseCsv(body.csv)
  if (!table.headers.length) return c.json({ error: 'That file has no header row.' }, { status: 422 })
  const mapping = proposeMapping(table.headers)
  return c.json({ headers: table.headers, rows: table.rows.slice(0, 20), mapping, preview: applyMapping(table, mapping) })
})

app.post('/api/company/import/confirm', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body || typeof body.csv !== 'string' || !body.mapping) return c.json({ error: 'Send the file and its confirmed mapping.' }, { status: 422 })
  const table = parseCsv(body.csv)
  const result = applyMapping(table, body.mapping as Record<number, never>)
  return c.json(result)
})

// 4. Obligations with reasons and rule versions.
app.post('/api/obligations', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  const profile = profileFrom(body)
  const state = validateProfile(profile)
  if (!state.complete) return c.json({ error: 'The interview is not finished.', ...state }, { status: 422 })
  const obligations = evaluateRules(profile)
  return c.json({ obligations, count: obligations.length, rule_version: RULE_VERSION })
})

// 5. Calendar: deadlines with colour, authority, penalty and checklist progress.
app.post('/api/calendar', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  const profile = profileFrom(body)
  const when = typeof body.today === 'string' ? body.today : today()
  const statuses = (body.statuses ?? {}) as Record<string, { status: 'open' | 'done' }>
  const obligations = evaluateRules(profile)
  const { deadlines, needsIncorporation } = buildCalendar(profile, obligations, when, statuses)
  return c.json({ deadlines, summary: summarise(deadlines), needs_incorporation: needsIncorporation, today: when })
})

app.post('/api/calendar.ics', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  const profile = profileFrom(body)
  const company = (body.company ?? {}) as Company
  const when = typeof body.today === 'string' ? body.today : today()
  const obligations = evaluateRules(profile)
  const { deadlines } = buildCalendar(profile, obligations, when, {})
  const stamp = (iso: string) => `${iso.replace(/-/g, '')}T090000Z`
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Startup Compliance Tracker//EN', `X-WR-CALNAME:${company.name ?? 'My company'} compliance`]
  for (const d of deadlines) {
    if (!d.due_date) continue
    lines.push('BEGIN:VEVENT', `UID:${d.id}@tracker`, `DTSTAMP:${stamp(when)}`, `DTSTART;VALUE=DATE:${d.due_date.replace(/-/g, '')}`, `SUMMARY:${d.name} — ${d.authority}`, `DESCRIPTION:${d.penalty}`, 'BEGIN:VALARM', 'TRIGGER:-P30D', 'ACTION:DISPLAY', `DESCRIPTION:${d.name} due in 30 days`, 'END:VALARM', 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return c.body(lines.join('\r\n'), 200, { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="compliance.ics"' })
})

// 6. Explain one obligation from its record, with the faithfulness check.
app.post('/api/explain', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body || typeof body.record !== 'object' || !body.record) return c.json({ error: 'Send the obligation record.' }, { status: 422 })
  const record = body.record as Parameters<typeof explain>[0]
  const language = body.language === 'hi' ? 'hi' : 'en'
  const question = typeof body.question === 'string' ? body.question.slice(0, 500) : undefined
  return c.json({ ...explain(record, language, question), language, intent: question ? classify(question) : null })
})

// 7. Compile the drafts for one deadline.
app.post('/api/deadlines/compile', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  const company = (body.company ?? {}) as Company
  const deadline = body.deadline as Deadline | undefined
  if (!deadline?.rule_id) return c.json({ error: 'Send the deadline to compile.' }, { status: 422 })
  const ticked = Array.isArray(body.ticked) ? (body.ticked as never[]) : []
  const knowledge = body.knowledge as Parameters<typeof compileDeadline>[4]
  const result = compileDeadline(company, deadline, typeof body.today === 'string' ? body.today : today(), ticked, knowledge)
  return c.json(result)
})

// 8. A ZIP of any folder the client has generated.
app.post('/api/folder.zip', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body || !Array.isArray(body.files) || !body.files.length) return c.json({ error: 'Send the files to zip.' }, { status: 422 })
  const files = (body.files as { path?: unknown; content?: unknown }[])
    .filter((f) => typeof f.path === 'string' && typeof f.content === 'string')
    .slice(0, 200)
    .map((f) => ({ path: f.path as string, content: f.content as string }))
  const zip = createZip(files)
  return c.body(zip as unknown as ArrayBuffer, 200, { 'content-type': 'application/zip' })
})

// 9. Share links: the token is random, only its hash is ever stored.
app.post('/api/share', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  const permission: SharePermission = body.permission === 'mark_done' ? 'mark_done' : 'view'
  const scope = Array.isArray(body.scope) && body.scope.length ? (body.scope as never[]) : 'all'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const token_hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return c.json({ token, token_hash, permission, scope, expires_at: typeof body.expires_at === 'string' ? body.expires_at : null }, 201)
})

app.post('/api/share/revoke', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  // Revocation is applied by the founder's client, which owns the record.
  return c.json({ revoked_at: new Date().toISOString(), id: body.id ?? null })
})

// 10. CA matching: weighted scoring with reasons.
app.post('/api/cas/match', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  const profile = profileFrom(body)
  const obligations = evaluateRules(profile)
  const { deadlines } = buildCalendar(profile, obligations, typeof body.today === 'string' ? body.today : today(), {})
  const budget = typeof body.budget === 'string' ? (body.budget as Company['budget']) : undefined
  return c.json({ matches: matchCAs(profile, deadlines, CAS, budget), count: CAS.length })
})

// 11. Reminder job, runnable with a simulated clock.
app.post('/api/cron/reminders', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  const profile = profileFrom(body)
  const when = typeof body.today === 'string' ? body.today : today()
  const company = (body.company ?? { name: 'Your company' }) as Company
  const log = Array.isArray(body.log) ? (body.log as ReminderEntry[]) : []
  const obligations = evaluateRules(profile)
  const { deadlines } = buildCalendar(profile, obligations, when, (body.statuses ?? {}) as Record<string, { status: 'open' | 'done' }>)
  const sent = runReminderJob(deadlines, when, log, company, company.email || 'founder@example.com')
  return c.json({ sent, due_today: deadlines.filter((d) => d.due_date === when).length, overdue: deadlines.filter((d) => (d.days_left ?? 0) < 0 && d.status !== 'done').length })
})

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
