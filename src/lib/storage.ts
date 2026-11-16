import { useEffect } from 'react'

import { SITE } from '../data'

/** Key for the optimistic copy of a client's record; the server copy wins. */
export const CACHE_PREFIX = 'niyam:cache:'
/** The pre-sign-in record, imported once into the client's account. */
export const LEGACY_KEY = 'niyam:tracker:v2'

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — ${SITE.name}` : `${SITE.name} — ${SITE.tagline}`
  }, [title])
}

/** Drop every local trace of a record. Called on sign-out, not on sign-in. */
export function clearLocalRecords() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key)
    }
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* private mode */
  }
}
