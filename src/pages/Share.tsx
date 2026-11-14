import { Check, Copy, Eye, Link2, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useDocumentTitle } from '../lib/storage'
import { newId, useTracker } from '../lib/tracker'
import { postJson } from '../lib/api'
import { GROUP_LABELS } from '../shared/catalogue'
import { addDays, formatDate, formatDateTime } from '../shared/format'
import type { ObligationGroup, ShareLink, SharePermission } from '../shared/types'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, Chip, EmptyState } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Footer } from '../components/Footer'
import { FormMessage } from '../components/Field'
import { useToast } from '../components/Overlay'
import { cx } from '../lib/cx'

export function SharePage() {
  useDocumentTitle('Share with your CA')
  const { state, deadlines, set, log } = useTracker()
  const toast = useToast()
  const [permission, setPermission] = useState<SharePermission>('view')
  const [scope, setScope] = useState<ObligationGroup[]>([])
  const [days, setDays] = useState('30')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const groups = [...new Set(deadlines.map((d) => d.group))]

  const create = async () => {
    setBusy(true)
    setError('')
    const expires_at = days === 'never' ? null : addDays(new Date().toISOString().slice(0, 10), Number(days))
    const res = await postJson<{ token: string; token_hash: string }>('/api/share', { permission, scope: scope.length ? scope : 'all', expires_at })
    if (!res.ok) {
      setBusy(false)
      setError(res.error)
      return
    }
    const link: ShareLink = {
      id: newId(),
      token: res.data.token,
      token_hash: res.data.token_hash,
      permission,
      scope: scope.length ? scope : 'all',
      expires_at,
      revoked_at: null,
      created_at: new Date().toISOString(),
    }
    set({ shares: [link, ...state.shares] })
    log('Created a share link', `${permission === 'mark_done' ? 'View and mark done' : 'View only'}${expires_at ? `, expires ${formatDate(expires_at)}` : ', no expiry'}`)
    setBusy(false)
    toast('Link created. Only its hash is kept with the record.')
  }

  const copy = async (link: ShareLink) => {
    if (!link.token) return
    const url = `${window.location.origin}/s/${link.token}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(link.id)
      setTimeout(() => setCopied(null), 2000)
      toast('Link copied.')
    } catch {
      setError('Could not use the clipboard. Open the link from the list instead.')
    }
  }

  const revoke = async (link: ShareLink) => {
    await postJson('/api/share/revoke', { id: link.id })
    set({ shares: state.shares.map((s) => (s.id === link.id ? { ...s, revoked_at: new Date().toISOString() } : s)) })
    log('Revoked a share link', link.id)
    toast('Revoked. The link stops working immediately.')
  }

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="Share"
        title="Bring in your CA"
        intro="A random 128-bit link, stored only as a hash, scoped to everything or to chosen categories. View only, or view and mark done. Everything the CA does lands in the activity log."
      />

      <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_1.2fr]">
        <Card as="section" className="px-5 py-6 sm:px-7">
          <h2 className="text-[16px] font-medium tracking-[-0.02em]">Create a link</h2>
          <fieldset className="mt-4">
            <legend className="mb-2 text-[13px] font-medium text-muted">Permission</legend>
            <div className="grid gap-2">
              {(
                [
                  { value: 'view', title: 'View only', body: 'Read the calendar, checklists and folders. Cannot mark anything done.' },
                  { value: 'mark_done', title: 'View and mark done', body: 'Everything above, plus marking deadlines complete.' },
                ] as { value: SharePermission; title: string; body: string }[]
              ).map((option) => (
                <label
                  key={option.value}
                  className={cx(
                    'round flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border px-4 py-3 transition-colors',
                    permission === option.value ? 'border-violet bg-violet-soft/60' : 'border-line-strong hov:border-ink/40',
                  )}
                >
                  <input
                    type="radio"
                    name="permission"
                    value={option.value}
                    checked={permission === option.value}
                    onChange={() => setPermission(option.value)}
                    className="mt-1 size-4 accent-[var(--color-violet)]"
                  />
                  <span>
                    <span className="block text-[14px] font-medium">{option.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{option.body}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-5">
            <p className="mb-2 text-[13px] font-medium text-muted">Scope</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip selected={scope.length === 0} onClick={() => setScope([])} className="h-9 px-3.5 text-[13px]">
                Whole company
              </Chip>
              {groups.map((g) => (
                <Chip
                  key={g}
                  selected={scope.includes(g)}
                  onClick={() => setScope(scope.includes(g) ? scope.filter((s) => s !== g) : [...scope, g])}
                  className="h-9 px-3.5 text-[13px]"
                >
                  {GROUP_LABELS[g]}
                </Chip>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <label htmlFor="expiry" className="mb-2 block text-[13px] font-medium text-muted">
              Expires
            </label>
            <select
              id="expiry"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="h-11 w-full appearance-none rounded-[var(--radius-control)] border border-line-strong bg-card px-3.5 text-[14px] focus:border-violet focus:shadow-[var(--shadow-focus)] focus:outline-none"
            >
              <option value="7">In 7 days</option>
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="never">No expiry</option>
            </select>
          </div>

          {error && (
            <div className="mt-4">
              <FormMessage tone="error">{error}</FormMessage>
            </div>
          )}

          <Button variant="violet" className="mt-5 w-full" onClick={() => void create()} loading={busy} icon={<Link2 className="size-4" />}>
            Create the link
          </Button>

          <div className="mt-5 flex gap-2 rounded-[var(--radius-control)] bg-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span>
              In this build the founder’s record lives in the browser, so an open link resolves on this device only. A hosted deployment stores the hash server-side and resolves it anywhere.
            </span>
          </div>
        </Card>

        <Card as="section" className="px-5 py-6 sm:px-7">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-medium tracking-[-0.02em]">Active links</h2>
            <Badge tone="neutral">{state.shares.filter((s) => !s.revoked_at).length}</Badge>
          </div>

          {!state.shares.length ? (
            <EmptyState title="No links yet" body="Create one and open it: the CA view is read-only, scoped, and logs every action back here." />
          ) : (
            <ul className="mt-4 grid gap-2">
              {state.shares.map((link) => {
                const expired = link.expires_at ? link.expires_at < state.today : false
                const revoked = Boolean(link.revoked_at)
                return (
                  <li key={link.id} className="rounded-[var(--radius-control)] border border-line px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-[13.5px] font-medium">
                          <Eye className="size-3.5 text-muted" aria-hidden />
                          {link.permission === 'mark_done' ? 'View and mark done' : 'View only'}
                        </p>
                        <p className="mt-0.5 truncate text-[12px] text-muted">
                          {link.scope === 'all' ? 'Whole company' : link.scope.map((s) => GROUP_LABELS[s]).join(', ')} ·{' '}
                          {link.expires_at ? `expires ${formatDate(link.expires_at)}` : 'no expiry'}
                        </p>
                      </div>
                      <Badge tone={revoked ? 'outline' : expired ? 'neutral' : 'success'}>{revoked ? 'Revoked' : expired ? 'Expired' : 'Active'}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {link.token && !revoked && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => void copy(link)} icon={copied === link.id ? <Check className="size-4" /> : <Copy className="size-4" />}>
                            {copied === link.id ? 'Copied' : 'Copy link'}
                          </Button>
                          <ButtonLink to={`/s/${link.token}`} variant="ghost" size="sm">
                            Open the CA view
                          </ButtonLink>
                        </>
                      )}
                      {!revoked && (
                        <Button variant="ghost" size="sm" onClick={() => void revoke(link)} icon={<Trash2 className="size-4" />}>
                          Revoke
                        </Button>
                      )}
                    </div>
                    <p className="mt-2 truncate text-[11px] text-faint">hash {link.token_hash.slice(0, 24)}…</p>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card as="section" className="mt-2 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-medium tracking-[-0.02em]">Activity log</h2>
            <p className="mt-1 text-[13px] text-muted">Profile changes, shares, downloads and every CA action.</p>
          </div>
          <Link to="/ca" className="caps text-violet hov:text-violet-deep">
            No CA yet? Match one
          </Link>
        </div>
        {!state.activity.length ? (
          <p className="mt-4 text-[13.5px] text-muted">Nothing yet. The log starts with the first change.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {state.activity.slice(0, 12).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <div>
                  <p className="text-[13.5px] font-medium">
                    {entry.action} <span className="font-normal text-muted">· {entry.actor}</span>
                  </p>
                  <p className="text-[12.5px] text-muted">{entry.detail}</p>
                </div>
                <span className="text-[11.5px] text-faint tabular-nums">{formatDateTime(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Footer />
    </Shell>
  )
}
