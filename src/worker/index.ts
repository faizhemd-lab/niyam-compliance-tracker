import { Hono } from 'hono'
import type { Context } from 'hono'

import { modelStatus, runAgent } from '../shared/agent'
import { CAS, RULES, RULE_VERSION } from '../shared/catalogue'
import { compileDeadline, checklistFor } from '../shared/documents'
import { classify, explain, extract, GATEWAY, maskIdentifiers } from '../shared/gateway'
import { deriveProfile, knowledgeToCompany } from '../shared/knowledge'
import { matchCAs } from '../shared/matching'
import { runReminderJob } from '../shared/reminders'
import { evaluateRules, missingFields, profileLine } from '../shared/rules'
import { buildCalendar, summarise } from '../shared/schedule'
import type { AgentInput } from '../shared/agent'
import type { Company, Deadline, DocKey, Profile, ReminderEntry, ShareLink, SharePermission } from '../shared/types'
import { applyMapping, parseCsv, proposeMapping } from '../shared/validation'
import { createZip } from '../shared/zip'
import { authenticatedUser } from './auth'
import { ensureSchema, readRecord, sha256Hex, shareOwner, syncShares, writeRecord } from './db'

/**
 * The Worker behind the app. It holds the rules engine, the calendar service,
 * the compiler, reminder job and matching — all deterministic, so the same
 * profile always produces the same calendar. The browser keeps the founder's
 * own record and statuses; every route here is a pure function of its payload.
 */
type Env = {
  /** Static assets binding; absent where a platform serves the assets itself. */
  ASSETS?: Fetcher
  /** The per-client record. See src/worker/db.ts. */
  DB?: D1Database
  /** Clerk session-token verification. See src/worker/auth.ts. */
  CLERK_PUBLISHABLE_KEY?: string
  CLERK_JWT_KEY?: string
  CLERK_JWKS_URL?: string
  APP_ORIGIN?: string
  ENVIRONMENT?: string
  /** Point these at a self-hosted Ollama, llama.cpp or vLLM server. */
  MODEL_BASE_URL?: string
  MODEL_NAME?: string
  MODEL_API_KEY?: string
}

type AppEnv = { Bindings: Env }

const app = new Hono<AppEnv>()

/** Personalized answers are never cached, by us or by a proxy. */
const NO_STORE = { 'cache-control': 'private, no-store' } as const

function unauthorised(c: Context<AppEnv>, reason: 'unconfigured' | 'unauthorized') {
  return reason === 'unconfigured'
    ? c.json({ error: 'Sign-in is not configured on this deployment yet.', code: 'auth_unconfigured' }, 503, NO_STORE)
    : c.json({ error: 'Sign in to use this.', code: 'unauthorized' }, 401, NO_STORE)
}

/** The signed-in client, or the response that refuses the request. */
async function authFor(c: Context<AppEnv>) {
  const result = await authenticatedUser(c.req.raw, c.env)
  return result.user ? { user: result.user, response: null } : { user: null, response: unauthorised(c, result.reason) }
}

/** Writes must come from this app's own origin. */
function sameOrigin(request: Request, env: Env) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const here = new URL(request.url).origin
  if (origin.replace(/\/$/, '') === here) return true
  const allowed = (env.APP_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean)
  return allowed.includes(origin.replace(/\/$/, ''))
}

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

// 0. Who is signed in, and the one company record they own.
app.get('/api/me', async (c) => {
  const auth = await authFor(c)
  if (!auth.user) return auth.response
  return c.json({ user: auth.user }, 200, NO_STORE)
})

app.get('/api/record', async (c) => {
  const auth = await authFor(c)
  if (!auth.user) return auth.response
  if (!c.env.DB) return c.json({ error: 'The record store is not configured on this deployment.' }, 503, NO_STORE)
  await ensureSchema(c.env.DB)
  const row = await readRecord(c.env.DB, auth.user.id)
  if (!row) return c.json({ data: null, saved_at: null }, 200, NO_STORE)
  try {
    return c.json({ data: JSON.parse(row.data), saved_at: row.updated_at }, 200, NO_STORE)
  } catch {
    return c.json({ error: 'The stored record could not be read.' }, 500, NO_STORE)
  }
})

app.put('/api/record', async (c) => {
  const auth = await authFor(c)
  if (!auth.user) return auth.response
  if (!sameOrigin(c.req.raw, c.env)) return c.json({ error: 'Cross-origin writes are refused.' }, 403, NO_STORE)
  if (!c.env.DB) return c.json({ error: 'The record store is not configured on this deployment.' }, 503, NO_STORE)
  const text = await c.req.text()
  if (text.length > 512_000) return c.json({ error: 'That record is too large to save.' }, 413, NO_STORE)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return badJson()
  }
  const data = body?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return c.json({ error: 'Send the record as { data: {} }.' }, 422, NO_STORE)
  await ensureSchema(c.env.DB)
  const savedAt = await writeRecord(c.env.DB, auth.user.id, JSON.stringify(data))
  const shares = Array.isArray((data as { shares?: unknown }).shares) ? ((data as { shares: { token_hash?: unknown }[] }).shares ?? []) : []
  await syncShares(
    c.env.DB,
    auth.user.id,
    shares.map((share) => (typeof share?.token_hash === 'string' ? share.token_hash : '')),
  )
  return c.json({ saved_at: savedAt }, 200, NO_STORE)
})

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
  const auth = await authFor(c)
  if (!auth.user) return auth.response
  if (!sameOrigin(c.req.raw, c.env)) return c.json({ error: 'Cross-origin writes are refused.' }, 403, NO_STORE)
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  const permission: SharePermission = body.permission === 'mark_done' ? 'mark_done' : 'view'
  const scope = Array.isArray(body.scope) && body.scope.length ? (body.scope as never[]) : 'all'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return c.json({ token, token_hash: await sha256Hex(token), permission, scope, expires_at: typeof body.expires_at === 'string' ? body.expires_at : null }, 201, NO_STORE)
})

