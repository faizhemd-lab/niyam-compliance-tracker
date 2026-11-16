/**
 * Clerk session-token verification on the Worker, using nothing but Web Crypto.
 *
 * Clerk signs session tokens with RS256. The signature is checked against the
 * instance's public key (`CLERK_JWT_KEY`, the PEM from the Clerk dashboard) or
 * against the instance JWKS (`CLERK_JWKS_URL`), then the time and origin claims
 * are checked. No Node built-ins and no SDK, so it runs unchanged in workerd.
 */

export type AuthUser = { id: string; email: string | null }

export type AuthEnv = {
  /** PEM public key copied from the Clerk dashboard, so no network call is needed. */
  CLERK_JWT_KEY?: string
  /** https://<your-frontend-api>/.well-known/jwks.json */
  CLERK_JWKS_URL?: string
  /** The origin this app is served from; used to check the token's azp claim. */
  APP_ORIGIN?: string
  /** Only local `wrangler dev` sets `development`, which allows one local user. */
  ENVIRONMENT?: string
}

export type AuthResult = { user: AuthUser } | { user: null; reason: 'unconfigured' | 'unauthorized' }

/** The only identity that exists without Clerk config, and only in local development. */
const DEV_USER: AuthUser = { id: 'local-development-user', email: 'developer@localhost' }

const encoder = new TextEncoder()

export const clerkConfigured = (env: AuthEnv) => Boolean(env.CLERK_JWT_KEY || env.CLERK_JWKS_URL)

function bytesFromBase64(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodePart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(bytesFromBase64(part))) as T
}

/** A copy of the bytes in an ArrayBuffer, which is what importKey expects. */
function buffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

const ALGORITHM = 'RSASSA-PKCS1-v1_5'
const HASH = 'SHA-256'

const pemCache = new Map<string, CryptoKey>()
const jwksCache = new Map<string, { keys: (JsonWebKey & { kid?: string })[]; at: number }>()

async function keyFromPem(pem: string): Promise<CryptoKey> {
  const cached = pemCache.get(pem)
  if (cached) return cached
  const der = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const key = await crypto.subtle.importKey('spki', buffer(bytesFromBase64(der)), { name: ALGORITHM, hash: HASH }, false, ['verify'])
  pemCache.set(pem, key)
  return key
}

async function keyFromJwks(url: string, kid?: string): Promise<CryptoKey | null> {
  let entry = jwksCache.get(url)
  if (!entry || Date.now() - entry.at > 10 * 60 * 1000) {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] }
    entry = { keys: body.keys ?? [], at: Date.now() }
    jwksCache.set(url, entry)
  }
  const jwk = entry.keys.find((k) => (kid ? k.kid === kid : true)) ?? entry.keys[0]
  if (!jwk) return null
  return crypto.subtle.importKey('jwk', jwk, { name: ALGORITHM, hash: HASH }, false, ['verify'])
}

async function publicKey(env: AuthEnv, kid?: string): Promise<CryptoKey | null> {
  if (env.CLERK_JWT_KEY) return keyFromPem(env.CLERK_JWT_KEY)
  if (env.CLERK_JWKS_URL) return keyFromJwks(env.CLERK_JWKS_URL, kid)
  return null
}

function authorisedParties(env: AuthEnv): string[] {
  return (env.APP_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

/** Verify a Clerk session token; returns the user, or null when it is not valid. */
export async function verifyClerkToken(token: string, env: AuthEnv): Promise<AuthUser | null> {
  const [rawHeader, rawPayload, rawSignature] = token.split('.')
  if (!rawHeader || !rawPayload || !rawSignature) return null

  const header = decodePart<{ alg?: string; kid?: string }>(rawHeader)
  if (header.alg !== 'RS256') return null

  const key = await publicKey(env, header.kid)
  if (!key) return null

  const valid = await crypto.subtle.verify(ALGORITHM, key, buffer(bytesFromBase64(rawSignature)), encoder.encode(`${rawHeader}.${rawPayload}`))
  if (!valid) return null

  const claims = decodePart<{ sub?: string; email?: string; exp?: number; nbf?: number; iat?: number; azp?: string; sid?: string }>(rawPayload)
  const now = Math.floor(Date.now() / 1000)
  if (typeof claims.exp !== 'number' || claims.exp + 30 < now) return null
  if (typeof claims.nbf === 'number' && claims.nbf - 30 > now) return null

  const parties = authorisedParties(env)
  if (claims.azp && parties.length && !parties.includes(claims.azp.replace(/\/$/, ''))) return null

  if (!claims.sub) return null
  return { id: claims.sub, email: claims.email ?? null }
}

/**
 * Who is asking. Fails closed: without Clerk configuration the only identity is
 * the local development user, and only when the deployment says it is a
 * development environment. Everyone else is told sign-in is not configured.
 */
export async function authenticatedUser(request: Request, env: AuthEnv): Promise<AuthResult> {
  if (clerkConfigured(env)) {
    const header = request.headers.get('authorization') ?? ''
    if (!header.toLowerCase().startsWith('bearer ')) return { user: null, reason: 'unauthorized' }
    const user = await verifyClerkToken(header.slice(7).trim(), env).catch(() => null)
    return user ? { user } : { user: null, reason: 'unauthorized' }
  }
  if (env.ENVIRONMENT === 'development') return { user: DEV_USER }
  return { user: null, reason: 'unconfigured' }
}
