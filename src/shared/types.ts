/** Shared types for the tracker: the profile, the rules catalogue and the calendar. */

export type Entity = 'private_limited' | 'llp' | 'partnership' | 'proprietorship'
export type Sells = 'goods' | 'services' | 'both'
export type Language = 'en' | 'hi'
export type ObligationGroup = 'gst' | 'company_law' | 'income_tax' | 'payroll' | 'fema' | 'labour'
export type Role = 'founder' | 'ca' | 'viewer'

export type ProfileField =
  | 'entity'
  | 'state'
  | 'turnover'
  | 'employees'
  | 'sells'
  | 'gst_registered'
  | 'interstate'
  | 'foreign_investment'
  | 'incorporated_on'

export type Profile = {
  entity?: Entity
  state?: string
  turnover?: number
  employees?: number
  sells?: Sells
  gst_registered?: boolean
  interstate?: boolean
  foreign_investment?: boolean
  incorporated_on?: string
}

/** The company record the rules read; the interview fills it. */
export type Company = Profile & {
  name: string
  email?: string
  cin?: string
  pan_masked?: string
  gstin_masked?: string
  directors?: Director[]
  premises?: boolean
  budget?: BudgetBand
}

export type Director = { name: string; din: string; email?: string; mobile?: string }

export type BudgetBand = 'under_10k' | '10k_30k' | '30k_60k' | 'above_60k'

export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | {
      field: ProfileField
      op: 'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte'
      value: string | number | boolean | readonly (string | number | boolean)[]
    }

export type Schedule =
  | { type: 'monthly'; day: number }
  | { type: 'yearly'; month: number; day: number }
  | { type: 'multi'; dates: { month: number; day: number }[] }
  | { type: 'relative'; days: number; from: 'incorporation'; label?: string }
  | { type: 'derived'; from: 'agm'; days: number }
  | { type: 'event'; label: string }

export type DocKey =
  | 'pan_card'
  | 'aadhaar'
  | 'contact_proof'
  | 'director_details'
  | 'board_resolution'
  | 'agm_notice'
  | 'financial_statements'
  | 'bank_statement'
  | 'employee_master'
  | 'gst_sales_summary'
  | 'share_allotment_details'
  | 'authority_letter'

export type Penalty = {
  text: string
  /** Hand-written illustration where a formula needs facts we do not hold. */
  example?: string
  fixed?: number
  per_day?: number
  cap?: number
  percent_of_turnover?: number
  interest_month?: number
}

export type Rule = {
  id: string
  name: string
  short: string
  authority: string
  group: ObligationGroup
  applies: Cond
  reason: string
  schedule: Schedule
  variants?: { when: Cond; schedule: Schedule }[]
  penalty: Penalty
  documents: DocKey[]
  plain: string
  how_to_file: string
  rule_version: string
  verified_on?: string
  source_url?: string
}

export type Fact = { label: string; value: string }

/** A rule that applies to a company, with the reason written from its profile. */
export type Obligation = {
  rule_id: string
  name: string
  short: string
  authority: string
  group: ObligationGroup
  reason: string
  facts: Fact[]
  penalty: Penalty
  penalty_example?: string
  documents: DocKey[]
  plain: string
  how_to_file: string
  rule_version: string
  verified: boolean
  source_url?: string
}

export type Colour = 'red' | 'amber' | 'green' | 'grey' | 'blue'

export type DeadlineStatus = 'open' | 'done'

export type Deadline = {
  id: string
  rule_id: string
  rule_version: string
  name: string
  short: string
  authority: string
  group: ObligationGroup
  reason: string
  facts: Fact[]
  penalty: string
  penalty_example?: string
  documents: DocKey[]
  plain: string
  how_to_file: string
  verified: boolean
  source_url?: string
  /** null for event-driven items, which sit in the "on event" lane. */
  due_date: string | null
  event_label?: string
  status: DeadlineStatus
  done_at?: string
  done_by?: 'founder' | 'ca'
  colour: Colour
  urgency: string
  days_left: number | null
}

export type ChecklistState = 'have' | 'missing' | 'generate'

export type ChecklistItem = {
  key: DocKey
  label: string
  state: ChecklistState
  note?: string
}

export type GeneratedFile = { path: string; name: string; media: string; content: string }

export type SharePermission = 'view' | 'mark_done'

export type ShareLink = {
  id: string
  /** The raw token lives only in the founder's browser so the link can be copied again; storage keeps the hash. */
  token?: string
  token_hash: string
  permission: SharePermission
  scope: ObligationGroup[] | 'all'
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

export type ActivityEntry = { id: string; at: string; actor: 'founder' | 'ca'; action: string; detail: string }

export type ReminderStage = string

export type ReminderEntry = {
  id: string
  deadline_id: string
  stage: ReminderStage
  channel: 'email' | 'whatsapp'
  to: string
  subject: string
  body: string
  sent_at: string
  status: 'sent' | 'failed'
}

export type CAProfile = {
  id: string
  name: string
  city: string
  languages: string[]
  specialties: ObligationGroup[]
  fee_band: BudgetBand
  rating: number
  reviews: number
  accepting: boolean
  blurb: string
}

export type CAMatch = {
  ca: CAProfile
  score: number
  reasons: string[]
  breakdown: { factor: string; weight: number; score: number }[]
}

export type ChatRole = 'tracker' | 'founder'

export type ChatMessage = {
  id: string
  role: ChatRole
  text: string
  at: string
  chips?: string[]
  note?: string
}

export type InterviewSlot = {
  field: ProfileField
  question: string
  helper?: string
  type: 'choice' | 'number' | 'date' | 'boolean'
  options?: string[]
  required: boolean
}
