/**
 * Model engines for the agent.
 *
 * The agent loop talks to one interface. Each engine translates the neutral
 * conversation below into its own wire format and back, so the loop, the
 * tools, the validation and the approvals are the same whichever model drives:
 *
 * - `openAICompatibleEngine`: any server with an OpenAI-compatible chat API
 *   (Ollama, llama.cpp, vLLM), including a company's own model.
 * - a Claude engine (added separately) for the hosted default.
 * - when no engine is configured or reachable, the agent's deterministic brain
 *   answers instead (see agent.ts).
 */

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> }

export type ToolCall = { id: string; name: string; args: Record<string, unknown> }

/** One entry of the conversation, independent of any provider's format. */
export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; callId: string; name: string; output: string }

export type EngineRequest = {
  /** Stable instructions first, then per-turn context. */
  system: string[]
  turns: Turn[]
  tools: ToolSpec[]
}

/** What one model step produced: text, tool calls, or both. */
export type EngineStep = { text: string; toolCalls: ToolCall[] }

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

export type ModelEnv = { MODEL_BASE_URL?: string; MODEL_NAME?: string; MODEL_API_KEY?: string }

export const BRAIN_STATUS: ModelStatus = { configured: false, connected: false, engine: 'on-server deterministic brain' }

const STEP_TIMEOUT = 25_000
const STATUS_TIMEOUT = 2_000
/** A reachable server is re-checked every minute; an unreachable one sooner. */
const STATUS_TTL_OK = 60_000
const STATUS_TTL_DOWN = 15_000

const statusCache = new Map<string, { at: number; status: ModelStatus }>()

/** Tests and the "test connection" button need a fresh check. */
export function clearEngineStatusCache() {
  statusCache.clear()
}

async function cachedStatus(key: string, check: () => Promise<ModelStatus>): Promise<ModelStatus> {
  const hit = statusCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < (hit.status.connected ? STATUS_TTL_OK : STATUS_TTL_DOWN)) return hit.status
  const status = await check()
  statusCache.set(key, { at: now, status })
  return status
}

/** Pick the engine this deployment is configured for, or null for the brain. */
export function engineFor(env: ModelEnv): Engine | null {
  const baseUrl = env.MODEL_BASE_URL?.trim().replace(/\/$/, '')
  if (baseUrl) return openAICompatibleEngine({ baseUrl, model: env.MODEL_NAME, apiKey: env.MODEL_API_KEY })
  return null
}

export async function engineStatus(env: ModelEnv): Promise<ModelStatus> {
  const engine = engineFor(env)
  return engine ? engine.status() : BRAIN_STATUS
}

// ---------------------------------------------------------------------------
// OpenAI-compatible servers (Ollama, llama.cpp, vLLM)

type OpenAIMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: unknown }

function toOpenAIMessages(request: EngineRequest): OpenAIMessage[] {
  const out: OpenAIMessage[] = request.system.map((content) => ({ role: 'system', content }))
  for (const turn of request.turns) {
    if (turn.role === 'user') out.push({ role: 'user', content: turn.text })
    else if (turn.role === 'tool') out.push({ role: 'tool', tool_call_id: turn.callId, content: turn.output })
    else
      out.push({
        role: 'assistant',
        content: turn.text,
        ...(turn.toolCalls?.length
          ? { tool_calls: turn.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : {}),
      })
  }
  return out
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

  return {
    id: 'openai_compatible',

    status: () =>
      cachedStatus(`openai:${baseUrl}:${config.model ?? ''}`, async () => {
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
            max_tokens: 800,
          }),
          signal: AbortSignal.timeout(STEP_TIMEOUT),
        })
        if (!res.ok) return null
        const body = (await res.json()) as {
          choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }[]
        }
        const message = body.choices?.[0]?.message
        if (!message) return null
        return {
          text: message.content ?? '',
          toolCalls: (message.tool_calls ?? []).map((c, index) => ({ id: c.id ?? `call-${index}`, name: c.function?.name ?? '', args: parseToolArgs(c.function?.arguments) })),
        }
      } catch {
        return null
      }
    },
  }
}
