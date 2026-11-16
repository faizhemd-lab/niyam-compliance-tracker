import { INDIAN_STATES } from './catalogue'
import { formatDate, formatRupees } from './format'
import { maskIdentifiers, parseAmount, parseDateText } from './gateway'
import type { Company, Director, Entity, Profile, ProfileField, Sells } from './types'

/**
 * The company knowledge base: every fact the agent knows about the business,
 * with where it came from and when it changed. The rules engine reads a profile
 * derived from these facts; documents are filled from them. Nothing is written
 * without validation, so a misread in chat cannot corrupt the record.
 */

export type FactSource = 'interview' | 'agent' | 'import' | 'manual' | 'document'
export type KBSection = 'identity' | 'people' | 'money' | 'registrations' | 'investors' | 'operations'
export type KnowledgeField =
  | 'legal_name'
  | 'entity'
  | 'state'
  | 'cin'
  | 'pan'
  | 'gstin'
  | 'incorporated_on'
  | 'address'
  | 'premises'
  | 'website'
  | 'contact_email'
  | 'contact_phone'
  | 'directors'
  | 'employees'
  | 'authorised_signatory'
  | 'turnover'
  | 'authorised_capital'
  | 'paid_up_capital'
  | 'fy_end'
  | 'gst_registered'
  | 'epf_registered'
  | 'esic_registered'
  | 'professional_tax_number'
  | 'shop_licence_number'
  | 'foreign_investment'
  | 'investors'
  | 'last_allotment_on'
  | 'sells'
  | 'interstate'

export type Investor = { name: string; country: string; amount?: number; allotted_on?: string }

export type Fact = { value: unknown; source: FactSource; updated_at: string }

export type Knowledge = { facts: Partial<Record<KnowledgeField, Fact>> }

export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'entity' | 'sells' | 'state' | 'directors' | 'investors'

export type FieldSpec = {
  key: KnowledgeField
  label: string
  section: KBSection
  type: FieldType
  /** The question the agent asks when the fact is missing. */
  ask: string
  hint?: string
  /** Which profile field this feeds, if the rules engine reads it. */
  rule?: ProfileField
  required?: boolean
}

export const SECTIONS: { key: KBSection; label: string; blurb: string }[] = [
  { key: 'identity', label: 'Identity', blurb: 'Who the business is, on paper.' },
  { key: 'people', label: 'People', blurb: 'Directors, signatories and headcount.' },
  { key: 'money', label: 'Money', blurb: 'Turnover and capital. Thresholds hang off these.' },
  { key: 'registrations', label: 'Registrations', blurb: 'What is already registered, and under which number.' },
  { key: 'investors', label: 'Investors', blurb: 'Foreign money brings RBI filings.' },
  { key: 'operations', label: 'Operations', blurb: 'What you sell and where you sell it.' },
]

