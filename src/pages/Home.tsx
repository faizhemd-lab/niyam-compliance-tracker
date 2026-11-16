import { ArrowRight, ArrowUpRight, Check, FileStack, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router'

import { DEMO_SCRIPT, FEATURES, JOURNEY, METRICS, PROBLEM, SITE, TRUST } from '../data'
import { useDocumentTitle } from '../lib/storage'
import { useTracker } from '../lib/tracker'
import { Header, PageHead, Shell } from '../components/AppShell'
import { Badge, Reveal } from '../components/Bits'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Accordion } from '../components/Content'
import { Footer } from '../components/Footer'

const QUESTIONS = [
  {
    q: 'Is a model deciding which filings apply to me?',
    a: 'No. Applicability, due dates and penalties come from a versioned rules catalogue evaluated by code. The model reads messy answers and explains a record back in plain words; it never sets a date.',
  },
  {
    q: 'What happens if the model misreads my answer?',
    a: 'Every extracted value is validated against allowed values and ranges, and a deterministic lakh and crore parser cross-checks turnover. Anything unclear becomes a clarifying question, not a guess.',
  },
  {
    q: 'Where does my company data live?',
    a: 'In this build, your record and statuses stay in your browser. The rules engine, compiler and reminder job run on the app server. PAN, GSTIN, phone and email are masked before any model call.',
  },
  {
    q: 'Are the rules checked?',
    a: 'Not yet. All 22 entries mirror the handbook’s sample catalogue and carry no reviewer sign-off, so every result says “not yet verified”. A practising CA reviews the catalogue before real use.',
  },
]

