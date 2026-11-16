import { Link } from 'react-router'

import { MENU, SITE } from '../data'
import { BrandName, Logo } from './Bits'
import { Card } from './Card'

export function Footer() {
  return (
    <footer className="px-2 pb-2">
      <Card tone="night" className="px-5 pt-10 pb-5 sm:px-8 sm:pt-12">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr_1fr]">
          <div className="max-w-md">
            <Logo wordmark light />
            <p className="mt-4 text-[clamp(1.5rem,1.1rem+1.2vw,2.2rem)] leading-[1.05] font-medium tracking-[-0.04em] text-white">
              Know what you owe the government, before they tell you.
            </p>
            <p className="mt-4 text-sm text-night-muted">{SITE.notice}</p>
          </div>
          <nav aria-label="Footer">
            <p className="caps mb-3 text-night-muted">The tracker</p>
            <ul className="grid grid-cols-2 gap-x-6">
              {MENU.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="inline-flex min-h-10 items-center text-white transition-colors hov:text-violet-light">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="caps mb-3 text-night-muted">The build</p>
            <ul className="space-y-2 text-sm text-night-muted">
              <li>22 rules in the catalogue, version 2026.1</li>
              <li>Rules engine, reminder job and compiler run on the server</li>
              <li>Agent runs on your server · identifiers masked before any model call</li>
              <li>
                <a href={`mailto:${SITE.email}`} className="inline-flex min-h-10 items-center text-white hov:text-violet-light">
                  {SITE.email}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <p aria-hidden className="display mt-12 -mb-[0.1em] text-center text-[clamp(4rem,-0.5rem+18vw,19rem)] leading-[0.8] tracking-[-0.07em] normal-case text-white select-none">
          <BrandName accent="text-violet-light" />
        </p>
        <div className="mt-5 flex flex-col items-start justify-between gap-2 border-t border-white/12 pt-4 text-xs text-night-muted sm:flex-row sm:items-center">
          <span>{SITE.event}</span>
          <span>Guidance, not legal advice · Verify every rule with a CA</span>
        </div>
      </Card>
    </footer>
  )
}
