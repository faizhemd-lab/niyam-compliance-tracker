export type ApiResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; status?: number }

/**
 * The session token is attached by whichever session provider is active, so
 * pages never talk to Clerk directly. Read-only API routes ignore it.
 */
let tokenGetter: (() => Promise<string | null>) | null = null

export function setTokenGetter(getter: (() => Promise<string | null>) | null) {
  tokenGetter = getter
}

async function authHeaders(extra?: HeadersInit): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...((extra as Record<string, string> | undefined) ?? {}) }
  if (tokenGetter) {
    try {
      const token = await tokenGetter()
      if (token) headers.authorization = `Bearer ${token}`
    } catch {
      /* signed out mid-request */
    }
  }
  return headers
}

/** Any JSON request, with the session attached and the response normalised. */
export async function requestJson<T = unknown>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      headers: await authHeaders(init.headers),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof json.error === 'string' ? json.error : 'Something went wrong. Please try again.',
        fieldErrors: (json.fieldErrors as Record<string, string>) ?? undefined,
      }
    }
    return { ok: true, data: json as T }
  } catch {
    return { ok: false, error: 'We could not reach the server. Check your connection and try again.' }
  }
}

/** POST JSON to a worker route and normalise the response. */
export async function postJson<T = unknown>(url: string, body: unknown): Promise<ApiResult<T>> {
  return requestJson<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** GET a worker route. */
export async function getJson<T = unknown>(url: string): Promise<ApiResult<T>> {
  return requestJson<T>(url, { method: 'GET' })
}

/** PUT a JSON body to a worker route. */
export async function putJson<T = unknown>(url: string, body: unknown): Promise<ApiResult<T>> {
  return requestJson<T>(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
