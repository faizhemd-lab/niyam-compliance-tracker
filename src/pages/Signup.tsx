import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { SITE } from '../data'
import { useDocumentTitle } from '../lib/storage'
import { SessionSignUp, useSession } from '../lib/session'
import { Header, Shell } from '../components/AppShell'
import { Badge } from '../components/Bits'
import { Card } from '../components/Card'
import { Footer } from '../components/Footer'

export function Signup() {
  useDocumentTitle('Create your account')
  const { status, configured } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const from = (location.state as { from?: string } | null)?.from ?? '/agent'

  // Signed in already: there is nothing to create.
  useEffect(() => {
    if (status === 'signed-in') navigate(from, { replace: true })
  }, [status, from, navigate])

  return (
    <Shell>
      <Header />
      <Card as="section" className="mt-2 px-5 pt-10 pb-9 sm:px-8 sm:pt-12">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-start">
          <div>
            <p className="caps mb-4 flex items-center gap-2 text-violet">
              <span className="inline-block size-1.5 rounded-full bg-violet" aria-hidden />
              {SITE.product}
            </p>
            <h1 className="display text-[clamp(2.4rem,1.2rem+4vw,4.4rem)] leading-[0.9] tracking-[-0.05em]">
              Start with an
              <br />
              empty record.
            </h1>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-ink-2">
              One account holds one company record. Create it here, answer a few questions in your own words, and the tracker works
              out what you owe and when.
            </p>
            <ul className="mt-6 grid gap-2 text-[14px] leading-relaxed text-muted">
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
                Nothing is pre-filled: you start with an empty company record.
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
                One record per client, stored on the app server — not in this browser.
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
                PAN, GSTIN, phone and email are masked before any model call.
              </li>
            </ul>
            <Link to="/" className="mt-8 inline-flex items-center gap-2 text-[14px] font-medium text-ink hov:text-violet">
              <ArrowLeft className="size-4" aria-hidden />
              Back to the landing page
            </Link>
          </div>

          <div className="rounded-[var(--radius-card-sm)] border border-line bg-soft p-5 sm:p-6">
            {configured ? (
              <>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-[15px] font-medium tracking-[-0.02em]">Create your account</p>
                  <Badge tone="violet">Secured by Clerk</Badge>
                </div>
                <SessionSignUp fallback={from} />
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-[15px] font-medium tracking-[-0.02em]">Sign-up is not set up yet</p>
                  <Badge tone="outline">Unconfigured</Badge>
                </div>
                <p className="text-[13.5px] leading-relaxed text-muted">
                  This build has no Clerk publishable key, so there is nothing to sign up with and the app stays closed. Add{' '}
                  <code className="rounded bg-card px-1.5 py-0.5 text-[12.5px]">VITE_CLERK_PUBLISHABLE_KEY</code> to the build, and{' '}
                  <code className="rounded bg-card px-1.5 py-0.5 text-[12.5px]">CLERK_JWT_KEY</code> (or{' '}
                  <code className="rounded bg-card px-1.5 py-0.5 text-[12.5px]">CLERK_JWKS_URL</code>) to the server, then rebuild.
                </p>
              </>
            )}
            <p className="mt-5 border-t border-line pt-4 text-[12px] leading-relaxed text-muted">{SITE.notice}</p>
          </div>
        </div>
      </Card>
      <Footer />
    </Shell>
  )
}
