import { DOC_LABELS, GENERATABLE, GROUP_LABELS } from './catalogue'
import { financialYear, formatDate, formatRupees } from './format'
import { factValue, type Investor, type Knowledge } from './knowledge'
import type { ChecklistItem, Company, Deadline, DocKey, GeneratedFile, ObligationGroup } from './types'

/** Which documents the company record already holds. */
function heldBy(company: Company, key: DocKey): boolean {
  switch (key) {
    case 'pan_card':
      return Boolean(company.pan_masked)
    case 'contact_proof':
      return Boolean(company.directors?.some((d) => d.email))
    case 'director_details':
      return Boolean(company.directors?.length)
    default:
      return false
  }
}

/** Have, Missing or Can be generated for one deadline. Ticked items count as Have. */
export function checklistFor(deadline: Deadline, company: Company, ticked: DocKey[] = []): ChecklistItem[] {
  return deadline.documents.map((key) => {
    if (ticked.includes(key)) return { key, label: DOC_LABELS[key], state: 'have', note: 'Marked as ready by you' }
    if (heldBy(company, key)) return { key, label: DOC_LABELS[key], state: 'have', note: 'In your company record' }
    if (GENERATABLE.includes(key)) return { key, label: DOC_LABELS[key], state: 'generate', note: 'The compiler drafts this' }
    return { key, label: DOC_LABELS[key], state: 'missing', note: 'You need to upload or type this' }
  })
}

export function checklistProgress(items: ChecklistItem[]) {
  const ready = items.filter((i) => i.state === 'have' || i.state === 'generate').length
  return { ready, total: items.length }
}

const FOLDER: Record<ObligationGroup, string> = {
  gst: 'GST',
  company_law: 'Companies-Act',
  income_tax: 'Income-Tax',
  payroll: 'Payroll',
  fema: 'FEMA',
  labour: 'Labour',
}

export function folderFor(deadline: Deadline): string {
  const fy = financialYear(deadline.due_date ?? new Date().toISOString().slice(0, 10))
  const dir = `${deadline.short.replace(/[^A-Za-z0-9]+/g, '-')}-${deadline.due_date ?? 'event'}`
  return `${fy}/${FOLDER[deadline.group]}/${dir}`
}

const DRAFT = 'DRAFT, review before use'

