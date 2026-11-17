import { claudeEngine } from './claude'

/**
 * Model engines for the agent.
 *
 * The agent loop talks to one interface. Each engine translates the neutral
 * conversation below into its own wire format and back, so the loop, the
 * tools, the validation and the approvals are the same whichever model drives:
 *
 * - `openAICompatibleEngine`: any server with an OpenAI-compatible chat API
 *   (Ollama, llama.cpp, vLLM), including a company's own model.
 * - `claudeEngine` (claude.ts): the hosted, paid engine.
 * - `workersAIEngine`: Cloudflare Workers AI through the `AI` binding, the free
 *   default (a daily free allowance on every Cloudflare account).
 * - when no engine is configured or reachable, the agent's deterministic brain
 *   answers instead (see agent.ts).
 */

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> }

export type ToolCall = { id: string; name: string; args: Record<string, unknown> }

/** One entry of the conversation, independent of any provider's format. */
export type Turn =
  | { role: 'user'; text: string }
  | {
      role: 'assistant'
      text: string
      toolCalls?: ToolCall[]
      /** The engine's own content for this step (e.g. thinking blocks), sent back unchanged within the turn. */
      raw?: unknown
    }
  | { role: 'tool'; callId: string; name: string; output: string }

export type EngineRequest = {
  /** Stable instructions first, then per-turn context. */
  system: string[]
  turns: Turn[]
  tools: ToolSpec[]
}

/** What one model step produced: text, tool calls, or both. */
export type EngineStep = { text: string; toolCalls: ToolCall[]; raw?: unknown }

export type ModelStatus = {
  configured: boolean
  connected: boolean
  engine: string
  model?: string
  models?: string[]
  detail?: string
}

export interface Engine {
  /** Stable id for logs. */
  readonly id: string
  status(): Promise<ModelStatus>
  /** One model call. Returns null when the call failed; the loop then falls back. */
  step(request: EngineRequest): Promise<EngineStep | null>
}

export type ModelEnv = {
  /** A self-hosted OpenAI-compatible server for this deployment. */
  MODEL_BASE_URL?: string
  MODEL_NAME?: string
  MODEL_API_KEY?: string
  /** The hosted default. A Worker secret; never sent to the browser. */
  ANTHROPIC_API_KEY?: string
  CLAUDE_MODEL?: string
  CLAUDE_EFFORT?: string
  /** The Workers AI binding (wrangler.jsonc "ai"), and an optional model override. */
  AI?: AiBinding
  WORKERS_AI_MODEL?: string
}

/** The part of the Workers AI binding the engine uses. */
export type AiBinding = { run(model: string, inputs: Record<string, unknown>): Promise<unknown> }

export const BRAIN_STATUS: ModelStatus = { configured: false, connected: false, engine: 'on-server deterministic brain' }

const STEP_TIMEOUT = 25_000
const STATUS_TIMEOUT = 2_000
/** A reachable server is re-checked every minute; an unreachable one sooner. */
const STATUS_TTL_OK = 60_000
const STATUS_TTL_DOWN = 15_000

const statusCache = new Map<string, { at: number; status: ModelStatus; until?: number }>()

/** Tests and the "test connection" button need a fresh check. */
export function clearEngineStatusCache() {
  statusCache.clear()
}

export async function cachedStatus(key: string, check: () => Promise<ModelStatus>): Promise<ModelStatus> {
  const hit = statusCache.get(key)
  const now = Date.now()
  if (hit?.until !== undefined) {
    if (now < hit.until) return hit.status
  } else if (hit && now - hit.at < (hit.status.connected ? STATUS_TTL_OK : STATUS_TTL_DOWN)) return hit.status
  const status = await check()
  statusCache.set(key, { at: now, status })
  return status
}

/** Record that an engine failed, so later turns skip it until `until` instead of failing again. */
export function markEngineDown(key: string, status: ModelStatus, until: number) {
  statusCache.set(key, { at: Date.now(), status: { ...status, connected: false }, until })
}

/**
 * Every engine this deployment is configured for, in the order they are tried:
 * a self-hosted model first, then Claude (when a key is set), then the free
 * Workers AI model. The agent uses the first one that is reachable; with none,
 * the deterministic brain answers.
 */
