// Static checks on a migration file. The runner wraps every file in its own transaction,
// so anything that ends/starts a transaction, or cannot run inside one, is refused.
//
// The scan works on a copy of the SQL with comments, string literals, quoted identifiers and
// dollar-quoted bodies blanked out, so `begin ... end` inside a plpgsql DO block or function
// body (very common in these files) is never mistaken for transaction control.

export interface ScanFinding {
  rule: string
  detail: string
}

const IDENT_CHAR = /[A-Za-z0-9_\u0080-￿]/
const DOLLAR_TAG = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/

export function stripSqlNoise(sql: string): { text: string; unterminated: string | null } {
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]

    // line comment
    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
      out += ' '
      continue
    }

    // block comment (nestable)
    if (ch === '/' && next === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2 }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2 }
        else i++
      }
      if (depth > 0) return { text: out, unterminated: '/* コメントが閉じられていません' }
      out += ' '
      continue
    }

    // single-quoted string (E'...' allows backslash escapes)
    if (ch === "'") {
      const prev = sql[i - 1]
      const beforePrev = sql[i - 2]
      const isEscapeString = (prev === 'E' || prev === 'e') && !(beforePrev && IDENT_CHAR.test(beforePrev))
      i++
      let closed = false
      while (i < n) {
        if (isEscapeString && sql[i] === '\\') { i += 2; continue }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue }
          closed = true
          i++
          break
        }
        i++
      }
      if (!closed) return { text: out, unterminated: "文字列リテラル（'）が閉じられていません" }
      out += "''"
      continue
    }

    // quoted identifier
    if (ch === '"') {
      i++
      let closed = false
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue }
          closed = true
          i++
          break
        }
        i++
      }
      if (!closed) return { text: out, unterminated: '引用符付き識別子（"）が閉じられていません' }
      out += '""'
      continue
    }

    // dollar-quoted body: only a quote start if not in the middle of an identifier
    if (ch === '$' && !(i > 0 && IDENT_CHAR.test(sql[i - 1]))) {
      const m = DOLLAR_TAG.exec(sql.slice(i, i + 80))
      if (m) {
        const open = m[0]
        const end = sql.indexOf(open, i + open.length)
        if (end === -1) return { text: out, unterminated: `ドル引用符（${open}）が閉じられていません` }
        i = end + open.length
        out += '$$$$'
        continue
      }
    }

    out += ch
    i++
  }
  return { text: out, unterminated: null }
}

const TX_CONTROL = /^(BEGIN|COMMIT|ROLLBACK|END|ABORT|SAVEPOINT|RELEASE)\b/
const CONCURRENT_INDEX = /^(CREATE (UNIQUE )?INDEX|DROP INDEX|REINDEX)\b.*\bCONCURRENTLY\b/

export function findForbidden(sql: string): ScanFinding[] {
  const findings: ScanFinding[] = []
  const { text, unterminated } = stripSqlNoise(sql)
  if (unterminated) {
    findings.push({ rule: 'unterminated', detail: unterminated })
    return findings
  }

  // psql meta-commands (a line starting with a backslash) are not SQL and are not executed
  // by this runner.
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('\\')) {
      findings.push({ rule: 'psql-meta-command', detail: `psql のメタコマンドは使えません: ${line.trim().slice(0, 40)}` })
    }
  }

  for (const raw of text.split(';')) {
    const stmt = raw.trim().replace(/\s+/g, ' ').toUpperCase()
    if (stmt === '') continue
    const label = stmt.slice(0, 40)
    if (TX_CONTROL.test(stmt) || stmt.startsWith('START TRANSACTION') || stmt.startsWith('PREPARE TRANSACTION')) {
      findings.push({ rule: 'transaction-control', detail: `トランザクション制御は書けません（runner が管理します）: ${label}` })
    } else if (stmt.startsWith('VACUUM')) {
      findings.push({ rule: 'vacuum', detail: 'VACUUM はトランザクション内で実行できません' })
    } else if (CONCURRENT_INDEX.test(stmt)) {
      findings.push({ rule: 'concurrently', detail: `CONCURRENTLY はトランザクション内で実行できません: ${label}` })
    } else if (stmt.startsWith('ALTER SYSTEM')) {
      findings.push({ rule: 'alter-system', detail: 'ALTER SYSTEM は使えません' })
    } else if (/^(CREATE|DROP) DATABASE\b/.test(stmt) || /^(CREATE|DROP|ALTER) TABLESPACE\b/.test(stmt)) {
      findings.push({ rule: 'cluster-level', detail: `クラスタ全体の操作は使えません: ${label}` })
    }
  }
  return findings
}
