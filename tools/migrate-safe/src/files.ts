import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findForbidden, type ScanFinding } from './sqlscan.ts'

// NN_snake_case_description.sql, NN = zero-padded sequence number (2+ digits).
export const FILENAME_RE = /^(\d{2,})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/

export interface MigrationFile {
  version: number
  filename: string
  sha256: string
  content: string
}

export interface HistoryRow {
  migration_version: number
  filename: string
  checksum_sha256: string
  adopted: boolean
  schema_fingerprint_after: string
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function parseFilename(name: string): { version: number; slug: string } | null {
  const m = FILENAME_RE.exec(name)
  if (!m) return null
  return { version: Number.parseInt(m[1], 10), slug: m[2] }
}

// Reads every *.sql in the directory. README.md and other non-.sql files are ignored;
// a .sql file whose name does not match the convention is reported, never silently skipped.
export function loadMigrationFiles(dir: string): { files: MigrationFile[]; invalidNames: string[] } {
  const files: MigrationFile[] = []
  const invalidNames: string[] = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.sql')) continue
    const parsed = parseFilename(name)
    if (!parsed) {
      invalidNames.push(name)
      continue
    }
    const buf = readFileSync(join(dir, name))
    files.push({ version: parsed.version, filename: name, sha256: sha256Hex(buf), content: buf.toString('utf8') })
  }
  files.sort((a, b) => a.version - b.version)
  return { files, invalidNames }
}

export interface Analysis {
  problems: string[]
  pending: MigrationFile[]
  findings: Map<string, ScanFinding[]>
}

// Pure: compares the files on disk with the recorded history.
//  - every history row must still have its file with an identical checksum
//  - versions are unique, and the next version to apply is exactly (latest recorded + 1), contiguous
//  - pending files must pass the forbidden-SQL scan
export function analyze(files: MigrationFile[], invalidNames: string[], history: HistoryRow[]): Analysis {
  const problems: string[] = []
  const findings = new Map<string, ScanFinding[]>()

  for (const name of invalidNames) {
    problems.push(`ファイル名が命名規則（NN_snake_case.sql）に合いません: ${name}`)
  }

  const seen = new Map<number, string>()
  for (const f of files) {
    const prev = seen.get(f.version)
    if (prev) problems.push(`番号が重複しています: ${prev} と ${f.filename}`)
    else seen.set(f.version, f.filename)
  }

  const byVersion = new Map(files.map((f) => [f.version, f]))
  const recorded = new Set<number>()
  for (const row of history) {
    recorded.add(row.migration_version)
    const file = byVersion.get(row.migration_version)
    if (!file) {
      problems.push(`履歴の v${row.migration_version}（${row.filename}）のファイルがありません`)
    } else if (file.filename !== row.filename) {
      problems.push(`履歴の v${row.migration_version} のファイル名が一致しません（履歴: ${row.filename}、実ファイル: ${file.filename}）`)
    } else if (file.sha256 !== row.checksum_sha256) {
      problems.push(`${row.filename} のチェックサムが履歴と一致しません（適用済みのファイルが変更されています）`)
    }
  }

  const latest = history.reduce((max, r) => Math.max(max, r.migration_version), 0)
  for (const f of files) {
    if (f.version <= latest && !recorded.has(f.version)) {
      problems.push(`${f.filename} は、履歴の最新（v${latest}）より前の番号なのに、履歴にありません`)
    }
  }

  const pending = files.filter((f) => f.version > latest)
  pending.forEach((f, idx) => {
    const expected = latest + 1 + idx
    if (f.version !== expected) {
      problems.push(`番号に欠番があります（次に適用するのは v${expected} のはずですが、${f.filename} です）`)
    }
  })

  for (const f of pending) {
    const found = findForbidden(f.content)
    if (found.length > 0) {
      findings.set(f.filename, found)
      for (const fd of found) problems.push(`${f.filename}: ${fd.detail}`)
    }
  }

  return { problems, pending, findings }
}
