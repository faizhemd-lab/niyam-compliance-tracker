import { ArrowRight, Bot, Check, Cpu, FileStack, Loader2, Send, ShieldCheck, Sunrise, Trash2, Wrench, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'

import { QUICK_PROMPTS } from '../lib/messages'
import { getJson, postJson } from '../lib/api'
import { useDocumentTitle } from '../lib/storage'
import { useTracker, type TrackerState } from '../lib/tracker'
import { localBrain, type AgentReply, type ModelStatus } from '../shared/agent'
import { factRows, missingFacts, suggestedFacts } from '../shared/knowledge'
import { formatDate } from '../shared/format'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, Chip, Logo } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Footer } from '../components/Footer'
import { useToast } from '../components/Overlay'
import { cx } from '../lib/cx'

const SOURCE_LABEL: Record<string, string> = {
  interview: 'you said',
  agent: 'from chat',
  import: 'imported',
  manual: 'edited',
  document: 'document',
}

export function Agent() {
  useDocumentTitle('Your compliance agent')
  const { state, set, knowledge, company, obligations, summary, adopt, flush, reset } = useTracker()
  const toast = useToast()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState<string | null>(null)
  const [model, setModel] = useState<ModelStatus | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [params] = useSearchParams()
  const endRef = useRef<HTMLDivElement>(null)
  const sentAsk = useRef(false)

  const sections = useMemo(() => factRows(knowledge), [knowledge])
  const missing = missingFacts(knowledge)
  const suggested = suggestedFacts(knowledge)

  useEffect(() => {
    void getJson<ModelStatus>('/api/agent/status').then((res) =>
      setModel(res.ok ? res.data : { configured: false, connected: false, engine: 'on-server deterministic brain' }),
    )
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [state.agentMessages.length, busy])

  const announce = (reply: AgentReply) => {
    if (reply.errors.length) toast(reply.errors[0].message)
    else if (reply.proposed.length) toast('The agent is waiting for your approval.')
    else if (reply.drafted?.files) toast(`${reply.drafted.files} drafts compiled. Every file is marked DRAFT.`)
  }

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    setInput('')
    setWaiting(text)
    setBusy(true)
    // The agent reads the record from the server, so local edits go first.
    await flush()

    const res = await postJson<AgentReply & { saved_at: string }>('/api/agent/message', { message: text, today: state.today })
    if (res.ok) {
      adopt(res.data.record, res.data.saved_at)
      setModel(res.data.model)
      announce(res.data)
    } else if (res.status === 409 || res.status === 401 || res.status === 403) {
      toast(res.error)
      setInput(text)
    } else {
      // The Worker or its record store is unreachable: run the same brain here.
      const fallback = localBrain({ record: state, message: text }, 'browser fallback')
      set(fallback.record)
      announce(fallback)
      toast('The app server did not answer, so the agent ran in your browser. Your changes will sync when it is back.')
    }
    setWaiting(null)
    setBusy(false)
  }

  const decide = async (id: string, approve: boolean) => {
    if (busy) return
    setBusy(true)
    await flush()
    const res = await postJson<{ ok: boolean; message: string; record: TrackerState; saved_at: string }>('/api/agent/approve', { id, approve })
    if (res.ok) {
      adopt(res.data.record, res.data.saved_at)
      toast(res.data.message)
    } else {
      toast(res.error)
    }
    setBusy(false)
  }

  const runMorningCheck = async () => {
    if (busy) return
    setBusy(true)
    await flush()
    const res = await postJson<{ record: TrackerState; saved_at: string; report: { reminders: number; drafted_folders: number; overdue: number } }>(
      '/api/agent/autopilot',
      { today: state.today },
    )
    if (res.ok) {
      adopt(res.data.record, res.data.saved_at)
      const r = res.data.report
      toast(`Morning check: ${r.reminders} reminders, ${r.drafted_folders} folders drafted, ${r.overdue} overdue.`)
    } else {
      toast(res.error)
    }
    setBusy(false)
  }

  useEffect(() => {
    const ask = params.get('ask')
    if (ask && !sentAsk.current) {
      sentAsk.current = true
      void send(ask)
    }
    // Only the first visit should auto-send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  return (
    <Shell>
      <Header />
      <PageHead
        eyebrow="Your agent"
        title="Talk to the business"
        intro="Tell the agent what changed, ask what is due, or ask it to draft a filing. It keeps one record of the business on this server and every answer or draft is built from that record."
        actions={
          <>
            <Badge tone={model?.connected ? 'success' : 'neutral'}>
              {model?.connected ? `Local model: ${model.model ?? 'connected'}` : model?.configured ? 'Local model unreachable' : 'On-server brain'}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="size-4" />}
              onClick={() => {
                reset()
                sentAsk.current = true
                toast('Record cleared. Start with the company name and type.')
              }}
            >
              Clear
            </Button>
          </>
        }
      >
        <div className="mt-6 flex flex-wrap gap-2 text-[13px]">
          <Badge tone="violet">{Object.keys(knowledge.facts).length} facts known</Badge>
          <Badge tone="outline">{obligations.length} obligations</Badge>
          <Badge tone={missing.length ? 'outline' : 'success'}>{missing.length ? `${missing.length} required facts missing` : 'Rules can run'}</Badge>
          {company.name && <span className="self-center text-muted">{company.name}</span>}
        </div>
      </PageHead>

      <div className="mt-2 grid gap-2 lg:grid-cols-[1.5fr_1fr]">
        <Card as="section" className="flex min-h-[36rem] flex-col px-4 pt-5 pb-4 sm:px-6">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2.5">
              <span className="round grid size-9 place-items-center rounded-full bg-violet text-white">
                <Bot className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-[14px] font-medium leading-tight">Compliance agent</p>
                <p className="text-[12px] text-muted">{model?.connected ? 'Self-hosted model · tool calls · validated writes' : 'On-server brain · no external model'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowLog(!showLog)} className="text-[12.5px] text-muted hov:text-ink">
                {showLog ? 'Hide tool log' : 'Tool log'}
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto py-5" aria-live="polite" aria-label="Conversation">
            {state.agentMessages.map((message) => (
              <div key={message.id} className={cx('flex', message.role === 'founder' ? 'justify-end' : 'justify-start')}>
                <div className={cx('max-w-[88%]', message.role === 'founder' && 'text-right')}>
                  <div
                    className={cx(
                      'round inline-block rounded-[22px] px-4 py-3 text-left text-[14.5px] leading-relaxed whitespace-pre-wrap',
                      message.role === 'founder' ? 'bg-ink text-white' : 'bg-soft text-ink',
                    )}
                  >
                    {message.text}
                  </div>

                  {message.changes && message.changes.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {message.changes.map((c) => (
                        <li key={`${message.id}-${c.label}`} className="round inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[11.5px] text-success">
                          {c.label} → {c.to}
                        </li>
                      ))}
                    </ul>
                  )}

                  {message.calls && message.calls.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {message.calls.map((call, i) => (
                        <li key={`${message.id}-call-${i}`} className="round inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-muted">
                          <Wrench className="size-3" aria-hidden />
                          <span className="font-medium text-ink-2">{call.name}</span>
                          {call.summary}
                        </li>
                      ))}
                    </ul>
                  )}

                  {message.actions && message.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {message.actions.map((action) => (
                        <Link key={`${message.id}-${action.to}-${action.label}`} to={action.to} className="inline-flex items-center gap-1 text-[13px] font-medium text-violet hov:text-violet-deep">
                          {action.label}
                          <ArrowRight className="size-3.5" aria-hidden />
                        </Link>
                      ))}
                    </div>
                  )}

                  {message.engine && (
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-faint">
                      {message.autopilot && <Sunrise className="size-3" aria-hidden />}
                      {message.autopilot ? `Autopilot · ${formatDate(message.at.slice(0, 10))}` : message.engine}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {waiting && (
              <div className="flex justify-end">
                <div className="round inline-block max-w-[88%] rounded-[22px] bg-ink px-4 py-3 text-left text-[14.5px] leading-relaxed whitespace-pre-wrap text-white opacity-80">
                  {waiting}
                </div>
              </div>
            )}
            {busy && (
              <p className="flex items-center gap-2 text-[13px] text-muted">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Reading the record and picking a tool…
              </p>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-line pt-3">
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {QUICK_PROMPTS.slice(0, 4).map((prompt) => (
                <Chip key={prompt} onClick={() => void send(prompt)} disabled={busy} className="h-8 shrink-0 px-3 text-[12.5px]">
                  {prompt.length > 46 ? `${prompt.slice(0, 44)}…` : prompt}
                </Chip>
              ))}
            </div>
            <form onSubmit={onSubmit} className="flex items-end gap-2">
              <label htmlFor="agent-message" className="sr-only">
                Message the agent
              </label>
              <textarea
                id="agent-message"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send(input)
                  }
                }}
                placeholder="Tell the agent something, or ask it to draft a filing"
                className="min-h-11 w-full resize-none rounded-[var(--radius-control)] border border-line-strong bg-card px-4 py-2.5 text-[15px] placeholder:text-muted/80 focus:border-violet focus:shadow-[var(--shadow-focus)] focus:outline-none"
              />
              <Button type="submit" variant="violet" className="size-12 shrink-0 px-0" loading={busy} aria-label="Send message">
                <Send className="size-4" aria-hidden />
              </Button>
            </form>
            <p className="mt-2 text-[11.5px] text-muted">Guidance, not legal advice. The agent drafts supporting documents; it never files on a government portal.</p>
          </div>
        </Card>

        <div className="grid content-start gap-2">
          {state.pending.length > 0 && (
            <Card as="section" className="border border-violet/40 px-5 py-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-violet" aria-hidden />
                <h2 className="text-[15px] font-medium">Waiting for your approval</h2>
              </div>
              <p className="mt-1 text-[12.5px] text-muted">The agent never shares your record or removes access on its own.</p>
              <ul className="mt-3 space-y-3">
                {state.pending.map((p) => (
                  <li key={p.id} className="rounded-[var(--radius-control)] border border-line px-3.5 py-3">
                    <p className="text-[13px] leading-snug">{p.summary}</p>
                    <div className="mt-2 flex gap-2">
                      <Button variant="violet" size="sm" icon={<Check className="size-4" />} disabled={busy} onClick={() => void decide(p.id, true)}>
                        Approve
                      </Button>
                      <Button variant="ghost" size="sm" icon={<X className="size-4" />} disabled={busy} onClick={() => void decide(p.id, false)}>
                        Decline
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card as="section" className="px-5 py-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-medium">What the agent knows</h2>
              <Link to="/company" className="text-[13px] text-violet hov:text-violet-deep">
                Edit
              </Link>
            </div>
            {company.name ? (
              <p className="mt-1 text-[12.5px] text-muted">{company.name}</p>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted">Nothing yet. Say the name, type and state in one line.</p>
            )}

            <div className="mt-3 divide-y divide-line">
              {sections.map((section) => {
                const known = section.rows.filter((r) => r.text)
                if (!known.length) return null
                return (
                  <div key={section.key} className="py-3">
                    <p className="caps mb-1.5 text-muted">{section.label}</p>
                    <dl className="grid gap-1">
                      {known.map((row) => (
                        <div key={row.spec.key} className="flex items-baseline justify-between gap-3">
                          <dt className="text-[12.5px] text-muted">{row.spec.label}</dt>
                          <dd className="flex items-baseline gap-1.5 text-right">
                            <span className="text-[12.5px] font-medium">{row.text}</span>
                            {row.fact && <span className="text-[10.5px] text-faint">{SOURCE_LABEL[row.fact.source] ?? row.fact.source}</span>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )
              })}
              {!Object.keys(knowledge.facts).length && <p className="py-3 text-[13px] text-muted">The record is empty.</p>}
            </div>

            {missing.length > 0 && (
              <div className="mt-2 rounded-[var(--radius-control)] border border-line bg-soft px-3.5 py-3">
                <p className="text-[12.5px] font-medium">Still needed before rules can run</p>
                <ul className="mt-1 space-y-1">
                  {missing.map((f) => (
                    <li key={f.key} className="text-[12px] text-muted">
                      {f.ask}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {missing.length === 0 && suggested.length > 0 && (
              <div className="mt-2 rounded-[var(--radius-control)] border border-line px-3.5 py-3">
                <p className="text-[12.5px] font-medium">Would improve the drafts</p>
                <ul className="mt-1 space-y-1">
                  {suggested.slice(0, 3).map((f) => (
                    <li key={f.key} className="text-[12px] text-muted">
                      {f.ask}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card as="section" className="px-5 py-5">
            <div className="flex items-center gap-2">
              <Cpu className="size-4 text-violet" aria-hidden />
              <h2 className="text-[15px] font-medium">Runs on this server</h2>
            </div>
            <dl className="mt-2 divide-y divide-line text-[12.5px]">
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-muted">Engine</dt>
                <dd className="text-right font-medium">{model?.engine ?? 'checking…'}</dd>
              </div>
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-muted">Model</dt>
                <dd className="text-right font-medium">{model?.model ?? 'none configured'}</dd>
              </div>
              <div className="flex justify-between gap-3 py-1.5">
                <dt className="text-muted">Outbound calls</dt>
                <dd className="text-right font-medium">{model?.connected ? 'to your model server only' : 'none'}</dd>
              </div>
            </dl>
            {model?.detail && <p className="mt-2 text-[11.5px] text-[#8a5207]">{model.detail}</p>}
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              {model?.connected
                ? 'The model runs on your hardware and the app talks to it over the local network. PAN, GSTIN, phone and email are masked before the prompt is built.'
                : 'No model server is configured, so the agent runs its deterministic brain in the Worker: the same tools, validation and record, just no language model. Point MODEL_BASE_URL at Ollama or vLLM to switch.'}
            </p>
            {!model?.connected && (
              <pre className="mt-3 overflow-x-auto rounded-[var(--radius-xs)] bg-night p-3 text-[11px] leading-relaxed text-white/85">{`# .dev.vars
MODEL_BASE_URL=http://localhost:11434/v1
MODEL_NAME=qwen2.5:7b`}</pre>
            )}
          </Card>

          <Card as="section" className="px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sunrise className="size-4 text-violet" aria-hidden />
                <h2 className="text-[15px] font-medium">Autopilot</h2>
              </div>
              <Badge tone={state.autopilot.enabled ? 'success' : 'neutral'}>{state.autopilot.enabled ? 'On' : 'Off'}</Badge>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Every morning at 09:00 IST the agent checks your record on the server: it queues due reminders, drafts folders for anything due within{' '}
              {state.autopilot.draft_within_days} days and leaves a briefing here. It never marks a filing done or shares anything on its own.
            </p>
            <p className="mt-2 text-[11.5px] text-muted">
              {state.autopilot.last_run ? `Last ran ${formatDate(state.autopilot.last_run)}` : 'Has not run yet'}
            </p>
            <div className="mt-3 grid gap-2">
              <Button variant="outline" size="sm" icon={<Sunrise className="size-4" />} disabled={busy} onClick={() => void runMorningCheck()}>
                Run the morning check now
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => set({ autopilot: { ...state.autopilot, enabled: !state.autopilot.enabled } })}
              >
                {state.autopilot.enabled ? 'Pause autopilot' : 'Turn autopilot on'}
              </Button>
            </div>
          </Card>

          <Card as="section" className="px-5 py-5">
            <h2 className="text-[15px] font-medium">One-click jobs</h2>
            <p className="mt-1 text-[12.5px] text-muted">These ask the agent, which reads your record on the server.</p>
            <div className="mt-3 grid gap-2">
              <Button
                variant="violet"
                size="sm"
                icon={<FileStack className="size-4" />}
                disabled={busy || !obligations.length}
                onClick={() => void send('Draft all documents for every open filing')}
              >
                Draft everything open
              </Button>
              <Button variant="outline" size="sm" icon={<ArrowRight className="size-4" />} disabled={busy || !obligations.length} onClick={() => void send('What is due next?')}>
                What is due next?
              </Button>
              <ButtonLink to="/documents" variant="ghost" size="sm">
                {state.generated.length} compiled files
              </ButtonLink>
            </div>
            <p className="mt-3 text-[11.5px] text-muted">{summary.total} deadlines · {summary.urgent} urgent · {summary.events} waiting on an event</p>
          </Card>

          {showLog && (
            <Card as="section" tone="soft" className="px-5 py-5">
              <p className="caps mb-2 text-muted">Tool log</p>
              <ul className="space-y-1.5">
                {state.agentMessages
                  .flatMap((m) => m.calls ?? [])
                  .slice(-12)
                  .map((call, i) => (
                    <li key={`${call.name}-${i}`} className="text-[12px] leading-snug">
                      <span className="font-medium">{call.name}</span> · {call.summary}
                      {!call.ok && <span className="text-danger"> · rejected</span>}
                    </li>
                  ))}
                {!state.agentMessages.some((m) => m.calls?.length) && <li className="text-[12px] text-muted">No tool calls yet.</li>}
              </ul>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
                <Logo className="[&_svg]:size-3.5" />
                Every write is validated against the field registry.
              </p>
            </Card>
          )}
        </div>
      </div>

      <Footer />
    </Shell>
  )
}
