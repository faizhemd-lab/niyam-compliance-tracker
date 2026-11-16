import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'

import { setTokenGetter } from './api'
import { clearLocalRecords } from './storage'

/**
 * The one place Clerk is wired in. Everything else asks this module who is
 * signed in, so the provider can be swapped without touching the pages.
 *
 * With no publishable key the app is not silently open: a development build
 * runs as one local user so it stays testable, and a production build reports
 * `unconfigured` and refuses the app.
 */
const publishableKey = ((import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined) ?? '').trim()

export type SessionUser = { id: string; email: string | null }
export type SessionStatus = 'loading' | 'signed-in' | 'signed-out' | 'unconfigured'

export type SessionValue = {
  status: SessionStatus
  user: SessionUser | null
  /** False when no Clerk publishable key was present at build time. */
  configured: boolean
  signOut: () => Promise<void>
}

/** The only identity that exists without Clerk config, and only in a dev build. */
const DEV_USER: SessionUser = { id: 'local-development-user', email: 'developer@localhost' }

const SessionContext = createContext<SessionValue | null>(null)

function UnconfiguredSessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const dev = import.meta.env.DEV

  useEffect(() => {
    setTokenGetter(null)
  }, [])

  const value = useMemo<SessionValue>(
    () => ({
      status: dev ? 'signed-in' : 'unconfigured',
      user: dev ? DEV_USER : null,
      configured: false,
      signOut: async () => {
        clearLocalRecords()
        navigate('/')
      },
    }),
    [dev, navigate],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

function ClerkSessionProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth()
  const { user } = useUser()
  const { signOut } = useClerk()

  // Every API call goes out with the session token attached.
  useEffect(() => {
    setTokenGetter(() => getToken())
    return () => setTokenGetter(null)
  }, [getToken])

  const value = useMemo<SessionValue>(
    () => ({
      status: !isLoaded ? 'loading' : isSignedIn ? 'signed-in' : 'signed-out',
      user: isSignedIn && user ? { id: user.id, email: user.primaryEmailAddress?.emailAddress ?? null } : null,
      configured: true,
      signOut: async () => {
        clearLocalRecords()
        await signOut({ redirectUrl: '/' })
      },
    }),
    [isLoaded, isSignedIn, user, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function SessionProvider({ children }: { children: ReactNode }) {
  if (!publishableKey) return <UnconfiguredSessionProvider>{children}</UnconfiguredSessionProvider>
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <ClerkSessionProvider>{children}</ClerkSessionProvider>
    </ClerkProvider>
  )
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside SessionProvider')
  return value
}

/** Route element that keeps everything below it behind a session. */
export function RequireAuth() {
  const { status } = useSession()
  const location = useLocation()

  if (status === 'loading') return <SessionSplash />
  if (status === 'unconfigured') return <AuthNotConfigured />
  if (status === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }
  return <Outlet />
}

/** Clerk's own sign-in surface, or nothing when the build has no key. */
export function SessionSignIn({ fallback = '/agent' }: { fallback?: string }) {
  if (!publishableKey) return null
  return (
    <SignIn routing="hash" signUpUrl="/signup" fallbackRedirectUrl={fallback} signUpFallbackRedirectUrl={fallback} />
  )
}

/**
 * Sign-up, kept on this origin. Clerk's default is its hosted Account Portal on
 * another domain, and a brand-new user lands there with no way back into the
 * app; `signUpUrl` on the sign-in surface sends them here instead. Sign-up is
 * sign-in afterwards: `fallbackRedirectUrl` takes them into the app.
 */
export function SessionSignUp({ fallback = '/agent' }: { fallback?: string }) {
  if (!publishableKey) return null
  return (
    <SignUp
      routing="hash"
      signInUrl="/login"
      fallbackRedirectUrl={fallback}
      signInFallbackRedirectUrl={fallback}
    />
  )
}

export function SessionSplash({ label = 'Loading your record…' }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center px-6">
      <div className="flex items-center gap-3 text-[14px] text-muted">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet border-t-transparent" aria-hidden />
        {label}
      </div>
    </div>
  )
}

export function AuthNotConfigured() {
  return (
    <div className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-3 px-6">
      <p className="caps text-violet">Sign-in</p>
      <h1 className="display text-4xl leading-[0.95]">Sign-in is not set up yet</h1>
      <p className="text-[15px] leading-relaxed text-muted">
        This deployment has no Clerk publishable key, so the app stays closed rather than letting anyone in. Set{' '}
        <code className="rounded bg-soft px-1.5 py-0.5 text-[13px]">VITE_CLERK_PUBLISHABLE_KEY</code> and rebuild, then add{' '}
        <code className="rounded bg-soft px-1.5 py-0.5 text-[13px]">CLERK_JWT_KEY</code> (or{' '}
        <code className="rounded bg-soft px-1.5 py-0.5 text-[13px]">CLERK_JWKS_URL</code>) as a server secret.
      </p>
      <a href="/" className="text-[14px] font-medium text-violet underline underline-offset-4">
        Back to the landing page
      </a>
    </div>
  )
}
