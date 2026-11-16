import { describe, expect, it } from 'vitest'

import { RULES } from '../src/shared/catalogue'
import { evaluateCondition, evaluateRules, missingFields, penaltyExample } from '../src/shared/rules'
import type { Profile } from '../src/shared/types'

const ids = (profile: Profile) => evaluateRules(profile).map((o) => o.rule_id).sort()

/**
 * Golden profiles: fictional companies with obligation lists checked by hand
 * against Appendix A of the handbook. If a rule changes on purpose, update the
 * expected list here in the same commit.
 */
const GOLDEN: { name: string; profile: Profile; expected: string[] }[] = [
  {
    name: 'demo: private limited, Telangana, 60 lakh, 12 people, services, not GST-registered',
    profile: { entity: 'private_limited', state: 'Telangana', turnover: 6_000_000, employees: 12, sells: 'services', gst_registered: false, interstate: false, foreign_investment: false, incorporated_on: '2026-04-01' },
    expected: ['advance_tax', 'agm', 'aoc4', 'dir3_kyc', 'esic', 'gst_registration', 'inc20a', 'itr', 'mgt7', 'professional_tax', 'shops_est', 'tds_deposit', 'tds_return'],
  },
  {
    name: 'new private company with foreign investment, 3 crore, 25 people, GST-registered',
    profile: { entity: 'private_limited', state: 'Karnataka', turnover: 30_000_000, employees: 25, sells: 'services', gst_registered: true, interstate: true, foreign_investment: true },
    expected: ['advance_tax', 'agm', 'aoc4', 'dir3_kyc', 'epf', 'esic', 'fc_gpr', 'fla', 'gstr1', 'gstr3b', 'gstr9', 'inc20a', 'itr', 'mgt7', 'professional_tax', 'shops_est', 'tds_deposit', 'tds_return'],
  },
  {
    name: 'proprietorship under the GST threshold, no staff, Delhi',
    profile: { entity: 'proprietorship', state: 'Delhi', turnover: 1_500_000, employees: 0, sells: 'services', gst_registered: false, interstate: false, foreign_investment: false },
    expected: ['advance_tax', 'itr'],
  },
  {
    name: 'LLP with 25 employees, Maharashtra, GST-registered',
    profile: { entity: 'llp', state: 'Maharashtra', turnover: 5_000_000, employees: 25, sells: 'services', gst_registered: true, interstate: false, foreign_investment: false },
    expected: ['advance_tax', 'dir3_kyc', 'epf', 'esic', 'gstr1', 'gstr3b', 'itr', 'llp_form11', 'llp_form8', 'professional_tax', 'shops_est', 'tds_deposit', 'tds_return'],
  },
  {
    name: 'partnership selling goods to other states below the turnover threshold',
    profile: { entity: 'partnership', state: 'Gujarat', turnover: 3_000_000, employees: 5, sells: 'goods', gst_registered: false, interstate: true, foreign_investment: false },
    expected: ['advance_tax', 'gst_registration', 'itr', 'professional_tax', 'shops_est', 'tds_deposit', 'tds_return'],
  },
  {
    name: 'proprietorship selling goods locally at 1.5 crore, Kerala (no professional tax rule)',
    profile: { entity: 'proprietorship', state: 'Kerala', turnover: 15_000_000, employees: 3, sells: 'goods', gst_registered: false, interstate: false, foreign_investment: false },
    expected: ['advance_tax', 'gst_registration', 'itr', 'shops_est', 'tax_audit', 'tds_deposit', 'tds_return'],
  },
  {
    name: 'pre-revenue LLP with foreign investment and no staff',
    profile: { entity: 'llp', state: 'Delhi', turnover: 0, employees: 0, sells: 'services', gst_registered: false, interstate: false, foreign_investment: true },
    expected: ['dir3_kyc', 'fla', 'itr', 'llp_form11', 'llp_form8'],
  },
  {
    name: 'pre-revenue private company, two founders on payroll, Telangana',
    profile: { entity: 'private_limited', state: 'Telangana', turnover: 0, employees: 2, sells: 'services', gst_registered: false, interstate: false, foreign_investment: false, incorporated_on: '2026-08-01' },
    expected: ['agm', 'aoc4', 'dir3_kyc', 'inc20a', 'itr', 'mgt7', 'professional_tax', 'shops_est', 'tds_deposit', 'tds_return'],
  },
  {
    name: 'partnership selling goods and services at 45 lakh, 9 people, Tamil Nadu',
    profile: { entity: 'partnership', state: 'Tamil Nadu', turnover: 4_500_000, employees: 9, sells: 'both', gst_registered: false, interstate: false, foreign_investment: false },
    expected: ['advance_tax', 'gst_registration', 'itr', 'professional_tax', 'shops_est', 'tds_deposit', 'tds_return'],
  },
  {
    name: 'services proprietorship exactly at the 20 lakh GST threshold',
    profile: { entity: 'proprietorship', state: 'Delhi', turnover: 2_000_000, employees: 0, sells: 'services', gst_registered: false, interstate: false, foreign_investment: false },
    expected: ['advance_tax', 'itr'],
  },
]

