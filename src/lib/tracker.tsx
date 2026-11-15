import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { DEMO_COMPANY } from '../data'
import { AGENT_GREETING, type AgentChatMessage } from './messages'
import {
  applyFacts,
  deriveProfile,
  emptyKnowledge,
  formatFact,
  knowledgeFromCompany,
  knowledgeToCompany,
  FIELD_BY_KEY,
  type FactSource,
  type Knowledge,
  type KnowledgeField,
} from '../shared/knowledge'
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

const KEY = 'niyam:tracker:v2'
const LEGACY_KEY = 'niyam:tracker:v1'

export type TrackerState = {
  knowledge: Knowledge
  agentMessages: AgentChatMessage[]
  statuses: StatusMap
  ticked: Record<string, DocKey[]>
  generated: GeneratedFile[]
  shares: ShareLink[]
  activity: ActivityEntry[]
  reminders: ReminderEntry[]
  budget: BudgetBand
  today: string
  intros: string[]
}

/** The facts the sample company starts with, beyond the profile fields. */
const DEMO_EXTRAS: Partial<Record<KnowledgeField, unknown>> = {
  authorised_capital: 1_000_000,
  paid_up_capital: 250_000,
  fy_end: '31 March',
  address: 'Plot 12, Hitec City, Hyderabad, Telangana',
  authorised_signatory: 'Ananya Rao',
  premises: true,
}

function demoKnowledge(): Knowledge {
  return applyFacts(knowledgeFromCompany(DEMO_COMPANY, 'import'), DEMO_EXTRAS, 'import').knowledge
}

function baseState(): TrackerState {
  return {
    knowledge: emptyKnowledge(),
    agentMessages: [{ id: 'greeting', role: 'agent', text: AGENT_GREETING, at: new Date().toISOString() }],
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
}

function load(): TrackerState {
  const fallback = baseState()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TrackerState>
      return { ...fallback, ...parsed, knowledge: parsed.knowledge ?? emptyKnowledge() }
    }
    // Migrate the first build's stored record, so existing answers survive.
    const legacyRaw = localStorage.getItem(LEGACY_KEY)
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as { company?: Company; profile?: Profile; statuses?: StatusMap; generated?: GeneratedFile[]; activity?: ActivityEntry[] }
      const company = legacy.company ?? ({ ...(legacy.profile ?? {}) } as Company)
      return {
        ...fallback,
        knowledge: Object.keys(company).length ? knowledgeFromCompany(company, 'import') : emptyKnowledge(),
        statuses: legacy.statuses ?? {},
        generated: legacy.generated ?? [],
        activity: legacy.activity ?? [],
      }
    }
    return fallback
  } catch {
    return fallback
  }
}

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
  loadDemo: () => void
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
}

const TrackerContext = createContext<Context | null>(null)

let seq = 0
export const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`

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
  const [state, setState] = useState<TrackerState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* storage full or private mode */
    }
  }, [state])

  const set = useCallback((patch: Partial<TrackerState>) => setState((s) => ({ ...s, ...patch })), [])

  const profile = useMemo(() => deriveProfile(state.knowledge), [state.knowledge])
  const company = useMemo(() => knowledgeToCompany(state.knowledge), [state.knowledge])
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

  const setKnowledge = useCallback(
    (knowledge: Knowledge, note?: string) =>
      setState((s) => ({
        ...s,
        knowledge,
        activity: note
          ? [{ id: newId(), at: new Date().toISOString(), actor: 'founder' as const, action: 'Updated the company record', detail: note }, ...s.activity].slice(0, 80)
          : s.activity,
      })),
    [],
  )

  const applyKnowledge = useCallback((patch: Partial<Record<KnowledgeField, unknown>>, source: FactSource = 'manual') => {
    let result = { changed: 0, errors: [] as string[] }
    setState((s) => {
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
  }, [])

  const mergeProfile = useCallback(
    (updates: Partial<Profile>, note?: string) => {
      const patch: Partial<Record<KnowledgeField, unknown>> = {}
      for (const [key, value] of Object.entries(updates) as [ProfileField, unknown][]) {
        const field = PROFILE_TO_FIELD[key]
        if (field && value !== undefined) patch[field] = value
      }
      if (!Object.keys(patch).length) return
      setState((s) => {
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
    [],
  )

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
    loadDemo: () =>
      setState((s) => ({
        ...s,
        knowledge: demoKnowledge(),
        statuses: {},
        ticked: {},
        generated: [],
        agentMessages: [
          { id: newId(), role: 'agent', text: `Loaded the sample company: ${DEMO_COMPANY.name}, a private limited company in Telangana. 12 people, ₹60 lakh turnover, no GST yet. Ask me what is due, or tell me something that changed.`, at: new Date().toISOString() },
        ],
        activity: [{ id: newId(), at: new Date().toISOString(), actor: 'founder', action: 'Loaded the sample company', detail: DEMO_COMPANY.name }, ...s.activity],
      })),
    reset: () => {
      setState({ ...baseState(), today: new Date().toISOString().slice(0, 10) })
    },
    mergeProfile,
    setKnowledge,
    applyKnowledge,
    addAgentMessage: (message) => setState((s) => ({ ...s, agentMessages: [...s.agentMessages, message].slice(-40) })),
    markDone: (id, by) =>
      setState((s) => ({
        ...s,
        statuses: { ...s.statuses, [id]: { status: 'done', done_at: new Date().toISOString(), done_by: by } },
        activity: [{ id: newId(), at: new Date().toISOString(), actor: by, action: 'Marked done', detail: id }, ...s.activity].slice(0, 80),
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
