import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runAgent, type AgentInput } from '../src/shared/agent'
import { CLAUDE_DEFAULT_MODEL, claudeEngine, toClaudeMessages } from '../src/shared/claude'
import { clearEngineStatusCache, enginesFor, engineStatus } from '../src/shared/engines'
import { applyFacts } from '../src/shared/knowledge'
import { emptyRecord, type CompanyRecord } from '../src/shared/record'

const TODAY = '2026-11-16'

function record(): CompanyRecord {
  const base = emptyRecord()
  const { knowledge } = applyFacts(
    base.knowledge,
    {
      legal_name: 'Northwind Labs Private Limited',
      entity: 'private_limited',
      state: 'Telangana',
      turnover: 6_000_000,
      employees: 12,
      sells: 'services',
      gst_registered: true,
      interstate: false,
      foreign_investment: false,
      incorporated_on: '2026-04-01',
    },
    'manual',
  )
  return { ...base, knowledge, today: TODAY }
}

const input = (message: string): AgentInput => ({ record: record(), message, today: TODAY })

type Captured = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

const message = (content: unknown[], stop_reason = 'end_turn') => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  type: 'message',
  role: 'assistant',
  model: CLAUDE_DEFAULT_MODEL,
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
})
const thinking = (signature: string) => ({ type: 'thinking', thinking: '', signature })
const text = (t: string) => ({ type: 'text', text: t })
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}) => ({ type: 'tool_use', id, name, input })

/** A stand-in for api.anthropic.com: /v1/models answers per `model`, /v1/messages pops scripted replies. */
function stubAnthropic(replies: (unknown | number)[], model: number | 'ok' = 'ok', extra?: (url: string) => Response | null) {
  const requests: Captured[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const own = extra?.(url)
      if (own) return own
      const headers = Object.fromEntries(new Headers(init?.headers).entries())
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      if (url.includes('/v1/models/')) {
        return model === 'ok' ? json(200, { id: CLAUDE_DEFAULT_MODEL, type: 'model', display_name: 'Claude', created_at: '2026-01-01T00:00:00Z' }) : json(model, { type: 'error', error: { type: 'error', message: 'nope' } })
      }
      if (url.includes('/v1/messages')) {
        requests.push({ url, headers, body: JSON.parse(String(init?.body)) })
        const next = replies.length > 1 ? replies.shift() : replies[0]
        if (typeof next === 'number') return json(next, { type: 'error', error: { type: 'api_error', message: 'boom' } })
        return json(200, next)
      }
      return json(404, { type: 'error', error: { type: 'not_found_error', message: url } })
    }),
  )
  return requests
}

const engine = () => claudeEngine({ apiKey: 'sk-test', baseURL: 'https://claude.test' })

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearEngineStatusCache()
})

describe('turns as Claude messages', () => {
  it('groups tool results into one user message and keeps raw assistant content', () => {
    const raw = [thinking('sig-1'), toolUse('t1', 'get_calendar'), toolUse('t2', 'list_shares')]
    const messages = toClaudeMessages([
      { role: 'user', text: 'what is due?' },
      { role: 'assistant', text: '', toolCalls: [], raw },
      { role: 'tool', callId: 't1', name: 'get_calendar', output: 'A' },
      { role: 'tool', callId: 't2', name: 'list_shares', output: 'B' },
    ])
    expect(messages).toEqual([
      { role: 'user', content: 'what is due?' },
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'A' },
          { type: 'tool_result', tool_use_id: 't2', content: 'B' },
        ],
      },
    ])
  })

  it('starts with the founder and skips empty turns', () => {
    expect(
      toClaudeMessages([
        { role: 'assistant', text: 'Good morning, here is your briefing.' },
        { role: 'user', text: '  ' },
        { role: 'user', text: 'thanks' },
      ]),
    ).toEqual([{ role: 'user', content: 'thanks' }])
  })
})

