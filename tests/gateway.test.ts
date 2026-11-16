import { describe, expect, it } from 'vitest'

import { classify, explain, extract, maskIdentifiers, parseAmount, parseDateText, type ExplainRecord } from '../src/shared/gateway'
import { nextSlot, takeTurn } from '../src/shared/interview'
import type { Profile } from '../src/shared/types'

describe('masking', () => {
  it('hides PAN, GSTIN, email and phone before anything reads the text', () => {
    const masked = maskIdentifiers('PAN ABCDE1234F, GSTIN 29PQRST5678G1Z5, mail me at ravi@example.com or +91 9876543210')
    expect(masked).toBe('PAN [PAN], GSTIN [GSTIN], mail me at [EMAIL] or [PHONE]')
  })
})

describe('amounts', () => {
  it.each([
    ['around 60 lakh', 6_000_000],
    ['around 50L', 5_000_000],
    ['1.5 crore', 15_000_000],
    ['2 cr', 20_000_000],
    ['Rs 25,00,000', 2_500_000],
    ['₹ 8500', 8500],
    ['3 million', 3_000_000],
  ])('reads "%s" as %i', (text, value) => {
    expect(parseAmount(text)).toBe(value)
  })

  it.each(['two crore ish', 'we started in 2024', 'not sure'])('does not guess an amount from "%s"', (text) => {
    expect(parseAmount(text)).toBeNull()
  })
})

describe('dates', () => {
  it.each([
    ['2026-4-1', '2026-04-01'],
    ['01/04/2026', '2026-04-01'],
    ['12 march 2025', '2025-03-12'],
    ['june 2024', '2024-06-01'],
  ])('reads "%s" as %s', (text, iso) => {
    expect(parseDateText(text)).toBe(iso)
  })
})

/**
 * A small extraction set from the handbook's examples. The rule that matters:
 * a value is either right or absent. A wrong value slipping through is a bug.
 */
describe('extraction', () => {
  it('reads the handbook example in one message', () => {
    const { updates, rejected } = extract('We’re a pvt ltd in Hyderabad, doing about 60 lakh a year, 12 people, services mostly.', null)
    expect(rejected).toEqual([])
    expect(updates).toEqual({ entity: 'private_limited', state: 'Telangana', turnover: 6_000_000, employees: 12, sells: 'services' })
  })

  it.each([
    ['just me and a part-timer', 'employees', { employees: 2 }],
    ['just me', 'employees', { employees: 1 }],
    ['no employees yet', 'employees', { employees: 0 }],
    ['LLP', 'entity', { entity: 'llp' }],
    ['sole proprietor', 'entity', { entity: 'proprietorship' }],
    ['we sell physical products', 'sells', { sells: 'goods' }],
    ['both', 'sells', { sells: 'both' }],
    ['we ship pan-india', 'interstate', { interstate: true }],
    ['not registered for gst', 'gst_registered', { gst_registered: false }],
    ['yes', 'gst_registered', { gst_registered: true }],
    ['no', 'foreign_investment', { foreign_investment: false }],
    ['we are in Bengaluru', 'state', { state: 'Karnataka' }],
  ] as const)('"%s" (asked %s) gives exactly %o', (message, awaiting, expected) => {
    expect(extract(message, awaiting).updates).toEqual(expected)
  })

  it('a bare yes only answers the question being asked', () => {
    expect(extract('yes', 'interstate').updates).toEqual({ interstate: true })
    expect(extract('yes', 'employees').updates).toEqual({})
  })

  it('does not read a headcount from an amount', () => {
    expect(extract('about 60 lakh', 'turnover').updates).toEqual({ turnover: 6_000_000 })
  })

  it('rejects an incorporation date in the future instead of saving it', () => {
    const { updates, rejected } = extract('incorporated on 2099-01-01', 'incorporated_on')
    expect(updates.incorporated_on).toBeUndefined()
    expect(rejected.map((r) => r.field)).toEqual(['incorporated_on'])
  })

  it('never sees the raw identifier', () => {
    const { updates } = extract('our PAN is ABCDE1234F', null)
    expect(JSON.stringify(updates)).not.toContain('ABCDE1234F')
  })
})

describe('the interview loop', () => {
  it('asks the required questions in a fixed order, then the incorporation date', () => {
    let profile: Profile = {}
    const asked: string[] = []
    const answers: Record<string, string> = {
      entity: 'Private Limited',
      state: 'Telangana',
      turnover: 'About 60 lakh',
      employees: '12 people',
      sells: 'Services',
      gst_registered: 'No',
      interstate: 'No',
      foreign_investment: 'No',
      incorporated_on: '2026-04-01',
    }
    for (let slot = nextSlot(profile); slot; slot = nextSlot(profile)) {
      asked.push(slot.field)
      profile = takeTurn(profile, answers[slot.field], slot).profile
      if (asked.length > 20) throw new Error('interview did not finish')
    }
    expect(asked).toEqual(['entity', 'state', 'turnover', 'employees', 'sells', 'gst_registered', 'interstate', 'foreign_investment', 'incorporated_on'])
  })

  it('asks again instead of guessing when it cannot read an answer', () => {
    const slot = nextSlot({})!
    const turn = takeTurn({}, 'hmm', slot)
    expect(turn.accepted).toEqual([])
    expect(turn.reply).toContain('I did not catch that')
    expect(turn.profile).toEqual({})
  })

  it('accepts a correction at any point', () => {
    const turn = takeTurn({ entity: 'private_limited', employees: 12 }, 'actually we have 25 employees')
    expect(turn.profile.employees).toBe(25)
  })
})

describe('explanations', () => {
  const record: ExplainRecord = {
    name: 'DIR-3 KYC (director KYC)',
    authority: 'Ministry of Corporate Affairs (MCA)',
    plain: 'Once a year, each director confirms their identity details with the government.',
    reason: 'Every director or partner holding a DIN confirms their details each year.',
    penalty: '₹5,000 late fee and the DIN is deactivated',
    how_to_file: 'File DIR-3 KYC on the MCA portal.',
    due: '30 Sep 2027',
    rule_version: '2026.1',
  }

  it('uses only numbers that appear in the record', () => {
    const result = explain(record, 'en')
    expect(result.faithful).toBe(true)
    expect(result.fallback).toBe(false)
    for (const n of result.text.match(/\d[\d,]*/g) ?? []) expect(JSON.stringify(record)).toContain(n.replace(/,$/, ''))
  })

  it('falls back to the stored plain text when asked about a penalty the record lacks', () => {
    expect(explain({ ...record, penalty: '' }, 'en', 'what is the late fee?')).toEqual({ text: record.plain, faithful: true, fallback: true })
  })
})

describe('intents', () => {
  it.each([
    ['I already filed it', 'mark_done'],
    ['what is due this month?', 'show_calendar'],
    ['can my accountant see this?', 'share_with_ca'],
    ['actually we have 30 staff', 'update_profile'],
    ['explain this in simple words', 'explain_item'],
    ['write me a poem', 'out_of_scope'],
  ] as const)('"%s" is %s', (message, intent) => {
    expect(classify(message)).toBe(intent)
  })
})
