import { ArrowRight, ArrowUpRight, CalendarPlus, Download, Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { useDocumentTitle } from '../lib/storage'
import { useTracker } from '../lib/tracker'
import { GROUP_LABELS } from '../shared/catalogue'
import { formatDate } from '../shared/format'
import { profileLine } from '../shared/rules'
import { toIcs } from '../shared/documents'
import type { Deadline, Obligation, ObligationGroup } from '../shared/types'
import { downloadBlob } from '../shared/zip'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, Chip, EmptyState } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { DeadlineRow, Facts } from '../components/DeadlineRow'
import { Footer } from '../components/Footer'
import { SummaryStrip, UrgencyTag } from '../components/Status'

function nextFor(deadlines: Deadline[], ruleId: string) {
  return deadlines.find((d) => d.rule_id === ruleId && d.status === 'open' && d.due_date) ?? deadlines.find((d) => d.rule_id === ruleId)
}

function ObligationCard({ obligation, deadlines }: { obligation: Obligation; deadlines: Deadline[] }) {
  const next = nextFor(deadlines, obligation.rule_id)
  const count = deadlines.filter((d) => d.rule_id === obligation.rule_id).length
  return (
    <Card as="article" className="px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-medium tracking-[-0.025em]">{obligation.name}</h3>
            <Badge tone="outline">{GROUP_LABELS[obligation.group]}</Badge>
            {!obligation.verified && <Badge tone="neutral">Not yet verified</Badge>}
          </div>
          <p className="mt-1 text-[13.5px] text-muted">
            {obligation.authority} · rule {obligation.rule_version}
          </p>
        </div>
        {next && <UrgencyTag deadline={next} />}
      </div>

      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{obligation.reason}</p>
      <div className="mt-3">
        <Facts facts={obligation.facts} />
      </div>

      <div className="mt-4 grid gap-3 border-t border-line pt-3 text-[13px] sm:grid-cols-3">
        <div>
          <p className="caps text-muted">Next deadline</p>
          <p className="mt-1 font-medium">{next?.due_date ? formatDate(next.due_date) : next ? 'On event' : '—'}</p>
        </div>
        <div>
          <p className="caps text-muted">If it is missed</p>
          <p className="mt-1 line-clamp-2">{obligation.penalty.text}</p>
        </div>
        <div>
          <p className="caps text-muted">In the window</p>
          <p className="mt-1 font-medium tabular-nums">{count === 0 ? '—' : `${count} ${count === 1 ? 'date' : 'dates'}`}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {next && (
          <ButtonLink to={`/deadline/${encodeURIComponent(next.id)}`} size="sm" variant="solid" iconRight={<ArrowUpRight className="size-4" />}>
            Open the item
          </ButtonLink>
        )}
        <span className="text-[12.5px] text-muted">{obligation.how_to_file}</span>
      </div>
    </Card>
  )
}

