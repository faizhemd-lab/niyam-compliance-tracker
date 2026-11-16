import { RULES } from './catalogue'
import { formatDate, formatRupees, formatTurnover } from './format'
import type { Cond, Fact, Obligation, Penalty, Profile, ProfileField, Rule, Schedule } from './types'

const ENTITY_LABELS: Record<string, string> = {
  private_limited: 'a private limited company',
  llp: 'a limited liability partnership (LLP)',
  partnership: 'a partnership firm',
  proprietorship: 'a sole proprietorship',
}

const SELLS_LABELS: Record<string, string> = {
  goods: 'goods',
  services: 'services',
  both: 'goods and services',
}

function hasValue(profile: Profile, field: ProfileField) {
  const value = profile[field]
  return value !== undefined && value !== null && value !== ''
}

/** One sentence for the leaf, in the founder's words, used as "why this applies". */
function factFor(field: ProfileField, profile: Profile): Fact | null {
  switch (field) {
    case 'entity':
      return profile.entity ? { label: 'Company type', value: `You run ${ENTITY_LABELS[profile.entity] ?? profile.entity}.` } : null
    case 'state':
      return profile.state ? { label: 'State', value: `You operate in ${profile.state}.` } : null
    case 'turnover':
      return profile.turnover !== undefined
        ? { label: 'Turnover', value: `Your turnover is about ${formatRupees(profile.turnover)} a year.` }
        : null
    case 'employees':
      return profile.employees !== undefined
        ? { label: 'People', value: profile.employees === 0 ? 'You have no employees yet.' : `You have ${profile.employees} ${profile.employees === 1 ? 'person' : 'people'} on payroll.` }
        : null
    case 'sells':
      return profile.sells ? { label: 'What you sell', value: `You sell ${SELLS_LABELS[profile.sells]}.` } : null
    case 'gst_registered':
      return profile.gst_registered === undefined ? null : profile.gst_registered
        ? { label: 'GST', value: 'You are registered for GST.' }
        : { label: 'GST', value: 'You are not registered for GST yet.' }
    case 'interstate':
      return profile.interstate === undefined ? null : profile.interstate
        ? { label: 'Sales area', value: 'You sell to customers in other states.' }
        : { label: 'Sales area', value: 'You sell only within your own state.' }
    case 'foreign_investment':
      return profile.foreign_investment === undefined ? null : profile.foreign_investment
        ? { label: 'Foreign investment', value: 'You have foreign investment.' }
        : { label: 'Foreign investment', value: 'You have no foreign investment.' }
    case 'incorporated_on':
      return profile.incorporated_on ? { label: 'Incorporated', value: `You incorporated on ${formatDate(profile.incorporated_on)}.` } : null
    default:
      return null
  }
}

function compareLeaf(field: ProfileField, op: string, value: string | number | boolean | readonly (string | number | boolean)[], profile: Profile): boolean {
  const actual = profile[field]
  if (actual === undefined || actual === null) return false
  switch (op) {
    case 'eq':
      return actual === value
    case 'in':
      return Array.isArray(value) && (value as readonly (string | number | boolean)[]).includes(actual)
    case 'gt':
      return typeof actual === 'number' && typeof value === 'number' && actual > value
    case 'gte':
      return typeof actual === 'number' && typeof value === 'number' && actual >= value
    case 'lt':
      return typeof actual === 'number' && typeof value === 'number' && actual < value
    case 'lte':
      return typeof actual === 'number' && typeof value === 'number' && actual <= value
    default:
      return false
  }
}

