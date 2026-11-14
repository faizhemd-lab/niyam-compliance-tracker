import { ArrowRight, HelpCircle, Info, RotateCcw, Send, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { GLOSSARY, SITE } from '../data'
import { postJson } from '../lib/api'
import { GREETING } from '../lib/messages'
import { useDocumentTitle } from '../lib/storage'
import { newId, useTracker } from '../lib/tracker'
import { formatDate, formatRupees } from '../shared/format'
import { chipText, nextSlot, prefilledFields, takeTurn } from '../shared/interview'
import { SLOTS } from '../shared/interview'
import { missingFields } from '../shared/rules'
import type { ChatMessage, Profile } from '../shared/types'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, Chip, Logo } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Modal } from '../components/Overlay'
import { Footer } from '../components/Footer'
import { cx } from '../lib/cx'

function valueLabel(profile: Profile, field: string) {
  const value = profile[field as keyof Profile]
  if (value === undefined || value === '') return null
  if (field === 'turnover' && typeof value === 'number') return `${formatRupees(value)} a year`
  if (field === 'incorporated_on' && typeof value === 'string') return formatDate(value)
  if (field === 'gst_registered' || field === 'interstate' || field === 'foreign_investment') return value ? 'Yes' : 'No'
  if (field === 'entity' && typeof value === 'string') return value.replace('_', ' ')
  if (field === 'employees') return `${value} people`
  return String(value)
}

type ApiTurn = { updates: Partial<Profile>; rejected: { field: string; reason: string }[]; profile: Profile }