/**
 * The CA's side of a share link: no session, scoped to the categories the
 * founder allowed, and it never hands back the record itself.
 */
async function sharedContext(c: Context<AppEnv>, token: string) {
  const db = c.env.DB
  if (!db) return { response: c.json({ error: 'Sharing needs the record store.' }, 503, NO_STORE) }
  await ensureSchema(db)
  const token_hash = await sha256Hex(token)
  const owner = await shareOwner(db, token_hash)
  if (!owner) return { response: c.json({ error: 'This link is not active.', reason: 'missing' }, 404, NO_STORE) }
  const row = await readRecord(db, owner)
  if (!row) return { response: c.json({ error: 'This link is not active.', reason: 'missing' }, 404, NO_STORE) }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(row.data) as Record<string, unknown>
  } catch {
    return { response: c.json({ error: 'This link is not active.', reason: 'missing' }, 404, NO_STORE) }
  }
  const share = ((data.shares ?? []) as ShareLink[]).find((entry) => entry.token_hash === token_hash)
  if (!share) return { response: c.json({ error: 'This link is not active.', reason: 'missing' }, 404, NO_STORE) }
  const when = today()
  if (share.revoked_at) return { response: c.json({ error: 'This link was revoked.', reason: 'revoked' }, 410, NO_STORE) }
  if (share.expires_at && share.expires_at < when) return { response: c.json({ error: 'This link has expired.', reason: 'expired' }, 410, NO_STORE) }

  const knowledge = (data.knowledge ?? { facts: {} }) as Parameters<typeof deriveProfile>[0]
  const profile = deriveProfile(knowledge)
  const statuses = (data.statuses ?? {}) as Record<string, { status: 'open' | 'done' }>
  const ticked = (data.ticked ?? {}) as Record<string, DocKey[]>
  const obligations = evaluateRules(profile)
  const { deadlines } = buildCalendar(profile, obligations, when, statuses)
  const company = knowledgeToCompany(knowledge)
  const visible = share.scope === 'all' ? deadlines : deadlines.filter((d) => (share.scope as string[]).includes(d.group))
  return {
    owner,
    data,
    share,
    when,
    payload: {
      permission: share.permission,
      scope: share.scope,
      expires_at: share.expires_at,
      company: company.name ?? '',
      today: when,
      deadlines: visible,
      summary: summarise(visible),
      checklists: Object.fromEntries(
        visible.map((d) => [d.id, checklistFor(d, company, ticked[d.id] ?? []).map((i) => ({ label: i.label, state: i.state }))]),
      ),
    },
  }
}

app.get('/api/share/:token', async (c) => {
  const token = c.req.param('token')
  if (!token) return c.json({ error: 'Send the link token.' }, 422, NO_STORE)
  const context = await sharedContext(c, token)
  if (!context.payload) return context.response
  return c.json(context.payload, 200, NO_STORE)
})

app.post('/api/share/:token/done', async (c) => {
  const token = c.req.param('token')
  if (!token) return c.json({ error: 'Send the link token.' }, 422, NO_STORE)
  if (!sameOrigin(c.req.raw, c.env)) return c.json({ error: 'Cross-origin writes are refused.' }, 403, NO_STORE)
  const context = await sharedContext(c, token)
  if (!context.payload) return context.response
  if (context.share.permission !== 'mark_done') return c.json({ error: 'This link is view only.' }, 403, NO_STORE)
  const body = await readJson(c.req.raw)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return c.json({ error: 'Send the deadline id.' }, 422, NO_STORE)

  const data = context.data as { statuses?: Record<string, unknown>; activity?: unknown[] }
  const statuses = { ...(data.statuses ?? {}), [id]: { status: 'done', done_at: new Date().toISOString(), done_by: 'ca' } }
  const activity = [{ id: crypto.randomUUID(), at: new Date().toISOString(), actor: 'ca', action: 'Marked done', detail: id }, ...(Array.isArray(data.activity) ? data.activity : [])].slice(0, 80)
  if (c.env.DB && context.owner) await writeRecord(c.env.DB, context.owner, JSON.stringify({ ...data, statuses, activity }))
  const next = await sharedContext(c, token)
  return c.json({ ok: true, payload: next.payload ?? context.payload }, 200, NO_STORE)
})

app.post('/api/share/revoke', async (c) => {
  const body = await readJson(c.req.raw)
  if (!body) return badJson()
  // Revocation is applied by the founder's client, which owns the record.
  return c.json({ revoked_at: new Date().toISOString(), id: body.id ?? null })
})

// 10. CA matching: weighted scoring with reasons. The directory is empty until real firms are onboarded.
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
app.all('*', (c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text('Not found', 404)))

export default app
