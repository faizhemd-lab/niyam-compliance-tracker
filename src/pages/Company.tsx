import { ArrowUpRight, Bot, Check, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { useDocumentTitle } from '../lib/storage'
import { useTracker } from '../lib/tracker'
import { INDIAN_STATES } from '../shared/catalogue'
import { FIELDS, SECTIONS, factValue, formatFact, missingFacts, type FieldSpec, type Investor, type KnowledgeField } from '../shared/knowledge'
import type { Director } from '../shared/types'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, Chip } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Input, Select } from '../components/Field'
import { Footer } from '../components/Footer'
import { useToast } from '../components/Overlay'

const SOURCE: Record<string, string> = { interview: 'said', agent: 'chat', import: 'import', manual: 'edited', document: 'document' }

export function CompanyPage() {
  useDocumentTitle('Company record')
  const { knowledge, company, applyKnowledge, loadDemo, reset } = useTracker()
  const toast = useToast()
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [director, setDirector] = useState({ name: '', din: '' })
  const [investor, setInvestor] = useState({ name: '', country: '' })

  const missing = missingFacts(knowledge)
  const known = Object.keys(knowledge.facts).length

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const spec of FIELDS) {
      if (spec.type === 'boolean' || spec.type === 'directors' || spec.type === 'investors') continue
      const value = knowledge.facts[spec.key]?.value
      if (spec.key === 'pan' || spec.key === 'gstin') continue
      next[spec.key] = value === undefined ? '' : String(value)
    }
    setValues(next)
  }, [knowledge])

  const rows = useMemo(
    () => SECTIONS.map((section) => ({ ...section, fields: FIELDS.filter((f) => f.section === section.key) })),
    [],
  )

  const save = () => {
    const patch: Partial<Record<KnowledgeField, unknown>> = {}
    for (const spec of FIELDS) {
      if (spec.type === 'boolean' || spec.type === 'directors' || spec.type === 'investors') continue
      const raw = values[spec.key]?.trim()
      if (!raw) continue
      patch[spec.key] = spec.type === 'number' ? Number(raw) : raw
    }
    const result = applyKnowledge(patch, 'manual')
    setErrors(result.errors)
    if (!result.errors.length) toast(result.changed ? `Saved ${result.changed} facts. The calendar re-ran.` : 'Nothing to change.')
  }

  const booleanField = (spec: FieldSpec) => {
    const current = factValue<boolean>(knowledge, spec.key)
    return (
      <div className="flex gap-1.5">
        {[true, false].map((value) => (
          <Chip
            key={String(value)}
            selected={current === value}
            onClick={() => {
              const result = applyKnowledge({ [spec.key]: value }, 'manual')
              if (result.errors.length) toast(result.errors[0])
            }}
            className="h-8 px-3 text-[12.5px]"
          >
            {value ? 'Yes' : 'No'}
          </Chip>
        ))}
      </div>
    )
  }

  const input = (spec: FieldSpec) => {
    if (spec.type === 'state') {
      return (
        <Select aria-label={spec.label} value={values[spec.key] ?? ''} onChange={(e) => setValues({ ...values, [spec.key]: e.target.value })} className="h-10 text-[13.5px]">
          <option value="">Not set</option>
          {INDIAN_STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </Select>
      )
    }
    if (spec.type === 'entity' || spec.type === 'sells') {
      const options =
        spec.type === 'entity'
          ? [
              ['', 'Not set'],
              ['private_limited', 'Private limited'],
              ['llp', 'LLP'],
              ['partnership', 'Partnership'],
              ['proprietorship', 'Sole proprietorship'],
            ]
          : [
              ['', 'Not set'],
              ['services', 'Services'],
              ['goods', 'Goods'],
              ['both', 'Both'],
            ]
      return (
        <Select
          aria-label={spec.label}
          value={values[spec.key] ?? ''}
          onChange={(e) => setValues({ ...values, [spec.key]: e.target.value })}
          className="h-10 text-[13.5px]"
        >
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      )
    }
    return (
      <Input
        aria-label={spec.label}
        type={spec.type === 'number' ? 'number' : spec.type === 'date' ? 'date' : 'text'}
        value={values[spec.key] ?? ''}
        placeholder={spec.key === 'pan' || spec.key === 'gstin' ? 'masked on save' : spec.hint ? '' : ''}
        onChange={(e) => setValues({ ...values, [spec.key]: e.target.value })}
        className="h-10 text-[13.5px]"
      />
    )
  }

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="Company record"
        title="What the agent knows"
        intro="This is the knowledge the agent and the rules engine share. Every fact carries where it came from. Correcting one re-runs the rules and keeps anything already marked done."
        actions={
          <>
            <ButtonLink to="/agent" variant="ghost" size="sm" icon={<Bot className="size-4" />}>
              Change it by chat
            </ButtonLink>
            <Button variant="ghost" size="sm" onClick={loadDemo} icon={<Sparkles className="size-4" />}>
              Load sample
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                reset()
                setErrors([])
              }}
              icon={<RotateCcw className="size-4" />}
            >
              Clear
            </Button>
            <Button variant="violet" size="sm" onClick={save} icon={<Check className="size-4" />}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="mt-5 flex flex-wrap items-center gap-2 text-[13px]">
          <Badge tone="violet">{known} facts</Badge>
          <Badge tone={missing.length ? 'outline' : 'success'}>{missing.length ? `${missing.length} required missing` : 'Complete enough to run'}</Badge>
          {company.name && <span className="text-muted">{company.name}</span>}
        </div>
        {errors.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-[var(--radius-control)] bg-danger/[0.06] px-4 py-3 text-[13px] text-danger" role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {missing.length > 0 && (
          <p className="mt-3 text-[13px] text-muted">
            The agent will ask for {missing.map((m) => m.label.toLowerCase()).join(', ')}.{' '}
            <Link to="/agent" className="text-violet hov:underline">
              Answer in chat
            </Link>
          </p>
        )}
      </PageHead>

      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        {rows.map((section) => (
          <Card as="section" key={section.key} className="px-5 py-5 sm:px-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[15.5px] font-medium tracking-[-0.02em]">{section.label}</h2>
              <p className="text-[11.5px] text-muted">{section.blurb}</p>
            </div>
            <dl className="mt-3 divide-y divide-line">
              {section.fields.map((spec) => {
                const fact = knowledge.facts[spec.key]
                const isList = spec.type === 'directors' || spec.type === 'investors'
                return (
                  <div key={spec.key} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-[12.5px] text-muted">{spec.label}</dt>
                      {fact && (
                        <span className="text-[10.5px] text-faint">
                          {SOURCE[fact.source] ?? fact.source} · {fact.updated_at.slice(0, 10)}
                        </span>
                      )}
                    </div>
                    <dd className="mt-1.5">
                      {spec.type === 'boolean' ? (
                        booleanField(spec)
                      ) : isList ? (
                        <div className="space-y-1.5">
                          {spec.type === 'directors' &&
                            ((factValue<Director[]>(knowledge, 'directors') ?? []).length ? (
                              (factValue<Director[]>(knowledge, 'directors') ?? []).map((d) => (
                                <div key={`${d.name}-${d.din}`} className="flex items-center justify-between gap-2 rounded-[var(--radius-xs)] bg-soft px-2.5 py-1.5 text-[12.5px]">
                                  <span>
                                    {d.name} {d.din && <span className="text-muted">· DIN {d.din}</span>}
                                  </span>
                                  <button
                                    type="button"
                                    aria-label={`Remove ${d.name}`}
                                    onClick={() => applyKnowledge({ directors: (factValue<Director[]>(knowledge, 'directors') ?? []).filter((x) => x.din !== d.din) }, 'manual')}
                                    className="text-faint hov:text-danger"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </div>
                              ))
                            ) : (
                              <p className="text-[12.5px] text-muted">None on file.</p>
                            ))}
                          {spec.type === 'investors' &&
                            ((factValue<Investor[]>(knowledge, 'investors') ?? []).length ? (
                              (factValue<Investor[]>(knowledge, 'investors') ?? []).map((i) => (
                                <p key={i.name} className="rounded-[var(--radius-xs)] bg-soft px-2.5 py-1.5 text-[12.5px]">
                                  {i.name} · {i.country}
                                  {i.amount ? ` · ${formatFact({ ...spec, type: 'number' }, i.amount)}` : ''}
                                </p>
                              ))
                            ) : (
                              <p className="text-[12.5px] text-muted">None on file.</p>
                            ))}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {spec.type === 'directors' ? (
                              <>
                                <Input aria-label="Director name" value={director.name} onChange={(e) => setDirector({ ...director, name: e.target.value })} placeholder="Name" className="h-9 w-32 text-[12.5px]" />
                                <Input aria-label="Director DIN" value={director.din} onChange={(e) => setDirector({ ...director, din: e.target.value })} placeholder="DIN" className="h-9 w-24 text-[12.5px]" />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  icon={<Plus className="size-3.5" />}
                                  disabled={!director.name.trim()}
                                  onClick={() => {
                                    const existing = factValue<Director[]>(knowledge, 'directors') ?? []
                                    const result = applyKnowledge({ directors: [...existing, { name: director.name.trim(), din: director.din.trim() }] }, 'manual')
                                    if (result.errors.length) toast(result.errors[0])
                                    else setDirector({ name: '', din: '' })
                                  }}
                                >
                                  Add
                                </Button>
                              </>
                            ) : (
                              <>
                                <Input aria-label="Investor name" value={investor.name} onChange={(e) => setInvestor({ ...investor, name: e.target.value })} placeholder="Investor" className="h-9 w-32 text-[12.5px]" />
                                <Input aria-label="Investor country" value={investor.country} onChange={(e) => setInvestor({ ...investor, country: e.target.value })} placeholder="Country" className="h-9 w-28 text-[12.5px]" />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  icon={<Plus className="size-3.5" />}
                                  disabled={!investor.name.trim()}
                                  onClick={() => {
                                    const existing = factValue<Investor[]>(knowledge, 'investors') ?? []
                                    const result = applyKnowledge({ investors: [...existing, { name: investor.name.trim(), country: investor.country.trim() || 'Unknown' }] }, 'manual')
                                    if (result.errors.length) toast(result.errors[0])
                                    else setInvestor({ name: '', country: '' })
                                  }}
                                >
                                  Add
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        input(spec)
                      )}
                      {!fact && !isList && spec.type !== 'boolean' && <p className="mt-1 text-[11.5px] text-faint">{spec.hint ?? spec.ask}</p>}
                      {!fact && spec.type === 'boolean' && <p className="mt-1 text-[11.5px] text-faint">{spec.ask}</p>}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </Card>
        ))}
      </div>

      <Card as="section" tone="soft" className="mt-2 px-5 py-5 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[15px] font-medium">Only the agent writes facts</p>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
              Every value above goes through the same validation whether it came from chat, a spreadsheet or this form: PAN and GSTIN patterns, date ranges, allowed company types. A rejected value is listed, never stored. PAN and GSTIN are kept masked.
            </p>
          </div>
          <ButtonLink to="/agent" variant="outline" size="sm" iconRight={<ArrowUpRight className="size-4" />}>
            Back to the agent
          </ButtonLink>
        </div>
      </Card>

      <Footer />
    </Shell>
  )
}
