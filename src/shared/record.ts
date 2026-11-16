import { emptyKnowledge, type Knowledge } from './knowledge'
import type { StatusMap } from './schedule'
import type { ActivityEntry, BudgetBand, DocKey, GeneratedFile, ReminderEntry, ShareLink, SharePermission, ObligationGroup } from './types'

/**
 * The one record a client owns, exactly as it is stored in D1. The browser,
 * the agent and the autopilot all read and write this shape, so the agent can
 * pull anything it needs from the record on the server without the browser
 * sending it.
 */

export type AgentCallName = string

export type AgentCall = { name: AgentCallName; summary: string; ok: boolean }
export type AgentAction = { label: string; to: string }

export type AgentChatMessage = {
  id: string
  role: 'founder' | 'agent'
  text: string
  at: string
  calls?: AgentCall[]
  actions?: AgentAction[]
  changes?: { label: string; to: string }[]
  engine?: string
  /** Set on messages the autopilot wrote while nobody was in the chat. */
  autopilot?: boolean
}

/**
 * Actions the agent may propose but never perform on its own: anything that
 * hands the record to someone else or takes access away. The founder approves
 * or declines each one.
 */
export type PendingAction =
  | {
      id: string
      tool: 'create_share'
      args: { permission: SharePermission; scope: ObligationGroup[] | 'all'; expires_at: string | null }
      summary: string
      created_at: string
    }
  | {
      id: string
      tool: 'revoke_share'
      args: { share_id: string }
      summary: string
      created_at: string
    }

export type AutopilotSettings = {
  /** The daily job skips records where the founder switched it off. */
  enabled: boolean
  /** The real date of the last run, so it runs at most once a day. */
  last_run?: string
  /** Draft folders for open deadlines due within this many days. */
  draft_within_days: number
}

export type CompanyRecord = {
  knowledge: Knowledge
  agentMessages: AgentChatMessage[]
  statuses: StatusMap
  ticked: Record<string, DocKey[]>
  generated: GeneratedFile[]
  shares: ShareLink[]
  activity: ActivityEntry[]
  reminders: ReminderEntry[]
  budget: BudgetBand
  /** The simulated clock the Reminders page can move. */
  today: string
  intros: string[]
  pending: PendingAction[]
  autopilot: AutopilotSettings
}

export const AGENT_GREETING =
  'I keep the record of this business and turn it into a compliance calendar. Tell me about it in your own words — company type, state, turnover, headcount — and I will file it away. I can also run the whole tracker for you: draft filings, send reminders, tick checklists, share with your CA and check in every morning.'

export const todayISO = () => new Date().toISOString().slice(0, 10)

let seq = 0
export const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export const DEFAULT_AUTOPILOT: AutopilotSettings = { enabled: true, draft_within_days: 14 }

/** A brand-new client's record: empty, with only the agent's greeting. */
export function emptyRecord(): CompanyRecord {
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
    today: todayISO(),
    intros: [],
    pending: [],
    autopilot: { ...DEFAULT_AUTOPILOT },
  }
}

/** A stored record may predate newer fields; fill it out to the current shape. */
export function withDefaults(parsed: Partial<CompanyRecord> | null | undefined): CompanyRecord {
  const base = emptyRecord()
  const source = parsed && typeof parsed === 'object' ? parsed : {}
  return {
    ...base,
    ...source,
    knowledge: source.knowledge && typeof source.knowledge === 'object' && source.knowledge.facts ? source.knowledge : emptyKnowledge(),
    agentMessages: Array.isArray(source.agentMessages) && source.agentMessages.length ? source.agentMessages : base.agentMessages,
    statuses: source.statuses ?? {},
    ticked: source.ticked ?? {},
    generated: Array.isArray(source.generated) ? source.generated : [],
    shares: Array.isArray(source.shares) ? source.shares : [],
    activity: Array.isArray(source.activity) ? source.activity : [],
    reminders: Array.isArray(source.reminders) ? source.reminders : [],
    intros: Array.isArray(source.intros) ? source.intros : [],
    pending: Array.isArray(source.pending) ? source.pending : [],
    autopilot: { ...DEFAULT_AUTOPILOT, ...(source.autopilot ?? {}) },
    today: typeof source.today === 'string' ? source.today : base.today,
  }
}

/** Append to the activity log, newest first, capped like the browser does. */
export function logActivity(record: CompanyRecord, actor: ActivityEntry['actor'], action: string, detail: string): CompanyRecord {
  return {
    ...record,
    activity: [{ id: newId(), at: new Date().toISOString(), actor, action, detail }, ...record.activity].slice(0, 80),
  }
}

/** Add generated files, skipping paths already present. */
export function addFiles(record: CompanyRecord, files: GeneratedFile[]): CompanyRecord {
  const paths = new Set(record.generated.map((f) => f.path))
  return { ...record, generated: [...record.generated, ...files.filter((f) => !paths.has(f.path))] }
}

export function addMessages(record: CompanyRecord, messages: AgentChatMessage[]): CompanyRecord {
  return { ...record, agentMessages: [...record.agentMessages, ...messages].slice(-40) }
}
