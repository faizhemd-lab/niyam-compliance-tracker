import type { BudgetBand, Company } from './shared/types'

export const SITE = {
  name: 'Niyam',
  product: 'Startup Compliance Tracker',
  tagline: 'Know what you owe the government, before they tell you',
  email: 'hello@niyam.example',
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

export const MENU = [{ to: '/', label: 'Home' }, { to: '/interview', label: 'Check my compliance' }, ...NAV, { to: '/company', label: 'Company profile' }, { to: '/import', label: 'Import data' }]

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
  { title: 'Start', body: 'Open the tracker and choose “Check my compliance”.' },
  { title: 'Tell us about your business', body: 'A short chat with tap-to-answer buttons, in plain language. Answers already in your database are skipped.' },
  { title: 'See what applies', body: '“14 obligations: 3 need attention now, 6 this quarter, 5 later.” Every row says why it applies.' },
  { title: 'Open the calendar', body: 'Each date shows the authority and the penalty, colour coded by urgency.' },
  { title: 'Prepare', body: 'Every item carries a document checklist. One click compiles drafts into an organised folder.' },
  { title: 'Delegate', body: 'Share the calendar and folder with your CA, or get matched with one.' },
  { title: 'Stay on track', body: 'Reminders arrive before each deadline and keep coming daily until you mark it done.' },
]

export const FEATURES = [
  { title: 'Interview on your own server', body: 'Slot-filling chat with tap answers. Identifiers are masked before any model call.', status: 'Real' },
  { title: 'Obligations that explain themselves', body: 'The rules engine returns the reason written from your own answers, plus the rule version.', status: 'Real' },
  { title: 'Calendar with authority and penalty', body: 'Monthly, quarterly, yearly and one-off deadlines for the next 12 months, with .ics export.', status: 'Real' },
  { title: 'Reminders until done', body: '30, 7, 3, 1 days before and on the day, then daily while overdue, with a simulated clock.', status: 'Real' },
  { title: 'Urgency that is not colour alone', body: 'Red, amber, green, grey and blue, each with a text label such as “Overdue by 5 days”.', status: 'Real' },
  { title: 'Company database plug-in', body: 'CSV upload, header detection and a column mapping you confirm once and reuse.', status: 'Real (CSV)' },
  { title: 'Document checklist per item', body: 'Have, Missing or Can be generated, rolled up onto the calendar entry.', status: 'Real' },
  { title: 'Document compiler and folders', body: 'Draft resolutions, notices, KYC sheets, employee master and GST data, zipped by financial year.', status: 'Real' },
  { title: 'Share with your CA', body: 'A random link, hashed at rest, with view or view-and-mark-done permission and an activity log.', status: 'Real (link)' },
  { title: 'CA matching', body: 'Weighted scoring on specialty, location, budget, rating and availability, with reasons.', status: 'Mock directory' },
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

export const DEMO_COMPANY: Company = {
  name: 'Northwind Labs Private Limited',
  entity: 'private_limited',
  state: 'Telangana',
  turnover: 6_000_000,
  employees: 12,
  sells: 'services',
  gst_registered: false,
  interstate: false,
  foreign_investment: false,
  incorporated_on: '2026-04-01',
  pan_masked: 'AB••••34F',
  directors: [{ name: 'Ananya Rao', din: '01234567', email: 'ananya@northwind.example' }],
  budget: '10k_30k',
  email: 'ananya@northwind.example',
}

export const BUDGET_OPTIONS: { value: BudgetBand; label: string }[] = [
  { value: 'under_10k', label: 'Under ₹10,000 a year' },
  { value: '10k_30k', label: '₹10,000–30,000 a year' },
  { value: '30k_60k', label: '₹30,000–60,000 a year' },
  { value: 'above_60k', label: 'Above ₹60,000 a year' },
]

export const DEMO_SCRIPT = [
  'A founder finds out about a filing only when the notice arrives.',
  'Three questions in, the tracker already knows GST applies next month.',
  'Open any deadline: the authority, the penalty and the reason it exists.',
  'Compile the folder, download the drafts, share it with a CA.',
  'Move the clock. Watch a reminder fire, go overdue, then stop when marked done.',
]
