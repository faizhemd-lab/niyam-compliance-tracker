import { CalendarClock, Clock, Mail, Play, RotateCcw, Send, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useDocumentTitle } from '../lib/storage'
import { useTracker } from '../lib/tracker'
import { postJson } from '../lib/api'
import { addDays, formatDate, formatDateTime } from '../shared/format'
import { reminderMessage, runReminderJob, upcomingReminders } from '../shared/reminders'
import type { ReminderEntry } from '../shared/types'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, EmptyState } from '../components/Bits'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Footer } from '../components/Footer'
import { useToast } from '../components/Overlay'
import { UrgencyTag } from '../components/Status'

export function Reminders() {
  useDocumentTitle('Reminders')
  const { state, profile, company, deadlines, addReminders, setToday, markDone, log } = useTracker()
  const toast = useToast()
  const [running, setRunning] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)

  const open = deadlines.filter((d) => d.status !== 'done')
  const overdue = open.filter((d) => (d.days_left ?? 0) < 0)
  const next = open
    .filter((d) => d.due_date)
    .slice(0, 6)
    .map((d) => ({ deadline: d, reminders: upcomingReminders(d) }))
  const preview = open.find((d) => d.due_date) ?? deadlines[0]

  const run = async () => {
    setRunning(true)
    const local = runReminderJob(deadlines, state.today, state.reminders, company, company.email || 'founder@example.com')
    const res = await postJson<{ sent: ReminderEntry[] }>('/api/cron/reminders', {
      profile,
      statuses: state.statuses,
      today: state.today,
      log: state.reminders,
      company,
    })
    const sent = res.ok ? res.data.sent : local
    addReminders(sent)
    setRunning(false)
    log('Ran the reminder job', `${sent.length} reminders for ${formatDate(state.today)}`)
    toast(sent.length ? `${sent.length} reminders sent for ${formatDate(state.today)}.` : 'No reminders due today. Nothing sent.')
  }

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="Reminders"
        title="Until it is done"
        intro="Reminders go out 30, 7, 3 and 1 days before a deadline and on the day. After that, daily — until you or your CA mark it done. This page runs the same job against a simulated clock."
        actions={
          <Button variant="violet" size="sm" onClick={() => void run()} loading={running} icon={<Play className="size-4" />}>
            Run today’s 09:00 job
          </Button>
        }
      >
        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label htmlFor="clock" className="caps mb-1.5 block text-muted">
              Simulated today (IST)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="clock"
                type="date"
                value={state.today}
                onChange={(e) => setToday(e.target.value || state.today)}
                className="h-11 rounded-[var(--radius-control)] border border-line-strong bg-card px-3.5 text-[14px] tabular-nums focus:border-violet focus:shadow-[var(--shadow-focus)] focus:outline-none"
              />
              {[7, 30, 90].map((d) => (
                <Button key={d} variant="outline" size="sm" onClick={() => setToday(addDays(state.today, d))}>
                  +{d} days
                </Button>
              ))}
              <Button variant="ghost" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => setToday(new Date().toISOString().slice(0, 10))}>
                Today
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[13px]">
            <Badge tone="neutral">{open.length} open</Badge>
            <Badge tone={overdue.length ? 'outline' : 'success'}>{overdue.length} overdue</Badge>
            <Badge tone="violet">{state.reminders.length} sent in the log</Badge>
          </div>
        </div>
      </PageHead>

      <div className="mt-2 grid gap-2 lg:grid-cols-[1.35fr_1fr]">
        <Card as="section" className="px-5 py-6 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[16px] font-medium tracking-[-0.02em]">Delivery log</h2>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="size-4" />}
              disabled={!state.reminders.length}
              onClick={() => {
                addReminders([])
                setToday(new Date().toISOString().slice(0, 10))
                toast('Log cleared.')
              }}
            >
              Clear
            </Button>
          </div>
          <p className="mt-1 text-[13px] text-muted">Idempotent: the log is the key, so running the job twice never sends the same stage twice.</p>

          {!state.reminders.length ? (
            <div className="mt-3">
              <EmptyState title="No reminders yet" body="Move the clock 30 days ahead, then run the job. Every open deadline inside a reminder window produces one message." />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line border-y border-line">
              {state.reminders.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium">{r.subject}</p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {r.channel} → {r.to} · stage {r.stage} · {formatDateTime(r.sent_at)}
                      </p>
                    </div>
                    <span className="round inline-flex h-6 items-center gap-1.5 rounded-full bg-success/10 px-2 text-[11.5px] font-medium text-success">
                      <Mail className="size-3" aria-hidden />
                      sent
                    </span>
                  </div>
                  <button type="button" onClick={() => setOpened(opened === r.id ? null : r.id)} className="mt-1 text-[12.5px] text-violet hov:underline">
                    {opened === r.id ? 'Hide message' : 'Show message'}
                  </button>
                  {opened === r.id && (
                    <pre className="mt-2 rounded-[var(--radius-control)] bg-soft p-3 text-[12px] leading-relaxed whitespace-pre-wrap">{r.body}</pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid content-start gap-2">
          <Card as="section" className="px-5 py-6">
            <h2 className="text-[16px] font-medium tracking-[-0.02em]">Next sends</h2>
            <p className="mt-1 text-[13px] text-muted">30, 7, 3, 1 and 0 days before each open deadline.</p>
            <ul className="mt-4 grid gap-3">
              {next.map(({ deadline, reminders }) => (
                <li key={deadline.id} className="rounded-[var(--radius-control)] border border-line px-3.5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/deadline/${encodeURIComponent(deadline.id)}`} className="text-[13.5px] font-medium hov:text-violet">
                      {deadline.short}
                    </Link>
                    <UrgencyTag deadline={deadline} />
                  </div>
                  <p className="mt-1 text-[12px] text-muted">
                    {reminders
                      .map((r) => `${r.label}: ${formatDate(r.on)}`)
                      .slice(0, 3)
                      .join(' · ')}
                  </p>
                </li>
              ))}
              {!next.length && <p className="text-[13px] text-muted">No open dated deadlines. Nothing to remind.</p>}
            </ul>
          </Card>

          {preview && (
            <Card as="section" tone="soft" className="px-5 py-6">
              <div className="flex items-center gap-2">
                <Smartphone className="size-4 text-violet" aria-hidden />
                <h2 className="text-[15px] font-medium">WhatsApp preview</h2>
                <Badge tone="outline">Preview only</Badge>
              </div>
              <div className="round mt-3 max-w-sm rounded-[18px] rounded-bl-[4px] bg-card px-3.5 py-3 text-[13px] leading-relaxed shadow-[var(--shadow-card)]">
                {reminderMessage(preview, '3', company).body}
              </div>
              <p className="mt-3 text-[12px] text-muted">
                Email is the live channel. WhatsApp needs an approved business template before launch; this is the copy it would send.
              </p>
            </Card>
          )}

          <Card as="section" className="px-5 py-6">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-violet" aria-hidden />
              <h2 className="text-[15px] font-medium">Why the clock matters</h2>
            </div>
            <ul className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted">
              <li className="flex gap-2">
                <Send className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Moving the clock shows a 30-day reminder, then the daily overdue one, without waiting a month.
              </li>
              <li className="flex gap-2">
                <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Marking an item done removes it from the job immediately, so the next run sends nothing for it.
              </li>
              <li className="flex gap-2">
                <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Failures are retried with back-off; persistent failures surface here rather than disappearing.
              </li>
            </ul>
            {overdue[0] && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  markDone(overdue[0].id, 'founder')
                  log('Marked done from reminders', overdue[0].name)
                  toast(`${overdue[0].short} marked done. Reminders stop.`)
                }}
              >
                Mark {overdue[0].short} done
              </Button>
            )}
          </Card>
        </div>
      </div>

      <Footer />
    </Shell>
  )
}
