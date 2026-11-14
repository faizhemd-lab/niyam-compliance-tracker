import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { DEMO_COMPANY } from '../data'
import { DEMO_MESSAGES } from './messages'
import { evaluateRules, missingFields } from '../shared/rules'
import { buildCalendar, summarise, type StatusMap } from '../shared/schedule'
import type {
  ActivityEntry,
  BudgetBand,
  ChatMessage,
  Company,
  DocKey,
  GeneratedFile,
  Profile,
  ProfileField,
  ReminderEntry,
  ShareLink,
} from '../shared/types'

const KEY = 'niyam:tracker:v1'

export type TrackerState = {
  company: Company
  profile: Profile
  messages: ChatMessage[]
  awaiting: ProfileField | null
  statuses: StatusMap
  ticked: Record<string, DocKey[]>
  generated: GeneratedFile[]
  shares: ShareLink[]
  activity: ActivityEntry[]
  reminders: ReminderEntry[]
  budget: BudgetBand
  today: string
  /** Set when the founder asks for a CA introduction. */
  intros: string[]
}

const initial: TrackerState = {
  company: { name: '' },
  profile: {},
  messages: DEMO_MESSAGES,
  awaiting: 'entity',
  statuses: {},
  ticked: {},
  generated: [],
  shares: [],
  activity: [],
  reminders: [],
  budget: '10k_30k',
  today: new Date().toISOString().slice(0, 10),
  intros: [],
}

function load(): TrackerState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initial
    const parsed = JSON.parse(raw) as Partial<TrackerState>
    return { ...initial, ...parsed }
  } catch {
    return initial
  }
}

type Context = {
  state: TrackerState
  set: (patch: Partial<TrackerState>) => void
  company: Company
  profile: Profile
  obligations: ReturnType<typeof evaluateRules>
  deadlines: ReturnType<typeof buildCalendar>['deadlines']
  summary: ReturnType<typeof summarise>
  needsIncorporation: string[]
  missing: ProfileField[]
  startInterview: () => void
  loadDemo: () => void
  reset: () => void
  mergeProfile: (updates: Partial<Profile>, note?: string) => void
  addMessage: (message: ChatMessage) => void
  markDone: (id: string, by: 'founder' | 'ca') => void
  reopen: (id: string) => void
  toggleDoc: (deadlineId: string, doc: DocKey) => void
  addGenerated: (files: GeneratedFile[]) => void
  log: (action: string, detail: string, actor?: 'founder' | 'ca') => void
  addReminders: (entries: ReminderEntry[]) => void
  setToday: (iso: string) => void
}

const TrackerContext = createContext<Context | null>(null)

let seq = 0
export const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`

export function TrackerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TrackerState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* storage full or private mode */
    }
  }, [state])

  const set = useCallback((patch: Partial<TrackerState>) => setState((s) => ({ ...s, ...patch })), [])

  const profile = state.profile
  const obligations = useMemo(() => evaluateRules(profile), [profile])
  const { deadlines, needsIncorporation } = useMemo(
    () => buildCalendar(profile, obligations, state.today, state.statuses),
    [profile, obligations, state.today, state.statuses],
  )
  const summary = useMemo(() => summarise(deadlines), [deadlines])

  const log = useCallback(
    (action: string, detail: string, actor: 'founder' | 'ca' = 'founder') =>
      setState((s) => ({
        ...s,
        activity: [{ id: newId(), at: new Date().toISOString(), actor, action, detail }, ...s.activity].slice(0, 80),
      })),
    [],
  )

  const mergeProfile = useCallback(
    (updates: Partial<Profile>, note?: string) => {
      setState((s) => ({
        ...s,
        profile: { ...s.profile, ...updates },
        company: { ...s.company, ...updates },
        activity: note
          ? [{ id: newId(), at: new Date().toISOString(), actor: 'founder' as const, action: 'Updated profile', detail: note }, ...s.activity].slice(0, 80)
          : s.activity,
      }))
    },
    [],
  )

  const value: Context = {
    state,
    set,
    company: state.company,
    profile,
    obligations,
    deadlines,
    summary,
    needsIncorporation,
    missing: missingFields(profile),
    startInterview: () => {
      set({ messages: DEMO_MESSAGES, awaiting: 'entity', statuses: {}, ticked: {}, generated: [] })
      log('Started interview', 'A new compliance check was started.')
    },
    loadDemo: () =>
      setState((s) => ({
        ...s,
        profile: { ...DEMO_COMPANY },
        company: { ...DEMO_COMPANY },
        statuses: {},
        ticked: {},
        generated: [],
        activity: [{ id: newId(), at: new Date().toISOString(), actor: 'founder', action: 'Loaded the sample company', detail: DEMO_COMPANY.name }, ...s.activity],
      })),
    reset: () => {
      setState({ ...initial, today: new Date().toISOString().slice(0, 10) })
    },
    mergeProfile,
    addMessage: (message) => setState((s) => ({ ...s, messages: [...s.messages, message] })),
    markDone: (id, by) =>
      setState((s) => ({
        ...s,
        statuses: { ...s.statuses, [id]: { status: 'done', done_at: new Date().toISOString(), done_by: by } },
        activity: [
          { id: newId(), at: new Date().toISOString(), actor: by, action: 'Marked done', detail: id },
          ...s.activity,
        ].slice(0, 80),
      })),
    reopen: (id) =>
      setState((s) => {
        const next = { ...s.statuses }
        delete next[id]
        return { ...s, statuses: next }
      }),
    toggleDoc: (deadlineId, doc) =>
      setState((s) => {
        const current = s.ticked[deadlineId] ?? []
        const next = current.includes(doc) ? current.filter((d) => d !== doc) : [...current, doc]
        return { ...s, ticked: { ...s.ticked, [deadlineId]: next } }
      }),
    addGenerated: (files) =>
      setState((s) => {
        const paths = new Set(s.generated.map((f) => f.path))
        return { ...s, generated: [...s.generated, ...files.filter((f) => !paths.has(f.path))] }
      }),
    log,
    addReminders: (entries) => setState((s) => ({ ...s, reminders: [...entries, ...s.reminders].slice(0, 200) })),
    setToday: (iso) => set({ today: iso }),
  }

  return <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>
}

export function useTracker() {
  const context = useContext(TrackerContext)
  if (!context) throw new Error('useTracker must be used inside TrackerProvider')
  return context
}

/** The deadline a page is looking at, from the id in the URL. */
export function useDeadline(id: string | undefined) {
  const { deadlines } = useTracker()
  return deadlines.find((d) => d.id === id)
}
