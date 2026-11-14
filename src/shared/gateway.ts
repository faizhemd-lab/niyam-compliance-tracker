import { CITY_TO_STATE, INDIAN_STATES } from './catalogue'
import { formatDate, formatRupees } from './format'
import type { Language, Profile, ProfileField } from './types'

/**
 * The model gateway. This is the only place that turns free text into profile
 * fields and record data into sentences. It has two jobs and no authority over
 * what applies or when it is due: the rules engine owns that.
 *
 * In this build the gateway is a deterministic on-server parser rather than a
 * language model (no model server is configured). The interface is the one a
 * local Ollama / vLLM model plugs into: swap `engine` and keep the validation.
 * The UI states this plainly instead of claiming a model is running.
 */
export const GATEWAY = {
  engine: 'deterministic local parser (v1)',
  hosting: 'self-hosted, no third-party calls',
  fallback: 'template questions and stored plain-words text',
} as const

export type Rejection = { field: ProfileField; reason: string }
export type Extraction = { updates: Partial<Profile>; rejected: Rejection[]; notes: string[] }

const PAN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g
const GSTIN = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}\b/g
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g
const PHONE = /\b(?:\+91[-\s]?)?[6-9]\d{9}\b/g

/** Mask identifiers before anything reaches a model or a log. */
export function maskIdentifiers(input: string): string {
  return input.replace(PAN, '[PAN]').replace(GSTIN, '[GSTIN]').replace(EMAIL, '[EMAIL]').replace(PHONE, '[PHONE]')
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
}

function parseCount(text: string): number | null {
  const digits = text.match(/\b(\d{1,6})\b/)
  if (digits) return Number(digits[1])
  const words = text.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)\b/)
  if (words) return NUMBER_WORDS[words[1]]
  return null
}

/** Deterministic lakh / crore parser: a cross-check on turnover, never a guess. */
export function parseAmount(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, '')
  const crore = t.match(/(\d+(?:\.\d+)?)\s*(crore|cr\b)/)
  if (crore) return Math.round(Number(crore[1]) * 10_000_000)
  const lakh = t.match(/(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|L\b)/i)
  if (lakh) return Math.round(Number(lakh[1]) * 100_000)
  const million = t.match(/(\d+(?:\.\d+)?)\s*(million|mn\b)/)
  if (million) return Math.round(Number(million[1]) * 1_000_000)
  // A bare four-digit number is usually a year, so plain amounts need a currency
  // marker unless they are long enough to be an amount on their own.
  const plain = t.match(/(?:rs\.?|₹|inr)\s*(\d{4,})/) ?? t.match(/\b(\d{5,})\b/)
  if (plain) return Number(plain[1])
  return null
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

