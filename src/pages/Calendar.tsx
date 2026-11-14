import { CalendarPlus, ChevronRight, Clock, Download } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useDocumentTitle } from '../lib/storage'
import { useTracker } from '../lib/tracker'
import { formatDate, monthLabel } from '../shared/format'
import { toIcs } from '../shared/documents'
import { downloadBlob } from '../shared/zip'
import type { Deadline } from '../shared/types'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, EmptyState } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { DeadlineRow } from '../components/DeadlineRow'
import { Footer } from '../components/Footer'
import { Legend, SummaryStrip } from '../components/Status'

function MonthBlock({ month, items }: { month: string; items: Deadline[] }) {
  const urgent = items.filter((d) => d.colour === 'red').length
  return (
    <section aria-labelledby={`month-${month}`} className="border-t border-line pt-5 first:border-0 first:pt-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`month-${month}`} className="text-[15px] font-medium tracking-[-0.02em]">
          {monthLabel(month)}
        </h2>
        <p className="text-[12.5px] text-muted">
          {items.length} {items.length === 1 ? 'deadline' : 'deadlines'}
          {urgent > 0 && <span className="text-danger"> · {urgent} urgent</span>}
        </p>
      </div>
      <div className="grid gap-2">
        {items.map((d) => (
          <DeadlineRow key={d.id} deadline={d} />
        ))}
      </div>
    </section>
  )
}

export function CalendarPage() {
  useDocumentTitle('Calendar')
  const { deadlines, summary, state, loadDemo } = useTracker()
  const [downloading, setDownloading] = useState(false)
  const dated = deadlines.filter((d) => d.due_date)
  const events = deadlines.filter((d) => !d.due_date)
  const overdue = dated.filter((d) => d.status !== 'done' && d.days_left !== null && d.days_left < 0)
  const months = new Map<string, Deadline[]>()
  for (const d of dated) {
    const key = d.due_date!.slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), d])
  }

  const download = async () => {
    setDownloading(true)
    try {
      const res = await fetch('/api/calendar.ics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile: state.profile, company: state.company, today: state.today }),
      })
      if (!res.ok) throw new Error('ics')
      downloadBlob('compliance-calendar.ics', await res.blob())
    } catch {
      downloadBlob('compliance-calendar.ics', new Blob([toIcs(deadlines, state.company.name || 'My company')], { type: 'text/calendar' }))
    }
    setDownloading(false)
  }

  if (!deadlines.length) {
    return (
      <Shell>
        <Header />
        <PageHead eyebrow="Calendar" title="Your deadlines live here" intro="Once the interview is done, every dated obligation lands on this calendar with its authority and penalty." />
        <Card className="mt-2">
          <EmptyState
            title="No calendar yet"
            body="Answer the eight questions, or load the sample company to see a year of deadlines."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink to="/interview" variant="violet">
                  Check my compliance
                </ButtonLink>
                <Button variant="outline" onClick={loadDemo}>
                  Load the sample company
                </Button>
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
        eyebrow="Calendar"
        title="Everything that is due"
        intro={`Dated from ${formatDate(state.today)}: 60 days behind and 12 months ahead. Each entry names the authority, the penalty and the colour state.`}
        actions={
          <>
            <ButtonLink to="/company" variant="outline" size="sm">
              Correct an answer
            </ButtonLink>
            <Button variant="violet" size="sm" onClick={() => void download()} loading={downloading} icon={<CalendarPlus className="size-4" />}>
              Export .ics
            </Button>
          </>
        }
      >
        <SummaryStrip summary={summary} />
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <Legend />
          <Link to="/reminders" className="caps flex items-center gap-1.5 text-violet hov:text-violet-deep">
            <Clock className="size-3.5" aria-hidden />
            Simulated clock: {formatDate(state.today)}
          </Link>
        </div>
      </PageHead>

      {overdue.length > 0 && (
        <Card as="section" className="mt-2 border border-danger/25 px-4 py-5 sm:px-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-medium text-danger">Overdue, still open</h2>
            <Badge tone="neutral">{overdue.length} to clear</Badge>
          </div>
          <div className="grid gap-2">
            {overdue.map((d) => (
              <DeadlineRow key={d.id} deadline={d} />
            ))}
          </div>
        </Card>
      )}

      <Card as="section" className="mt-2 px-4 py-6 sm:px-6">
        <div className="grid gap-8">
          {[...months.entries()].map(([month, items]) => (
            <MonthBlock key={month} month={month} items={items} />
          ))}
        </div>
      </Card>

      {events.length > 0 && (
        <Card as="section" tone="soft" className="mt-2 px-5 py-6 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-medium">On event</h2>
              <p className="mt-1 text-[13.5px] text-muted">No fixed date until something happens — an allotment, a first hire, a new state.</p>
            </div>
            <Badge tone="outline">Blue lane</Badge>
          </div>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {events.map((d) => (
              <li key={d.id}>
                <Link to={`/deadline/${encodeURIComponent(d.id)}`} className="flex h-full items-start justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-card px-4 py-3 hov:border-line-strong">
                  <div>
                    <p className="text-[14px] font-medium">{d.name}</p>
                    <p className="mt-1 text-[12.5px] text-muted">{d.event_label}</p>
                  </div>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card as="section" className="mt-2 flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <div>
          <p className="text-[15px] font-medium">Want this in Google Calendar or Outlook?</p>
          <p className="mt-1 text-[13.5px] text-muted">The .ics file carries every open deadline with a reminder 30 days ahead.</p>
        </div>
        <Button variant="outline" onClick={() => void download()} loading={downloading} icon={<Download className="size-4" />}>
          Download the calendar file
        </Button>
      </Card>

      {summary.urgent > 0 && (
        <p className="px-3 py-2 text-[12.5px] text-muted">
          {summary.urgent} urgent · reminders on the{' '}
          <Link to="/reminders" className="text-violet hov:underline">
            reminders page
          </Link>{' '}
          · colours always carry a text label too.
        </p>
      )}

      <p className="mt-2 px-3 pb-1 text-[12px] text-muted">
        Showing {dated.length} dated entries and {events.length} event items
      </p>

      <Footer />
    </Shell>
  )
}
