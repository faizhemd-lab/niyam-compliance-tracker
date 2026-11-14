import { ArrowUpRight, Menu, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router'

import { MENU, NAV, SITE } from '../data'
import { cx } from '../lib/cx'
import { useTracker } from '../lib/tracker'
import { Logo } from './Bits'
import { ButtonLink, IconButton } from './Button'
import { Card } from './Card'

/** The header that sits at the top of every page: white pill on the canvas. */
export function Header() {
  const [open, setOpen] = useState(false)
  const { summary } = useTracker()
  return (
    <>
      <header className="sticky top-2 z-40 px-2">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 rounded-full border border-line bg-card/92 px-4 backdrop-blur-md sm:px-5">
          <Link to="/" aria-label={`${SITE.name} home`} className="round flex items-center gap-2.5 rounded-full">
            <Logo wordmark />
          </Link>
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cx(
                        'round inline-flex h-9 items-center rounded-full px-3.5 text-[13.5px] font-medium transition-colors',
                        isActive ? 'bg-soft text-ink' : 'text-muted hov:bg-soft hov:text-ink',
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-2">
            <span className="caps hidden text-muted xl:inline">{summary.total} obligations</span>
            <ButtonLink to="/interview" variant="violet" size="sm" className="hidden sm:inline-flex" iconRight={<ArrowUpRight className="size-4" />}>
              Check my compliance
            </ButtonLink>
            <IconButton aria-label="Open menu" aria-expanded={open} tone="outline" size="sm" onClick={() => setOpen(true)} className="lg:hidden">
              <Menu className="size-4" />
            </IconButton>
          </div>
        </div>
      </header>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[70] bg-scrim/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              initial={{ x: '104%' }}
              animate={{ x: 0 }}
              exit={{ x: '104%' }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="on-dark absolute top-2 right-2 bottom-2 flex w-[min(420px,calc(100%-16px))] flex-col overflow-y-auto rounded-[var(--radius-card)] bg-night p-6 text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <Logo wordmark light />
                <IconButton aria-label="Close menu" tone="light" onClick={() => setOpen(false)}>
                  <X className="size-5" />
                </IconButton>
              </div>
              <nav aria-label="Menu" className="mt-8 flex-1">
                <ul>
                  {MENU.map((item) => (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={() => setOpen(false)}
                        className="flex min-h-14 items-center justify-between border-b border-white/12 text-[1.35rem] font-medium tracking-[-0.03em] hov:text-violet-light"
                      >
                        {item.label}
                        <ArrowUpRight className="size-5 opacity-60" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <p className="mt-8 text-sm text-night-muted">{SITE.notice}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** A page's first card: eyebrow, title, intro and any actions. */
export function PageHead({
  eyebrow,
  title,
  intro,
  actions,
  children,
}: {
  eyebrow?: string
  title: string
  intro?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <Card as="section" className="mt-2 px-5 pt-8 pb-7 sm:px-8 sm:pt-10">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          {eyebrow && <p className="caps mb-3 text-violet">{eyebrow}</p>}
          <h1 className="display text-[clamp(2.4rem,1.2rem+4.2vw,4.6rem)] leading-[0.9]">{title}</h1>
          {intro && <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-ink-2">{intro}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  )
}

/** Page width and vertical rhythm for the stacked white panels. */
export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <div key={pathname} className="mx-auto flex min-h-svh max-w-[1400px] flex-col px-2 pb-2">
      {children}
    </div>
  )
}