function header(title: string, company: Company, deadline: Deadline) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} — ${company.name}</title>
<style>body{font-family:Georgia,serif;max-width:46rem;margin:3rem auto;padding:0 1.5rem;color:#111;line-height:1.6}
.draft{border:1px solid #c0262d;color:#c0262d;padding:.5rem .75rem;font:600 12px/1.4 system-ui;letter-spacing:.08em;text-transform:uppercase}
h1{font-size:1.6rem;margin:1.5rem 0 .25rem}table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{border:1px solid #ccc;padding:.5rem;text-align:left;font-size:.95rem}footer{margin-top:3rem;font-size:.8rem;color:#555}</style></head>
<body><p class="draft">${DRAFT}</p>
<h1>${title}</h1>
<p><strong>${company.name}</strong>${company.cin ? ` · CIN ${company.cin}` : ''}</p>
<p>${deadline.name} · ${deadline.authority} · due ${deadline.due_date ? formatDate(deadline.due_date) : deadline.event_label ?? 'on event'}</p>`
}

function footer(deadline: Deadline) {
  return `<footer>Guidance, not legal advice. Generated from the company record on ${formatDate(new Date().toISOString().slice(0, 10))} using rule version ${deadline.rule_version}. Verify with a CA before filing.</footer></body></html>`
}

function directorRows(company: Company) {
  if (!company.directors?.length) {
    return '<tr><td>—</td><td>—</td><td>—</td><td>—</td></tr>'
  }
  return company.directors
    .map((d) => `<tr><td>${d.name}</td><td>${d.din}</td><td>${d.email ?? '—'}</td><td>${d.mobile ?? '—'}</td></tr>`)
    .join('')
}

/** The cover sheet every compiled folder carries, built only from known facts. */
function coverFile(company: Company, deadline: Deadline, today: string, kb?: Knowledge): GeneratedFile {
  const paidUp = kb ? factValue<number>(kb, 'paid_up_capital') : undefined
  const authorised = kb ? factValue<number>(kb, 'authorised_capital') : undefined
  const rows: [string, string | undefined][] = [
    ['Legal name', company.name || undefined],
    ['CIN / LLPIN', company.cin],
    ['PAN', company.pan_masked],
    ['GSTIN', company.gstin_masked],
    ['State', company.state],
    ['Incorporated', company.incorporated_on ? formatDate(company.incorporated_on) : undefined],
    ['Authorised capital', authorised ? formatRupees(authorised) : undefined],
    ['Paid-up capital', paidUp ? formatRupees(paidUp) : undefined],
  ]
  return {
    path: `${folderFor(deadline)}/00_Filing-Cover_DRAFT.html`,
    name: `Filing cover — ${deadline.short}`,
    media: 'text/html',
    content: `${header('Filing cover sheet', company, deadline)}
<table><tbody>${rows.filter(([, v]) => v).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
<h2 style="font-size:1.05rem;margin-top:1.5rem">Why this filing applies</h2>
<p>${deadline.reason}</p><ul>${deadline.facts.map((f) => `<li>${f.value}</li>`).join('')}</ul>
<h2 style="font-size:1.05rem;margin-top:1.5rem">If it is missed</h2><p>${deadline.penalty}</p>
<h2 style="font-size:1.05rem;margin-top:1.5rem">How to file</h2><p>${deadline.how_to_file}</p>
<p style="font-size:.85rem;color:#555">Compiled ${formatDate(today)} · rule ${deadline.rule_version} · ${deadline.verified ? 'reviewed' : 'not yet verified'}</p>${footer(deadline)}`,
  }
}

/** A one-page money summary, for filings that need accounts with them. */
function financialSummary(company: Company, deadline: Deadline, kb?: Knowledge): GeneratedFile {
  const capital = kb ? factValue<number>(kb, 'paid_up_capital') : undefined
  return {
    path: `${folderFor(deadline)}/02_Financial-Summary_DRAFT.html`,
    name: 'Financial summary cover',
    media: 'text/html',
    content: `${header('Financial summary', company, deadline)}
<p>This sheet is a cover for the signed financial statements, not a replacement for them. The figures below are what the company record holds.</p>
<table><tbody>
<tr><th>Turnover</th><td>${company.turnover !== undefined ? formatRupees(company.turnover) : 'Not on record'}</td></tr>
<tr><th>Paid-up capital</th><td>${capital !== undefined ? formatRupees(capital) : 'Not on record'}</td></tr>
<tr><th>Employees on payroll</th><td>${company.employees ?? 'Not on record'}</td></tr>
<tr><th>GST status</th><td>${company.gst_registered ? 'Registered' : 'Not registered'}</td></tr>
</tbody></table>
<p>Attach the audited statements and the auditor’s report before filing.</p>${footer(deadline)}`,
  }
}

/** FC-GPR needs the allotment details; draft them from the investor facts. */
function allotmentFile(company: Company, deadline: Deadline, today: string, kb?: Knowledge): GeneratedFile {
  const investors = (kb ? factValue<Investor[]>(kb, 'investors') : undefined) ?? []
  const rows = investors.map((i) => `${i.name},${i.country},${i.amount ?? ''},${i.allotted_on ?? ''}`).join('\n')
  return {
    path: `${folderFor(deadline)}/01_Share-Allotment_DRAFT.csv`,
    name: 'Share allotment data (FC-GPR)',
    media: 'text/csv',
    content: `# ${DRAFT} — ${company.name} — generated ${today} — rule ${deadline.rule_version}\ninvestor,country,amount_inr,allotted_on\n${rows || '# add investor name, country, amount and allotment date\n'}`,
  }
}

function template(key: DocKey, company: Company, deadline: Deadline, today: string): GeneratedFile | null {
  const base = folderFor(deadline)
  const dirs = financialYear(deadline.due_date ?? today)

  switch (key) {
    case 'board_resolution':
      return {
        path: `${base}/01_Board-Resolution_DRAFT.html`,
        name: `Board resolution — ${company.name}`,
        media: 'text/html',
        content: `${header('Board resolution', company, deadline)}
<p>Resolved that the financial statements of the company for the year ended 31 March be and are hereby approved, and that the notice of the annual general meeting be issued to all members.</p>
<table><thead><tr><th>Director</th><th>DIN</th><th>Email</th><th>Mobile</th></tr></thead><tbody>${directorRows(company)}</tbody></table>
<p>Place: ${company.state ?? '—'} · Date: ${formatDate(today)}</p>${footer(deadline)}`,
      }
    case 'agm_notice':
      return {
        path: `${base}/02_Notice-of-AGM_DRAFT.html`,
        name: `Notice of AGM — ${company.name}`,
        media: 'text/html',
        content: `${header('Notice of annual general meeting', company, deadline)}
<p>Notice is hereby given that the annual general meeting of the members of ${company.name} will be held on 30 September at the registered office to transact the ordinary business of adopting the accounts and appointing the auditor.</p>
<p>Registered office: ${company.state ?? '—'}</p>${footer(deadline)}`,
      }
    case 'employee_master':
      return {
        path: `${base}/01_Employee-master_DRAFT.csv`,
        name: 'Employee master list',
        media: 'text/csv',
        content: `# ${DRAFT} — ${company.name} — generated ${today} — rule ${deadline.rule_version}\nname,designation,gross_monthly_salary,uan,esic_number,date_of_joining\n${(company.directors ?? []).map((d) => `${d.name},Director,,,,\n`).join('')}`,
      }
    case 'gst_sales_summary':
      return {
        path: `${base}/01_GST-data-sheet_DRAFT.csv`,
        name: 'GST filing data sheet',
        media: 'text/csv',
        content: `# ${DRAFT} — ${company.name} — generated ${today} — rule ${deadline.rule_version}\ninvoice_no,invoice_date,customer,gstin,place_of_supply,taxable_value,cgst,sgst,igst\n`,
      }
    case 'director_details':
      return {
        path: `${base}/01_Director-KYC-Sheet_DRAFT.csv`,
        name: 'Director KYC details sheet',
        media: 'text/csv',
        content: `# ${DRAFT} — ${company.name} — generated ${today} — rule ${deadline.rule_version}\nname,din,email,mobile\n${(company.directors ?? []).map((d) => `${d.name},${d.din},${d.email ?? ''},${d.mobile ?? ''}\n`).join('')}`,
      }
    case 'authority_letter':
      return {
        path: `${base}/01_Authority-Letter_DRAFT.html`,
        name: 'Authority letter to your CA',
        media: 'text/html',
        content: `${header('Authority letter', company, deadline)}
<p>We authorise our chartered accountant to prepare and file ${deadline.name} for ${company.name} with ${deadline.authority}, and to represent the company in correspondence about it.</p>
<p>For ${company.name}, ${company.state ?? ''} · ${dirs}</p>${footer(deadline)}`,
      }
    default:
      return null
  }
}

/**
 * Compile the documents a deadline can generate, plus its checklist and a
 * manifest, and report the fields the templates need but the record lacks.
 */
export function compileDeadline(
  company: Company,
  deadline: Deadline,
  today: string,
  ticked: DocKey[] = [],
  knowledge?: Knowledge,
): { files: GeneratedFile[]; missing: string[]; folder: string } {
  const missing: string[] = []
  if (!company.name) missing.push('Company name')
  if (!company.directors?.length) missing.push('Director or partner details')

  const files: GeneratedFile[] = [coverFile(company, deadline, today, knowledge)]
  if (deadline.documents.includes('financial_statements')) files.push(financialSummary(company, deadline, knowledge))
  if (deadline.documents.includes('share_allotment_details')) files.push(allotmentFile(company, deadline, today, knowledge))

  for (const key of deadline.documents) {
    if (!GENERATABLE.includes(key)) continue
    const file = template(key, company, deadline, today)
    if (file) files.push(file)
  }

  const checklist = checklistFor(deadline, company, ticked)
  files.push({
    path: `${folderFor(deadline)}/_checklist.html`,
    name: 'Document checklist',
    media: 'text/html',
    content: `${header('Document checklist', company, deadline)}
<ul>${checklist.map((c) => `<li><strong>${c.label}</strong> — ${c.state === 'have' ? 'Have' : c.state === 'generate' ? 'Can be generated' : 'Missing'}</li>`).join('')}</ul>
${footer(deadline)}`,
  })
  files.push({
    path: `${folderFor(deadline)}/_manifest.json`,
    name: 'Manifest',
    media: 'application/json',
    content: JSON.stringify(
      {
        company: company.name,
        obligation: deadline.rule_id,
        rule_version: deadline.rule_version,
        due_date: deadline.due_date,
        generated_at: today,
        generated_by: 'Startup Compliance Tracker',
        warning: DRAFT,
        files: files.map((f) => f.path),
      },
      null,
      2,
    ),
  })

  return { files, missing: [...new Set(missing)], folder: folderFor(deadline) }
}

/** Group generated files into the folder tree the page shows. */
export function groupFiles(files: GeneratedFile[]): { dir: string; files: GeneratedFile[] }[] {
  const map = new Map<string, GeneratedFile[]>()
  for (const file of files) {
    const dir = file.path.split('/').slice(0, -1).join('/')
    const list = map.get(dir) ?? []
    list.push(file)
    map.set(dir, list)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dir, list]) => ({ dir, files: list }))
}

