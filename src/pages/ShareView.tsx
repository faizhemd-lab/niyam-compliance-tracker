import { Check, Download, Lock, ShieldAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useParams } from 'react-router'

import { useDocumentTitle } from '../lib/storage'
import { useTracker } from '../lib/tracker'
import { GROUP_LABELS } from '../shared/catalogue'
import { checklistFor, checklistProgress } from '../shared/documents'
import { formatDate } from '../shared/format'
import { downloadZip } from '../shared/zip'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, EmptyState } from '../components/Bits'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Footer } from '../components/Footer'
import { useToast } from '../components/Overlay'
import { ColourDot, GroupTag, SummaryStrip, UrgencyTag } from '../components/Status'

/** The CA's view, reached from a share link. Read-mostly, scoped by permission. */
export function ShareView() {
  const { token } = useParams()
  const { state, company, deadlines, summary, markDone, log } = useTracker()
  const toast = useToast()
  const logged = useRef(false)
  const share = state.shares.find((s) => s.token === token)
  useDocumentTitle('Shared calendar')

  useEffect(() => {
    if (!logged.current && share && !share.revoked_at) {
      logged.current = true
      log('CA opened the shared calendar', `${share.permission} · ${share.scope === 'all' ? 'whole company' : share.scope.join(', ')}`, 'ca')
    }
  }, [share, log])

  if (!share) {
    return (
      <Shell>
        <Header />
        <PageHead eyebrow="Shared view" title="This link is not active here" intro="A share link resolves against the company that created it. In this build the record lives in the founder’s browser, so open the link on the device that created it." />
        <Card className="mt-2">
          <EmptyState title="Nothing to show" body="If you are the founder, create a fresh link from the Share page and open it there." action={<Badge tone="outline">Link not found</Badge>} />
        </Card>
        <Footer />
      </Shell>
    )
  }

  const expired = share.expires_at ? share.expires_at < state.today : false
  const inactive = Boolean(share.revoked_at) || expired
  const visible = share.scope === 'all' ? deadlines : deadlines.filter((d) => share.scope.includes(d.group))
  const scopedSummary = {
    ...summary,
    total: visible.length,
    urgent: visible.filter((d) => d.colour === 'red').length,
    soon: visible.filter((d) => d.colour === 'amber').length,
    later: visible.filter((d) => d.colour === 'green').length,
    events: visible.filter((d) => d.colour === 'blue').length,
    done: visible.filter((d) => d.status === 'done').length,
  }

  if (inactive) {
    return (
      <Shell>
        <Header />
        <PageHead eyebrow="Shared view" title={share.revoked_at ? 'This link was revoked' : 'This link has expired'} intro="The founder can create a new link at any time. Nothing already downloaded is affected." />
        <Card className="mt-2 px-6 py-10">
          <div className="mx-auto max-w-md text-center">
            <Lock className="mx-auto size-8 text-muted" aria-hidden />
            <p className="mt-3 text-[15px] font-medium">{share.revoked_at ? `Revoked ${formatDate(share.revoked_at.slice(0, 10))}` : `Expired ${formatDate(share.expires_at ?? state.today)}`}</p>
            <p className="mt-1 text-[13.5px] text-muted">Ask the founder for a fresh link.</p>
          </div>
        </Card>
        <Footer />
      </Shell>
    )
  }

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="Shared with you"
        title={company.name || 'A startup'}
        intro={`${share.permission === 'mark_done' ? 'You can view the calendar and mark items done.' : 'You can view the calendar, checklists and folders.'} ${share.scope === 'all' ? 'The whole company is in scope.' : `Scope: ${share.scope.map((s) => GROUP_LABELS[s]).join(', ')}.`}`}
        actions={
          <>
            <Badge tone="violet">{share.permission === 'mark_done' ? 'View + mark done' : 'View only'}</Badge>
            <Button
              variant="outline"
              size="sm"
              icon={<Download className="size-4" />}
              disabled={!state.generated.length}
              onClick={() => {
                downloadZip('shared-folder.zip', state.generated)
                log('CA downloaded the folder', `${state.generated.length} files`, 'ca')
                toast('Downloaded with the DRAFT mark intact.')
              }}
            >
              Download folder
            </Button>
          </>
        }
      >
        <SummaryStrip summary={scopedSummary} />
      </PageHead>

      <div className="mt-2 grid gap-2 lg:grid-cols-[1.4fr_1fr]">
        <Card as="section" className="px-4 py-5 sm:px-6">
          <h2 className="mb-3 text-[15px] font-medium">Calendar</h2>
          <ul className="grid gap-2">
            {visible.map((d) => {
              const items = checklistFor(d, company, state.ticked[d.id] ?? [])
              const progress = checklistProgress(items)
              return (
                <li key={d.id} className="rounded-[var(--radius-control)] border border-line px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 text-[14px] font-medium">
                        <ColourDot colour={d.colour} />
                        {d.name}
                      </p>
                      <p className="mt-1 text-[12.5px] text-muted">
                        {d.authority} · {d.due_date ? formatDate(d.due_date) : d.event_label ?? 'On event'}
                      </p>
                      <p className="mt-1 text-[12px] text-muted">
                        {progress.ready} of {progress.total} documents ready · rule {d.rule_version}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <UrgencyTag deadline={d} />
                      <GroupTag group={d.group} />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {share.permission === 'mark_done' && d.status !== 'done' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<Check className="size-3.5" />}
                        onClick={() => {
                          markDone(d.id, 'ca')
                          log('CA marked an item done', d.name, 'ca')
                          toast('Marked done. The founder sees this in the activity log.')
                        }}
                      >
                        Mark done
                      </Button>
                    ) : (
                      <span className="text-[12px] text-muted">{d.status === 'done' ? 'Done' : 'View only'}</span>
                    )}
                    <span className="text-[12px] text-muted">Penalty: {d.penalty}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>

        <div className="grid content-start gap-2">
          <Card as="section" className="px-5 py-5">
            <p className="caps mb-2 text-muted">Checklists in scope</p>
            <ul className="divide-y divide-line">
              {visible.slice(0, 6).map((d) => (
                <li key={d.id} className="py-2.5">
                  <p className="text-[13px] font-medium">{d.short}</p>
                  <p className="mt-1 text-[12px] text-muted">
                    {checklistFor(d, company, state.ticked[d.id] ?? [])
                      .map((i) => `${i.label}: ${i.state === 'have' ? 'Have' : i.state === 'generate' ? 'Can generate' : 'Missing'}`)
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
          <Card as="section" tone="soft" className="px-5 py-5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-violet" aria-hidden />
              <p className="text-[14px] font-medium">Guidance, not legal advice</p>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              Deadlines and penalties come from a versioned rules catalogue that has not been reviewed against official portals. Verify before filing.
            </p>
          </Card>
        </div>
      </div>

      <Footer />
    </Shell>
  )
}