describe('golden profiles', () => {
  it.each(GOLDEN)('$name', ({ profile, expected }) => {
    expect(ids(profile)).toEqual([...expected].sort())
  })
})

describe('threshold boundaries', () => {
  const base: Profile = { entity: 'proprietorship', state: 'Delhi', turnover: 1_500_000, employees: 0, sells: 'services', gst_registered: false, interstate: false, foreign_investment: false }
  const has = (patch: Partial<Profile>, id: string) => ids({ ...base, ...patch }).includes(id)

  it('GST registration for services starts above ₹20 lakh, not at it', () => {
    expect(has({ turnover: 2_000_000 }, 'gst_registration')).toBe(false)
    expect(has({ turnover: 2_000_001 }, 'gst_registration')).toBe(true)
  })

  it('GST registration for goods starts above ₹40 lakh, not at it', () => {
    expect(has({ sells: 'goods', turnover: 4_000_000 }, 'gst_registration')).toBe(false)
    expect(has({ sells: 'goods', turnover: 4_000_001 }, 'gst_registration')).toBe(true)
  })

  it('selling goods to other states needs GST at any turnover, selling services does not', () => {
    expect(has({ sells: 'goods', interstate: true, turnover: 100_000 }, 'gst_registration')).toBe(true)
    expect(has({ sells: 'services', interstate: true, turnover: 100_000 }, 'gst_registration')).toBe(false)
  })

  it('a GST-registered business never gets the registration item', () => {
    expect(has({ gst_registered: true, turnover: 90_000_000 }, 'gst_registration')).toBe(false)
  })

  it('GSTR-9 starts above ₹2 crore', () => {
    expect(has({ gst_registered: true, turnover: 20_000_000 }, 'gstr9')).toBe(false)
    expect(has({ gst_registered: true, turnover: 20_000_001 }, 'gstr9')).toBe(true)
  })

  it('tax audit starts above ₹1 crore and never applies to a private company', () => {
    expect(has({ turnover: 10_000_000 }, 'tax_audit')).toBe(false)
    expect(has({ turnover: 10_000_001 }, 'tax_audit')).toBe(true)
    expect(has({ entity: 'private_limited', turnover: 50_000_000 }, 'tax_audit')).toBe(false)
  })

  it('advance tax starts at ₹10 lakh', () => {
    expect(has({ turnover: 999_999 }, 'advance_tax')).toBe(false)
    expect(has({ turnover: 1_000_000 }, 'advance_tax')).toBe(true)
  })

  it('EPF starts at 20 employees', () => {
    expect(has({ employees: 19 }, 'epf')).toBe(false)
    expect(has({ employees: 20 }, 'epf')).toBe(true)
  })

  it('ESIC starts at 10 employees', () => {
    expect(has({ employees: 9 }, 'esic')).toBe(false)
    expect(has({ employees: 10 }, 'esic')).toBe(true)
  })

  it('TDS starts with the first employee', () => {
    expect(has({ employees: 0 }, 'tds_deposit')).toBe(false)
    expect(has({ employees: 1 }, 'tds_deposit')).toBe(true)
  })

  it('every business files an income tax return, even with no turnover yet', () => {
    for (const entity of ['private_limited', 'llp', 'partnership', 'proprietorship'] as const) {
      expect(has({ entity, turnover: 0 }, 'itr')).toBe(true)
    }
  })
})

