import type { ChatMessage } from '../shared/types'

export const GREETING =
  'Hi! I will help you find out which government filings apply to your business. It takes about three minutes, and you can answer with the buttons or in your own words.'

export const DEMO_MESSAGES: ChatMessage[] = [
  {
    id: 'greeting',
    role: 'tracker',
    text: GREETING,
    at: new Date().toISOString(),
    chips: ['Private Limited', 'LLP', 'Partnership', 'Sole proprietor'],
  },
]

export const CONTEXT_ANSWER =
  'I can explain any deadline, update your answers, mark something done or find you a CA. For anything outside that, ask a CA.'
