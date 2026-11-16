import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LIMITS, runAgent, type AgentInput } from '../src/shared/agent'
import { clearEngineStatusCache, engineFor, openAICompatibleEngine, type Engine, type EngineRequest, type EngineStep, type ModelStatus } from '../src/shared/engines'
import { checkGrounding, numbersIn } from '../src/shared/grounding'
import { applyFacts } from '../src/shared/knowledge'
import { emptyRecord, type CompanyRecord } from '../src/shared/record'

const TODAY = '2026-11-16'

/** A complete record for a GST-registered private company: about 20 deadlines. */
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
      pan: 'ABCDE1234F',
    },
    'manual',
    '2026-11-01T00:00:00.000Z',
  )
  return { ...base, knowledge, today: TODAY }
}

const input = (message: string, rec = record()): AgentInput => ({ record: rec, message, today: TODAY })

const UP: ModelStatus = { configured: true, connected: true, engine: 'fake', model: 'fake-model' }

/**
 * A scripted model: each step returns the next scripted answer, or a function
 * of the request so far. Every request is kept for inspection.
 */
function fakeEngine(script: (EngineStep | null | ((req: EngineRequest) => EngineStep | null))[], status: ModelStatus = UP) {
  const requests: EngineRequest[] = []
  const engine: Engine = {
    id: 'fake',
    status: async () => status,
    step: async (req) => {
      requests.push(structuredClone(req))
      const next = script.length > 1 ? script.shift()! : script[0]
      return typeof next === 'function' ? next(req) : next
    },
  }
  return { engine, requests }
}

const call = (name: string, args: Record<string, unknown> = {}, id = `${name}-1`) => ({ id, name, args })
const toolOutputs = (req: EngineRequest) => req.turns.filter((t) => t.role === 'tool').map((t) => (t.role === 'tool' ? t.output : ''))

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearEngineStatusCache()
})

describe('grounding', () => {
  it('reads numbers the way people write them', () => {
    expect(numbersIn('₹1,50,000 by 30 Sep 2027, 3 days left')).toEqual(['150000', '30', '2027', '3'])
  })

  it('accepts numbers that appear in the sources, whatever their grouping', () => {
    expect(checkGrounding('Pay ₹1,50,000 by 20 Nov 2026.', ['penalty ₹150000', 'GSTR-3B 20 Nov 2026']).grounded).toBe(true)
  })

  it('flags a number that is not in the sources', () => {
    expect(checkGrounding('The late fee is ₹9,999.', ['Late fee ₹50/day'])).toEqual({ grounded: false, unsupported: ['9999'] })
  })

  it('does not count a number as present because it is part of a longer one', () => {
    expect(checkGrounding('Due on 20 Nov 2026.', ['gstr3b@2026-11-20']).grounded).toBe(true)
    expect(checkGrounding('Due on the 2nd.', ['2026-11-20']).grounded).toBe(false)
    expect(checkGrounding('You owe 500.', ['₹5000']).grounded).toBe(false)
  })
})