export const FIELDS: FieldSpec[] = [
  { key: 'legal_name', label: 'Legal name', section: 'identity', type: 'text', ask: 'What is the registered legal name of the business?', required: true },
  { key: 'entity', label: 'Company type', section: 'identity', type: 'entity', ask: 'Is it a private limited company, an LLP, a partnership or a sole proprietorship?', rule: 'entity', required: true },
  { key: 'state', label: 'State', section: 'identity', type: 'state', ask: 'Which state is the business registered in?', rule: 'state', required: true },
  { key: 'cin', label: 'CIN or LLPIN', section: 'identity', type: 'text', ask: 'What is the CIN or LLPIN on the incorporation certificate?', hint: 'Optional. It appears on drafted resolutions.' },
  { key: 'pan', label: 'PAN', section: 'identity', type: 'text', ask: 'What is the PAN? I store only a masked form.', hint: 'Ten characters, for example ABCDE1234F.' },
  { key: 'gstin', label: 'GSTIN', section: 'identity', type: 'text', ask: 'What is the GSTIN, if you have one?', hint: 'Fifteen characters. Stored masked.' },
  { key: 'incorporated_on', label: 'Incorporated on', section: 'identity', type: 'date', ask: 'When was the business incorporated?', rule: 'incorporated_on', hint: 'Needed for INC-20A and the first GST deadline.' },
  { key: 'address', label: 'Registered address', section: 'identity', type: 'text', ask: 'What is the registered address?', hint: 'Used in notices and the authority letter.' },
  { key: 'premises', label: 'Has premises', section: 'identity', type: 'boolean', ask: 'Do you work from an office or shop, rather than home?' },
  { key: 'website', label: 'Website', section: 'identity', type: 'text', ask: 'What is the website, if any?' },
  { key: 'contact_email', label: 'Reminder email', section: 'identity', type: 'text', ask: 'Which email should reminders go to?' },
  { key: 'contact_phone', label: 'Phone', section: 'identity', type: 'text', ask: 'Which mobile number should we keep on file?' },
  { key: 'directors', label: 'Directors', section: 'people', type: 'directors', ask: 'Who are the directors or partners, and what are their DINs?', hint: 'Needed for DIR-3 KYC, resolutions and the KYC sheet.' },
  { key: 'employees', label: 'Employees', section: 'people', type: 'number', ask: 'How many people are on payroll, including part-timers?', rule: 'employees', required: true },
  { key: 'authorised_signatory', label: 'Authorised signatory', section: 'people', type: 'text', ask: 'Who signs filings on behalf of the company?' },
  { key: 'turnover', label: 'Turnover', section: 'money', type: 'number', ask: 'Roughly what is the yearly turnover, before costs?', rule: 'turnover', required: true, hint: 'You can say “60 lakh” or “2 crore”.' },
  { key: 'authorised_capital', label: 'Authorised capital', section: 'money', type: 'number', ask: 'What is the authorised share capital?' },
  { key: 'paid_up_capital', label: 'Paid-up capital', section: 'money', type: 'number', ask: 'What is the paid-up share capital?' },
  { key: 'fy_end', label: 'Financial year end', section: 'money', type: 'text', ask: 'When does your financial year end?', hint: '31 March unless you have a reason to change it.' },
  { key: 'gst_registered', label: 'GST registered', section: 'registrations', type: 'boolean', ask: 'Are you registered for GST?', rule: 'gst_registered', required: true },
  { key: 'epf_registered', label: 'EPF registered', section: 'registrations', type: 'boolean', ask: 'Is the company registered with EPFO?' },
  { key: 'esic_registered', label: 'ESIC registered', section: 'registrations', type: 'boolean', ask: 'Is the company registered with ESIC?' },
  { key: 'professional_tax_number', label: 'Professional tax number', section: 'registrations', type: 'text', ask: 'Do you have a professional tax registration number?' },
  { key: 'shop_licence_number', label: 'Shop licence number', section: 'registrations', type: 'text', ask: 'Do you have a Shops & Establishments licence number?' },
  { key: 'foreign_investment', label: 'Foreign investment', section: 'investors', type: 'boolean', ask: 'Is there any foreign investment or foreign shareholder?', rule: 'foreign_investment', required: true },
  { key: 'investors', label: 'Investors', section: 'investors', type: 'investors', ask: 'Which investors put money in, and from which countries?', hint: 'Needed for FC-GPR and the FLA return.' },
  { key: 'last_allotment_on', label: 'Last share allotment', section: 'investors', type: 'date', ask: 'When were shares last allotted to an investor?' },
  { key: 'sells', label: 'Sells', section: 'operations', type: 'sells', ask: 'Do you sell goods, services, or both?', rule: 'sells', required: true },
  { key: 'interstate', label: 'Sells to other states', section: 'operations', type: 'boolean', ask: 'Do you sell to customers in other states?', rule: 'interstate', required: true },
]

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]))

export const emptyKnowledge = (): Knowledge => ({ facts: {} })