/** Evaluate a condition and collect the profile facts that made it true. */
export function evaluateCondition(cond: Cond, profile: Profile): { ok: boolean; facts: Fact[] } {
  if ('all' in cond) {
    const results = cond.all.map((c) => evaluateCondition(c, profile))
    return { ok: results.every((r) => r.ok), facts: results.flatMap((r) => (r.ok ? r.facts : [])) }
  }
  if ('any' in cond) {
    const results = cond.any.map((c) => evaluateCondition(c, profile))
    return { ok: results.some((r) => r.ok), facts: results.filter((r) => r.ok).flatMap((r) => r.facts) }
  }
  if ('not' in cond) {
    const result = evaluateCondition(cond.not, profile)
    return { ok: !result.ok, facts: [] }
  }
  const ok = compareLeaf(cond.field, cond.op, cond.value, profile)
  const fact = ok ? factFor(cond.field, profile) : null
  return { ok, facts: fact ? [fact] : [] }
}

/** The schedule a rule uses for this profile: a variant's, or its default. */
export function effectiveSchedule(rule: Rule, profile: Profile): Schedule {
  for (const variant of rule.variants ?? []) {
    if (evaluateCondition(variant.when, profile).ok) return variant.schedule
  }
  return rule.schedule
}

/**
 * Illustrative penalty for filing 30 days late, from the structured fields.
 * Always shown beside the rule text and labelled indicative.
 */
export function penaltyExample(penalty: Penalty, turnover?: number, days = 30): string | undefined {
  if (penalty.example) return penalty.example
  const parts: number[] = []
  if (penalty.per_day) {
    // A fixed fee on top of a daily fee: both are owed.
    if (penalty.fixed) parts.push(penalty.fixed)
    let late = penalty.per_day * days
    if (penalty.cap) late = Math.min(late, penalty.cap)
    if (penalty.percent_of_turnover && turnover) late = Math.min(late, turnover * penalty.percent_of_turnover)
    parts.push(late)
  } else if (penalty.percent_of_turnover && turnover) {
    // A fixed amount beside a share of turnover means "whichever is lower".
    const amount = turnover * penalty.percent_of_turnover
    parts.push(penalty.fixed ? Math.min(penalty.fixed, amount) : amount)
  } else if (penalty.fixed) {
    parts.push(penalty.fixed)
  }
  const total = parts.reduce((a, b) => a + b, 0)
  if (!total) return undefined
  return `about ${formatRupees(total)} if filed ${days} days late`
}

/** Required interview answers, in the order they are asked. */
export const REQUIRED_FIELDS: ProfileField[] = [
  'entity',
  'state',
  'turnover',
  'employees',
  'sells',
  'gst_registered',
  'interstate',
  'foreign_investment',
]

export function missingFields(profile: Profile): ProfileField[] {
  return REQUIRED_FIELDS.filter((field) => !hasValue(profile, field))
}

/** Every rule that applies, with the reason written from the profile. */
export function evaluateRules(profile: Profile, rules: Rule[] = RULES): Obligation[] {
  return rules
    .map((rule) => {
      const result = evaluateCondition(rule.applies, profile)
      if (!result.ok) return null
      const seen = new Set<string>()
      const facts = result.facts.filter((f) => {
        const key = `${f.label}:${f.value}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      const obligation: Obligation = {
        rule_id: rule.id,
        name: rule.name,
        short: rule.short,
        authority: rule.authority,
        group: rule.group,
        reason: rule.reason,
        facts,
        penalty: rule.penalty,
        penalty_example: penaltyExample(rule.penalty, profile.turnover),
        documents: rule.documents,
        plain: rule.plain,
        how_to_file: rule.how_to_file,
        rule_version: rule.rule_version,
        verified: Boolean(rule.verified_on),
        source_url: rule.source_url,
      }
      return obligation
    })
    .filter((o): o is Obligation => o !== null)
}

/** Turnover in words for the summary strip. */
export function profileLine(profile: Profile): string {
  const bits: string[] = []
  if (profile.entity) bits.push(ENTITY_LABELS[profile.entity] ?? profile.entity)
  if (profile.state) bits.push(profile.state)
  if (profile.turnover !== undefined) bits.push(`${formatTurnover(profile.turnover)} turnover`)
  if (profile.employees !== undefined) bits.push(`${profile.employees} ${profile.employees === 1 ? 'person' : 'people'}`)
  return bits.join(' · ')
}