export function Home() {
  useDocumentTitle()
  const navigate = useNavigate()
  const { loadDemo } = useTracker()

  const startDemo = () => {
    loadDemo()
    navigate('/calendar')
  }

  return (
    <Shell>
      <Header />

      <Card as="section" className="mt-2 overflow-hidden px-5 pt-10 pb-8 sm:px-8 sm:pt-14">
        <div className="grid gap-10 lg:grid-cols-[1.35fr_1fr] lg:items-end">
          <div>
            <p className="caps mb-4 flex items-center gap-2 text-violet">
              <span className="inline-block size-1.5 rounded-full bg-violet" aria-hidden />
              {SITE.product}
            </p>
            <h1 className="display text-[clamp(2.6rem,1rem+6.4vw,6.4rem)] leading-[0.86] tracking-[-0.06em]">
              <span className="block">Know what you</span>
              <span className="block">owe the</span>
              <span className="block text-violet">government.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2 sm:text-lg">
              Tell us about your business in a few minutes. We work out every registration, licence and filing that applies, when it is due, who it is owed to, and what a missed deadline costs — then keep reminding you until it is done.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <ButtonLink to="/interview" variant="violet" size="lg" iconRight={<ArrowRight className="size-4" />}>
                Check my compliance
              </ButtonLink>
              <Button variant="outline" size="lg" onClick={startDemo} icon={<FileStack className="size-4" />}>
                See a sample calendar
              </Button>
            </div>
          </div>

          <div className="rounded-[var(--radius-card-sm)] border border-line bg-soft p-5">
            <div className="flex items-center justify-between">
              <p className="caps text-muted">A first-time founder</p>
              <Badge tone="violet">3 minutes</Badge>
            </div>
            <ol className="mt-4 space-y-3">
              {DEMO_SCRIPT.map((line, i) => (
                <li key={line} className="flex gap-3 text-[14px] leading-snug">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-violet/10 text-[11px] font-medium text-violet tabular-nums">{i + 1}</span>
                  <span className="text-ink-2">{line}</span>
                </li>
              ))}
            </ol>
            <p className="mt-5 border-t border-line pt-4 text-[13px] text-muted">
              Sample company: a private limited company in Telangana, ₹60 lakh turnover, 12 people, no GST yet.
            </p>
          </div>
        </div>

        <dl className="mt-12 grid grid-cols-1 gap-8 border-t border-line pt-8 sm:grid-cols-3">
          {METRICS.map((m) => (
            <div key={m.label[0]}>
              <dd className="text-[clamp(2.2rem,1.6rem+1.6vw,3.2rem)] leading-none font-medium tracking-[-0.05em] tabular-nums">
                {m.value}
                {m.suffix}
              </dd>
              <dt className="caps mt-2 text-muted">
                {m.label.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </dt>
            </div>
          ))}
        </dl>
      </Card>

      <Card as="section" tone="night" className="mt-2 px-5 py-10 sm:px-8 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.4fr]">
          <div>
            <p className="caps mb-3 text-violet-light">The problem</p>
            <h2 className="display text-[clamp(2rem,1.2rem+2.6vw,3.6rem)] leading-[0.9] text-white">
              A founder finds out
              <br />
              about a filing only
              <br />
              when the notice arrives.
            </h2>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3">
            {PROBLEM.map((quote) => (
              <li key={quote} className="rounded-[var(--radius-control)] border border-white/12 bg-white/[0.04] p-4">
                <p className="text-[14.5px] leading-relaxed text-white/90">{quote}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-10 max-w-2xl text-[15px] leading-relaxed text-night-muted">
          Which registrations apply depends on company type, state, turnover, headcount, GST status and foreign investment. The answer is knowable. It is just buried in forms most founders have never seen.
        </p>
      </Card>

      <PageHead
        eyebrow="What you get"
        title="Nine pieces, one calendar"
        intro="Everything below is built into this site. Where something is a sample or not yet built, it says so on the feature itself."
        actions={<ButtonLink to="/obligations" variant="outline" size="sm" iconRight={<ArrowUpRight className="size-4" />}>Open obligations</ButtonLink>}
      >
        <div className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.03} className="rounded-[var(--radius-card-sm)] border border-line bg-soft/60 p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-medium tracking-[-0.02em]">{f.title}</p>
                <Badge tone={f.status === 'Real' ? 'success' : 'outline'}>{f.status}</Badge>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">{f.body}</p>
            </Reveal>
          ))}
        </div>
      </PageHead>

      <PageHead eyebrow="The journey" title="Seven steps, in order" intro="The interview asks fixed questions in a fixed order, so the result is repeatable. Correcting one answer rebuilds the calendar without losing what you have already marked done.">
        <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {JOURNEY.map((step, i) => (
            <li key={step.title} className="border-t border-line pt-4">
              <p className="caps text-violet tabular-nums">{String(i + 1).padStart(2, '0')}</p>
              <p className="mt-2 text-[15px] font-medium">{step.title}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </PageHead>

      <Card as="section" tone="violet" className="mt-2 px-5 py-10 sm:px-8 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <ShieldCheck className="size-8 text-white/80" aria-hidden />
            <h2 className="display mt-4 text-[clamp(2rem,1.2rem+2.6vw,3.4rem)] leading-[0.9] text-white">
              Rules decide.
              <br />
              AI talks.
            </h2>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/80">
              The model is a translator and a teacher, never the judge. It turns human language into structured data and records back into plain words.
            </p>
          </div>
          <ul className="grid gap-5 sm:grid-cols-2">
            {TRUST.map((t) => (
              <li key={t.title}>
                <p className="flex items-center gap-2 text-[15px] font-medium text-white">
                  <Check className="size-4 shrink-0" aria-hidden />
                  {t.title}
                </p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-white/75">{t.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <PageHead eyebrow="Straight answers" title="Questions judges ask" intro="The four that decide whether this is a toy or a product.">
        <div className="mt-8">
          <Accordion items={QUESTIONS} defaultOpen={null} />
        </div>
      </PageHead>

      <Card as="section" className="mt-2 flex flex-col items-start justify-between gap-6 px-5 py-8 sm:flex-row sm:items-center sm:px-8">
        <div>
          <p className="display text-[clamp(1.6rem,1.2rem+1.6vw,2.4rem)] leading-none">Start with your own business.</p>
          <p className="mt-2 text-[15px] text-muted">Eight questions, no form numbers, no jargon. Your first calendar is about three minutes away.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink to="/interview" variant="violet" iconRight={<ArrowUpRight className="size-4" />}>
            Check my compliance
          </ButtonLink>
          <ButtonLink to="/import" variant="outline">
            Import from a spreadsheet
          </ButtonLink>
        </div>
      </Card>

      <Footer />
    </Shell>
  )
}
