import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type postgres from 'postgres'

const SQL_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql', 'fingerprint.sql')

// Fingerprint of the `console` schema. The value for "schema missing / nothing in it" is the
// fixed string EMPTY, so it can be stored and compared like any other value.
export const EMPTY_FINGERPRINT = 'EMPTY'

// Works with both a plain connection and a transaction handle.
export async function computeFingerprint(sql: Pick<postgres.Sql, 'unsafe'>): Promise<string> {
  const rows = await sql.unsafe<{ schema_fingerprint: string | null }[]>(readFileSync(SQL_FILE, 'utf8'))
  if (rows.length !== 1) {
    throw new Error(`fingerprint.sql の結果が 1 行ではありません（${rows.length} 行）。想定外のため停止します`)
  }
  return rows[0].schema_fingerprint ?? EMPTY_FINGERPRINT
}
