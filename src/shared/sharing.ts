import type { Deadline, ObligationGroup, ShareLink } from './types'

/** Share links: a random 128-bit token in the URL, and only its SHA-256 hash at rest. */

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return hex(new Uint8Array(digest))
}

export async function createShareToken(): Promise<{ token: string; token_hash: string }> {
  const token = hex(crypto.getRandomValues(new Uint8Array(16)))
  return { token, token_hash: await hashToken(token) }
}

export type ShareState = 'active' | 'revoked' | 'expired'

/**
 * What a link allows on a given day. A link is valid through its expiry date and
 * dead the day after; revocation wins over everything and takes effect at once.
 */
export function shareAccess(share: ShareLink, today: string): { state: ShareState; active: boolean; canMarkDone: boolean } {
  const state: ShareState = share.revoked_at ? 'revoked' : share.expires_at && share.expires_at < today ? 'expired' : 'active'
  const active = state === 'active'
  return { state, active, canMarkDone: active && share.permission === 'mark_done' }
}

export function inScope(share: ShareLink, group: ObligationGroup): boolean {
  return share.scope === 'all' || share.scope.includes(group)
}

/** The deadlines a link may see: nothing once inactive, otherwise only its scope. */
export function visibleDeadlines(share: ShareLink, deadlines: Deadline[], today: string): Deadline[] {
  if (!shareAccess(share, today).active) return []
  return deadlines.filter((d) => inScope(share, d.group))
}
