import { Check, RotateCcw, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { BUDGET_OPTIONS } from '../data'
import { useDocumentTitle } from '../lib/storage'
import { useTracker } from '../lib/tracker'
import { INDIAN_STATES } from '../shared/catalogue'
import { formatRupees, formatTurnover } from '../shared/format'
import type { BudgetBand, Company as CompanyRecord, Entity, Profile, Sells } from '../shared/types'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, Chip } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Field, Input, Select } from '../components/Field'
import { Footer } from '../components/Footer'
import { useToast } from '../components/Overlay'

const BOOLEANS: { key: 'gst_registered' | 'interstate' | 'foreign_investment'; label: string; hint: string }[] = [
  { key: 'gst_registered', label: 'Registered for GST', hint: 'A 15-character GSTIN means yes.' },
  { key: 'interstate', label: 'Sells to other states', hint: 'Selling goods across state lines usually needs GST.' },
  { key: 'foreign_investment', label: 'Foreign investment', hint: 'Any investor outside India, including NRIs.' },
]

export function CompanyPage() {
  useDocumentTitle('Company profile')
  const { company, profile, loadDemo, reset, mergeProfile, log } = useTracker()
  const toast = useToast()
  const [draft, setDraft] = useState<CompanyRecord>({ ...company, ...profile })
  const [saved, setSaved] = useState(false)

  const set = <K extends keyof CompanyRecord>(key: K, value: CompanyRecord[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const save = (e: FormEvent) => {
    e.preventDefault()
    const director = draft.directors?.[0]
    const updates: Partial<Profile> = {
      entity: draft.entity,
      state: draft.state,
      turnover: draft.turnover,
      employees: draft.employees,
      sells: draft.sells,
      gst_registered: draft.gst_registered,
      interstate: draft.interstate,
      foreign_investment: draft.foreign_investment,
      incorporated_on: draft.incorporated_on,
    }
    mergeProfile(updates, 'Edited the company profile directly')
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
    toast('Saved. The rules engine re-ran; items marked done kept their status.')
    if (director || draft.name) {
      log('Updated company details', [draft.name, director?.name].filter(Boolean).join(' · '))
    }
  }

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="Company profile"
        title="The record the rules read"
        intro="Every obligation comes from these answers. Correct one and the calendar rebuilds: new deadlines appear, items that no longer apply are removed unless already done, and done items keep their status."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={reset} icon={<RotateCcw className="size-4" />}>
              Start over
            </Button>
            <Button variant="outline" size="sm" onClick={loadDemo} icon={<Sparkles className="size-4" />}>
              Load sample
            </Button>
          </>
        }
      >
        <div className="mt-5 flex flex-wrap gap-2 text-[13px]">
          <Badge tone="violet">{draft.turnover ? formatTurnover(draft.turnover) : 'Turnover missing'}</Badge>
          <Badge tone="outline">{draft.employees !== undefined ? `${draft.employees} people` : 'Headcount missing'}</Badge>
          <Badge tone={draft.incorporated_on ? 'success' : 'neutral'}>{draft.incorporated_on ? `Incorporated ${draft.incorporated_on}` : 'No incorporation date'}</Badge>
        </div>
      </PageHead>

      <form onSubmit={save} className="mt-2 grid gap-2 lg:grid-cols-[1.4fr_1fr]">
        <Card as="section" className="px-5 py-6 sm:px-7">
          <h2 className="text-[16px] font-medium tracking-[-0.02em]">Business</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Legal name" className="sm:col-span-2">
              {(p) => <Input {...p} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Northwind Labs Private Limited" />}
            </Field>

            <Field label="Company type">
              {(p) => (
                <Select {...p} value={draft.entity ?? ''} onChange={(e) => set('entity', (e.target.value || undefined) as Entity)}>
                  <option value="">Not set</option>
                  <option value="private_limited">Private limited</option>
                  <option value="llp">LLP</option>
                  <option value="partnership">Partnership</option>
                  <option value="proprietorship">Sole proprietorship</option>
                </Select>
              )}
            </Field>

            <Field label="State">
              {(p) => (
                <Select {...p} value={draft.state ?? ''} onChange={(e) => set('state', e.target.value || undefined)}>
                  <option value="">Not set</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Turnover (₹ per year)" hint={draft.turnover ? `About ${formatRupees(draft.turnover)} a year` : 'Total sales before costs, in rupees.'}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  step={10000}
                  value={draft.turnover ?? ''}
                  onChange={(e) => set('turnover', e.target.value === '' ? undefined : Number(e.target.value))}
                />
              )}
            </Field>

            <Field label="Employees on payroll">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  step={1}
                  value={draft.employees ?? ''}
                  onChange={(e) => set('employees', e.target.value === '' ? undefined : Number(e.target.value))}
                />
              )}
            </Field>

            <Field label="What you sell">
              {(p) => (
                <Select {...p} value={draft.sells ?? ''} onChange={(e) => set('sells', (e.target.value || undefined) as Sells)}>
                  <option value="">Not set</option>
                  <option value="services">Services</option>
                  <option value="goods">Goods</option>
                  <option value="both">Both</option>
                </Select>
              )}
            </Field>

            <Field label="Incorporated on" hint="Needed for INC-20A and other first-year filings.">
              {(p) => <Input {...p} type="date" value={draft.incorporated_on ?? ''} onChange={(e) => set('incorporated_on', e.target.value || undefined)} />}
            </Field>

            {BOOLEANS.map((b) => (
              <div key={b.key} className="sm:col-span-2">
                <p className="mb-1.5 text-sm font-medium">{b.label}</p>
                <div className="flex gap-2">
                  {[true, false].map((value) => (
                    <Chip key={String(value)} selected={draft[b.key] === value} onClick={() => set(b.key, value)} className="h-9 px-4 text-[13px]">
                      {value ? 'Yes' : 'No'}
                    </Chip>
                  ))}
                  <span className="ml-1 self-center text-[12.5px] text-muted">{b.hint}</span>
                </div>
              </div>
            ))}
          </div>

          <h2 className="mt-8 border-t border-line pt-6 text-[16px] font-medium tracking-[-0.02em]">Identifiers and director</h2>
          <p className="mt-1 text-[12.5px] text-muted">Stored masked: only the first and last characters are shown anywhere in the app.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="CIN or LLPIN" optional>
              {(p) => <Input {...p} value={draft.cin ?? ''} onChange={(e) => set('cin', e.target.value)} placeholder="U62099TG2026PTC000000" />}
            </Field>
            <Field label="PAN (masked)" optional>
              {(p) => <Input {...p} value={draft.pan_masked ?? ''} onChange={(e) => set('pan_masked', e.target.value)} placeholder="AB••••34F" />}
            </Field>
            <Field label="GSTIN (masked)" optional>
              {(p) => <Input {...p} value={draft.gstin_masked ?? ''} onChange={(e) => set('gstin_masked', e.target.value)} placeholder="36AB••••1Z5" />}
            </Field>
            <Field label="Email for reminders" optional>
              {(p) => <Input {...p} type="email" value={draft.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="founder@company.example" />}
            </Field>
            <Field label="Director name" optional>
              {(p) => (
                <Input
                  {...p}
                  value={draft.directors?.[0]?.name ?? ''}
                  onChange={(e) => set('directors', [{ ...(draft.directors?.[0] ?? { din: '' }), name: e.target.value }])}
                />
              )}
            </Field>
            <Field label="Director DIN" optional>
              {(p) => (
                <Input
                  {...p}
                  value={draft.directors?.[0]?.din ?? ''}
                  onChange={(e) => set('directors', [{ ...(draft.directors?.[0] ?? { name: '' }), din: e.target.value }])}
                />
              )}
            </Field>
          </div>

          <Field label="Budget for compliance help" className="mt-4">
            {(p) => (
              <Select {...p} value={draft.budget ?? '10k_30k'} onChange={(e) => set('budget', e.target.value as BudgetBand)}>
                {BUDGET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button type="submit" variant="violet" icon={saved ? <Check className="size-4" /> : undefined}>
              {saved ? 'Saved' : 'Save and rebuild the calendar'}
            </Button>
            <ButtonLink to="/obligations" variant="ghost" size="sm">
              Back to obligations
            </ButtonLink>
          </div>
        </Card>

        <div className="grid content-start gap-2">
          <Card as="section" tone="soft" className="px-5 py-5">
            <h2 className="text-[15px] font-medium">What the engine will do</h2>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-muted">
              <li>Re-evaluate all 22 rules against these answers.</li>
              <li>Add deadlines that now apply, inside a window from 60 days back to 12 months ahead.</li>
              <li>Remove deadlines that no longer apply — unless already marked done.</li>
              <li>Keep done items, their dates and who marked them.</li>
            </ul>
          </Card>

          <Card as="section" className="px-5 py-5">
            <h2 className="text-[15px] font-medium">Assumptions on record</h2>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-muted">
              <li>AGM assumed on 30 September, so AOC-4 falls 30 days later and MGT-7 60 days later.</li>
              <li>Advance tax applies above ₹10 lakh turnover; the catalogue uses turnover as a stand-in for estimated tax.</li>
              <li>Professional tax and Shop licences stay in the on-event lane until a state-specific rule is verified.</li>
              {!draft.incorporated_on && <li className="text-danger">No incorporation date: INC-20A and GST registration cannot be dated.</li>}
            </ul>
          </Card>

          <Card as="section" className="px-5 py-5">
            <p className="caps mb-2 text-muted">Rules version</p>
            <p className="text-[14px] font-medium">2026.1 · 22 entries</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">No entry has been signed off against an official portal yet. Each result shows a “not yet verified” badge until a CA review records the source and date.</p>
          </Card>
        </div>
      </form>

      <Footer />
    </Shell>
  )
}
