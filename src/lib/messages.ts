import type { AgentCall, AgentAction } from '../shared/agent'

export const AGENT_GREETING =
  'I keep the record of this business and turn it into a compliance calendar. Tell me about it in your own words — company type, state, turnover, headcount — and I will file it away. Then ask me to draft a filing and I will fill the templates from what I know.'

export const QUICK_PROMPTS = [
  'We are a private limited company in Telangana, about ₹60 lakh a year, 12 people. We sell services and are not GST registered.',
  'What do we owe the government?',
  'Draft the documents for the AGM',
  'Actually we now have 25 employees',
  'We raised ₹2 crore from a US investor last month',
  'Our director is Ananya Rao, DIN 01234567',
]

export type AgentChatMessage = {
  id: string
  role: 'founder' | 'agent'
  text: string
  at: string
  calls?: AgentCall[]
  actions?: AgentAction[]
  changes?: { label: string; to: string }[]
  engine?: string
}
