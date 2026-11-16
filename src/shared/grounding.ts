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
