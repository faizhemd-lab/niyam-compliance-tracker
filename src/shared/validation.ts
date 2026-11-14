import { CITY_TO_STATE, INDIAN_STATES } from './catalogue'
import type { Company, Profile } from './types'

/** CSV parsing, column mapping and validation for the company database plug-in. */

export type CsvTable = { headers: string[]; rows: string[][] }

export function parseCsv(text: string): CsvTable {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = clean.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
  if (!lines.length) return { headers: [], rows: [] }
  const split = (line: string) => {
    const out: string[] = []
    let cell = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = !quoted
      } else if (ch === ',' && !quoted) {
        out.push(cell.trim())
        cell = ''
      } else cell += ch
    }
    out.push(cell.trim())
    return out
  }
  const [headerLine, ...rest] = lines
  return { headers: split(headerLine), rows: rest.map(split) }
}

export const IMPORT_FIELDS = [
  { key: 'name', label: 'Company name' },
  { key: 'entity', label: 'Company type' },
  { key: 'state', label: 'State' },
  { key: 'turnover', label: 'Turnover (₹)' },
  { key: 'employees', label: 'Employees' },
  { key: 'gst_registered', label: 'GST registered' },
  { key: 'incorporated_on', label: 'Incorporation date' },
  { key: 'pan', label: 'PAN' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'director_name', label: 'Director name' },
  { key: 'director_din', label: 'Director DIN' },
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]['key']
export type Mapping = Record<number, ImportField | ''>

const HINTS: Record<ImportField, RegExp> = {
  name: /company|legal.?name|business.?name|entity.?name|^name$/i,
  entity: /type|constitution|entity|structure|form/i,
  state: /state|province/i,
  turnover: /turnover|revenue|sales|annual.?income|top.?line/i,
  employees: /employee|head.?count|staff|people|team/i,
  gst_registered: /gst.?status|registered|gst.?(yes|no)?$/i,
  incorporated_on: /incorporat|incorporation|start.?(date)?|registered.?on/i,
  pan: /\bpan\b|pan.?number/i,
  gstin: /gstin|gst.?number|gst.?no/i,
  director_name: /director|promoter|partner.?name/i,
  director_din: /\bdin\b|director.?id/i,
}

/** Suggest a mapping from the header row; the founder can correct it. */
export function proposeMapping(headers: string[]): Mapping {
  const mapping: Mapping = {}
  const used = new Set<ImportField>()
  headers.forEach((header, index) => {
    const field = IMPORT_FIELDS.map((f) => f.key).find((key) => !used.has(key) && HINTS[key].test(header))
    if (field) {
      mapping[index] = field
      used.add(field)
    } else mapping[index] = ''
  })
  return mapping
}

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/

const ENTITY: Record<string, Profile['entity']> = {
  'private limited': 'private_limited',
  pvt: 'private_limited',
  'pvt ltd': 'private_limited',
  'private ltd': 'private_limited',
  llp: 'llp',
  'limited liability partnership': 'llp',
  partnership: 'partnership',
  firm: 'partnership',
  proprietorship: 'proprietorship',
  'sole proprietor': 'proprietorship',
  proprietor: 'proprietorship',
}

const mask = (value: string) => `${value.slice(0, 2)}••••${value.slice(-3)}`

export type ImportResult = {
  updates: Partial<Company>
  applied: number
  skipped: number
  errors: { row: number; column: string; message: string }[]
  missing: string[]
}