export function factValue<T = unknown>(kb: Knowledge, key: KnowledgeField): T | undefined {
  return kb.facts[key]?.value as T | undefined
}

export function hasFact(kb: Knowledge, key: KnowledgeField): boolean {
  const value = kb.facts[key]?.value
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
}

/** The profile the rules engine reads, derived from the facts. */
export function deriveProfile(kb: Knowledge): Profile {
  const profile: Profile = {}
  for (const spec of FIELDS) {
    if (!spec.rule) continue
    const value = kb.facts[spec.key]?.value
    if (value === undefined || value === null) continue
    ;(profile as Record<string, unknown>)[spec.rule] = value
  }
  return profile
}

/** A company record for the compiler and the existing screens. */
export function knowledgeToCompany(kb: Knowledge): Company {
  const profile = deriveProfile(kb)
  return {
    ...profile,
    name: (factValue<string>(kb, 'legal_name') ?? '') as string,
    cin: factValue<string>(kb, 'cin'),
    pan_masked: factValue<string>(kb, 'pan'),
    gstin_masked: factValue<string>(kb, 'gstin'),
    directors: factValue<Director[]>(kb, 'directors') ?? [],
    premises: factValue<boolean>(kb, 'premises'),
    email: factValue<string>(kb, 'contact_email'),
    budget: undefined,
  }
}

/** Build a knowledge base from a legacy company record (demo data, imports). */
export function knowledgeFromCompany(company: Company, source: FactSource = 'import', at = new Date().toISOString()): Knowledge {
  const facts: Knowledge['facts'] = {}
  const put = (key: KnowledgeField, value: unknown) => {
    if (value === undefined || value === null || value === '') return
    facts[key] = { value, source, updated_at: at }
  }
  put('legal_name', company.name)
  put('entity', company.entity)
  put('state', company.state)
  put('turnover', company.turnover)
  put('employees', company.employees)
  put('sells', company.sells)
  put('gst_registered', company.gst_registered)
  put('interstate', company.interstate)
  put('foreign_investment', company.foreign_investment)
  put('incorporated_on', company.incorporated_on)
  put('cin', company.cin)
  put('pan', company.pan_masked)
  put('gstin', company.gstin_masked)
  put('directors', company.directors)
  put('premises', company.premises)
  put('contact_email', company.email)
  return { facts }
}

const mask = (value: string) => `${value.slice(0, 2)}••••${value.slice(-3)}`
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/

export type FactError = { key: KnowledgeField; message: string }

