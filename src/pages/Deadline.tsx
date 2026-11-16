import { ArrowLeft, Check, CircleHelp, Download, FileCheck2, Play, Share2, Sparkles, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { useDocumentTitle } from '../lib/storage'
import { useTracker } from '../lib/tracker'
import { postJson } from '../lib/api'
import { GROUP_LABELS } from '../shared/catalogue'
import { compileDeadline, checklistFor, checklistProgress } from '../shared/documents'
import { formatDate, formatRupees } from '../shared/format'
import { upcomingReminders } from '../shared/reminders'
import type { DocKey, GeneratedFile } from '../shared/types'
import { downloadZip } from '../shared/zip'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, EmptyState } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { DeadlineRow, Facts } from '../components/DeadlineRow'
import { Footer } from '../components/Footer'
import { useToast } from '../components/Overlay'
import { GroupTag, UrgencyTag } from '../components/Status'
import { Accordion } from '../components/Content'
import { cx } from '../lib/cx'

const STATE_LABEL = { have: 'Have', missing: 'Missing', generate: 'Can be generated' } as const
const STATE_TONE = {
  have: 'bg-success/10 text-success',
  missing: 'bg-danger/10 text-danger',
  generate: 'bg-violet-soft text-violet-deep',
} as const

export function DeadlinePage() {
  const { id } = useParams()
  const deadlineId = decodeURIComponent(id ?? '')
  const { state, company, knowledge, deadlines, markDone, reopen, toggleDoc, addGenerated, log, mergeProfile } = useTracker()
  const toast = useToast()
  const deadline = deadlines.find((d) => d.id === deadlineId)
  useDocumentTitle(deadline?.short ?? 'Deadline')

  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<{ text: string; faithful: boolean; fallback: boolean } | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [folder, setFolder] = useState<string | null>(null)

  if (!deadline) {
    return (
      <Shell>
        <Header />
        <PageHead eyebrow="Deadline" title="That item is not in your calendar" intro="It may no longer apply after a correction, or the link may be from another company." />
        <Card className="mt-2">
          <EmptyState
            title="Not found"
            body="Open the calendar to pick an item from the current rules result."
            action={<ButtonLink to="/calendar" variant="violet" icon={<ArrowLeft className="size-4" />}>Back to the calendar</ButtonLink>}
          />
        </Card>
        <Footer />
      </Shell>
    )
  }

  const ticked = state.ticked[deadline.id] ?? []
  const items = checklistFor(deadline, company, ticked)
  const progress = checklistProgress(items)
  const generated = folder ? state.generated.filter((f) => f.path.startsWith(folder)) : []
  const reminders = upcomingReminders(deadline)

  const compile = async () => {
    setCompiling(true)
    const local = compileDeadline(company, deadline, state.today, ticked, knowledge)
    const res = await postJson<{ files: GeneratedFile[]; missing: string[]; folder: string }>('/api/deadlines/compile', {
      company,
      knowledge,
      deadline,
      today: state.today,
      ticked,
    })
    const result = res.ok ? res.data : local
    addGenerated(result.files)
    setFolder(result.folder)
    setCompiling(false)
    log('Compiled documents', `${result.files.length} drafts for ${deadline.name}`)
    toast(
      result.missing.length
        ? `Drafts compiled. ${result.missing.join(', ')} missing from the record.`
        : `${result.files.length} drafts compiled into ${result.folder}`,
    )
  }

  const explain = async () => {
    setExplaining(true)
    const record = {
      name: deadline.name,
      authority: deadline.authority,
      plain: deadline.plain,
      reason: deadline.reason,
      penalty: deadline.penalty,
      how_to_file: deadline.how_to_file,
      due: deadline.due_date ? formatDate(deadline.due_date) : 'On event',
      rule_version: deadline.rule_version,
    }
    const res = await postJson<{ text: string; faithful: boolean; fallback: boolean }>('/api/explain', {
      record,
      language: 'en',
      question: question || undefined,
    })
    setAnswer(
      res.ok
        ? res.data
        : {
            text: `${record.plain} It applies because ${record.reason}. If it is late: ${record.penalty}. Next step: ${record.how_to_file}`,
            faithful: true,
            fallback: false,
          },
    )
    setExplaining(false)
  }

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow={`${GROUP_LABELS[deadline.group]} · rule ${deadline.rule_version}`}
        title={deadline.short}
        intro={deadline.reason}
        actions={
          <>
            <ButtonLink to="/calendar" variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />}>
              Calendar
            </ButtonLink>
            {deadline.status === 'done' ? (
              <Button
                variant="outline"
                size="sm"
                icon={<Undo2 className="size-4" />}
                onClick={() => {
                  reopen(deadline.id)
                  toast('Reopened. Reminders resume.')
                }}
              >
                Reopen
              </Button>
            ) : (
              <Button
                variant="violet"
                size="sm"
                icon={<Check className="size-4" />}
                onClick={() => {
                  markDone(deadline.id, 'founder')
                  log('Marked done', `${deadline.name} due ${deadline.due_date ?? 'on event'}`)
                  toast('Marked done. Reminders for this item stop now.')
                }}
              >
                Mark done
              </Button>
            )}
          </>
        }
      >
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <UrgencyTag deadline={deadline} />
          <GroupTag group={deadline.group} />
          <Badge tone="outline">{deadline.authority}</Badge>
          {deadline.verified ? <Badge tone="success">Verified rule</Badge> : <Badge tone="neutral">Not yet verified</Badge>}
          {deadline.status === 'done' && (
            <Badge tone="success">
              Done {deadline.done_at ? formatDate(deadline.done_at.slice(0, 10)) : ''} by {deadline.done_by ?? 'you'}
            </Badge>
          )}
        </div>
        <Facts facts={deadline.facts} />
      </PageHead>

      <div className="mt-2 grid gap-2 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-2">
          <Card as="section" className="px-5 py-6 sm:px-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="caps text-muted">Due date</p>
                <p className="mt-1 text-[clamp(1.6rem,1.2rem+1.2vw,2.2rem)] leading-none font-medium tracking-[-0.03em]">
                  {deadline.due_date ? formatDate(deadline.due_date) : 'On event'}
                </p>
                {deadline.event_label && <p className="mt-2 max-w-sm text-[13px] text-muted">{deadline.event_label}</p>}
              </div>
              <div className="text-right">
                <p className="caps text-muted">Owed to</p>
                <p className="mt-1 text-[15px] font-medium">{deadline.authority}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
              <div>
                <p className="caps mb-1.5 text-muted">What it is</p>
                <p className="text-[14.5px] leading-relaxed text-ink-2">{deadline.plain}</p>
              </div>
              <div>
                <p className="caps mb-1.5 text-muted">How to file</p>
                <p className="text-[14.5px] leading-relaxed text-ink-2">{deadline.how_to_file}</p>
              </div>
            </div>

            <div className="mt-5 rounded-[var(--radius-control)] border border-danger/20 bg-danger/[0.035] px-4 py-3">
              <p className="caps text-danger">If it is missed</p>
              <p className="mt-1 text-[14px] leading-relaxed">{deadline.penalty}</p>
              {deadline.penalty_example && <p className="mt-1 text-[12.5px] text-muted">{deadline.penalty_example}. Indicative only.</p>}
            </div>
          </Card>

          <Card as="section" className="px-5 py-6 sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-medium tracking-[-0.02em]">Document checklist</h2>
                <p className="mt-1 text-[13px] text-muted">
                  {progress.ready} of {progress.total} ready. {deadline.documents.length} documents for this filing.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink
                  to={`/agent?ask=${encodeURIComponent(`Draft the documents for ${deadline.short}`)}`}
                  variant="outline"
                  size="sm"
                >
                  Ask the agent
                </ButtonLink>
                <Button variant="solid" size="sm" onClick={() => void compile()} loading={compiling} icon={<Sparkles className="size-4" />}>
                  Compile drafts
                </Button>
              </div>
            </div>

            <ul className="mt-4 divide-y divide-line border-y border-line">
              {items.map((item) => (
                <li key={item.key} className="flex items-center gap-3 py-3">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={item.state === 'have'}
                    aria-label={`Mark ${item.label} ready`}
                    onClick={() => {
                      toggleDoc(deadline.id, item.key as DocKey)
                      log('Updated checklist', `${item.label} on ${deadline.name}`)
                    }}
                    className={cx(
                      'round grid size-6 shrink-0 place-items-center rounded-[7px] border transition-colors',
                      item.state === 'have' ? 'border-violet bg-violet text-white' : 'border-line-strong bg-card hov:border-ink',
                    )}
                  >
                    {item.state === 'have' && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium">{item.label}</p>
                    {item.note && <p className="text-[12.5px] text-muted">{item.note}</p>}
                  </div>
                  <span className={cx('round inline-flex h-7 items-center rounded-full px-2.5 text-[12.5px] font-medium', STATE_TONE[item.state])}>
                    {STATE_LABEL[item.state]}
                  </span>
                </li>
              ))}
            </ul>

            {folder && (
              <div className="mt-4 rounded-[var(--radius-control)] bg-soft px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] font-medium">{folder}</p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<Download className="size-4" />}
                      onClick={() => {
                        downloadZip(`${deadline.short.replace(/\s+/g, '-')}.zip`, generated)
                        toast('Folder downloaded. Every file is marked DRAFT.')
                      }}
                    >
                      Download folder
                    </Button>
                    <ButtonLink to="/documents" variant="ghost" size="sm">
                      All documents
                    </ButtonLink>
                  </div>
                </div>
                <ul className="mt-2 grid gap-1">
                  {generated.map((file) => (
                    <li key={file.path} className="truncate text-[12.5px] text-muted">
                      {file.path.split('/').slice(-1)[0]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card as="section" className="px-5 py-6 sm:px-7">
            <h2 className="text-[16px] font-medium tracking-[-0.02em]">Reminders for this item</h2>
            <p className="mt-1 text-[13px] text-muted">Then daily while overdue, until you or your CA mark it done.</p>
            {reminders.length ? (
              <ol className="mt-4 grid gap-2 sm:grid-cols-2">
                {reminders.map((r) => (
                  <li key={r.stage} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-soft px-3 py-2 text-[13px]">
                    <span>{r.label}</span>
                    <span className="text-muted tabular-nums">{formatDate(r.on)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 rounded-[var(--radius-control)] bg-soft px-4 py-3 text-[13.5px] text-muted">
                {deadline.status === 'done' ? 'Done: no reminders are scheduled for this item.' : 'Event-driven items start reminding once you record the event.'}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink to="/reminders" variant="outline" size="sm" icon={<Play className="size-4" />}>
                Run the reminder job
              </ButtonLink>
              <ButtonLink to="/share" variant="ghost" size="sm" icon={<Share2 className="size-4" />}>
                Share with your CA
              </ButtonLink>
            </div>
          </Card>
        </div>

        <div className="grid content-start gap-2">
          <Card as="section" tone="soft" className="px-5 py-6">
            <div className="flex items-center gap-2">
              <CircleHelp className="size-4 text-violet" aria-hidden />
              <h2 className="text-[16px] font-medium tracking-[-0.02em]">Explain this in simple words</h2>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              The answer is built only from this item’s record, then every number is checked against it. If the check fails, you get the stored text instead.
            </p>
            <label htmlFor="explain" className="sr-only">
              Your question
            </label>
            <textarea
              id="explain"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              placeholder="e.g. what happens if I am two weeks late?"
              className="mt-3 w-full resize-y rounded-[var(--radius-control)] border border-line-strong bg-card px-3.5 py-2.5 text-[14px] focus:border-violet focus:shadow-[var(--shadow-focus)] focus:outline-none"
            />
            <Button variant="violet" size="sm" className="mt-2" onClick={() => void explain()} loading={explaining}>
              Explain
            </Button>
            {answer && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-[14px] leading-relaxed text-ink-2">{answer.text}</p>
                <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
                  <FileCheck2 className="size-3.5" aria-hidden />
                  {answer.fallback ? 'Checked: not answerable from the record, showing stored text' : answer.faithful ? 'Checked: every figure matches the rule record' : 'Answer discarded: figures did not match the record'}
                </p>
                <p className="mt-1 text-[11.5px] text-faint">Guidance, not legal advice.</p>
              </div>
            )}
          </Card>

          <Card as="section" className="px-5 py-6">
            <h2 className="text-[16px] font-medium tracking-[-0.02em]">The record behind this</h2>
            <dl className="mt-3 divide-y divide-line text-[13px]">
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted">Rule</dt>
                <dd className="text-right font-medium">{deadline.rule_id}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted">Version</dt>
                <dd className="text-right font-medium tabular-nums">{deadline.rule_version}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted">Verified on</dt>
                <dd className="text-right font-medium">{deadline.verified ? 'Reviewed' : 'Not yet reviewed'}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted">Documents</dt>
                <dd className="text-right font-medium tabular-nums">{deadline.documents.length}</dd>
              </div>
              {deadline.penalty_example && (
                <div className="flex justify-between gap-3 py-2">
                  <dt className="text-muted">Indicative penalty</dt>
                  <dd className="text-right font-medium">{deadline.penalty_example.replace('about ', '')}</dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-[12px] leading-snug text-muted">
              Rules are versioned data. A reviewer signs each one off with a source link; until then it shows as not yet verified.
            </p>
          </Card>

          <Card as="section" className="px-5 py-6">
            <h2 className="text-[16px] font-medium tracking-[-0.02em]">Urgency states</h2>
            <Accordion
              defaultOpen={null}
              items={[
                { q: 'Why is this colour?', a: `This item is ${deadline.colour}: ${deadline.urgency}. Colour is never the only signal — every entry carries this text label.` },
                { q: 'What does marking done do?', a: 'It records who marked it and when, and removes the item from the reminder job immediately. Reopen it any time.' },
                { q: 'Can I correct the answers behind it?', a: 'Yes. Correcting an answer re-runs the rules engine. Deadlines that no longer apply are removed unless already marked done, and done items keep their status.' },
              ]}
            />
            <p className="mt-4 text-[12px] text-muted">
              {deadline.facts.length} answers triggered this item · {formatRupees(company.turnover ?? 0)} turnover on record
            </p>
            {!company.turnover && (
              <Link to="/company" className="mt-2 inline-flex text-[13px] text-violet hov:underline">
                Add your turnover
              </Link>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => {
                mergeProfile({ incorporated_on: state.today })
                toast('Incorporation date set to today — adjust it on the company page.')
              }}
            >
              Set incorporation date
            </Button>
          </Card>

          <Card as="section" className="px-5 py-5">
            <p className="caps mb-2 text-muted">Nearby</p>
            <div className="grid gap-1.5">
              {deadlines
                .filter((d) => d.id !== deadline.id)
                .slice(0, 3)
                .map((d) => (
                  <DeadlineRow key={d.id} deadline={d} showAuthority={false} />
                ))}
            </div>
          </Card>
        </div>
      </div>

      <Footer />
    </Shell>
  )
}