export function Interview() {
  useDocumentTitle('Check my compliance')
  const { state, profile, company, set, mergeProfile, addMessage, startInterview, loadDemo } = useTracker()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [glossary, setGlossary] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const slot = nextSlot(profile)
  const missing = missingFields(profile)
  const complete = missing.length === 0

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [state.messages.length, busy])

  const push = (message: Omit<ChatMessage, 'id' | 'at'>) => addMessage({ ...message, id: newId(), at: new Date().toISOString() })

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    setInput('')
    push({ role: 'founder', text })
    setBusy(true)

    const local = takeTurn(profile, text, slot)
    const res = await postJson<ApiTurn>('/api/interview/message', { profile, message: text, awaiting: slot?.field ?? null })
    const updates = res.ok ? res.data.updates : local.extraction.updates
    const rejected = res.ok ? res.data.rejected : local.extraction.rejected
    const merged: Profile = { ...profile, ...updates }

    if (Object.keys(updates).length) {
      mergeProfile(updates, `Interview answer updated ${Object.keys(updates).join(', ')}.`)
      set({ profile: merged })
    }

    const after = nextSlot(merged)
    const accepted = Object.keys(updates).length

    const skipsOptional = !accepted && slot?.field === 'incorporated_on' && /^(skip|pass|not sure|no idea|don'?t know|later)\b/i.test(text)

    if (rejected.length) {
      push({ role: 'tracker', text: rejected[0].reason })
    } else if (skipsOptional) {
      push({ role: 'tracker', text: 'No problem. The first-year filings that need an incorporation date stay undated until you add it on the company page.' })
    } else if (!accepted) {
      push({ role: 'tracker', text: `I did not catch that. ${slot ? slot.question : 'Could you say it another way?'}`, chips: slot?.options })
    } else if (after) {
      push({
        role: 'tracker',
        text: after.question,
        chips: after.options,
        note: after.helper,
      })
    } else {
      push({
        role: 'tracker',
        text: 'That is everything I need. Your answers are saved; the rules engine can build the calendar now.',
      })
    }

    set({ awaiting: skipsOptional ? null : (after?.field ?? null) })
    setBusy(false)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  const restart = () => {
    startInterview()
    set({ messages: [{ id: 'greeting', role: 'tracker', text: GREETING, at: new Date().toISOString(), chips: ['Private Limited', 'LLP', 'Partnership', 'Sole proprietor'] }], awaiting: 'entity' })
  }

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="The interview"
        title="Tell us about your business"
        intro="Eight questions, in a fixed order. Answer with a button or in your own words — “about 60 lakh, mostly online” is fine. Every answer is validated before it is saved."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={restart} icon={<RotateCcw className="size-4" />}>
              Start over
            </Button>
            <Button variant="outline" size="sm" onClick={loadDemo} icon={<Sparkles className="size-4" />}>
              Fill with sample company
            </Button>
          </>
        }
      />

      <div className="mt-2 grid gap-2 lg:grid-cols-[1.5fr_1fr]">
        <Card as="section" className="flex min-h-[34rem] flex-col px-4 pt-5 pb-4 sm:px-6">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2.5">
              <Logo />
              <div>
                <p className="text-[14px] font-medium leading-tight">Compliance tracker</p>
                <p className="text-[12px] text-muted">Self-hosted · identifiers masked</p>
              </div>
            </div>
            <Badge tone={complete ? 'success' : 'neutral'}>{complete ? 'Answers complete' : `${missing.length} to go`}</Badge>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto py-5" aria-live="polite" aria-label="Conversation">
            {state.messages.map((message) => (
              <div key={message.id} className={cx('flex', message.role === 'founder' ? 'justify-end' : 'justify-start')}>
                <div className={cx('max-w-[85%]', message.role === 'founder' ? 'text-right' : '')}>
                  <div
                    className={cx(
                      'round inline-block rounded-[22px] px-4 py-3 text-left text-[14.5px] leading-relaxed',
                      message.role === 'founder' ? 'bg-ink text-white' : 'bg-soft text-ink',
                    )}
                  >
                    {message.text}
                  </div>
                  {message.note && <p className="mt-1.5 max-w-sm text-[12.5px] leading-snug text-muted">{message.note}</p>}
                  {message.chips && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {message.chips.map((chip) => (
                        <Chip key={chip} onClick={() => void send(chipText(chip))} disabled={busy} className="h-9 px-3.5 text-[13.5px]">
                          {chip}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && <p className="text-[13px] text-muted">Reading your answer…</p>}
            <div ref={endRef} />
          </div>

          <form onSubmit={onSubmit} className="border-t border-line pt-3">
            <div className="flex items-end gap-2">
              <label htmlFor="answer" className="sr-only">
                Your answer
              </label>
              <textarea
                id="answer"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send(input)
                  }
                }}
                placeholder={slot ? slot.question : 'Ask about any deadline, or correct an answer'}
                className="min-h-11 w-full resize-none rounded-[var(--radius-control)] border border-line-strong bg-card px-4 py-2.5 text-[15px] placeholder:text-muted/80 focus:border-violet focus:shadow-[var(--shadow-focus)] focus:outline-none"
              />
              <Button type="submit" variant="violet" size="md" loading={busy} aria-label="Send answer" className="size-12 shrink-0 px-0">
                <Send className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setGlossary(true)} className="inline-flex min-h-8 items-center gap-1.5 text-[13px] text-violet hov:text-violet-deep">
                <HelpCircle className="size-3.5" aria-hidden />
                What does this mean?
              </button>
              {complete && (
                <ButtonLink to="/obligations" variant="solid" size="sm" iconRight={<ArrowRight className="size-4" />}>
                  See what applies
                </ButtonLink>
              )}
            </div>
          </form>
        </Card>

        <div className="grid content-start gap-2">
          <Card as="section" className="px-5 py-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-medium">What we know</h2>
              <Link to="/company" className="text-[13px] text-violet hov:text-violet-deep">
                Edit
              </Link>
            </div>
            {prefilledFields(profile).length === 0 && !profile.incorporated_on ? (
              <p className="mt-3 text-[14px] leading-relaxed text-muted">Nothing yet. {GREETING}</p>
            ) : (
              <dl className="mt-3 divide-y divide-line">
                {SLOTS.map((s) => {
                  const value = valueLabel(profile, s.field)
                  if (!value) return null
                  return (
                    <div key={s.field} className="flex items-baseline justify-between gap-3 py-2">
                      <dt className="text-[13px] text-muted">{s.question.replace(/\?$/, '')}</dt>
                      <dd className="text-right text-[13.5px] font-medium">{value}</dd>
                    </div>
                  )
                })}
              </dl>
            )}
            <p className="mt-4 border-t border-line pt-3 text-[12.5px] leading-snug text-muted">
              {company.name ? `${company.name} · ` : ''}
              Answers are compared with the rules catalogue, not with a model. Add an incorporation date for first-year filings.
            </p>
          </Card>

          <Card as="section" tone="soft" className="px-5 py-5">
            <p className="caps mb-2 text-muted">Model gateway</p>
            <p className="text-[14.5px] font-medium">Deterministic local parser, v1</p>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-snug text-muted">
              <li className="flex gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Extraction runs on the app server. No request leaves for a third-party model.
              </li>
              <li className="flex gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                PAN, GSTIN, phone and email are masked before extraction; raw identifiers are not stored.
              </li>
              <li className="flex gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                The same interface accepts a self-hosted Ollama or vLLM model — validation and the rules engine stay unchanged.
              </li>
            </ul>
          </Card>

          <Card as="section" className="px-5 py-5">
            <p className="caps mb-2 text-muted">Not legal advice</p>
            <p className="text-[13px] leading-relaxed text-muted">{SITE.notice}</p>
          </Card>
        </div>
      </div>

      <Modal open={glossary} onClose={() => setGlossary(false)} title="Plain words" description="Every term the interview and the calendar use, explained once.">
        <dl className="divide-y divide-line">
          {GLOSSARY.map((g) => (
            <div key={g.term} className="py-3">
              <dt className="text-[14px] font-medium">{g.term}</dt>
              <dd className="mt-1 text-[13.5px] leading-relaxed text-muted">{g.meaning}</dd>
            </div>
          ))}
        </dl>
      </Modal>

      <Footer />
    </Shell>
  )
}