/** Validate every value; bad rows are listed, never silently dropped. */
export function applyMapping(table: CsvTable, mapping: Mapping): ImportResult {
  const updates: Partial<Company> = {}
  const errors: ImportResult['errors'] = []
  let applied = 0
  let skipped = 0
  const byField = new Map<ImportField, number[]>()
  for (const [index, field] of Object.entries(mapping)) {
    if (!field) continue
    byField.set(field, [...(byField.get(field) ?? []), Number(index)])
  }

  const first = (field: ImportField) => {
    const index = byField.get(field)?.[0]
    if (index === undefined) return ''
    return table.rows[0]?.[index]?.trim() ?? ''
  }

  const pan = first('pan').toUpperCase()
  if (pan) {
    if (PAN.test(pan)) updates.pan_masked = mask(pan)
    else errors.push({ row: 1, column: 'PAN', message: `“${pan}” is not a valid PAN.` })
  }
  const gstin = first('gstin').toUpperCase()
  if (gstin) {
    if (GSTIN.test(gstin)) updates.gstin_masked = mask(gstin)
    else errors.push({ row: 1, column: 'GSTIN', message: `“${gstin}” is not a valid GSTIN.` })
  }

  const name = first('name')
  if (name) updates.name = name
  const entityRaw = first('entity').toLowerCase().replace(/[.\s]+/g, ' ').trim()
  if (entityRaw) {
    const entity = ENTITY[entityRaw] ?? ENTITY[entityRaw.replace(/\s/g, '')]
    if (entity) updates.entity = entity
    else errors.push({ row: 1, column: 'Company type', message: `“${first('entity')}” is not a type we recognise.` })
  }
  const stateRaw = first('state')
  if (stateRaw) {
    const state = INDIAN_STATES.find((s) => s.toLowerCase() === stateRaw.toLowerCase()) ?? CITY_TO_STATE[stateRaw.toLowerCase()]
    if (state) updates.state = state
    else errors.push({ row: 1, column: 'State', message: `“${stateRaw}” is not a state we cover.` })
  }
  const turnoverRaw = first('turnover').replace(/[₹,\s]/g, '')
  if (turnoverRaw) {
    const value = Number(turnoverRaw)
    if (Number.isFinite(value) && value >= 0) updates.turnover = value
    else errors.push({ row: 1, column: 'Turnover', message: `“${first('turnover')}” is not a number.` })
  }
  const employeesRaw = first('employees').replace(/,/g, '')
  if (employeesRaw) {
    const value = Number(employeesRaw)
    if (Number.isInteger(value) && value >= 0) updates.employees = value
    else errors.push({ row: 1, column: 'Employees', message: `“${first('employees')}” is not a whole number.` })
  }
  const gstRaw = first('gst_registered').toLowerCase()
  if (gstRaw) {
    if (/^(yes|y|true|1|registered)/.test(gstRaw)) updates.gst_registered = true
    else if (/^(no|n|false|0|unregistered|not)/.test(gstRaw)) updates.gst_registered = false
    else errors.push({ row: 1, column: 'GST registered', message: `“${first('gst_registered')}” is not yes or no.` })
  }
  const date = first('incorporated_on')
  if (date) {
    const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    const dmy = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    if (iso) updates.incorporated_on = date
    else if (dmy) updates.incorporated_on = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
    else errors.push({ row: 1, column: 'Incorporation date', message: `“${date}” is not a date we can read.` })
  }

  const directorName = first('director_name')
  const din = first('director_din')
  if (directorName || din) {
    updates.directors = [{ name: directorName || 'Director', din: din || '—' }]
  }

  applied = table.rows.filter((row) => row.some((cell) => cell.trim())).length
  skipped = errors.length
  const missing = (['name', 'entity', 'state', 'turnover', 'employees', 'gst_registered'] as const).filter((f) => {
    if (f === 'name') return !updates.name
    return updates[f] === undefined
  })

  return { updates, applied, skipped, errors, missing: [...missing] }
}

/** The sample sheet offered on the import page, so the flow can be tried at once. */
export const SAMPLE_CSV = `Company name,Constitution,State,Turnover,Employees,GST status,Incorporated on,PAN,GSTIN,Director name,DIN
Northwind Labs Private Limited,Private Limited,Telangana,6000000,12,No,2026-04-01,ABCDE1234F,,Ananya Rao,01234567
Cedar & Co,LLP,Karnataka,2500000,25,Yes,2024-11-12,PQRST5678G,29PQRST5678G1Z5,Ravi Kumar,07654321`
