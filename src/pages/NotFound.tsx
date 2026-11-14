import { Link } from 'react-router'

import { MENU } from '../data'
import { useDocumentTitle } from '../lib/storage'
import { Header, PageHead, Shell } from '../components/AppShell'
import { ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Footer } from '../components/Footer'

export function NotFound() {
  useDocumentTitle('Page not found')
  return (
    <Shell>
      <Header />
      <PageHead eyebrow="404" title="This page is not in the catalogue" intro="The link may be old, or the deadline may have left the calendar after a correction." actions={<ButtonLink to="/" variant="violet">Back to the start</ButtonLink>} />
      <Card as="section" className="mt-2 px-5 py-8 sm:px-8">
        <p className="caps mb-3 text-muted">Where things are</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {MENU.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className="inline-flex min-h-10 items-center text-[15px] hov:text-violet">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Footer />
    </Shell>
  )
}
