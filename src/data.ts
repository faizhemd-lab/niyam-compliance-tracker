import type { BudgetBand } from './shared/types'

export const SITE = {
  name: 'complAInce',
  product: 'Startup Compliance Tracker',
  tagline: 'Know what you owe the government, before they tell you',
  email: 'hello@complaince.example',
  event: 'Ground Zero Buildathon · Studentpreneurs with AI Agents · Impact Hub, Hyderabad · 14 November 2026',
  notice: 'Guidance, not legal advice. Every rule carries a version and is meant to be reviewed by a practising CA before real use.',
}

export const NAV = [
  { to: '/obligations', label: 'Obligations' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/documents', label: 'Documents' },
  { to: '/reminders', label: 'Reminders' },
  { to: '/ca', label: 'Find a CA' },
  { to: '/share', label: 'Share' },
]

export const MENU = [{ to: '/', label: 'Home' }, { to: '/agent', label: 'Talk to the agent' }, ...NAV, { to: '/company', label: 'Company record' }, { to: '/import', label: 'Import data' }]

export const PROBLEM = [
  '“I did not know a director KYC was due. The fees were ₹5,000 and my DIN stopped working.”',
  '“Our first GST return was late by four days. The portal locked the next one.”',
  '“I found out about INC-20A when the strike-off notice arrived.”',
]

export const METRICS = [
  { value: 3, suffix: ' min', label: ['First question', 'to full calendar'] },
  { value: 22, suffix: '', label: ['Obligations', 'in the catalogue'] },
  { value: 100, suffix: '%', label: ['Deadlines decided', 'by rules, not AI'] },
]

export const JOURNEY = [
  { title: 'Start', body: 'Open the agent and say what the business is, in your own words.' },
  { title: 'Tell the agent', body: 'It keeps one record of the company, fills gaps by asking, and updates the record whenever you correct it.' },
  { title: 'See what applies', body: '“14 obligations: 3 need attention now, 6 this quarter, 5 later.” Every row says why it applies.' },
  { title: 'Open the calendar', body: 'Each date shows the authority and the penalty, colour coded by urgency.' },
  { title: 'Prepare', body: 'Every item carries a document checklist. One click compiles drafts into an organised folder.' },
  { title: 'Delegate', body: 'Share the calendar and folder with your CA, or get matched with one.' },
  { title: 'Stay on track', body: 'Reminders arrive before each deadline and keep coming daily until you mark it done.' },
]

export const FEATURES = [
  { title: 'A local agent that remembers', body: 'Free-form chat that reads and writes one company record, with every write validated. Runs on your own server.', status: 'Real' },
  { title: 'Obligations that explain themselves', body: 'The rules engine returns the reason written from your own answers, plus the rule version.', status: 'Real' },
  { title: 'Calendar with authority and penalty', body: 'Monthly, quarterly, yearly and one-off deadlines for the next 12 months, with .ics export.', status: 'Real' },
  { title: 'Reminders until done', body: '30, 7, 3, 1 days before and on the day, then daily while overdue, with a simulated clock.', status: 'Real' },
  { title: 'Urgency that is not colour alone', body: 'Red, amber, green, grey and blue, each with a text label such as “Overdue by 5 days”.', status: 'Real' },
  { title: 'Company database plug-in', body: 'CSV upload, header detection and a column mapping you confirm once and reuse.', status: 'Real (CSV)' },
  { title: 'Document checklist per item', body: 'Have, Missing or Can be generated, rolled up onto the calendar entry.', status: 'Real' },
  { title: 'Agent-drafted documents', body: 'Ask in chat for any filing; it compiles the cover sheet, templates and checklist, and names the facts it still needs.', status: 'Real' },
  { title: 'Share with your CA', body: 'A random link, hashed at rest, with view or view-and-mark-done permission and an activity log.', status: 'Real (link)' },
  { title: 'CA matching', body: 'Weighted scoring on specialty, location, budget, rating and availability, with the reason for every match.', status: 'Directory not open' },
]

export const TRUST = [
  { title: 'Rules decide. AI talks.', body: 'Applicability, dates and penalties come from the versioned rules catalogue. The model only reads messy answers and explains records back in plain words.' },
  { title: 'Every result is explainable', body: 'Each obligation shows the answers that triggered it (“you have 12 people”) and the exact rule version behind it.' },
  { title: 'Private by default', body: 'The app, the record and the rules run together. PAN, GSTIN, phone and email are masked before any model call, and logs store the masked text.' },
  { title: 'Honest about uncertainty', body: 'Rules without a reviewer’s “verified on” date are marked not verified. When the tracker cannot answer, it says so and points you to a CA.' },
]

export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: 'AGM', meaning: 'Annual General Meeting: the yearly meeting where a company presents its accounts to shareholders.' },
  { term: 'CA', meaning: 'Chartered Accountant: a qualified accountant who can advise on and handle filings.' },
  { term: 'CIN / LLPIN', meaning: 'The registration number of a company or an LLP.' },
  { term: 'DIN', meaning: 'Director Identification Number: a director’s unique ID.' },
  { term: 'EPF / EPFO', meaning: 'Employees’ Provident Fund and the body that runs it: retirement savings paid by employer and employee.' },
  { term: 'ESIC', meaning: 'Employees’ State Insurance Corporation: health insurance for lower-paid staff.' },
  { term: 'FEMA / RBI', meaning: 'The law on foreign money in and out of India, and the central bank that monitors it.' },
  { term: 'GST / GSTIN', meaning: 'Goods and Services Tax, and a business’s GST registration number.' },
  { term: 'MCA / ROC', meaning: 'Ministry of Corporate Affairs and its Registrar of Companies, who receive company filings.' },
  { term: 'PAN', meaning: 'Permanent Account Number issued by the Income Tax Department.' },
  { term: 'QRMP', meaning: 'A GST option to file returns quarterly instead of monthly for smaller businesses.' },
  { term: 'TDS', meaning: 'Tax Deducted at Source: tax cut from payments such as salaries and deposited with the government.' },
  { term: 'Turnover', meaning: 'Total sales in a year, before costs are subtracted.' },
  { term: 'Model gateway', meaning: 'The one module through which the app talks to a language model. It can be pointed at a self-hosted model without touching any other code.' },
]

export const BUDGET_OPTIONS: { value: BudgetBand; label: string }[] = [
  { value: 'under_10k', label: 'Under ₹10,000 a year' },
  { value: '10k_30k', label: '₹10,000–30,000 a year' },
  { value: '30k_60k', label: '₹30,000–60,000 a year' },
  { value: 'above_60k', label: 'Above ₹60,000 a year' },
]

