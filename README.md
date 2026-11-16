# Niyam — Startup Compliance Tracker

An AI-agent-style compliance tracker for first-time Indian founders. You describe
your business in plain language; the app works out which registrations, licences
and filings apply, when each is due, who it is owed to and what a missed deadline
costs — then keeps reminding you until you mark it done.

Built for the **Ground Zero Buildathon (Studentpreneurs, with AI Agents)**,
Impact Hub, Hyderabad, 14 November 2026.

> Guidance, not legal advice. Deadlines and penalties in the catalogue reflect
> rules as generally known and have **not** been verified against official
> portals. Verify every entry with a practising CA before relying on it.

## What is in the product

| Area | Route | What it does |
| --- | --- | --- |
| Landing | `/` | Promise, problem, the nine features, the seven-step journey, straight answers |
| Interview | `/interview` | Guided slot-filling chat: tap answers or free text, glossary, live profile panel |
| Obligations | `/obligations` | Every rule that applies, with the reason written from your answers and the rule version |
| Calendar | `/calendar` | Dated deadlines for 60 days back to 12 months ahead, colour coded, with an “on event” lane and .ics export |
| Deadline | `/deadline/:id` | Authority, penalty, plain-words explanation, checklist, compiler, reminders, mark done |
| Documents | `/documents` | Compiled folders with drafts, checklists, manifests and ZIP download |
| Reminders | `/reminders` | Simulated clock, the daily job, the idempotent delivery log, WhatsApp preview |
| Share | `/share` | Hashed share links, permissions, expiry, revocation, activity log |
| CA view | `/s/:token` | The accountant’s scoped, read-mostly view |
| Import | `/import` | CSV upload, header detection, mapping preview, validated import |
| Company | `/company` | Correct any answer; the rules engine re-runs safely |

## Run it

```sh
bun install
bun run dev        # http://localhost:5305 (Vite + the Worker in workerd)
bun run build      # dist/client (assets) + dist/niyam/index.js (Worker)
bun run typecheck
bun run test       # Vitest: rules, calendar, reminders, parser, import, documents, sharing
```

This build was verified with Node 22 running the Vite binary directly
(`node node_modules/vite/bin/vite.js --port 5305`). The Cloudflare Vite plugin
needs Node’s fetch and does not work under Bun’s runtime.

## Tests

`tests/` holds the checks chapter 15 of the handbook asks for, run with Vitest
(`vitest.config.ts`, kept apart from the Vite config so no plugins load):

- `rules.test.ts`: ten golden company profiles with hand-checked obligation
  lists, every threshold boundary (₹20 lakh, ₹40 lakh, ₹1 crore, ₹2 crore;
  9/10, 19/20 and 0/1 employees), catalogue completeness and penalty estimates.
- `schedule.test.ts`: the calendar window, month-end and leap-year dates, year
  boundaries, urgency colours and labels, and safe reconciliation after a
  profile correction.
- `reminders.test.ts`: a full simulated year of the daily job: no duplicates,
  each stage once, overdue daily, stops when marked done.
- `gateway.test.ts`: masking, amount and date parsing, extraction cases from the
  handbook, the interview order, explanation faithfulness and intents.
- `import-and-documents.test.ts`: messy CSVs, masked identifiers, DRAFT marks,
  folder names, manifests and checklist states.
- `sharing.test.ts`: token size and hashing, expiry, revocation, view-only and
  scope limits, and `POST /api/share`.

If a rule changes on purpose, update its golden profile in the same commit.

## How the AI is used — and what it is not allowed to do

The design rule is **rules decide, AI talks**:

- **Applicability, due dates and penalties come from the rules catalogue and
  the engine** (`src/shared/catalogue.ts`, `rules.ts`, `schedule.ts`). No model
  output can add, move or remove a deadline.
- **The model gateway** (`src/shared/gateway.ts`) is the only module that turns
  free text into profile fields and record data into sentences. It is where a
  self-hosted model (Ollama / vLLM, OpenAI-compatible) plugs in.
- **In this build the gateway runs a deterministic on-server parser**, not a
  language model, because no model server is configured. The UI says so
  (“Deterministic local parser, v1”) instead of claiming otherwise. The
  interface, validation and fallbacks are the ones a model would use.
- **Every extracted value is validated**: allowed values, numeric ranges, a
  deterministic lakh/crore parser and date parsing. Unclear answers become
  clarifying questions, never guesses.
- **Identifiers are masked** (PAN, GSTIN, email, phone) before extraction, and
  logs store only masked text.
- **Explanations are checked for faithfulness**: every number in the answer must
  appear in the rule record, otherwise the stored plain-words text is shown.
- **Free-text intents** are classified into a fixed list (`explain_item`,
  `update_profile`, `mark_done`, `show_calendar`, `share_with_ca`, `out_of_scope`).

