import { MotionConfig, motion } from 'motion/react'
import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router'

import { ToastProvider } from './components/Overlay'
import { TrackerProvider } from './lib/tracker'
import { CalendarPage } from './pages/Calendar'
import { CompanyPage } from './pages/Company'
import { DeadlinePage } from './pages/Deadline'
import { Documents } from './pages/Documents'
import { Home } from './pages/Home'
import { ImportPage } from './pages/Import'
import { Interview } from './pages/Interview'
import { NotFound } from './pages/NotFound'
import { Obligations } from './pages/Obligations'
import { Reminders } from './pages/Reminders'
import { SharePage } from './pages/Share'
import { ShareView } from './pages/ShareView'

function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      return
    }
    const t = window.setTimeout(() => {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 420)
    return () => window.clearTimeout(t)
  }, [pathname, hash])
  return null
}

function Pages() {
  const location = useLocation()
  return (
    <motion.main
      id="main"
      key={location.pathname}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="flex-1"
    >
      <Routes location={location}>
        <Route index element={<Home />} />
        <Route path="interview" element={<Interview />} />
        <Route path="obligations" element={<Obligations />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="deadline/:id" element={<DeadlinePage />} />
        <Route path="documents" element={<Documents />} />
        <Route path="reminders" element={<Reminders />} />
        <Route path="share" element={<SharePage />} />
        <Route path="s/:token" element={<ShareView />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="company" element={<CompanyPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </motion.main>
  )
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <TrackerProvider>
          <ToastProvider>
            <ScrollManager />
            <a href="#main" className="sr-only z-[100] rounded-full bg-violet px-5 py-3 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
              Skip to content
            </a>
            <div id="top" className="flex min-h-svh flex-col">
              <Pages />
            </div>
          </ToastProvider>
        </TrackerProvider>
      </BrowserRouter>
    </MotionConfig>
  )
}
