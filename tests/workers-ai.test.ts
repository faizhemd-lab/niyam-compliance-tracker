import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runAgent, type AgentInput } from '../src/shared/agent'
import { clearEngineStatusCache, enginesFor, engineStatus, WORKERS_AI_DEFAULT_MODEL, workersAIEngine, type AiBinding } from '../src/shared/engines'
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

/** The shape Workers AI returned for llama-4-scout when probed. */
const openAIShape = (content: string | null, toolCalls: { id: string; name: string; args: object }[] = []) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content,
        tool_calls: toolCalls.length ? toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) : undefined,
      },
      finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
    },
  ],
  usage: { prompt_tokens: 4000, completion_tokens: 40, neurons: 100 },
})

function fakeAI(script: (unknown | Error)[]) {
  const calls: { model: string; inputs: Record<string, unknown> }[] = []
  const ai: AiBinding = {
    run: vi.fn(async (model: string, inputs: Record<string, unknown>) => {
      calls.push({ model, inputs: structuredClone(inputs) })
      const next = script.length > 1 ? script.shift() : script[0]
      if (next instanceof Error) throw next
      return next
    }),
  }
  return { ai, calls }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  clearEngineStatusCache()
})

describe('the Workers AI engine', () => {
  it('is used when the binding exists, after a self-hosted model and Claude', () => {
    const { ai } = fakeAI([openAIShape('x')])
    expect(enginesFor({ AI: ai }).map((e) => e.id)).toEqual(['workers_ai'])
    expect(enginesFor({ AI: ai, ANTHROPIC_API_KEY: 'k', MODEL_BASE_URL: 'https://own.test/v1' }).map((e) => e.id)).toEqual(['openai_compatible', 'claude', 'workers_ai'])
  })

  it('reports itself up without spending the allowance on a check', async () => {
    const { ai, calls } = fakeAI([openAIShape('x')])
    expect(await engineStatus({ AI: ai })).toMatchObject({ connected: true, engine: 'Workers AI', model: WORKERS_AI_DEFAULT_MODEL })
    expect(calls).toHaveLength(0)
  })

  it('sends OpenAI-style tools and reads OpenAI-style tool calls back', async () => {
    const { ai, calls } = fakeAI([openAIShape(null, [{ id: 'c1', name: 'list_shares', args: {} }]), openAIShape('You have no share links yet.')])
    const result = await runAgent(input('who can see my record?'), {}, workersAIEngine(ai))
    expect(result.reply).toBe('You have no share links yet.')
    expect(result.calls.map((c) => c.name)).toEqual(['list_shares'])

    expect(calls[0].model).toBe('@cf/meta/llama-4-scout-17b-16e-instruct')
    const tools = calls[0].inputs.tools as { type: string; function: { name: string } }[]
    expect(tools[0]).toMatchObject({ type: 'function', function: { name: 'read_company' } })
    const second = calls[1].inputs.messages as { role: string; content: unknown; tool_call_id?: string; tool_calls?: unknown }[]
    // The assistant turn with tool calls carries null content: an empty string made other models fail.
    expect(second.at(-2)).toMatchObject({ role: 'assistant', content: null })
    expect(second.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'No share links yet.' })
  })

  it('also reads the older top-level tool_calls shape', async () => {
    const legacy = { response: null, tool_calls: [{ name: 'list_shares', arguments: {} }] }
    const { ai } = fakeAI([legacy, { response: 'No links yet.' }])
    const result = await runAgent(input('any share links?'), {}, workersAIEngine(ai))
    expect(result.calls.map((c) => c.name)).toEqual(['list_shares'])
    expect(result.reply).toBe('No links yet.')
  })

  it('uses a model override when one is set', async () => {
    const { ai, calls } = fakeAI([openAIShape('Hi.')])
    await runAgent(input('hi'), {}, workersAIEngine(ai, '@cf/meta/llama-3.3-70b-instruct-fp8-fast'))
    expect(calls[0].model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast')
  })

  it('falls back on an error, and skips the engine briefly afterwards', async () => {
    const { ai, calls } = fakeAI([new Error('8004: Internal server error')])
    const engine = workersAIEngine(ai)
    const first = await runAgent(input('hi'), {}, engine)
    expect(first.fallback).toBe('engine_failed')
    const second = await runAgent(input('hi'), {}, engine)
    expect(second.fallback).toBe('engine_down')
    expect(calls).toHaveLength(1)
  })

  it('marks the engine down until midnight UTC once the free allowance is used up', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T15:00:00.000Z'))
    const { ai, calls } = fakeAI([new Error('4006: you have used up your daily free allocation of 10,000 neurons')])
    const engine = workersAIEngine(ai)
    await runAgent(input('hi'), {}, engine)
    const status = await engine.status()
    expect(status).toMatchObject({ connected: false, detail: 'Today’s free Workers AI allowance is used up. It resets at 00:00 UTC.' })

    vi.setSystemTime(new Date('2026-11-16T23:59:00.000Z'))
    expect((await engine.status()).connected).toBe(false)
    vi.setSystemTime(new Date('2026-11-17T00:00:01.000Z'))
    expect((await engine.status()).connected).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('keeps the guardrails: grounding, approvals and masking', async () => {
    const { ai, calls } = fakeAI([openAIShape(null, [{ id: 'c1', name: 'propose_share', args: { permission: 'mark_done' } }]), openAIShape('Your penalty is ₹12,345 and the link is ready.')])
    const result = await runAgent(input('share with my CA, PAN ABCDE1234F'), {}, workersAIEngine(ai))
    expect(result.record.shares).toEqual([])
    expect(result.record.pending).toHaveLength(1)
    expect(result.fallback).toBe('ungrounded')
    expect(result.reply).not.toContain('12,345')
    expect(JSON.stringify(calls)).not.toContain('ABCDE1234F')
  })

  it('logs token and neuron usage without content', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { ai } = fakeAI([openAIShape('Hello.')])
    await runAgent(input('hello'), {}, workersAIEngine(ai))
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('workers_ai_step'))!
    expect(JSON.parse(line)).toEqual({ event: 'workers_ai_step', model: WORKERS_AI_DEFAULT_MODEL, prompt_tokens: 4000, completion_tokens: 40, neurons: 100 })
  })
})