export function enginesFor(env: ModelEnv): Engine[] {
  const engines: Engine[] = []
  const baseUrl = env.MODEL_BASE_URL?.trim().replace(/\/$/, '')
  if (baseUrl) engines.push(openAICompatibleEngine({ baseUrl, model: env.MODEL_NAME, apiKey: env.MODEL_API_KEY }))
  const key = env.ANTHROPIC_API_KEY?.trim()
  if (key) engines.push(claudeEngine({ apiKey: key, model: env.CLAUDE_MODEL, effort: env.CLAUDE_EFFORT }))
  if (env.AI) engines.push(workersAIEngine(env.AI, env.WORKERS_AI_MODEL))
  return engines
}

/** The first configured engine, or null when the brain answers. */
export function engineFor(env: ModelEnv): Engine | null {
  return enginesFor(env)[0] ?? null
}

/** The status of the engine that would answer now: the first reachable one, else the first configured one. */
export async function engineStatus(env: ModelEnv): Promise<ModelStatus> {
  const engines = enginesFor(env)
  if (!engines.length) return BRAIN_STATUS
  let first: ModelStatus | undefined
  for (const engine of engines) {
    const status = await engine.status()
    if (status.connected) return status
    first ??= status
  }
  return first!
}

// ---------------------------------------------------------------------------
// OpenAI-compatible servers (Ollama, llama.cpp, vLLM)

type OpenAIMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_call_id?: string; tool_calls?: unknown }

function toOpenAIMessages(request: EngineRequest): OpenAIMessage[] {
  const out: OpenAIMessage[] = request.system.map((content) => ({ role: 'system', content }))
  for (const turn of request.turns) {
    if (turn.role === 'user') out.push({ role: 'user', content: turn.text })
    else if (turn.role === 'tool') out.push({ role: 'tool', tool_call_id: turn.callId, content: turn.output })
    else
      out.push({
        role: 'assistant',
        // Some servers reject an empty string next to tool calls; null is the standard form.
        content: turn.toolCalls?.length && !turn.text ? null : turn.text,
        ...(turn.toolCalls?.length
          ? {
              // Tool calls go back exactly as the server sent them when we have them: some servers attach
              // fields they require on the next request (Gemini's thought signatures in `extra_content`).
              tool_calls: rawOpenAIToolCalls(turn.raw) ?? turn.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
            }
          : {}),
      })
  }
  return out
}

/** The raw tool calls an OpenAI-compatible server returned, stored on the assistant turn. */
type OpenAIRaw = { openai_tool_calls: unknown[] }

function rawOpenAIToolCalls(raw: unknown): unknown[] | undefined {
  return raw && typeof raw === 'object' && Array.isArray((raw as OpenAIRaw).openai_tool_calls) ? (raw as OpenAIRaw).openai_tool_calls : undefined
}

/** Tool arguments arrive as a JSON string, an object, or garbage. */
export function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    // Malformed arguments: the tool reports what it needs.
    return {}
  }
}