/** A calendar file with an alarm 30 days before each deadline, for Google Calendar or Outlook. */
export function toIcs(deadlines: Deadline[], companyName: string): string {
  const stamp = (iso: string) => `${iso.replace(/-/g, '')}T090000Z`
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Startup Compliance Tracker//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${companyName} compliance`]
  for (const d of deadlines) {
    if (!d.due_date || d.status === 'done') continue
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.id}@startup-compliance-tracker`,
      `DTSTAMP:${stamp(new Date().toISOString().slice(0, 10))}`,
      `DTSTART;VALUE=DATE:${d.due_date.replace(/-/g, '')}`,
      `SUMMARY:${d.name} — ${d.authority}`,
      `DESCRIPTION:${d.penalty.replace(/\n/g, ' ')} (Rule ${d.rule_version}. Guidance, not legal advice.)`,
      'BEGIN:VALARM',
      'TRIGGER:-P30D',
      'ACTION:DISPLAY',
      `DESCRIPTION:${d.name} due in 30 days`,
      'END:VALARM',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function totalPenaltyText(deadline: Deadline): string {
  return deadline.penalty_example ? `${deadline.penalty} (${deadline.penalty_example})` : deadline.penalty
}

export const GROUP_FOLDER = FOLDER
export const GROUP_TITLES = GROUP_LABELS
export const formatMoney = formatRupees