export function Obligations() {
  useDocumentTitle('Obligations')
  const { profile, obligations, deadlines, summary, needsIncorporation } = useTracker()
  const [group, setGroup] = useState<ObligationGroup | 'all'>('all')
  const [downloading, setDownloading] = useState(false)

  const groups = useMemo(() => [...new Set(obligations.map((o) => o.group))], [obligations])
  const filtered = group === 'all' ? obligations : obligations.filter((o) => o.group === group)
  const urgent = deadlines.filter((d) => d.colour === 'red' && d.status === 'open')

  const downloadIcs = async () => {
    setDownloading(true)
    try {
      const res = await fetch('/api/calendar.ics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile, company: { name: 'My company' }, today: new Date().toISOString().slice(0, 10) }),
      })
      if (!res.ok) throw new Error('ics')
      downloadBlob('compliance-calendar.ics', await res.blob())
    } catch {
      downloadBlob('compliance-calendar.ics', new Blob([toIcs(deadlines, 'My company')], { type: 'text/calendar' }))
    }
    setDownloading(false)
  }

  if (!obligations.length) {
    return (
      <Shell>
        <Header />
        <PageHead eyebrow="Obligations" title="Nothing to show yet" intro="Tell the agent about the business and the rules engine will work out what applies. One line is enough to start." />
        <Card className="mt-2">
          <EmptyState
            title="No profile, no calendar"
            body="Tell the agent about the business and the rules engine lists every obligation that applies to it."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink to="/agent" variant="violet" iconRight={<ArrowRight className="size-4" />}>
                  Talk to the agent
                </ButtonLink>
                <ButtonLink to="/import" variant="outline">
                  Import a spreadsheet
                </ButtonLink>
              </div>
            }
          />
        </Card>
        <Footer />
      </Shell>
    )
  }

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="What applies to you"
        title={`${summary.total} obligations`}
        intro={`${profileLine(profile)}. Every item below says why it applies, who it is owed to and what a missed deadline costs.`}
        actions={
          <>
            <ButtonLink to="/company" variant="outline" size="sm" icon={<Pencil className="size-4" />}>
              Correct an answer
            </ButtonLink>
            <Button variant="solid" size="sm" onClick={() => void downloadIcs()} loading={downloading} icon={<CalendarPlus className="size-4" />}>
              Add to calendar
            </Button>
          </>
        }
      >
        <SummaryStrip summary={summary} />
        {urgent.length > 0 && (
          <div className="mt-5 rounded-[var(--radius-control)] border border-danger/30 bg-danger/[0.04] px-4 py-3">
            <p className="text-[13.5px] font-medium text-danger">
              {urgent.length} {urgent.length === 1 ? 'item needs' : 'items need'} attention now
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {urgent.slice(0, 3).map((d) => d.short).join(' · ')}
              {urgent.length > 3 ? ` and ${urgent.length - 3} more` : ''}
            </p>
          </div>
        )}
        {needsIncorporation.length > 0 && (
          <p className="mt-4 rounded-[var(--radius-control)] bg-soft px-4 py-3 text-[13px] text-muted">
            No incorporation date yet, so {needsIncorporation.join(' and ')} {needsIncorporation.length === 1 ? 'is' : 'are'} not dated.{' '}
            <Link to="/company" className="text-violet hov:underline">
              Add it
            </Link>
            .
          </p>
        )}
      </PageHead>

      <Card as="section" className="mt-2 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Chip selected={group === 'all'} onClick={() => setGroup('all')} className="h-9 px-3.5 text-[13.5px]">
              All {obligations.length}
            </Chip>
            {groups.map((g) => (
              <Chip key={g} selected={group === g} onClick={() => setGroup(g)} className="h-9 px-3.5 text-[13.5px]">
                {GROUP_LABELS[g]}
              </Chip>
            ))}
          </div>
          <p className="text-[12.5px] text-muted">Rules version 2026.1 · not verified against official portals</p>
        </div>

        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          {filtered.map((o) => (
            <ObligationCard key={o.rule_id} obligation={o} deadlines={deadlines} />
          ))}
        </div>
      </Card>

      <Card as="section" className="mt-2 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="display text-[clamp(1.6rem,1.2rem+1.4vw,2.3rem)] leading-none">The full dated list</h2>
            <p className="mt-2 text-[14px] text-muted">Next 12 months, with 60 days behind so overdue items stay visible.</p>
          </div>
          <ButtonLink to="/calendar" variant="outline" size="sm" iconRight={<Download className="size-4" />}>
            Open the calendar
          </ButtonLink>
        </div>
        <div className="mt-4 grid gap-2">
          {deadlines.slice(0, 8).map((d) => (
            <DeadlineRow key={d.id} deadline={d} />
          ))}
        </div>
        {deadlines.length > 8 && (
          <Link to="/calendar" className="mt-4 inline-flex min-h-10 items-center gap-1.5 text-[13.5px] font-medium text-violet hov:text-violet-deep">
            All {deadlines.length} deadlines
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </Card>

      <Footer />
    </Shell>
  )
}