## The rules engine

22 rules, version `2026.1`, encoded as data (Appendix A of the handbook):

- Conditions compose with `all` / `any` / `not` and `eq` / `in` / `gt` / `gte` /
  `lt` / `lte` over `entity`, `state`, `turnover`, `employees`, `sells`,
  `gst_registered`, `interstate`, `foreign_investment`, `incorporated_on`.
- Schedules: `monthly`, `yearly`, `multi`, `relative` (N days after
  incorporation), `derived` (N days after the AGM) and `event` for items with no
  fixed date. Yearly rules can declare a variant per company type.
- Window: 60 days in the past (so overdue items stay visible) to 365 days ahead.
  No deadline is generated before the incorporation date.
- Colour: red (overdue or ≤ 3 days), amber (4–30), green (> 30), grey (done),
  blue (waiting on an event). Every colour also carries a text label.
- Penaly estimators use structured fields (fixed, per-day, cap, % of turnover,
  interest) and are labelled indicative.
- Correcting a profile re-runs the engine: new deadlines are added, dead ones
  removed unless done, and done items keep their status.
- Every rule renders with its version and a “not yet verified” badge until a
  reviewer records a `verified_on` date and source.

## Reminders

A daily job (09:00 IST) computes `left = due − today`; stages are 30, 7, 3, 1, 0
days, then `overdue-<today>` every day until done. The delivery log is the
idempotency key, so running the job twice never duplicates a message. Marking an
item done removes it from the job immediately. The page accepts a simulated
“today” so a month of reminders can be shown in seconds. Email is the live
channel; WhatsApp is a copy preview.

## Document compiler

Templates fill from the company record: board resolution, AGM notice, director
KYC sheet, employee master, GST data sheet and an authority letter, plus a
checklist and `_manifest.json` per folder. Every file carries a
**DRAFT, review before use** mark and the rule version. Folder names carry the
deadline date (`FY2026-27/Companies-Act/AGM-2026-09-30/…`). ZIPs are built by a
small stored-entry ZIP writer (`src/shared/zip.ts`) that runs in the Worker and
in the browser. The compiler lists fields it is missing rather than producing a
half-empty document.

## API

All routes are stateless pure functions of their payload; the founder’s record
and statuses live in the browser (`localStorage`), so there is no session table
in this build. Routes:

```
GET  /api/health
POST /api/interview/message        { profile, message, awaiting }
POST /api/company                  { profile, today }
POST /api/company/import           { csv }
POST /api/company/import/confirm   { csv, mapping }
POST /api/obligations              { profile }
POST /api/calendar                 { profile, statuses, today }
POST /api/calendar.ics             { profile, company, today }
POST /api/explain                  { record, language, question }
POST /api/deadlines/compile        { company, deadline, today, ticked }
POST /api/folder.zip               { files }
POST /api/share                    { permission, scope, expires_at }
POST /api/share/revoke             { id }
POST /api/cas/match                { profile, budget, today }   (dormant, see below)
POST /api/cron/reminders           { profile, statuses, today, log, company }
```

## Layout

```
src/
  shared/        deterministic core, shared by the Worker and the UI
    catalogue.ts   the 22 rules, CA directory, states, city map
    rules.ts       condition evaluation, reasons, penalty examples
    schedule.ts    date generation, colours, summary, month grouping
    interview.ts   slots, order, one turn of the conversation
    gateway.ts     model gateway: extraction, masking, explanation, intents
    documents.ts   checklists, compiler, folder tree, .ics
    reminders.ts   stages, messages, the idempotent job
    matching.ts    weighted CA scoring with reasons (dormant)
    validation.ts  CSV parse, header mapping, value validation
    zip.ts         stored-entry ZIP writer
  worker/index.ts  Hono routes
  lib/             browser store, API helper, copy
  components/      design system: buttons, fields, overlays, status, rows
  pages/           one page per route
```

## Data and limits of this build

- **Storage:** the company record, statuses, checklist ticks, generated files,
  share links, reminder log and activity log live in `localStorage`. A share link
  therefore resolves on the device that created it; a hosted deployment stores
  the token hash server-side and resolves it anywhere.
- **CA matching is paused.** The Find a CA page and its links are removed for
  now. The scoring (`src/shared/matching.ts`), the sample directory in
  `catalogue.ts` and `POST /api/cas/match` stay in the code, unused, so the
  feature can come back without a rewrite.
- **Model:** no LLM is called; see “How the AI is used”.
- **Documents:** HTML and CSV drafts (print to PDF), not Word or PDF generation.
- **State-specific rules** (professional tax, Shop licence) stay in the on-event
  lane until a state-specific rule is verified.

## Deploy

`deploy.json` points at the build output. After `bun run build`, deploy with the
Freebuff Sites tool (or the Sites API) from this directory.