export function openAICompatibleEngine(config: { baseUrl: string; model?: string; apiKey?: string }): Engine {
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const auth: Record<string, string> = config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}
  const statusKey = `openai:${baseUrl}:${config.model ?? ''}`

  return {
    id: 'openai_compatible',

    status: () =>
      cachedStatus(statusKey, async () => {
        try {
          const res = await fetch(`${baseUrl}/models`, { headers: auth, signal: AbortSignal.timeout(STATUS_TIMEOUT) })
          if (!res.ok) return { configured: true, connected: false, engine: 'self-hosted model', model: config.model, detail: `The model server answered ${res.status}.` }
          const body = (await res.json()) as { data?: { id?: string }[] }
          const models = (body.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
          return { configured: true, connected: true, engine: 'self-hosted model', model: config.model ?? models[0], models }
        } catch (error) {
          return {
            configured: true,
            connected: false,
            engine: 'self-hosted model',
            model: config.model,
            detail: error instanceof Error ? error.message.slice(0, 160) : 'The model server is unreachable.',
          }
        }
      }),

    async step(request) {
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...auth },
          body: JSON.stringify({
            model: config.model ?? 'local-model',
            messages: toOpenAIMessages(request),
            tools: request.tools.map((t) => ({ type: 'function', function: t })),
            tool_choice: 'auto',
            temperature: 0.2,
            // Room for models that think before answering; thinking counts toward this on some servers.
            max_tokens: 2048,
          }),
          signal: AbortSignal.timeout(STEP_TIMEOUT),
        })
        if (!res.ok) {
          // Rate limited or overloaded: skip this engine briefly instead of failing every turn.
          if (res.status === 429 || res.status === 503) {
            const wait = Number(res.headers.get('retry-after'))
            markEngineDown(statusKey, { configured: true, connected: false, engine: 'self-hosted model', model: config.model, detail: res.status === 429 ? 'The model server is rate limiting requests.' : 'The model server is overloaded.' }, Date.now() + (Number.isFinite(wait) && wait > 0 ? Math.min(wait, 300) : 30) * 1000)
          }
          console.log(JSON.stringify({ event: 'model_error', engine: 'openai_compatible', status: res.status }))
          return null
        }
        const body = (await res.json()) as {
          choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }[]
        }
        const message = body.choices?.[0]?.message
        if (!message) return null
        const calls = message.tool_calls ?? []
        return {
          text: message.content ?? '',
          toolCalls: calls.map((c, index) => ({ id: c.id ?? `call-${index}`, name: c.function?.name ?? '', args: parseToolArgs(c.function?.arguments) })),
          ...(calls.length ? { raw: { openai_tool_calls: calls } satisfies OpenAIRaw } : {}),
        }
      } catch {
        return null
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Cloudflare Workers AI (the free default)

/**
 * Picked by probing the catalogue's tool-calling models on the real binding:
 * Llama 4 Scout called tools and answered from tool results reliably;
 * GLM 4.7 Flash failed every tool-result round trip; Qwen3 30B ignored tools.
 */
export const WORKERS_AI_DEFAULT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'

/** Errors that mean the daily free allowance (or a plan limit) is used up. */
const ALLOWANCE_ERROR = /allocation|neuron|quota|limit|exceeded|429/i

function nextUtcMidnight(now = Date.now()) {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

type WorkersAIOutput = {
  response?: string | null
  tool_calls?: { name?: string; arguments?: unknown }[]
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; neurons?: number }
}

export function workersAIEngine(ai: AiBinding, model?: string): Engine {
  const name = model?.trim() || WORKERS_AI_DEFAULT_MODEL
  const key = `workers-ai:${name}`
  const up: ModelStatus = { configured: true, connected: true, engine: 'Workers AI', model: name }

  return {
    id: 'workers_ai',

    // A status check would spend the free allowance, so the binding counts as
    // up unless a recent call failed (see markEngineDown below).
    status: () => cachedStatus(key, async () => up),

    async step(request) {
      try {
        const out = (await ai.run(name, {
          messages: toOpenAIMessages(request),
          tools: request.tools.map((t) => ({ type: 'function', function: t })),
          max_tokens: 1024,
          temperature: 0.2,
        })) as WorkersAIOutput
        const usage = out.usage
        console.log(JSON.stringify({ event: 'workers_ai_step', model: name, prompt_tokens: usage?.prompt_tokens ?? null, completion_tokens: usage?.completion_tokens ?? null, neurons: usage?.neurons ?? null }))

        // Current models answer in the OpenAI shape; older ones put tool calls at the top level.
        const message = out.choices?.[0]?.message
        const openAICalls = (message?.tool_calls ?? []).map((c, index) => ({ id: c.id ?? `call-${index}`, name: c.function?.name ?? '', args: parseToolArgs(c.function?.arguments) }))
        const legacyCalls = (out.tool_calls ?? []).map((c, index) => ({ id: `call-${index}`, name: c.name ?? '', args: parseToolArgs(c.arguments) }))
        return { text: message?.content ?? out.response ?? '', toolCalls: openAICalls.length ? openAICalls : legacyCalls }
      } catch (error) {
        const detail = error instanceof Error ? error.message.slice(0, 160) : 'Workers AI failed.'
        if (ALLOWANCE_ERROR.test(detail)) {
          markEngineDown(key, { ...up, detail: 'Today’s free Workers AI allowance is used up. It resets at 00:00 UTC.' }, nextUtcMidnight())
        } else {
          markEngineDown(key, { ...up, detail }, Date.now() + 30_000)
        }
        console.log(JSON.stringify({ event: 'workers_ai_error', model: name, allowance: ALLOWANCE_ERROR.test(detail) }))
        return null
      }
    },
  }
}