export function parseDateText(text: string): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) {
    const [, y, m, d] = iso
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const dmy = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  const named = text.toLowerCase().match(/\b(\d{1,2})?\s*([a-z]+)\s+(20\d{2})\b/)
  if (named) {
    const month = MONTHS.indexOf(named[2])
    if (month >= 0) {
      const day = named[1] ? Number(named[1]) : 1
      return `${named[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  return null
}

function findState(text: string): string | undefined {
  const lower = text.toLowerCase()
  for (const state of INDIAN_STATES) {
    if (lower.includes(state.toLowerCase())) return state
  }
  for (const [city, state] of Object.entries(CITY_TO_STATE)) {
    if (new RegExp(`\\b${city}\\b`).test(lower)) return state
  }
  return undefined
}

function booleanAnswer(text: string, awaiting: ProfileField | null, field: ProfileField): boolean | undefined {
  // A bare yes or no only answers the question being asked; anything else
  // would let "no foreign investment" also turn off GST.
  if (awaiting !== field) return undefined
  if (/^(yes|yeah|yep|y|haan|ha)\b/i.test(text.trim())) return true
  if (/^(no|nope|n|nahi)\b/i.test(text.trim())) return false
  return undefined
}

/**
 * One message in, validated field updates out. Every value is checked here:
 * allowed values, numeric ranges and a deterministic amount parser. A value
 * that fails is rejected with a reason instead of being saved.
 */
export function extract(message: string, awaiting: ProfileField | null): Extraction {
  const text = maskIdentifiers(message)
  const lower = text.toLowerCase()
  const updates: Partial<Profile> = {}
  const rejected: Rejection[] = []
  const notes: string[] = []

  // Company type
  if (/private\s*(limited|ltd)|pvt\.?\s*(limited|ltd)|pvt\b/.test(lower)) updates.entity = 'private_limited'
  else if (/\bllp\b|limited liability partnership/.test(lower)) updates.entity = 'llp'
  else if (/partnership|partners?\b/.test(lower) && !/private/.test(lower)) updates.entity = 'partnership'
  else if (/proprietor|sole\s*proprietor|sole\s*trader|individual business/.test(lower)) updates.entity = 'proprietorship'

  // State, from a state name or a city
  const state = findState(text)
  if (state) updates.state = state

  // Turnover
  const amount = parseAmount(text)
  if (amount !== null) {
    if (amount < 0 || amount > 1_000_000_000_000) rejected.push({ field: 'turnover', reason: 'That turnover looks out of range. Say it in lakh or crore, for example "60 lakh".' })
    else {
      updates.turnover = amount
      if (awaiting === 'turnover' && amount > 0 && amount < 10_000) notes.push(`read as ${formatRupees(amount)} a year`)
    }
  }

  // Employees
  if (/just me|only me|solo|founder only|no employees|nobody else/.test(lower)) updates.employees = /no employees/.test(lower) ? 0 : 1
  else if (/me and (a|one) (part[- ]?timer|partner|co-?founder)|two of us|both of us/.test(lower)) updates.employees = 2
  else if (/\b(people|employees|staff|persons|team|headcount|on payroll)\b/.test(lower) || awaiting === 'employees') {
    // Read the number attached to the headcount word, so "60 lakh, 12 people" is 12.
    const adjacent = lower.match(/(\d{1,6})\s*(?:people|persons|employees|staff|team|headcount|payroll)/)
    const count = adjacent ? Number(adjacent[1]) : awaiting === 'employees' ? parseCount(lower) : null
    if (count !== null) {
      if (count < 0 || count > 100_000) rejected.push({ field: 'employees', reason: 'That headcount looks out of range.' })
      else updates.employees = count
    }
  }

  // Goods or services
  if (/\bboth\b|goods and services/.test(lower)) updates.sells = 'both'
  else if (/\bgoods\b|\bproducts?\b|manufactur|physical|merchandise|e-?commerce\b.*product/.test(lower)) updates.sells = 'goods'
  else if (/\bservices?\b|software|saas|app\b|consult|design|agency|marketing|freelanc/.test(lower)) updates.sells = 'services'

  // GST registration
  if (/not (gst )?registered|no gst|gst.*(not|nahi)|unregistered/.test(lower)) updates.gst_registered = false
  else if (/gst registered|registered (for|under) gst|have gst|gst number|gstin|we are gst/.test(lower)) updates.gst_registered = true
  else {
    const answer = booleanAnswer(lower, awaiting, 'gst_registered')
    if (answer !== undefined) updates.gst_registered = answer
  }

  // Sales across states
  if (/only (in|within) (my|our|the) (state|city)|local(ly)? only|no interstate|within (the )?state/.test(lower)) updates.interstate = false
  else if (/other states?|across (india|states)|pan[- ]?india|all (over )?india|nationwide|inter-?state/.test(lower)) updates.interstate = true
  else {
    const answer = booleanAnswer(lower, awaiting, 'interstate')
    if (answer !== undefined) updates.interstate = answer
  }

  // Foreign investment
  if (/no foreign|no fdi|no outside (investors?|money)|no overseas|foreign.*(none|no)\b|not raised (from )?outside/.test(lower)) updates.foreign_investment = false
  else if (/foreign|fdi|overseas investor|us investor|investor(s)? (from|in) (the )?(us|usa|uk|singapore|uae)|nri/.test(lower)) updates.foreign_investment = true
  else {
    const answer = booleanAnswer(lower, awaiting, 'foreign_investment')
    if (answer !== undefined) updates.foreign_investment = answer
  }

  // Incorporation date
  const date = parseDateText(text)
  if (date) {
    const today = new Date().toISOString().slice(0, 10)
    if (date > today) rejected.push({ field: 'incorporated_on', reason: 'That date is in the future. When was the company incorporated?' })
    else if (date < '1950-01-01') rejected.push({ field: 'incorporated_on', reason: 'That date looks too early. Use YYYY-MM-DD.' })
    else updates.incorporated_on = date
  }

  return { updates, rejected, notes }
}

/** A short confirmation in plain words, after a message is accepted. */
export function confirm(updates: Partial<Profile>): string[] {
  const out: string[] = []
  if (updates.entity) out.push(`company type: ${updates.entity.replace('_', ' ')}`)
  if (updates.state) out.push(`state: ${updates.state}`)
  if (updates.turnover !== undefined) out.push(`turnover: ${formatRupees(updates.turnover)} a year`)
  if (updates.employees !== undefined) out.push(`people: ${updates.employees}`)
  if (updates.sells) out.push(`you sell ${updates.sells}`)
  if (updates.gst_registered !== undefined) out.push(`GST: ${updates.gst_registered ? 'registered' : 'not registered'}`)
  if (updates.interstate !== undefined) out.push(`sales: ${updates.interstate ? 'across states' : 'within your state'}`)
  if (updates.foreign_investment !== undefined) out.push(`foreign investment: ${updates.foreign_investment ? 'yes' : 'no'}`)
  if (updates.incorporated_on) out.push(`incorporated: ${formatDate(updates.incorporated_on)}`)
  return out
}

// ---------------------------------------------------------------------------
// Explanation

export type ExplainRecord = {
  name: string
  authority: string
  plain: string
  reason: string
  penalty: string
  how_to_file: string
  due: string
  rule_version: string
}

/**
 * Explain an obligation using only the record it was given, then check that
 * every number in the answer appears in that record. A mismatch falls back to
 * the stored plain-words text, so the founder always sees something correct.
 */
export function explain(record: ExplainRecord, language: Language, question?: string): { text: string; faithful: boolean; fallback: boolean } {
  const draft = [
    `${record.name} is handled with ${record.authority}.`,
    record.plain,
    `It applies to you because ${record.reason.charAt(0).toLowerCase()}${record.reason.slice(1)}`,
    record.due === 'On event' ? `There is no fixed date: file it ${record.how_to_file.replace(/^File /, '').toLowerCase()}` : `Your next deadline is ${record.due}.`,
    `If it is late: ${record.penalty}.`,
    `Next step: ${record.how_to_file}`,
  ].join(' ')

  const numbersIn = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[.,]$/, ''))
  const source = JSON.stringify(record)
  const faithful = numbersIn(draft).every((n) => source.includes(n))

  if (language !== 'en') {
    return { text: draft, faithful, fallback: false }
  }

  // A question about something outside the record gets an honest non-answer.
  if (question && /penalt|fine|late fee/i.test(question) && !record.penalty) {
    return { text: record.plain, faithful: true, fallback: true }
  }

  if (!faithful) return { text: record.plain, faithful: false, fallback: true }
  return { text: draft, faithful, fallback: false }
}

// ---------------------------------------------------------------------------
// Intent routing

export type Intent = 'explain_item' | 'update_profile' | 'mark_done' | 'show_calendar' | 'find_ca' | 'out_of_scope'

/** Free text after the interview is classified into a fixed list, then code acts. */
export function classify(message: string): Intent {
  const t = message.toLowerCase()
  if (/mark (it |this )?(as )?done|i (already )?filed|completed it/.test(t)) return 'mark_done'
  if (/calendar|deadline|due date|when is|what is due/.test(t)) return 'show_calendar'
  if (/\bca\b|accountant|chartered/.test(t)) return 'find_ca'
  if (/(\d+)\s*(people|employees|staff)|turnover|actually|we are (a|an)|changed|correction/.test(t)) return 'update_profile'
  if (/explain|what does|what is|mean|simple words/.test(t)) return 'explain_item'
  return 'out_of_scope'
}
