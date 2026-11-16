import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { getJson, putJson } from './api'
import { SessionSplash, useSession } from './session'
import { CACHE_PREFIX, LEGACY_KEY } from './storage'
import { useToast } from '../components/Overlay'
import {
  applyFacts,
  deriveProfile,
  formatFact,
  knowledgeToCompany,
  FIELD_BY_KEY,
  type FactSource,
  type Knowledge,
  type KnowledgeField,
} from '../shared/knowledge'
import { emptyRecord, newId, todayISO, withDefaults, type AgentChatMessage, type CompanyRecord } from '../shared/record'
import { evaluateRules, missingFields } from '../shared/rules'
import { buildCalendar, summarise } from '../shared/schedule'
import type { ChatMessage, Company, DocKey, GeneratedFile, Profile, ProfileField, ReminderEntry } from '../shared/types'

/** The record as the browser holds it: the same shape the agent works on in D1. */
export type TrackerState = CompanyRecord

export { newId }

/** The pre-sign-in record, read once and then handed to the client's account. */
function readLegacy(): TrackerState | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    return withDefaults(JSON.parse(raw) as Partial<TrackerState>)
  } catch {
    return null
  }
}

/** Stable placeholder, so derived values stay referentially stable while loading. */
const EMPTY = emptyRecord()

type Context = {
  state: TrackerState
  set: (patch: Partial<TrackerState>) => void
  knowledge: Knowledge
  company: Company
  profile: Profile
  obligations: ReturnType<typeof evaluateRules>
  deadlines: ReturnType<typeof buildCalendar>['deadlines']
  summary: ReturnType<typeof summarise>
  needsIncorporation: string[]
  missing: ProfileField[]
  reset: () => void
  mergeProfile: (updates: Partial<Profile>, note?: string) => void
  setKnowledge: (knowledge: Knowledge, note?: string) => void
  applyKnowledge: (patch: Partial<Record<KnowledgeField, unknown>>, source?: FactSource) => { changed: number; errors: string[] }
  addAgentMessage: (message: AgentChatMessage) => void
  markDone: (id: string, by: 'founder' | 'ca') => void
  reopen: (id: string) => void
  toggleDoc: (deadlineId: string, doc: DocKey) => void
  addGenerated: (files: GeneratedFile[]) => void
  log: (action: string, detail: string, actor?: 'founder' | 'ca') => void
  addReminders: (entries: ReminderEntry[]) => void
  setToday: (iso: string) => void
  /** Take a record the server just saved (from the agent), without saving it again. */
  adopt: (record: TrackerState, savedAt: string) => void
  /** Wait until every local change has reached the server. */
  flush: () => Promise<void>
}

const TrackerContext = createContext<Context | null>(null)

/** Map the rules profile back onto knowledge keys, for older callers. */
const PROFILE_TO_FIELD: Partial<Record<ProfileField, KnowledgeField>> = {
  entity: 'entity',
  state: 'state',
  turnover: 'turnover',
  employees: 'employees',
  sells: 'sells',
  gst_registered: 'gst_registered',
  interstate: 'interstate',
  foreign_investment: 'foreign_investment',
  incorporated_on: 'incorporated_on',
}