function coerce(spec: FieldSpec, raw: unknown): { value?: unknown; error?: string } {
  switch (spec.type) {
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/[₹,\s]/g, ''))
      if (!Number.isFinite(value) || value < 0) return { error: `${spec.label} must be a number of zero or more.` }
      return { value: Math.round(value) }
    }
    case 'boolean':
      if (typeof raw === 'boolean') return { value: raw }
      if (/^(yes|true|y|1)$/i.test(String(raw))) return { value: true }
      if (/^(no|false|n|0)$/i.test(String(raw))) return { value: false }
      return { error: `${spec.label} must be yes or no.` }
    case 'entity': {
      const map: Record<string, Entity> = {
        private_limited: 'private_limited',
        'private limited': 'private_limited',
        llp: 'llp',
        partnership: 'partnership',
        proprietorship: 'proprietorship',
      }
      const value = map[String(raw).toLowerCase()]
      return value ? { value } : { error: 'Company type must be private limited, LLP, partnership or proprietorship.' }
    }
    case 'sells': {
      const value = String(raw).toLowerCase()
      if (value === 'goods' || value === 'services' || value === 'both') return { value: value as Sells }
      return { error: 'Sells must be goods, services or both.' }
    }
    case 'state': {
      const value = INDIAN_STATES.find((s) => s.toLowerCase() === String(raw).toLowerCase())
      return value ? { value } : { error: `“${raw}” is not a state we cover.` }
    }
    case 'date': {
      const value = String(raw)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: `${spec.label} must be a date like 2026-04-01.` }
      if (value > new Date().toISOString().slice(0, 10)) return { error: `${spec.label} cannot be in the future.` }
      return { value }
    }
    case 'directors': {
      if (!Array.isArray(raw)) return { error: 'Directors must be a list of names and DINs.' }
      const list = raw
        .map((d) => d as Partial<Director>)
        .filter((d) => d && typeof d.name === 'string' && d.name.trim())
        .map((d) => ({ name: d.name!.trim(), din: (d.din ?? '').trim(), email: d.email, mobile: d.mobile }))
      return list.length ? { value: list } : { error: 'Give at least one director name.' }
    }
    case 'investors': {
      if (!Array.isArray(raw)) return { error: 'Investors must be a list.' }
      const list = raw
        .map((i) => i as Partial<Investor>)
        .filter((i) => i && typeof i.name === 'string' && i.name.trim())
        .map((i) => ({ name: i.name!.trim(), country: (i.country ?? 'Unknown').trim(), amount: i.amount, allotted_on: i.allotted_on }))
      return list.length ? { value: list } : { error: 'Give at least one investor name.' }
    }
    case 'text': {
      const value = String(raw).trim()
      if (!value) return { error: `${spec.label} cannot be empty.` }
      if (spec.key === 'pan') {
        const pan = value.toUpperCase()
        if (!PAN.test(pan)) return { error: 'That PAN does not look right. It is ten characters, like ABCDE1234F.' }
        return { value: mask(pan) }
      }
      if (spec.key === 'gstin') {
        const gstin = value.toUpperCase()
        if (!GSTIN.test(gstin)) return { error: 'That GSTIN does not look right. It is fifteen characters.' }
        return { value: mask(gstin) }
      }
      if (spec.key === 'contact_email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { error: 'That email address does not look right.' }
      return { value: value.slice(0, 500) }
    }
  }
}

export type AppliedFacts = {
  knowledge: Knowledge
  changed: { key: KnowledgeField; label: string; from?: string; to: string }[]
  errors: FactError[]
}

/** Validate and merge facts. Nothing is stored unless every value passes. */
export function applyFacts(kb: Knowledge, patch: Partial<Record<KnowledgeField, unknown>>, source: FactSource, at = new Date().toISOString()): AppliedFacts {
  const facts = { ...kb.facts }
  const changed: AppliedFacts['changed'] = []
  const errors: FactError[] = []
  for (const [key, raw] of Object.entries(patch) as [KnowledgeField, unknown][]) {
    const spec = FIELD_BY_KEY.get(key)
    if (!spec) continue
    const { value, error } = coerce(spec, raw)
    if (error || value === undefined) {
      errors.push({ key, message: error ?? `${spec.label} is invalid.` })
      continue
    }
    const before = facts[key]?.value
    if (JSON.stringify(before) === JSON.stringify(value)) continue
    facts[key] = { value, source, updated_at: at }
    changed.push({ key, label: spec.label, from: before === undefined ? undefined : formatFact(spec, before), to: formatFact(spec, value) })
  }
  return { knowledge: { facts }, changed, errors }
}

export function formatFact(spec: FieldSpec, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (spec.type === 'number' && typeof value === 'number') return spec.key === 'employees' ? `${value}` : formatRupees(value)
  if (spec.type === 'date') return formatDate(String(value))
  if (spec.type === 'boolean') return value ? 'Yes' : 'No'
  if (spec.type === 'entity') return String(value).replace('_', ' ')
  if (spec.type === 'directors' && Array.isArray(value)) return value.map((d) => `${(d as Director).name} (DIN ${(d as Director).din || '—'})`).join(', ')
  if (spec.type === 'investors' && Array.isArray(value)) return value.map((i) => `${(i as Investor).name}, ${(i as Investor).country}`).join('; ')
  return String(value)
}

