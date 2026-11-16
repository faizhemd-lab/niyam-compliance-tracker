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