export function TrackerProvider({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const userId = user?.id ?? null
  const [state, setState] = useState<TrackerState | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const toast = useToast()

  /*
   * Saving. The agent and the daily autopilot write the same D1 row, so every
   * save carries `base` — the saved_at this browser last saw — and the server
   * refuses it if someone saved since. On a refusal the browser takes the
   * server's copy instead of overwriting it.
   */
  const savedAt = useRef<string | null>(null)
  const latest = useRef<TrackerState | null>(null)
  const fromServer = useRef<TrackerState | null>(null)
  const dirty = useRef(false)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const adopt = useCallback((record: TrackerState, at: string | null) => {
    savedAt.current = at
    dirty.current = false
    fromServer.current = record
    setState(record)
  }, [])

  const pull = useCallback(async () => {
    const res = await getJson<{ data: TrackerState | null; saved_at: string | null }>('/api/record')
    if (res.ok && res.data.data && res.data.saved_at !== savedAt.current) adopt(withDefaults(res.data.data), res.data.saved_at)
    return res
  }, [adopt])

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    chain.current = chain.current.then(async () => {
      const data = latest.current
      if (!data || !dirty.current) return
      dirty.current = false
      const res = await putJson<{ saved_at: string }>('/api/record', { data, base: savedAt.current })
      if (res.ok) {
        savedAt.current = res.data.saved_at
        return
      }
      if (res.status === 409) {
        await pull()
        toast('The agent updated your record on the server, so you are now looking at the latest copy.')
        return
      }
      dirty.current = true
    })
    return chain.current
  }, [pull, toast])

  // The server is the source of truth; this only fills the screen while it loads.
  useEffect(() => {
    if (!userId) return
    let alive = true
    setState(null)
    setError('')
    savedAt.current = null
    void (async () => {
      const res = await getJson<{ data: TrackerState | null; saved_at: string | null }>('/api/record')
      if (!alive) return
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (res.data.data) {
        adopt(withDefaults(res.data.data), res.data.saved_at)
        return
      }
      // First sign-in: carry over a record made before sign-in existed, once.
      const legacy = readLegacy()
      if (legacy) {
        const put = await putJson<{ saved_at: string }>('/api/record', { data: legacy, base: null })
        adopt(legacy, put.ok ? put.data.saved_at : null)
        try {
          localStorage.removeItem(LEGACY_KEY)
        } catch {
          /* private mode */
        }
        return
      }
      setState(emptyRecord())
    })()
    return () => {
      alive = false
    }
  }, [userId, attempt, adopt])

  // Persist: a local copy for an instant reload, then a debounced, versioned save.
  useEffect(() => {
    if (!state || !userId) return
    latest.current = state
    try {
      localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify(state))
    } catch {
      /* storage full or private mode */
    }
    if (fromServer.current === state) return
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 700)
  }, [state, userId, flush])

  // Pick up what the agent or the autopilot did while this tab was in the background.
  useEffect(() => {
    if (!userId) return
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !dirty.current) void pull()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [userId, pull])

  const update = useCallback((fn: (current: TrackerState) => TrackerState) => {
    setState((current) => (current ? fn(current) : current))
  }, [])

  const set = useCallback(
    (patch: Partial<TrackerState>) => update((current) => ({ ...current, ...patch })),
    [update],
  )

  const current = state ?? EMPTY
  const profile = useMemo(() => deriveProfile(current.knowledge), [current.knowledge])
  const company = useMemo(() => knowledgeToCompany(current.knowledge), [current.knowledge])
  const obligations = useMemo(() => evaluateRules(profile), [profile])
  const { deadlines, needsIncorporation } = useMemo(
    () => buildCalendar(profile, obligations, current.today, current.statuses),
    [profile, obligations, current.today, current.statuses],
  )
  const summary = useMemo(() => summarise(deadlines), [deadlines])

  const log = useCallback(
    (action: string, detail: string, actor: 'founder' | 'ca' = 'founder') =>
      update((s) => ({
        ...s,
        activity: [{ id: newId(), at: new Date().toISOString(), actor, action, detail }, ...s.activity].slice(0, 80),
      })),
    [update],
  )

  const setKnowledge = useCallback(
    (knowledge: Knowledge, note?: string) =>
      update((s) => ({
        ...s,
        knowledge,
        activity: note
          ? [{ id: newId(), at: new Date().toISOString(), actor: 'founder' as const, action: 'Updated the company record', detail: note }, ...s.activity].slice(0, 80)
          : s.activity,
      })),
    [update],
  )

  const applyKnowledge = useCallback(
    (patch: Partial<Record<KnowledgeField, unknown>>, source: FactSource = 'manual') => {
      let result = { changed: 0, errors: [] as string[] }
      update((s) => {
        const applied = applyFacts(s.knowledge, patch, source)
        result = {
          changed: applied.changed.length,
          errors: applied.errors.map((e) => e.message),
        }
        if (!applied.changed.length && !applied.errors.length) return s
        const detail = applied.changed.map((c) => `${c.label} → ${c.to}`).join(', ')
        return {
          ...s,
          knowledge: applied.knowledge,
          activity: applied.changed.length
            ? [{ id: newId(), at: new Date().toISOString(), actor: 'founder' as const, action: 'Edited the company record', detail }, ...s.activity].slice(0, 80)
            : s.activity,
        }
      })
      return result
    },
    [update],
  )

  const mergeProfile = useCallback(
    (updates: Partial<Profile>, note?: string) => {
      const patch: Partial<Record<KnowledgeField, unknown>> = {}
      for (const [key, value] of Object.entries(updates) as [ProfileField, unknown][]) {
        const field = PROFILE_TO_FIELD[key]
        if (field && value !== undefined) patch[field] = value
      }
      if (!Object.keys(patch).length) return
      update((s) => {
        const applied = applyFacts(s.knowledge, patch, 'manual')
        return {
          ...s,
          knowledge: applied.knowledge,
          activity: note
            ? [{ id: newId(), at: new Date().toISOString(), actor: 'founder' as const, action: 'Updated the company record', detail: note }, ...s.activity].slice(0, 80)
            : s.activity,
        }
      })
    },
    [update],
  )

  if (error) {
    return (
      <div className="flex min-h-svh items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="caps text-violet">Your record</p>
          <h1 className="display mt-2 text-3xl leading-tight">We could not load your record</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-muted">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="mt-5 rounded-full bg-violet px-5 py-2.5 text-[14px] font-medium text-white"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!state) return <SessionSplash />

  const value: Context = {
    state,
    set,
    knowledge: state.knowledge,
    company,
    profile,
    obligations,
    deadlines,
    summary,
    needsIncorporation,
    missing: missingFields(profile),
    reset: () => setState({ ...emptyRecord(), today: todayISO() }),
    adopt,
    flush,
    mergeProfile,
    setKnowledge,
    applyKnowledge,
    addAgentMessage: (message) => update((s) => ({ ...s, agentMessages: [...s.agentMessages, message].slice(-40) })),
    markDone: (id, by) =>
      update((s) => ({
        ...s,
        statuses: { ...s.statuses, [id]: { status: 'done', done_at: new Date().toISOString(), done_by: by } },
        activity: [{ id: newId(), at: new Date().toISOString(), actor: by, action: 'Marked done', detail: id }, ...s.activity].slice(0, 80),
      })),
    reopen: (id) =>
      update((s) => {
        const next = { ...s.statuses }
        delete next[id]
        return { ...s, statuses: next }
      }),
    toggleDoc: (deadlineId, doc) =>
      update((s) => {
        const ticked = s.ticked[deadlineId] ?? []
        const next = ticked.includes(doc) ? ticked.filter((d) => d !== doc) : [...ticked, doc]
        return { ...s, ticked: { ...s.ticked, [deadlineId]: next } }
      }),
    addGenerated: (files) =>
      update((s) => {
        const paths = new Set(s.generated.map((f) => f.path))
        return { ...s, generated: [...s.generated, ...files.filter((f) => !paths.has(f.path))] }
      }),
    log,
    addReminders: (entries) => update((s) => ({ ...s, reminders: [...entries, ...s.reminders].slice(0, 200) })),
    setToday: (iso) => set({ today: iso }),
  }

  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>
}

export function useTracker() {
  const context = useContext(TrackerContext)
  if (!context) throw new Error('useTracker must be used inside TrackerProvider')
  return context
}

/** For the shared header, which also renders on public pages. */
export function useTrackerOptional() {
  return useContext(TrackerContext)
}

export function useDeadline(id: string | undefined) {
  const { deadlines } = useTracker()
  return deadlines.find((d) => d.id === id)
}

/** Show a fact for the knowledge panel, with where it came from. */
export function factLine(key: KnowledgeField, knowledge: Knowledge) {
  const fact = knowledge.facts[key]
  const spec = FIELD_BY_KEY.get(key)
  if (!fact || !spec) return null
  return { label: spec.label, value: formatFact(spec, fact.value), source: fact.source, at: fact.updated_at }
}

export type { ChatMessage }