export function factRows(kb: Knowledge) {
  return SECTIONS.map((section) => ({
    ...section,
    rows: FIELDS.filter((f) => f.section === section.key).map((spec) => ({
      spec,
      fact: kb.facts[spec.key],
      text: factValue(kb, spec.key) === undefined ? null : formatFact(spec, kb.facts[spec.key]?.value),
    })),
  }))
}

/** Facts the rules cannot run without. */
export function missingFacts(kb: Knowledge): FieldSpec[] {
  return FIELDS.filter((f) => f.required && !hasFact(kb, f.key))
}

/** Facts that would improve the documents, once the required ones are in. */
export function suggestedFacts(kb: Knowledge): FieldSpec[] {
  const useful: KnowledgeField[] = ['legal_name', 'incorporated_on', 'cin', 'pan', 'address', 'directors', 'contact_email', 'authorised_capital', 'paid_up_capital', 'fy_end']
  return FIELDS.filter((f) => useful.includes(f.key) && !hasFact(kb, f.key))
}

/**
 * Read facts out of a founder's message. Deterministic and conservative: a
 * value is only proposed when the sentence is clear, and applyFacts validates
 * it again before it is stored.
 */
export function extractFacts(message: string, kb: Knowledge): { patch: Partial<Record<KnowledgeField, unknown>>; notes: string[] } {
  // Identifiers are read from the raw message so we can store them masked;
  // everything else parses the masked text, so numbers in a PAN never leak in.
  const raw = message
  const text = maskIdentifiers(message)
  const lower = text.toLowerCase()
  const patch: Partial<Record<KnowledgeField, unknown>> = {}
  const notes: string[] = []

  // Company type, state, money, headcount and the yes/no facts.
  if (/private\s*(limited|ltd)|pvt\.?\s*(limited|ltd)/.test(lower)) patch.entity = 'private_limited'
  else if (/\bllp\b|limited liability partnership/.test(lower)) patch.entity = 'llp'
  else if (/proprietor|sole\s*proprietor/.test(lower)) patch.entity = 'proprietorship'
  else if (/partnership/.test(lower) && !/private/.test(lower)) patch.entity = 'partnership'

  const state = INDIAN_STATES.find((s) => lower.includes(s.toLowerCase()))
  if (state) patch.state = state

  // A DIN is eight digits and is not money.
  const amountText = text.replace(/\bDIN[:\s]*\d{8}\b/gi, ' ')
  const amount = parseAmount(amountText)
  if (amount !== null) {
    if (/capital/.test(lower)) {
      if (/paid.?up/.test(lower)) patch.paid_up_capital = amount
      else if (/authoris|authoriz/.test(lower)) patch.authorised_capital = amount
      else patch.authorised_capital = amount
    } else if (/invest|raised|funding|round/.test(lower)) {
      const country = text.match(/\b(US|USA|United States|UK|Singapore|UAE|Dubai|Germany|Japan|Netherlands|Mauritius|Canada)\b/i)
      const existing = (kb.facts.investors?.value as Investor[] | undefined) ?? []
      const investor: Investor = { name: country ? `${country[1]} investor` : 'Investor', country: country ? country[1] : 'Unknown', amount }
      patch.investors = [...existing.filter((i) => i.name !== investor.name), investor]
      patch.foreign_investment = true
    } else {
      patch.turnover = amount
    }
  }

  const headcount = lower.match(/(\d{1,6})\s*(?:people|persons|employees|staff|team|headcount|payroll)/)
  if (headcount) patch.employees = Number(headcount[1])
  else if (/just me|only me|solo founder|no employees/.test(lower)) patch.employees = /no employees/.test(lower) ? 0 : 1

  if (/\bboth\b|goods and services/.test(lower)) patch.sells = 'both'
  else if (/\bservices?\b|software|saas|consult|design|agency|marketing/.test(lower)) patch.sells = 'services'
  else if (/\bgoods\b|products?\b|manufactur|trading/.test(lower)) patch.sells = 'goods'

  const gstinMatch = raw.toUpperCase().match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3})\b/)
  if (/not (gst )?registered|no gst|without gst/.test(lower)) patch.gst_registered = false
  else if (/gst registered|registered (for|under) gst|have gst|gst number|gstin|\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}\b/.test(raw) || gstinMatch) {
    patch.gst_registered = true
    if (gstinMatch) patch.gstin = gstinMatch[1]
  }

  if (/only (in|within) (my|our|the) (state|city)|local(ly)? only|within (the )?state/.test(lower)) patch.interstate = false
  else if (/other states?|across (india|states)|pan[- ]?india|nationwide|inter-state/.test(lower)) patch.interstate = true

  if (/no foreign|no fdi|no outside investor|no overseas|not raised (from )?outside/.test(lower)) {
    patch.foreign_investment = false
    patch.investors = []
  } else if (/foreign|fdi|overseas|investor[s]? from (the )?(us|usa|uk|singapore|uae|germany|japan)/.test(lower)) {
    patch.foreign_investment = true
  }

  if (/work from home|no office|home office|remote only/.test(lower)) patch.premises = false
  else if (/\boffice\b|\bshop\b|\bpremises\b|coworking|co-working/.test(lower)) patch.premises = true

  const date = parseDateText(text)
  if (date) {
    if (/allot|shares|round/.test(lower)) patch.last_allotment_on = date
    else if (/incorporat|registered (the )?(company|firm)/.test(lower) || /\bincorporated\b/.test(lower)) patch.incorporated_on = date
  }

  const pan = raw.toUpperCase().match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/)
  if (pan) patch.pan = pan[0]

  const cin = raw.toUpperCase().match(/\b([LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6})\b/)
  if (cin) patch.cin = cin[1]

  const din = text.match(/\bDIN[:\s]*([0-9]{8})\b/i)
  if (din) {
    const existing = (kb.facts.directors?.value as Director[] | undefined) ?? []
    const nameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/)
    const name = nameMatch ? nameMatch[1] : existing[0]?.name ?? 'Director'
    patch.directors = [...existing.filter((d) => d.din !== din[1]), { name, din: din[1], email: existing.find((d) => d.name === name)?.email }]
  } else if (/director[s]? (?:is|are|include[s]?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/.test(text)) {
    const name = text.match(/director[s]? (?:is|are|include[s]?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/)![1]
    const existing = (kb.facts.directors?.value as Director[] | undefined) ?? []
    patch.directors = [...existing.filter((d) => d.name !== name), { name, din: existing.find((d) => d.name === name)?.din ?? '' }]
  }

  const email = raw.match(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/)
  if (email && /remind|email me|contact/.test(lower)) patch.contact_email = email[0]

  const legalName = text.match(/\b([A-Z][\w&.-]+(?:\s+[A-Z][\w&.-]+){0,4}\s+(?:Private Limited|Pvt\.? Ltd\.?|LLP|Limited))\b/)
  if (legalName) patch.legal_name = legalName[1]

  if (/epf|provident fund/.test(lower) && /registered/.test(lower)) patch.epf_registered = true
  if (/esic/.test(lower) && /registered/.test(lower)) patch.esic_registered = true

  if (Object.keys(patch).length === 0 && /actually|correction|sorry|instead/.test(lower)) {
    notes.push('I could not find a fact to change in that sentence. Try “we now have 25 employees” or “turnover is 2 crore”.')
  }
  return { patch, notes }
}

/** Compact text for prompts: only what is known, with the source. */
export function knowledgeForPrompt(kb: Knowledge): string {
  const lines: string[] = []
  for (const spec of FIELDS) {
    if (!hasFact(kb, spec.key)) continue
    lines.push(`- ${spec.key}: ${formatFact(spec, kb.facts[spec.key]?.value)} (${kb.facts[spec.key]?.source})`)
  }
  return lines.join('\n') || '(nothing known yet)'
}
