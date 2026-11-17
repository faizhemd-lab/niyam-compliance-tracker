/**
 * Grounded replies.
 *
 * A model may phrase things freely, but every number it states — a date, a
 * rupee amount, a count, a day figure — must already appear in what the agent
 * actually had this turn: the tool results, the record and situation it was
 * given, and the conversation. A reply that introduces a number from nowhere
 * is not shown; the agent falls back to a summary written by code instead.
 *
 * This is deliberately strict. A false alarm costs a plainer reply; a missed
 * one could tell a founder the wrong deadline or penalty.
 */

const NUMBER = /\d[\d,]*(?:\.\d+)?/g

/** "₹1,50,000." → "150000"; "2.5" stays "2.5". */
function normalise(token: string): string {
  return token.replace(/,/g, '').replace(/\.$/, '').replace(/\.0+$/, '')
}

export function numbersIn(text: string): string[] {
  return [...new Set((text.match(NUMBER) ?? []).map(normalise).filter(Boolean))]
}

export type GroundingResult = { grounded: boolean; unsupported: string[] }

export function checkGrounding(reply: string, sources: string[]): GroundingResult {
  const haystack = sources.join('\n').replace(/(\d),(?=\d)/g, '$1')
  const unsupported = numbersIn(reply).filter((n) => {
    const escaped = n.replace('.', '\\.')
    return !new RegExp(`(?<![\\d.])${escaped}(?![\\d]|\\.\\d)`).test(haystack)
  })
  return { grounded: unsupported.length === 0, unsupported }
}

/**
 * Claims about actions must be backed by a tool that actually succeeded this
 * turn. "I drafted the documents" with no draft call, or "marked done" with no
 * mark_done, is a claim from nowhere, even though it contains no number.
 */
const CLAIMS: { pattern: RegExp; tools: string[]; label: string }[] = [
  { pattern: /\b(drafted|prepared|compiled|generated)\b[^.]*\b(documents?|drafts?|folders?|files?|papers?)\b|\bdocuments? (are|were|have been) (drafted|prepared|compiled|generated)\b/i, tools: ['draft_documents', 'run_autopilot'], label: 'drafted' },
  { pattern: /\bmarked\b[^.]*\b(as )?(done|filed|complete[d]?)\b|\b(is|are) now (marked )?(done|filed)\b/i, tools: ['mark_done'], label: 'marked done' },
  { pattern: /\breminders?\b[^.]*\b(sent|set|queued|scheduled|went out)\b|\b(sent|queued|scheduled) (a |the |your )?reminders?\b/i, tools: ['run_reminders', 'run_autopilot'], label: 'reminders' },
  { pattern: /\bautopilot\b[^.]*\b(ran|has run|has been run|checked|completed)\b|\bran the (morning check|autopilot)\b/i, tools: ['run_autopilot'], label: 'autopilot' },
  // The agent can only propose sharing; the founder approves. So "shared" or "link created" is never true in a reply.
  { pattern: /\b(have shared|has been shared|shared (it|the|your)|created (a |the )?(share )?link|link (is|has been) (created|ready|sent)|have revoked|has been revoked)\b/i, tools: [], label: 'shared' },
  { pattern: /\b(updated|saved|recorded|changed)\b[^.]*\b(record|profile|turnover|employees|state|details?|facts?)\b/i, tools: ['update_company'], label: 'saved' },
  { pattern: /\breopened\b/i, tools: ['reopen'], label: 'reopened' },
  { pattern: /\b(ticked|checked off)\b/i, tools: ['tick_document'], label: 'ticked' },
]

export function unbackedClaims(reply: string, calls: { name: string; ok: boolean }[]): string[] {
  const succeeded = new Set(calls.filter((c) => c.ok).map((c) => c.name))
  return CLAIMS.filter((c) => c.pattern.test(reply) && !c.tools.some((t) => succeeded.has(t))).map((c) => c.label)
}

/** A reply that spells out tool calls as text ("[draft_documents(item=...)]") instead of making them. */
export function looksLikeToolSyntax(reply: string, toolNames: string[]): boolean {
  return toolNames.some((name) => new RegExp(`\\b${name}\\b`).test(reply)) || /^\s*\[?\s*[a-z_]+\s*\([^)]*\)/.test(reply)
}
