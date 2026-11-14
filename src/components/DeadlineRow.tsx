import { ArrowUpRight, FileCheck2 } from 'lucide-react'
import { Link } from 'react-router'

import { formatDate } from '../shared/format'
import { checklistFor, checklistProgress } from '../shared/documents'
import type { Deadline } from '../shared/types'
import { cx } from '../lib/cx'
import { useTracker } from '../lib/tracker'
import { ColourDot, GroupTag, UrgencyTag } from './Status'

/** One calendar entry: what, when, who it is owed to, and what happens if late. */
export function DeadlineRow({ deadline, showAuthority = true }: { deadline: Deadline; showAuthority?: boolean }) {
  const { company, state } = useTracker()
  const items = checklistFor(deadline, company, state.ticked[deadline.id] ?? [])
  const progress = checklistProgress(items)

  return (
    <Link
      to={`/deadline/${encodeURIComponent(deadline.id)}`}
      className="group grid gap-2 rounded-[var(--radius-control)] border border-line bg-card px-4 py-3.5 transition-[border-color,box-shadow] duration-[var(--duration-fast)] hov:border-line-strong hov:shadow-[var(--shadow-card)] sm:grid-cols-[7.5rem_1fr_auto] sm:items-center sm:gap-4"
    >
      <div className="flex items-center gap-2 sm:block">
        <ColourDot colour={deadline.colour} className="sm:hidden" />
        <p className="text-[14px] font-medium tabular-nums">{deadline.due_date ? formatDate(deadline.due_date) : 'On event'}</p>
        <p className="caps text-muted sm:mt-1">{deadline.due_date ? deadline.due_date.slice(0, 4) : 'no fixed date'}</p>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium tracking-[-0.02em]">{deadline.name}</p>
          <GroupTag group={deadline.group} />
        </div>
        <p className="mt-1.5 line-clamp-1 text-[13.5px] text-muted">
          {showAuthority && <span className="text-ink-2">{deadline.authority}</span>}
          {showAuthority && ' · '}
          {deadline.penalty}
        </p>
        {deadline.status !== 'done' && (
          <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
            <FileCheck2 className="size-3.5" aria-hidden />
            {progress.ready} of {progress.total} documents ready
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <UrgencyTag deadline={deadline} />
        <ArrowUpRight className={cx('size-4 shrink-0 text-faint transition-transform duration-[var(--duration-base)] group-hov:-translate-y-0.5 group-hov:translate-x-0.5')} aria-hidden />
      </div>
    </Link>
  )
}

export function Facts({ facts }: { facts: { label: string; value: string }[] }) {
  if (!facts.length) return null
  return (
    <dl className="flex flex-wrap gap-2">
      {facts.map((f) => (
        <div key={`${f.label}-${f.value}`} className="round inline-flex items-center gap-2 rounded-full bg-soft px-3 py-1.5 text-[13px]">
          <dt className="sr-only">{f.label}: </dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}