describe('the Claude engine', () => {
  it('sends the documented request: model, adaptive thinking, effort, fallbacks, cached prompt, tools', async () => {
    const requests = stubAnthropic([message([text('Hello.')])])
    const result = await runAgent(input('hi'), {}, engine())
    expect(result.reply).toBe('Hello.')
    expect(result.model).toMatchObject({ connected: true, engine: 'Claude', model: CLAUDE_DEFAULT_MODEL })

    const [{ headers, body }] = requests
    // SDK 1.x sends the API key as a bearer token.
    expect(headers.authorization).toBe('Bearer sk-test')
    expect(requests[0].url.startsWith('https://claude.test/')).toBe(true)
    expect(headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01')
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      tool_choice: { type: 'auto' },
    })
    expect(body).not.toHaveProperty('temperature')
    const system = body.system as { text: string; cache_control?: unknown }[]
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(system[1].text).toContain('Today is 2026-11-16')
    const tools = body.tools as { name: string; input_schema: { type: string } }[]
    expect(tools.map((t) => t.name)).toContain('get_calendar')
    expect(tools.every((t) => t.input_schema.type === 'object')).toBe(true)
  })

  it('sends thinking and tool calls back unchanged with the tool results', async () => {
    const first = [thinking('sig-abc'), toolUse('toolu_1', 'list_shares')]
    const requests = stubAnthropic([message(first, 'tool_use'), message([text('You have no share links yet.')])])
    const result = await runAgent(input('who can see my record?'), {}, engine())
    expect(result.reply).toBe('You have no share links yet.')
    expect(result.calls.map((c) => c.name)).toEqual(['list_shares'])

    const second = requests[1].body.messages as { role: string; content: unknown }[]
    expect(second.at(-2)).toEqual({ role: 'assistant', content: first })
    expect(second.at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'No share links yet.' }] })
    // The system prompt and tools are byte-identical across the turn's requests.
    expect(requests[1].body.system).toEqual(requests[0].body.system)
    expect(requests[1].body.tools).toEqual(requests[0].body.tools)
  })

  it('uses the configured effort when it is valid, and medium otherwise', async () => {
    let requests = stubAnthropic([message([text('Hi.')])])
    await runAgent(input('hi'), {}, claudeEngine({ apiKey: 'k', baseURL: 'https://claude.test', effort: 'low' }))
    expect(requests[0].body.output_config).toEqual({ effort: 'low' })
    vi.unstubAllGlobals()
    clearEngineStatusCache()
    requests = stubAnthropic([message([text('Hi.')])])
    await runAgent(input('hi'), {}, claudeEngine({ apiKey: 'k', baseURL: 'https://claude.test', effort: 'ultra' }))
    expect(requests[0].body.output_config).toEqual({ effort: 'medium' })
  })

  it('never acts on a refused turn', async () => {
    stubAnthropic([message([toolUse('toolu_1', 'propose_share', { permission: 'mark_done' })], 'refusal')])
    const result = await runAgent(input('share everything'), {}, engine())
    expect(result.fallback).toBe('engine_failed')
    expect(result.record.pending).toEqual([])
  })

  it('never acts on a turn cut off at max_tokens', async () => {
    stubAnthropic([message([toolUse('toolu_1', 'update_company', { facts: { employees: 2 } })], 'max_tokens')])
    const result = await runAgent(input('we have 25 people'), {}, engine())
    expect(result.fallback).toBe('engine_failed')
    // The truncated call (employees: 2) never ran; the fallback read the founder's own "25".
    expect(result.changes.some((c) => c.key === 'employees' && c.to === '2')).toBe(false)
  })

  it('falls back when the API errors', async () => {
    stubAnthropic([500])
    const result = await runAgent(input('hi'), {}, engine())
    expect(result.fallback).toBe('engine_failed')
    expect(result.reply.length).toBeGreaterThan(0)
  })

  it('reports a rejected key as down, so the brain answers', async () => {
    stubAnthropic([message([text('unused')])], 401)
    const status = await engine().status()
    expect(status).toMatchObject({ connected: false, detail: 'The Anthropic API key was rejected.' })
    const result = await runAgent(input('hi'), {}, engine())
    expect(result.fallback).toBe('engine_down')
  })

  it('applies the grounding check to Claude replies too', async () => {
    stubAnthropic([message([text('Your GST penalty will be ₹4,44,444.')])])
    const result = await runAgent(input('what is my GST penalty?'), {}, engine())
    expect(result.fallback).toBe('ungrounded')
    expect(result.reply).not.toContain('4,44,444')
  })

  it('never puts an identifier in a request', async () => {
    const requests = stubAnthropic([message([toolUse('toolu_1', 'read_company')], 'tool_use'), message([text('Noted.')])])
    await runAgent(input('PAN ABCDE1234F, GSTIN 36ABCDE1234F1Z5, mail ceo@northwind.example'), {}, engine())
    const sent = JSON.stringify(requests.map((r) => r.body))
    for (const secret of ['ABCDE1234F', '36ABCDE1234F1Z5', 'ceo@northwind.example']) expect(sent).not.toContain(secret)
  })
})

describe('engine order', () => {
  it('uses Claude when only the Anthropic key is set, and nothing without keys', () => {
    expect(enginesFor({ ANTHROPIC_API_KEY: 'k' }).map((e) => e.id)).toEqual(['claude'])
    expect(enginesFor({ ANTHROPIC_API_KEY: '  ' })).toEqual([])
    expect(enginesFor({})).toEqual([])
  })

  it('tries a self-hosted model first, then Claude', () => {
    expect(enginesFor({ MODEL_BASE_URL: 'https://own.test/v1', ANTHROPIC_API_KEY: 'k' }).map((e) => e.id)).toEqual(['openai_compatible', 'claude'])
  })

  it('moves on to Claude when the self-hosted model is down', async () => {
    const requests = stubAnthropic([message([text('Claude here.')])], 'ok', (url) => (url.startsWith('https://own.test') ? new Response('down', { status: 503 }) : null))
    const env = { MODEL_BASE_URL: 'https://own.test/v1', ANTHROPIC_API_KEY: 'k' }
    expect(await engineStatus(env)).toMatchObject({ engine: 'Claude', connected: true })
    const result = await runAgent(input('hi'), env)
    expect(result.reply).toBe('Claude here.')
    expect(requests).toHaveLength(1)
  })

  it('never exposes the key in the status', async () => {
    stubAnthropic([message([text('x')])])
    const status = await engineStatus({ ANTHROPIC_API_KEY: 'sk-ant-secret' })
    expect(JSON.stringify(status)).not.toContain('sk-ant-secret')
  })
})
