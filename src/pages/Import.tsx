import { ArrowRight, FileSpreadsheet, Upload, Wand2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { useDocumentTitle } from '../lib/storage'
import { useTracker } from '../lib/tracker'
import { postJson } from '../lib/api'
import { knowledgeFromCompany } from '../shared/knowledge'
import { IMPORT_FIELDS, SAMPLE_CSV, applyMapping, parseCsv, proposeMapping, type ImportResult, type Mapping } from '../shared/validation'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Footer } from '../components/Footer'
import { FormMessage } from '../components/Field'
import { useToast } from '../components/Overlay'

type Preview = { headers: string[]; rows: string[][]; mapping: Mapping; preview: ImportResult }

export function ImportPage() {
  useDocumentTitle('Import your company data')
  const { setKnowledge, knowledge, log, company } = useTracker()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState('')
  const [mapping, setMapping] = useState<Mapping>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const analyse = async (text: string) => {
    setError('')
    setResult(null)
    setBusy(true)
    const table = parseCsv(text)
    if (!table.headers.length) {
      setError('That file has no header row. The first row must name the columns.')
      setBusy(false)
      return
    }
    const local: Preview = { headers: table.headers, rows: table.rows.slice(0, 20), mapping: proposeMapping(table.headers), preview: applyMapping(table, proposeMapping(table.headers)) }
    const res = await postJson<Preview>('/api/company/import', { csv: text })
    const next = res.ok ? res.data : local
    setPreview(next)
    setMapping(next.mapping)
    setBusy(false)
  }

  const confirm = async () => {
    setBusy(true)
    const table = parseCsv(csv)
    const local = applyMapping(table, mapping)
    const res = await postJson<ImportResult>('/api/company/import/confirm', { csv, mapping })
    const applied = res.ok ? res.data : local
    setResult(applied)
    if (Object.keys(applied.updates).length) {
      const imported = knowledgeFromCompany({ ...company, ...applied.updates }, 'import')
      setKnowledge({ facts: { ...knowledge.facts, ...imported.facts } }, `Imported ${Object.keys(applied.updates).join(', ')} from a sheet`)
      log('Imported company data', `${Object.keys(applied.updates).join(', ')}`)
      toast('Imported. The agent knows these facts now — ask it to draft the next filing.')
    }
    setBusy(false)
  }

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="Company database plug-in"
        title="Stop retyping your own data"
        intro="Upload a CSV exported from your spreadsheet or accounting tool. The tracker detects the headers, proposes a mapping, validates every value, and hands the result to the agent as known facts."
        actions={<Badge tone="outline">CSV and spreadsheet exports</Badge>}
      />

      <div className="mt-2 grid gap-2 lg:grid-cols-[1.2fr_1fr]">
        <Card as="section" className="px-5 py-6 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[16px] font-medium tracking-[-0.02em]">1. Add your sheet</h2>
            <Button variant="ghost" size="sm" icon={<Wand2 className="size-4" />} onClick={() => { setCsv(SAMPLE_CSV); void analyse(SAMPLE_CSV) }}>
              Use the sample
            </Button>
          </div>
          <p className="mt-1 text-[13px] text-muted">Paste CSV, or upload a file. In Excel or Google Sheets use File → Download → CSV.</p>

          <label htmlFor="csv" className="sr-only">
            CSV data
          </label>
          <textarea
            id="csv"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={7}
            placeholder="Company name,Constitution,State,Turnover,Employees,GST status,Incorporated on…"
            className="mt-3 w-full resize-y rounded-[var(--radius-control)] border border-line-strong bg-card px-3.5 py-3 font-mono text-[12.5px] leading-relaxed focus:border-violet focus:shadow-[var(--shadow-focus)] focus:outline-none"
          />

          <div className="mt-2 flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const text = await file.text()
                setCsv(text)
                void analyse(text)
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} icon={<Upload className="size-4" />}>
              Upload a CSV
            </Button>
            <Button variant="violet" size="sm" onClick={() => void analyse(csv)} loading={busy} disabled={!csv.trim()} icon={<FileSpreadsheet className="size-4" />}>
              Read the headers
            </Button>
          </div>
          {error && (
            <div className="mt-3">
              <FormMessage tone="error">{error}</FormMessage>
            </div>
          )}

          {preview && (
            <div className="mt-6 border-t border-line pt-5">
              <h2 className="text-[16px] font-medium tracking-[-0.02em]">2. Check the mapping</h2>
              <p className="mt-1 text-[13px] text-muted">Detected from your header row. Change anything that looks wrong; the mapping is saved for next time.</p>
              <div className="mt-3 grid gap-2">
                {preview.headers.map((header, index) => (
                  <div key={`${header}-${index}`} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
                    <span className="truncate rounded-[var(--radius-xs)] bg-soft px-3 py-2 font-mono text-[12px]">{header}</span>
                    <ArrowRight className="hidden size-4 text-faint sm:block" aria-hidden />
                    <select
                      aria-label={`Map ${header}`}
                      value={mapping[index] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [index]: e.target.value as Mapping[number] })}
                      className="h-10 w-full rounded-[var(--radius-xs)] border border-line-strong bg-card px-3 text-[13px] focus:border-violet focus:outline-none"
                    >
                      <option value="">Do not import</option>
                      {IMPORT_FIELDS.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr>
                      {preview.headers.slice(0, 5).map((h) => (
                        <th key={h} className="border-b border-line px-2 py-1.5 text-left font-medium text-muted">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 3).map((row, i) => (
                      <tr key={i}>
                        {row.slice(0, 5).map((cell, j) => (
                          <td key={j} className="border-b border-line px-2 py-1.5">
                            {cell || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="violet" className="mt-4" onClick={() => void confirm()} loading={busy} iconRight={<ArrowRight className="size-4" />}>
                Import these rows
              </Button>
            </div>
          )}
        </Card>

        <div className="grid content-start gap-2">
          {result && (
            <Card as="section" className={result.errors.length ? 'px-5 py-5' : 'px-5 py-5'}>
              <div className="flex items-center justify-between">
                <h2 className="text-[15px] font-medium">3. Import result</h2>
                <Badge tone={result.errors.length ? 'outline' : 'success'}>{result.errors.length ? 'Check these' : 'Clean'}</Badge>
              </div>
              <dl className="mt-3 divide-y divide-line text-[13px]">
                <div className="flex justify-between py-2">
                  <dt className="text-muted">Rows read</dt>
                  <dd className="font-medium tabular-nums">{result.applied}</dd>
                </div>
                <div className="flex justify-between py-2">
                  <dt className="text-muted">Fields filled</dt>
                  <dd className="font-medium tabular-nums">{Object.keys(result.updates).length}</dd>
                </div>
                <div className="flex justify-between py-2">
                  <dt className="text-muted">Values rejected</dt>
                  <dd className="font-medium tabular-nums">{result.errors.length}</dd>
                </div>
              </dl>
              {result.errors.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {result.errors.map((e) => (
                    <li key={`${e.column}-${e.message}`} className="text-[12.5px] text-danger">
                      Row {e.row}, {e.column}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {result.missing.length > 0 && (
                <p className="mt-3 rounded-[var(--radius-control)] bg-soft px-3 py-2 text-[12.5px] text-muted">
                  Still missing: {result.missing.join(', ')}. The agent will ask for {result.missing.length === 1 ? 'it' : 'them'}.
                </p>
              )}
              <ButtonLink to="/obligations" variant="outline" size="sm" className="mt-4">
                See the rebuilt calendar
              </ButtonLink>
            </Card>
          )}

          <Card as="section" tone="soft" className="px-5 py-6">
            <h2 className="text-[15px] font-medium">What gets imported</h2>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-muted">
              <li>Legal name, company type, state and incorporation date</li>
              <li>Turnover and headcount, the two figures most rules look at</li>
              <li>GST status, PAN and GSTIN — stored masked</li>
              <li>Director or partner name and DIN for KYC and resolutions</li>
            </ul>
            <p className="mt-3 border-t border-line pt-3 text-[12px] text-muted">
              Imported data is never trusted blindly: PAN and GSTIN are pattern-checked, dates and numbers parsed, and bad rows listed rather than dropped silently.
            </p>
          </Card>

          <Card as="section" className="px-5 py-6">
            <h2 className="text-[15px] font-medium">Already on file</h2>
            <p className="mt-1 text-[13px] text-muted">
              {company.name ? `${company.name}${company.pan_masked ? ` · PAN ${company.pan_masked}` : ''}` : 'No company record yet.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ButtonLink to="/company" variant="outline" size="sm">
                Review the record
              </ButtonLink>
              <ButtonLink to="/agent" variant="ghost" size="sm">
                Talk to the agent
              </ButtonLink>
            </div>
          </Card>
        </div>
      </div>

      <Footer />
    </Shell>
  )
}