describe('the catalogue', () => {
  it('has unique rule ids', () => {
    const all = RULES.map((r) => r.id)
    expect(new Set(all).size).toBe(all.length)
  })

  it.each(RULES.map((r) => [r.id, r] as const))('%s has a reason, authority, penalty, plain text and version', (_id, rule) => {
    expect(rule.reason.trim()).not.toBe('')
    expect(rule.authority.trim()).not.toBe('')
    expect(rule.penalty.text.trim()).not.toBe('')
    expect(rule.plain.trim()).not.toBe('')
    expect(rule.how_to_file.trim()).not.toBe('')
    expect(rule.rule_version).toMatch(/^\d{4}\.\d+$/)
    expect(rule.documents.length).toBeGreaterThan(0)
  })

  it('shows unverified rules as unverified', () => {
    const obligations = evaluateRules(GOLDEN[1].profile)
    for (const o of obligations) {
      const rule = RULES.find((r) => r.id === o.rule_id)!
      expect(o.verified).toBe(Boolean(rule.verified_on))
    }
  })
})

describe('reasons', () => {
  it('quotes the answers that triggered a rule', () => {
    const gst = evaluateRules(GOLDEN[0].profile).find((o) => o.rule_id === 'gst_registration')!
    const text = gst.facts.map((f) => f.value).join(' ')
    expect(text).toContain('not registered for GST')
    expect(text).toContain('₹60,00,000')
    expect(text).toContain('services')
  })

  it('does not repeat the same fact twice', () => {
    for (const o of evaluateRules(GOLDEN[1].profile)) {
      const keys = o.facts.map((f) => `${f.label}:${f.value}`)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('a "not" condition contributes no facts', () => {
    const result = evaluateCondition({ not: { field: 'entity', op: 'eq', value: 'llp' } }, { entity: 'private_limited' })
    expect(result).toEqual({ ok: true, facts: [] })
  })

  it('a missing answer never satisfies a condition', () => {
    expect(evaluateCondition({ field: 'employees', op: 'lt', value: 10 }, {}).ok).toBe(false)
  })
})

describe('missing answers', () => {
  it('lists required fields in interview order', () => {
    expect(missingFields({ state: 'Delhi' })).toEqual(['entity', 'turnover', 'employees', 'sells', 'gst_registered', 'interstate', 'foreign_investment'])
  })

  it('treats false and 0 as answered', () => {
    expect(missingFields(GOLDEN[6].profile)).toEqual([])
  })
})

describe('penalty estimate', () => {
  it('multiplies a daily fee by 30 days and applies the cap', () => {
    expect(penaltyExample({ text: '', per_day: 50, cap: 5000 })).toBe('about ₹1,500 if filed 30 days late')
    expect(penaltyExample({ text: '', per_day: 500, cap: 5000 })).toBe('about ₹5,000 if filed 30 days late')
  })

  it('caps a daily fee at a share of turnover', () => {
    expect(penaltyExample({ text: '', per_day: 200, percent_of_turnover: 0.005 }, 1_000_000)).toBe('about ₹5,000 if filed 30 days late')
  })

  it('adds a fixed fee to a daily fee', () => {
    expect(penaltyExample({ text: '', fixed: 50_000, per_day: 1000 })).toBe('about ₹80,000 if filed 30 days late')
  })

  it('takes the lower of a fixed amount and a share of turnover', () => {
    expect(penaltyExample({ text: '', fixed: 150_000, percent_of_turnover: 0.005 }, 20_000_000)).toBe('about ₹1,00,000 if filed 30 days late')
  })

  it('prefers a hand-written example and returns nothing when there is no formula', () => {
    expect(penaltyExample({ text: '', example: 'At least ₹10,000' })).toBe('At least ₹10,000')
    expect(penaltyExample({ text: 'Fine set by your state' })).toBeUndefined()
  })
})