describe('the agent loop', () => {
  it('uses tools, then shows a reply grounded in what they returned', async () => {
    const { engine, requests } = fakeEngine([
      { text: '', toolCalls: [call('get_calendar', { filter: 'next_30' })] },
      (req) => {
        const out = toolOutputs(req)[0]
        const date = out.match(/\d{1,2} [A-Z][a-z]{2} \d{4}/)![0]
        return { text: `Your next filing is due on ${date}.`, toolCalls: [] }
      },
    ])
    const result = await runAgent(input('what is due this month?'), {}, engine)
    expect(requests).toHaveLength(2)
    expect(result.fallback).toBeUndefined()
    expect(result.reply).toMatch(/^Your next filing is due on \d{1,2} [A-Z][a-z]{2} 2026\.$/)
    expect(result.calls.map((c) => c.name)).toEqual(['get_calendar'])
    expect(result.record.agentMessages.at(-1)?.text).toBe(result.reply)
  })

  it('replaces a reply that states a number no tool returned', async () => {
    const { engine } = fakeEngine([
      { text: '', toolCalls: [call('get_deadline', { item: 'GSTR-3B' })] },
      { text: 'If you miss it, the penalty is ₹73,000.', toolCalls: [] },
    ])
    const result = await runAgent(input('what if I miss GSTR-3B?'), {}, engine)
    expect(result.fallback).toBe('ungrounded')
    expect(result.reply).not.toContain('73,000')
    expect(result.reply).toContain('Done: Read GSTR-3B')
  })

  it('hands an ungrounded reply with no tool use to the deterministic brain', async () => {
    const { engine } = fakeEngine([{ text: 'You have 99 filings due.', toolCalls: [] }])
    const result = await runAgent(input('what is due?'), {}, engine)
    expect(result.fallback).toBe('ungrounded')
    expect(result.reply).not.toContain('99')
  })

  it('falls back to the brain when no engine is configured', async () => {
    const result = await runAgent(input('what is due?'), {})
    expect(result.fallback).toBe('no_engine')
    expect(result.model.engine).toBe('on-server deterministic brain')
    expect(result.reply.length).toBeGreaterThan(0)
  })

  it('falls back to the brain when the engine is down', async () => {
    const { engine, requests } = fakeEngine([null], { configured: true, connected: false, engine: 'fake', detail: 'refused' })
    const result = await runAgent(input('what is due?'), {}, engine)
    expect(requests).toHaveLength(0)
    expect(result.fallback).toBe('engine_down')
  })

  it('falls back to the brain when the first model call fails', async () => {
    const { engine } = fakeEngine([null])
    const result = await runAgent(input('what is due?'), {}, engine)
    expect(result.fallback).toBe('engine_failed')
    expect(result.reply.length).toBeGreaterThan(0)
  })

  it('keeps what the tools did when the model fails half-way', async () => {
    const { engine } = fakeEngine([{ text: '', toolCalls: [call('set_autopilot', { enabled: false })] }, null])
    const result = await runAgent(input('turn the autopilot off'), {}, engine)
    expect(result.fallback).toBe('engine_failed')
    expect(result.record.autopilot.enabled).toBe(false)
    expect(result.reply).toContain('Autopilot switched off')
  })

  it(`stops after ${LIMITS.steps} model steps`, async () => {
    let n = 0
    const { engine, requests } = fakeEngine([() => ({ text: '', toolCalls: [call('read_company', { n: n++ }, `c${n}`)] })])
    const result = await runAgent(input('tell me everything'), {}, engine)
    expect(requests).toHaveLength(LIMITS.steps)
    expect(result.fallback).toBe('out_of_steps')
    expect(result.calls).toHaveLength(LIMITS.steps)
  })

  it(`runs at most ${LIMITS.callsPerStep} tool calls per step and refuses the rest`, async () => {
    const many = Array.from({ length: 20 }, (_, i) => call('list_reminders', { limit: i + 1 }, `r${i}`))
    const { engine, requests } = fakeEngine([{ text: '', toolCalls: many }, { text: 'Checked.', toolCalls: [] }])
    const result = await runAgent(input('check reminders'), {}, engine)
    expect(result.calls).toHaveLength(LIMITS.callsPerStep)
    const outputs = toolOutputs(requests[1])
    expect(outputs).toHaveLength(20)
    expect(outputs.filter((o) => o.startsWith('Skipped')).length).toBe(20 - LIMITS.callsPerStep)
  })

  it('runs the same call only once in a turn', async () => {
    const { engine } = fakeEngine([
      { text: '', toolCalls: [call('draft_documents', { item: 'AGM' }, 'a')] },
      { text: '', toolCalls: [call('draft_documents', { item: 'AGM' }, 'b')] },
      { text: 'Drafted.', toolCalls: [] },
    ])
    const result = await runAgent(input('draft the AGM papers'), {}, engine)
    expect(result.calls.filter((c) => c.name === 'draft_documents')).toHaveLength(1)
  })

  it('reports an unknown tool without crashing', async () => {
    const { engine } = fakeEngine([{ text: '', toolCalls: [call('delete_everything')] }, { text: 'I cannot do that.', toolCalls: [] }])
    const result = await runAgent(input('delete everything'), {}, engine)
    expect(result.calls).toEqual([{ name: 'delete_everything', summary: 'Unknown tool', ok: false }])
    expect(result.reply).toBe('I cannot do that.')
  })

  it('logs one content-free line per turn', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { engine } = fakeEngine([{ text: 'Hello.', toolCalls: [] }])
    await runAgent(input('hi, our PAN is ABCDE1234F'), {}, engine)
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('agent_turn'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('ABCDE1234F')
    expect(lines[0]).not.toContain('PAN')
    expect(JSON.parse(lines[0])).toMatchObject({ event: 'agent_turn', engine: 'fake', model: 'fake-model' })
  })
})

