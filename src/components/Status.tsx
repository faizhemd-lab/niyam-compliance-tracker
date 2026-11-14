import { AlertTriangle, CalendarClock, CheckCircle2, CircleDot, CloudMoon } from 'lucide-react'

import { GROUP_LABELS } from '../shared/catalogue'
import type { Colour, Deadline, ObligationGroup } from '../shared/types'
import { cx } from '../lib/cx'

export const COLOUR_LABEL: Record<Colour, string> = {
  red: 'Overdue or due within 3 days',
  amber: 'Due in 4 to 30 days',
  green: 'More than 30 days away',
  grey: 'Done',
  blue: 'Waiting on an event',
}

const DOT: Record<Colour, string> = {
  red: 'bg-danger',
  amber: 'bg-[#c2760a]',
  green: 'bg-success',
  grey: 'bg-faint',
  blue: 'bg-[#2563eb]',
}

const TAG: Record<Colour, string> = {
  red: 'bg-danger/10 text-danger',
  amber: 'bg-[#c2760a]/12 text-[#8a5207]',
  green: 'bg-success/10 text-success',
  grey: 'bg-soft text-muted',
  blue: 'bg-[#2563eb]/10 text-[#1d4ed8]',
}

export function ColourDot({ colour, className }: { colour: Colour; className?: string }) {
  return <span aria-hidden className={cx('inline-block size-2.5 shrink-0 rounded-full round', DOT[colour], className)} />
}

export function UrgencyTag({ deadline }: { deadline: Deadline }) {
  return (
    <span className={cx('round inline-flex h-7 items-center gap-2 rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap', TAG[deadline.colour])}>
      <ColourDot colour={deadline.colour} className="size-2" />
      {deadline.urgency}
    </span>
  )
}

export function GroupTag({ group }: { group: ObligationGroup }) {
  return (
    <span className="round inline-flex h-7 items-center rounded-full border border-line-strong px-2.5 text-[12.5px] text-muted whitespace-nowrap">
      {GROUP_LABELS[group]}
    </span>
  )
}

export function SummaryStrip({ summary }: { summary: { total: number; urgent: number; soon: number; later: number; events: number; done: number } }) {
  const parts = [
    { key: 'total', label: 'obligations', value: summary.total, tone: 'text-ink' },
    { key: 'urgent', label: 'need attention now', value: summary.urgent, tone: 'text-danger' },
    { key: 'soon', label: 'this quarter', value: summary.soon, tone: 'text-[#8a5207]' },
    { key: 'later', label: 'later', value: summary.later, tone: 'text-success' },
    { key: 'events', label: 'on event', value: summary.events, tone: 'text-[#1d4ed8]' },
    { key: 'done', label: 'done', value: summary.done, tone: 'text-muted' },
  ].filter((p) => p.value > 0 || p.key === 'total')

  return (
    <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-5 sm:grid-cols-3 lg:grid-cols-6">
      {parts.map((p) => (
        <div key={p.key}>
          <dd className={cx('text-[clamp(1.6rem,1.2rem+1vw,2.2rem)] leading-none font-medium tabular-nums tracking-[-0.04em]', p.tone)}>{p.value}</dd>
          <dt className="caps mt-1.5 text-muted">{p.label}</dt>
        </div>
      ))}
    </dl>
  )
}

export function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted">
      {(Object.keys(COLOUR_LABEL) as Colour[]).map((colour) => (
        <li key={colour} className="flex items-center gap-2">
          <ColourDot colour={colour} />
          <span>{COLOUR_LABEL[colour]}</span>
        </li>
      ))}
    </ul>
  )
}

export function DeadlineIcon({ deadline }: { deadline: Deadline }) {
  const className = 'size-4'
  if (deadline.status === 'done') return <CheckCircle2 className={className} aria-hidden />
  if (deadline.colour === 'blue') return <CloudMoon className={className} aria-hidden />
  if (deadline.colour === 'red') return <AlertTriangle className={className} aria-hidden />
  if (deadline.colour === 'amber') return <CalendarClock className={className} aria-hidden />
  return <CircleDot className={className} aria-hidden />
}
