import { Check, Lock, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'

import { getJson, postJson } from '../lib/api'
import { useDocumentTitle } from '../lib/storage'
import { GROUP_LABELS } from '../shared/catalogue'
import { formatDate } from '../shared/format'
import type { Deadline } from '../shared/types'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Footer } from '../components/Footer'
import { useToast } from '../components/Overlay'
import { ColourDot, GroupTag, SummaryStrip, UrgencyTag } from '../components/Status'

type ChecklistItem = { label: string; state: 'have' | 'generate' | 'missing' }

type SharedPayload = {
  permission: 'view' | 'mark_done'
  scope: 'all' | string[]
  expires_at: string | null
  company: string
  today: string
  deadlines: Deadline[]
  summary: { total: number; urgent: number; soon: number; later: number; events: number; done: number }
  checklists: Record<string, ChecklistItem[]>
}

type View =
  | { kind: 'loading' }
  | { kind: 'ok'; payload: SharedPayload }
  | { kind: 'inactive'; title: string; intro: string }
  | { kind: 'error'; message: string }

/** The CA's view, resolved on the server from the link token alone. */
export function ShareView() {
  useDocumentTitle('Shared calendar')
  const { token } = useParams()
  const toast = useToast()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) {
      setView({ kind: 'inactive', title: 'This link is not active', intro: 'Ask the founder for a fresh link.' })
      return
    }
    const res = await getJson<SharedPayload>(`/api/share/${encodeURIComponent(token)}`)
    if (res.ok) {
      setView({ kind: 'ok', payload: res.data })
      return
    }
    if (res.status === 410) {
      setView({
        kind: 'inactive',
        title: res.error.toLowerCase().includes('revoked') ? 'This link was revoked' : 'This link has expired',
        intro: 'The founder can create a new link at any time. Nothing already downloaded is affected.',
      })
      return
    }
    if (res.status === 404) {
      setView({ kind: 'inactive', title: 'This link is not active', intro: 'Check the address with the founder, or ask for a fresh link.' })
      return
    }
    setView({ kind: 'error', message: res.error })
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const markDone = async (id: string) => {
    if (!token) return
    setBusy(true)
    const res = await postJson<{ payload: SharedPayload }>(`/api/share/${encodeURIComponent(token)}/done`, { id })
    setBusy(false)
    if (res.ok && res.data.payload) {
      setView({ kind: 'ok', payload: res.data.payload })
      toast('Marked done. The founder sees this in the activity log.')
      return
    }
    toast(res.ok ? 'That did not save. Try again.' : res.error)
  }

  if (view.kind === 'loading') {
    return (
      <Shell>
        <Header />
        <Card className="mt-2 px-6 py-16">
          <div className="flex items-center justify-center gap-3 text-[14px] text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet border-t-transparent" aria-hidden />
            Opening the shared calendar…
          </div>
        </Card>
        <Footer />
      </Shell>
    )
  }

  if (view.kind === 'inactive' || view.kind === 'error') {
    const title = view.kind === 'inactive' ? view.title : 'We could not open this link'
    const intro = view.kind === 'inactive' ? view.intro : view.message
    return (
      <Shell>
        <Header />
        <PageHead eyebrow="Shared view" title={title} intro={intro} />
        <Card className="mt-2 px-6 py-12">
          <div className="mx-auto max-w-md text-center">
            <Lock className="mx-auto size-8 text-muted" aria-hidden />
            <p className="mt-3 text-[14px] text-muted">Nothing is shown until a link resolves.</p>
            <ButtonLink to="/" variant="outline" size="sm" className="mt-5">
              Go to the landing page
            </ButtonLink>
          </div>
        </Card>
        <Footer />
      </Shell>
    )
  }

  const { payload } = view
  const scopeLine =
    payload.scope === 'all'
      ? 'The whole company is in scope.'
      : `Scope: ${payload.scope.map((group) => GROUP_LABELS[group as keyof typeof GROUP_LABELS] ?? group).join(', ')}.`

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="Shared with you"
        title={payload.company || 'A company calendar'}
        intro={`${payload.permission === 'mark_done' ? 'You can view the calendar and mark items done.' : 'You can view the calendar and checklists.'} ${scopeLine}`}
        actions={
          <>
            <Badge tone="violet">{payload.permission === 'mark_done' ? 'View + mark done' : 'View only'}</Badge>
            {payload.expires_at && <Badge tone="outline">Expires {formatDate(payload.expires_at)}</Badge>}
          </>
        }
      >
        <SummaryStrip summary={payload.summary} />
      </PageHead>

      <div className="mt-2 grid gap-2 lg:grid-cols-[1.4fr_1fr]">
        <Card as="section" className="px-4 py-5 sm:px-6">
          <h2 className="mb-3 text-[15px] font-medium">Calendar</h2>
          {payload.deadlines.length === 0 ? (
            <p className="py-8 text-center text-[13.5px] text-muted">Nothing dated in this scope yet.</p>
          ) : (
            <ul className="grid gap-2">
              {payload.deadlines.map((d) => {
                const items = payload.checklists[d.id] ?? []
                const ready = items.filter((i) => i.state !== 'missing').length
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
                        {items.length > 0 && (
                          <p className="mt-1 text-[12px] text-muted">
                            {ready} of {items.length} documents ready · rule {d.rule_version}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <UrgencyTag deadline={d} />
                        <GroupTag group={d.group} />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {payload.permission === 'mark_done' && d.status !== 'done' ? (
                        <Button variant="outline" size="sm" loading={busy} icon={<Check className="size-3.5" />} onClick={() => void markDone(d.id)}>
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
          )}
        </Card>

        <div className="grid content-start gap-2">
          <Card as="section" className="px-5 py-5">
            <p className="caps mb-2 text-muted">Checklists in scope</p>
            {payload.deadlines.length === 0 ? (
              <p className="text-[13px] text-muted">Nothing to list.</p>
            ) : (
              <ul className="divide-y divide-line">
                {payload.deadlines.slice(0, 6).map((d) => (
                  <li key={d.id} className="py-2.5">
                    <p className="text-[13px] font-medium">{d.short}</p>
                    <p className="mt-1 text-[12px] text-muted">
                      {(payload.checklists[d.id] ?? [])
                        .map((i) => `${i.label}: ${i.state === 'have' ? 'Have' : i.state === 'generate' ? 'Can generate' : 'Missing'}`)
                        .join(' · ') || 'No checklist on file.'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
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
