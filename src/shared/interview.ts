import { INDIAN_STATES } from './catalogue'
import { extract, maskIdentifiers, type Extraction } from './gateway'
import { REQUIRED_FIELDS, missingFields } from './rules'
import type { InterviewSlot, Profile, ProfileField } from './types'

/** Questions are ordered by code, so the conversation is predictable and testable. */
export const SLOTS: InterviewSlot[] = [
  {
    field: 'entity',
    question: 'First, what kind of company is it?',
    helper: 'A private limited company is the usual choice for startups raising money. An LLP is common for two or more professionals.',
    type: 'choice',
    options: ['Private Limited', 'LLP', 'Partnership', 'Sole proprietor'],
    required: true,
  },
  {
    field: 'state',
    question: 'Which state is the business registered in?',
    helper: 'Compliance differs by state. A city is fine too, for example "Hyderabad".',
    type: 'choice',
    options: ['Telangana', 'Karnataka', 'Maharashtra', 'Delhi', 'Tamil Nadu'],
    required: true,
  },
  {
    field: 'turnover',
    question: 'Roughly how much money does the business bring in per year?',
    helper: 'Turnover means total sales before costs. You can say "60 lakh" or "about 2 crore".',
    type: 'number',
    options: ['About ₹10 lakh', 'About ₹60 lakh', 'About ₹1 crore', 'About ₹3 crore'],
    required: true,
  },
  {
    field: 'employees',
    question: 'How many people work for you, including part-timers on payroll?',
    helper: 'Count anyone paid through the company. Contractors you pay per invoice do not count.',
    type: 'number',
    options: ['Just me', '5 people', '12 people', '25 people'],
    required: true,
  },
  {
    field: 'sells',
    question: 'Do you sell goods, services, or both?',
    helper: 'Software, design and consulting are services. Products you ship are goods.',
    type: 'choice',
    options: ['Services', 'Goods', 'Both'],
    required: true,
  },
  {
    field: 'gst_registered',
    question: 'Are you registered for GST?',
    helper: 'GST is the tax on sales. You would have a 15-character GSTIN if you are registered.',
    type: 'boolean',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    field: 'interstate',
    question: 'Do you sell to customers in other states?',
    helper: 'Selling goods across state lines usually requires GST registration, whatever the turnover.',
    type: 'boolean',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    field: 'foreign_investment',
    question: 'Is there any foreign investment or foreign shareholder?',
    helper: 'This covers money from an investor outside India, including NRI shareholders.',
    type: 'boolean',
    options: ['Yes', 'No'],
    required: true,
  },
  {
    field: 'incorporated_on',
    question: 'When was the company incorporated?',
    helper: 'Optional, but first-year filings like INC-20A need it. Use YYYY-MM-DD.',
    type: 'date',
    required: false,
  },
]

/** The next question: required slots first, in fixed order, then the optional date. */
export function nextSlot(profile: Profile): InterviewSlot | undefined {
  const missing = missingFields(profile)
  if (missing.length) return SLOTS.find((s) => s.field === missing[0])
  if (!profile.incorporated_on) return SLOTS.find((s) => s.field === 'incorporated_on')
  return undefined
}

export function nextQuestion(profile: Profile): string | undefined {
  const slot = nextSlot(profile)
  return slot?.question
}

/** Answers already known from an imported company record are skipped. */
export function prefilledFields(profile: Profile): ProfileField[] {
  return REQUIRED_FIELDS.filter((field) => profile[field] !== undefined)
}

const CHIP_TO_TEXT: Record<string, string> = {
  'Private Limited': 'Private Limited',
  LLP: 'LLP',
  Partnership: 'Partnership',
  'Sole proprietor': 'Sole proprietor',
  'About ₹10 lakh': 'About 10 lakh',
  'About ₹60 lakh': 'About 60 lakh',
  'About ₹1 crore': 'About 1 crore',
  'About ₹3 crore': 'About 3 crore',
  'Just me': 'Just me',
  '5 people': '5 people',
  '12 people': '12 people',
  '25 people': '25 people',
  Services: 'Services',
  Goods: 'Goods',
  Both: 'Both',
  Yes: 'Yes',
  No: 'No',
}

export function chipText(label: string): string {
  return CHIP_TO_TEXT[label] ?? label
}

export type TurnResult = {
  extraction: Extraction
  profile: Profile
  accepted: string[]
  asked: InterviewSlot | undefined
  complete: boolean
  reply: string
}

/** One turn of the interview loop, exactly as the handbook describes it. */
export function takeTurn(profile: Profile, message: string, slot?: InterviewSlot): TurnResult {
  const masked = maskIdentifiers(message)
  const extraction = extract(masked, slot?.field ?? null)
  const next: Profile = { ...profile, ...extraction.updates }

  // Drop fields the message could not have meant: a message about GST should
  // not accidentally set the headcount, so rejections are surfaced, not guessed.
  const accepted = Object.keys(extraction.updates).filter((k) => (extraction.updates as Record<string, unknown>)[k] !== undefined)
  const after = nextSlot(next)

  let reply: string
  if (extraction.rejected.length) {
    reply = extraction.rejected[0].reason
  } else if (accepted.length === 0) {
    reply = `I did not catch that. ${slot ? slot.question : 'Could you say it another way?'}`
  } else if (after) {
    reply = after.question
  } else {
    reply = 'That is everything I need. Building your compliance calendar.'
  }

  return {
    extraction,
    profile: next,
    accepted,
    asked: after,
    complete: missingFields(next).length === 0,
    reply,
  }
}

export { INDIAN_STATES }
