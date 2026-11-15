import { ArrowUpRight, BadgeCheck, GraduationCap, MapPin, Star } from 'lucide-react'
import { useEffect, useState } from 'react'

import { BUDGET_OPTIONS, SITE } from '../data'
import { useDocumentTitle } from '../lib/storage'
import { useTracker } from '../lib/tracker'
import { postJson } from '../lib/api'
import { CAS, GROUP_LABELS } from '../shared/catalogue'
import { matchCAs } from '../shared/matching'
import type { BudgetBand, CAMatch } from '../shared/types'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Avatar, Badge, EmptyState } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Footer } from '../components/Footer'
import { useToast } from '../components/Overlay'

export function CaMatch() {
  useDocumentTitle('Find a CA')
  const { state, profile, deadlines, obligations, log, set } = useTracker()
  const toast = useToast()
  const [budget, setBudget] = useState<BudgetBand>(state.budget)
  const [matches, setMatches] = useState<CAMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<'server' | 'browser'>('browser')

  useEffect(() => {
    setBudget(state.budget)
  }, [state.budget])

  useEffect(() => {
    let alive = true
    setLoading(true)
    const local = matchCAs(profile, deadlines, CAS, budget)
    void postJson<{ matches: CAMatch[] }>('/api/cas/match', { profile, budget, today: state.today })
      .then((res) => {
        if (!alive) return
        setMatches(res.ok && res.data.matches.length ? res.data.matches : local)
        setSource(res.ok ? 'server' : 'browser')
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [profile, deadlines, budget, state.today])

  if (!obligations.length) {
    return (
      <Shell>
        <Header />
        <PageHead eyebrow="Find a CA" title="Match on what you actually owe" intro="Matching needs the obligations that apply to you. Tell the agent about the business first — one line is enough." />
        <Card className="mt-2">
          <EmptyState title="No record yet" body="Tell the agent about the business and the matcher scores CAs on the filings you really have." action={<ButtonLink to="/agent" variant="violet">Talk to the agent</ButtonLink>} />
        </Card>
        <Footer />
      </Shell>
    )
  }

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="Find a CA"
        title="Accountants who know your filings"
        intro="Scored on specialty fit (40%), location and language (20%), budget (15%), rating (15%) and availability (10%) — with the reason for every recommendation. Payment never enters the score."
        actions={
          <label className="flex items-center gap-2 text-[13px] text-muted">
            Budget
            <select
              value={budget}
              onChange={(e) => {
                setBudget(e.target.value as BudgetBand)
                set({ budget: e.target.value as BudgetBand })
              }}
              className="h-10 rounded-[var(--radius-control)] border border-line-strong bg-card px-3 text-[13.5px] text-ink focus:border-violet focus:shadow-[var(--shadow-focus)] focus:outline-none"
            >
              {BUDGET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <div className="mt-5 flex flex-wrap gap-2">
          <Badge tone="outline">Sample directory</Badge>
          <Badge tone="success">Real scoring</Badge>
          <span className="text-[12.5px] text-muted">
            {loading ? 'Scoring…' : `Scored ${CAS.length} accountants`} · computed {source === 'server' ? 'on the app server' : 'in your browser'}
          </span>
        </div>
      </PageHead>

      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        {matches.map((match, index) => {
          const requested = state.intros.includes(match.ca.id)
          return (
            <Card as="article" key={match.ca.id} className="px-5 py-5 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Avatar name={match.ca.name} size="sm" />
                  <div>
                    <p className="flex items-center gap-1.5 text-[16px] font-medium tracking-[-0.02em]">
                      {match.ca.name}
                      {match.ca.accepting && <BadgeCheck className="size-4 text-success" aria-hidden />}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden />
                        {match.ca.city}
                      </span>
                      <span className="flex items-center gap-1">
                        <Star className="size-3.5" aria-hidden />
                        {match.ca.rating} · {match.ca.reviews} reviews
                      </span>
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[clamp(1.6rem,1.2rem+1vw,2.1rem)] leading-none font-medium tabular-nums tracking-[-0.04em]">{match.score}</p>
                  <p className="caps text-muted">match</p>
                  <p className="mt-1 text-[11px] text-faint">#{index + 1}</p>
                </div>
              </div>

              <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">{match.ca.blurb}</p>

              <ul className="mt-3 space-y-1.5">
                {match.reasons.slice(0, 3).map((reason) => (
                  <li key={reason} className="flex gap-2 text-[12.5px] leading-snug text-muted">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-violet" aria-hidden />
                    {reason}
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {match.ca.specialties.map((s) => (
                  <Badge key={s} tone="outline">
                    {GROUP_LABELS[s]}
                  </Badge>
                ))}
              </div>

              <div className="mt-4 grid gap-1.5 border-t border-line pt-3">
                {match.breakdown.map((b) => (
                  <div key={b.factor} className="grid grid-cols-[8.5rem_1fr_2rem] items-center gap-2">
                    <span className="truncate text-[11.5px] text-muted">{b.factor}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-soft">
                      <span className="block h-full rounded-full bg-violet" style={{ width: `${b.score}%` }} />
                    </span>
                    <span className="text-right text-[11px] text-muted tabular-nums">{b.score}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] text-muted">
                  <GraduationCap className="size-3.5" aria-hidden />
                  {match.ca.languages.join(' · ')} · fee band {match.ca.fee_band.replace(/_/g, ' ')}
                </span>
                <Button
                  variant={requested ? 'outline' : 'violet'}
                  size="sm"
                  disabled={requested}
                  iconRight={!requested ? <ArrowUpRight className="size-4" /> : undefined}
                  onClick={() => {
                    set({ intros: [...state.intros, match.ca.id] })
                    log('Requested an introduction', `${match.ca.name} · ${match.ca.city}`)
                    toast(`Introduction requested. ${match.ca.name} receives your profile, calendar and obligation summary.`)
                  }}
                >
                  {requested ? 'Introduction sent' : 'Request introduction'}
                </Button>
              </div>
            </Card>
          )
        })}
      </div>

      <Card as="section" tone="night" className="mt-2 px-5 py-8 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="caps mb-2 text-violet-light">Why a CA would use this</p>
            <p className="text-[clamp(1.3rem,1rem+1vw,1.8rem)] leading-[1.15] font-medium tracking-[-0.03em] text-white">
              Clients arrive with a profile, a calendar and documents already organised — not a shoebox of receipts.
            </p>
          </div>
          <p className="text-[13.5px] leading-relaxed text-night-muted">
            Matching is the revenue path: introduction or engagement referral fees from CA firms, plus optional paid plans for startups. Ranking never depends on who pays. {SITE.notice}
          </p>
        </div>
      </Card>

      <Footer />
    </Shell>
  )
}
