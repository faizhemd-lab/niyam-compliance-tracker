/**
 * One row per signed-in client. The schema is created on first use, so a fresh
 * D1 database works without a migration step. Every query is scoped by the
 * user id that came out of a verified session token, never by a client-supplied
 * id.
 */

let schema: Promise<void> | null = null

export function ensureSchema(db: D1Database): Promise<void> {
  if (!schema) {
    schema = db
      .batch([
        db.prepare(
          `CREATE TABLE IF NOT EXISTS records (
             user_id TEXT PRIMARY KEY,
             data TEXT NOT NULL,
             updated_at TEXT NOT NULL
           )`,
        ),
        db.prepare(
          `CREATE TABLE IF NOT EXISTS shares (
             token_hash TEXT PRIMARY KEY,
             user_id TEXT NOT NULL,
             created_at TEXT NOT NULL
           )`,
        ),
        db.prepare('CREATE INDEX IF NOT EXISTS shares_by_user ON shares (user_id)'),
        db.prepare(
          `CREATE TABLE IF NOT EXISTS agent_usage (
             user_id TEXT NOT NULL,
             bucket TEXT NOT NULL,
             count INTEGER NOT NULL,
             PRIMARY KEY (user_id, bucket)
           )`,
        ),
      ])
      .then(() => undefined)
      .catch((error) => {
        schema = null
        throw error
      })
  }
  return schema
}

export async function readRecord(db: D1Database, userId: string): Promise<{ data: string; updated_at: string } | null> {
  const row = await db.prepare('SELECT data, updated_at FROM records WHERE user_id = ?').bind(userId).first<{ data: string; updated_at: string }>()
  return row ?? null
}

export async function writeRecord(db: D1Database, userId: string, data: string): Promise<string> {
  const updatedAt = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO records (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .bind(userId, data, updatedAt)
    .run()
  return updatedAt
}

/**
 * Write only if nobody saved since `base` (the updated_at the writer read).
 * `base = null` means "only if there is no row yet". Returns the new
 * updated_at, or null when the record moved on underneath the writer.
 */
export async function writeRecordIf(db: D1Database, userId: string, data: string, base: string | null): Promise<string | null> {
  const updatedAt = new Date().toISOString()
  const result =
    base === null
      ? await db.prepare('INSERT OR IGNORE INTO records (user_id, data, updated_at) VALUES (?, ?, ?)').bind(userId, data, updatedAt).run()
      : await db.prepare('UPDATE records SET data = ?, updated_at = ? WHERE user_id = ? AND updated_at = ?').bind(data, updatedAt, userId, base).run()
  return (result.meta?.changes ?? 0) > 0 ? updatedAt : null
}

/** One page of records for the scheduled autopilot, in user_id order. */
export async function listRecords(db: D1Database, after: string, limit = 50): Promise<{ user_id: string; data: string; updated_at: string }[]> {
  const rows = await db
    .prepare('SELECT user_id, data, updated_at FROM records WHERE user_id > ? ORDER BY user_id LIMIT ?')
    .bind(after, limit)
    .all<{ user_id: string; data: string; updated_at: string }>()
  return rows.results ?? []
}

/**
 * The record is the source of truth for share links; this table is only a
 * lookup index from token hash to owner, so a public link can be resolved
 * without knowing whose record to read. Rebuilt from the record on each save.
 */
export async function syncShares(db: D1Database, userId: string, tokenHashes: string[]): Promise<void> {
  await db.prepare('DELETE FROM shares WHERE user_id = ?').bind(userId).run()
  const unique = [...new Set(tokenHashes.filter((hash) => /^[0-9a-f]{64}$/.test(hash)))].slice(0, 100)
  for (const hash of unique) {
    await db.prepare('INSERT OR REPLACE INTO shares (token_hash, user_id, created_at) VALUES (?, ?, ?)').bind(hash, userId, new Date().toISOString()).run()
  }
}

export async function shareOwner(db: D1Database, tokenHash: string): Promise<string | null> {
  const row = await db.prepare('SELECT user_id FROM shares WHERE token_hash = ?').bind(tokenHash).first<{ user_id: string }>()
  return row?.user_id ?? null
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Per-user limits on agent messages, counted in D1 so they hold across every
 * Worker instance. Each message counts against a 10-minute and a daily bucket.
 */
export const AGENT_QUOTA = { perTenMinutes: 30, perDay: 300 } as const

export type QuotaResult = { ok: true } | { ok: false; retryAfter: number; window: 'ten_minutes' | 'day' }

export async function takeAgentQuota(db: D1Database, userId: string, now = new Date()): Promise<QuotaResult> {
  const iso = now.toISOString()
  const day = iso.slice(0, 10)
  const tenMinutes = `${iso.slice(0, 15)}0`
  const bump = (bucket: string) =>
    db
      .prepare(
        `INSERT INTO agent_usage (user_id, bucket, count) VALUES (?1, ?2, 1)
         ON CONFLICT (user_id, bucket) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(userId, bucket)
  const [short, long] = await db.batch<{ count: number }>([bump(`m:${tenMinutes}`), bump(`d:${day}`)])
  const shortCount = short.results?.[0]?.count ?? 0
  const longCount = long.results?.[0]?.count ?? 0

  // Old buckets are swept now and then rather than on every message.
  if (Math.random() < 0.02) {
    const cutoff = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10)
    await db.prepare(`DELETE FROM agent_usage WHERE substr(bucket, 3, 10) < ?1`).bind(cutoff).run()
  }

  if (longCount > AGENT_QUOTA.perDay) {
    const tomorrow = Date.parse(`${day}T00:00:00Z`) + 86_400_000
    return { ok: false, window: 'day', retryAfter: Math.max(1, Math.ceil((tomorrow - now.getTime()) / 1000)) }
  }
  if (shortCount > AGENT_QUOTA.perTenMinutes) {
    const next = Date.parse(`${tenMinutes}:00.000Z`) + 600_000
    return { ok: false, window: 'ten_minutes', retryAfter: Math.max(1, Math.ceil((next - now.getTime()) / 1000)) }
  }
  return { ok: true }
}
