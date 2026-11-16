import { describe, expect, it } from 'vitest'

import { compileDeadline, checklistFor, checklistProgress } from '../src/shared/documents'
import { evaluateRules } from '../src/shared/rules'
import { buildCalendar } from '../src/shared/schedule'
import type { Company, Profile } from '../src/shared/types'
import { applyMapping, parseCsv, proposeMapping } from '../src/shared/validation'

// Test data only: a fictional company in the shape a founder's sheet might take.
const SHEET = `Company name,Constitution,State,Turnover,Employees,GST status,Incorporated on,PAN,GSTIN,Director name,DIN
Northwind Labs Private Limited,Private Limited,Telangana,6000000,12,No,2026-04-01,ABCDE1234F,,Ananya Rao,01234567`

describe('CSV import', () => {
  it('maps a typical sheet and imports it cleanly', () => {
    const table = parseCsv(SHEET)
    const result = applyMapping(table, proposeMapping(table.headers))
    expect(result.errors).toEqual([])
    expect(result.missing).toEqual([])
    expect(result.updates).toMatchObject({ name: 'Northwind Labs Private Limited', entity: 'private_limited', state: 'Telangana', turnover: 6_000_000, employees: 12, gst_registered: false, incorporated_on: '2026-04-01' })
  })

  it('stores PAN and GSTIN only masked', () => {
    const table = parseCsv('Company,PAN,GSTIN\nAcme,ABCDE1234F,29ABCDE1234F1Z5')
    const { updates } = applyMapping(table, proposeMapping(table.headers))
    expect(updates.pan_masked).toBe('AB••••34F')
    expect(JSON.stringify(updates)).not.toContain('ABCDE1234F')
  })

  it('copes with a byte-order mark, Windows line endings, blank rows and quoted commas', () => {
    const table = parseCsv('﻿Company name,Turnover\r\n\r\n"Acme, Inc",12345\r\n')
    expect(table.headers).toEqual(['Company name', 'Turnover'])
    expect(table.rows).toEqual([['Acme, Inc', '12345']])
  })

  it('lists bad values with the column instead of dropping them silently', () => {
    const table = parseCsv('Company,Constitution,Employees,PAN,Incorporated on\nAcme,Trust,twelve,BADPAN,next week')
    const result = applyMapping(table, proposeMapping(table.headers))
    expect(result.errors.map((e) => e.column).sort()).toEqual(['Company type', 'Employees', 'Incorporation date', 'PAN'])
    expect(result.updates.entity).toBeUndefined()
    expect(result.updates.employees).toBeUndefined()
  })

  it('reads day/month/year dates', () => {
    const table = parseCsv('Company,Incorporated on\nAcme,1/4/2026')
    expect(applyMapping(table, proposeMapping(table.headers)).updates.incorporated_on).toBe('2026-04-01')
  })
})

describe('documents', () => {
  const PROFILE: Profile = { entity: 'private_limited', state: 'Telangana', turnover: 6_000_000, employees: 12, sells: 'services', gst_registered: true, interstate: false, foreign_investment: false, incorporated_on: '2026-04-01' }
  const COMPANY: Company = { ...PROFILE, name: 'Northwind Labs Private Limited', pan_masked: 'AB••••34F', directors: [{ name: 'Ananya Rao', din: '01234567', email: 'ananya@northwind.example' }] }
  const deadlines = buildCalendar(PROFILE, evaluateRules(PROFILE), '2026-11-16').deadlines
  const agm = deadlines.find((d) => d.rule_id === 'agm' && d.due_date === '2027-09-30')!

  it('marks every generated file as a draft', () => {
    for (const d of deadlines) {
      const { files } = compileDeadline(COMPANY, d, '2026-11-16')
      for (const f of files) expect(f.content).toContain('DRAFT, review before use')
    }
  })

  it('files drafts under the financial year, the law and the due date', () => {
    const { folder, files } = compileDeadline(COMPANY, agm, '2026-11-16')
    expect(folder).toBe('FY2027-28/Companies-Act/AGM-2027-09-30')
    expect(files.every((f) => f.path.startsWith(`${folder}/`))).toBe(true)
    expect(files.map((f) => f.path.split('/').at(-1)).sort()).toEqual(['00_Filing-Cover_DRAFT.html', '01_Board-Resolution_DRAFT.html', '02_Financial-Summary_DRAFT.html', '02_Notice-of-AGM_DRAFT.html', '_checklist.html', '_manifest.json'])
  })

  it('writes a manifest naming the rule version and the files', () => {
    const { files } = compileDeadline(COMPANY, agm, '2026-11-16')
    const manifest = JSON.parse(files.find((f) => f.path.endsWith('_manifest.json'))!.content)
    expect(manifest).toMatchObject({ obligation: 'agm', rule_version: agm.rule_version, due_date: '2027-09-30' })
    // Every file except the manifest itself.
    expect(manifest.files).toHaveLength(files.length - 1)
  })

  it('reports missing fields instead of producing a half-empty document silently', () => {
    expect(compileDeadline({ name: '' }, agm, '2026-11-16').missing).toEqual(['Company name', 'Director or partner details'])
    expect(compileDeadline(COMPANY, agm, '2026-11-16').missing).toEqual([])
  })

  it('marks checklist items Have, Missing or Can be generated', () => {
    const kyc = deadlines.find((d) => d.rule_id === 'dir3_kyc')!
    const items = checklistFor(kyc, COMPANY)
    expect(Object.fromEntries(items.map((i) => [i.key, i.state]))).toEqual({ pan_card: 'have', aadhaar: 'missing', contact_proof: 'have', director_details: 'have' })
    expect(checklistProgress(items)).toEqual({ ready: 3, total: 4 })
    expect(checklistProgress(checklistFor(kyc, COMPANY, ['aadhaar']))).toEqual({ ready: 4, total: 4 })
  })
})