describe('guardrails hold whichever model drives', () => {
  it('refuses mark_done unless the founder said the filing is done', async () => {
    const { engine } = fakeEngine([{ text: '', toolCalls: [call('mark_done', { item: 'GSTR-3B' })] }, { text: 'Okay.', toolCalls: [] }])
    const result = await runAgent(input('remind me about GSTR-3B'), {}, engine)
    expect(result.calls[0]).toMatchObject({ name: 'mark_done', ok: false })
    expect(Object.values(result.record.statuses).some((s) => s.status === 'done')).toBe(false)
  })

  it('marks done once the founder says it is filed', async () => {
    const { engine } = fakeEngine([{ text: '', toolCalls: [call('mark_done', { item: 'GSTR-3B' })] }, { text: 'Marked.', toolCalls: [] }])
    const result = await runAgent(input('we filed GSTR-3B yesterday'), {}, engine)
    expect(result.calls[0]).toMatchObject({ name: 'mark_done', ok: true })
    expect(Object.values(result.record.statuses).filter((s) => s.status === 'done')).toHaveLength(1)
  })

  it('only proposes a share link; nothing is shared until the founder approves', async () => {
    const { engine } = fakeEngine([{ text: '', toolCalls: [call('propose_share', { permission: 'mark_done' })] }, { text: 'Waiting for your approval.', toolCalls: [] }])
    const result = await runAgent(input('share everything with my CA'), {}, engine)
    expect(result.record.shares).toEqual([])
    expect(result.record.pending).toHaveLength(1)
    expect(result.proposed[0]).toMatchObject({ tool: 'create_share' })
  })

  it('validates facts the model tries to save', async () => {
    const { engine } = fakeEngine([{ text: '', toolCalls: [call('update_company', { facts: { employees: -4, entity: 'empire' } })] }, { text: 'Hmm.', toolCalls: [] }])
    const result = await runAgent(input('we have -4 people'), {}, engine)
    expect(result.errors.map((e) => e.key).sort()).toEqual(['employees', 'entity'])
    expect(result.changes).toEqual([])
  })

  it('never sends an identifier to the model', async () => {
    const { engine, requests } = fakeEngine([{ text: '', toolCalls: [call('read_company')] }, { text: 'Saved.', toolCalls: [] }])
    await runAgent(input('our PAN is ABCDE1234F and GSTIN 36ABCDE1234F1Z5, call 9876543210 or ceo@northwind.example'), {}, engine)
    const sent = JSON.stringify(requests)
    for (const secret of ['ABCDE1234F', '36ABCDE1234F1Z5', '9876543210', 'ceo@northwind.example']) expect(sent).not.toContain(secret)
  })
})

describe('the OpenAI-compatible engine', () => {
  const env = { MODEL_BASE_URL: 'https://model.test/v1/', MODEL_NAME: 'qwen-test' }

  function stubServer(completions: unknown[], models: unknown = { data: [{ id: 'qwen-test' }] }) {
    const bodies: string[] = []
    let modelChecks = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/models')) {
          modelChecks++
          return new Response(JSON.stringify(models), { status: 200 })
        }
        bodies.push(String(init?.body))
        const next = completions.shift()
        return next === 500 ? new Response('boom', { status: 500 }) : new Response(JSON.stringify(next), { status: 200 })
      }),
    )
    return { bodies, modelChecks: () => modelChecks }
  }

  const answer = (content: string, tool_calls?: unknown[]) => ({ choices: [{ message: { content, tool_calls } }] })

  it('is chosen from MODEL_BASE_URL, and not without it', () => {
    expect(engineFor(env)?.id).toBe('openai_compatible')
    expect(engineFor({})).toBeNull()
  })

  it('checks the server once and then reuses the answer', async () => {
    const server = stubServer([answer('Hi.'), answer('Hi again.')])
    await runAgent(input('hi'), env)
    await runAgent(input('hi'), env)
    expect(server.modelChecks()).toBe(1)
  })

  it('sends tools in the OpenAI format and reads tool calls back, including malformed arguments', async () => {
    const server = stubServer([
      answer('', [{ id: 'x1', function: { name: 'get_calendar', arguments: '{not json' } }]),
      answer('Here is the calendar.'),
    ])
    const result = await runAgent(input('show my calendar'), env)
    expect(result.calls[0]).toMatchObject({ name: 'get_calendar', ok: true })
    const first = JSON.parse(server.bodies[0])
    expect(first.model).toBe('qwen-test')
    expect(first.tools[0]).toMatchObject({ type: 'function', function: { name: 'read_company' } })
    const second = JSON.parse(server.bodies[1])
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'x1' })
    expect(result.reply).toBe('Here is the calendar.')
  })

  it('treats a server error as a failed step', async () => {
    stubServer([500])
    const result = await runAgent(input('hi'), env)
    expect(result.fallback).toBe('engine_failed')
  })

  it('never puts an identifier in a request body', async () => {
    const server = stubServer([answer('', [{ id: 'r', function: { name: 'read_company', arguments: '{}' } }]), answer('Done.')])
    await runAgent(input('PAN ABCDE1234F'), env)
    expect(server.bodies.join('\n')).not.toContain('ABCDE1234F')
  })

  it('reports an unreachable server as down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('connect ECONNREFUSED'))))
    const status = await openAICompatibleEngine({ baseUrl: 'https://down.test/v1' }).status()
    expect(status).toMatchObject({ configured: true, connected: false })
  })
})
