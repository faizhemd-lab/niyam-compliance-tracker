import Anthropic from '@anthropic-ai/sdk'

import { cachedStatus, type Engine, type EngineRequest, type ModelStatus, type Turn } from './engines'

/**
 * The hosted default engine: Claude, through Anthropic's official SDK.
 *
 * - Adaptive thinking is always on for this model; effort is the control
 *   (CLAUDE_EFFORT, default "medium").
 * - Within one founder message the assistant's content (thinking blocks and
 *   tool calls) is sent back exactly as it came, so the model keeps its
 *   reasoning across tool calls. Earlier founder messages are replayed as text
 *   only, which the API allows (thinking blocks may be dropped as a whole).
 * - The system prompt and tools never change inside a turn, and the stable
 *   prompt is cached.
 * - A classifier refusal is retried server-side on the model Anthropic
 *   recommends for that category (`fallbacks: "default"`); a refusal that
 *   survives that, a truncated reply or an API error makes the step fail, and
 *   the agent loop falls back to code-written answers.
 */

export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Effort = (typeof EFFORTS)[number]

export type ClaudeConfig = {
  apiKey: string
  model?: string
  effort?: string
  /** Tests point this at a stub server. */
  baseURL?: string
}

/** Our neutral turns as Claude messages: tool results grouped into one user message, raw assistant content kept. */
export function toClaudeMessages(turns: Turn[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = []
  let results: Anthropic.Beta.BetaToolResultBlockParam[] = []
  const flush = () => {
    if (results.length) out.push({ role: 'user', content: results })
    results = []
  }
  for (const turn of turns) {
    if (turn.role === 'tool') {
      results.push({ type: 'tool_result', tool_use_id: turn.callId, content: turn.output })
      continue
    }
    flush()
    if (turn.role === 'user') {
      if (turn.text.trim()) out.push({ role: 'user', content: turn.text })
    } else if (turn.raw) {
      out.push({ role: 'assistant', content: turn.raw as Anthropic.Beta.BetaContentBlockParam[] })
    } else if (turn.text.trim()) {
      out.push({ role: 'assistant', content: turn.text })
    }
  }
  flush()
  // A conversation starts with the founder.
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

export function claudeEngine(config: ClaudeConfig): Engine {
  const model = config.model?.trim() || CLAUDE_DEFAULT_MODEL
  const effort: Effort = (EFFORTS as readonly string[]).includes(config.effort ?? '') ? (config.effort as Effort) : 'medium'
  // The base URL is explicit so an ANTHROPIC_BASE_URL in the environment can never redirect requests.
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL ?? 'https://api.anthropic.com', maxRetries: 1, timeout: 60_000 })

  return {
    id: 'claude',

    status: () =>
      cachedStatus(`claude:${model}`, async (): Promise<ModelStatus> => {
        try {
          await client.models.retrieve(model)
          return { configured: true, connected: true, engine: 'Claude', model }
        } catch (error) {
          let detail = 'Claude is unreachable.'
          if (error instanceof Anthropic.AuthenticationError) detail = 'The Anthropic API key was rejected.'
          else if (error instanceof Anthropic.NotFoundError) detail = `The model ${model} is not available to this key.`
          else if (error instanceof Anthropic.RateLimitError) detail = 'Claude is rate limited right now.'
          else if (error instanceof Anthropic.APIError) detail = `Claude answered ${error.status}.`
          return { configured: true, connected: false, engine: 'Claude', model, detail }
        }
      }),

    async step(request: EngineRequest) {
      const [stable, ...volatile] = request.system
      try {
        const response = await client.beta.messages.create({
          model,
          max_tokens: 16_000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort },
          system: [
            // Stable instructions are cached together with the tools that render before them.
            { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
            ...volatile.map((text) => ({ type: 'text' as const, text })),
          ],
          tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema })),
          tool_choice: { type: 'auto' },
          messages: toClaudeMessages(request.turns),
        })

        // Never act on a refused or truncated turn: a tool call may be cut off mid-input.
        if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null

        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
        const toolCalls = response.content
          .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
          .map((b) => ({ id: b.id, name: b.name, args: b.input && typeof b.input === 'object' ? (b.input as Record<string, unknown>) : {} }))
        return { text, toolCalls, raw: response.content }
      } catch (error) {
        // Typed errors only; the loop falls back either way.
        if (error instanceof Anthropic.APIError) console.log(JSON.stringify({ event: 'claude_error', status: error.status ?? null }))
        else console.log(JSON.stringify({ event: 'claude_error', status: null }))
        return null
      }
    },
  }
}
