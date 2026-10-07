import postgres from 'postgres'
import { parseConnection, type ConnectionInfo } from './conn.ts'
import { generateCode } from './confirm.ts'
import { assertEnvironmentName, evaluateGate, loadEnvironments, type EnvironmentsConfig, type GateResult } from './env.ts'
import { analyze, loadMigrationFiles, sha256Hex, type Analysis, type HistoryRow, type MigrationFile } from './files.ts'
import { computeFingerprint } from './fingerprint.ts'
import { collectGitInfo, evaluateGitGuard } from './git.ts'
import { ADOPTED_FILE, HISTORY_DDL, LOCK_KEY, REQUIRED_ROLES } from './history.ts'
import { describeSetRole, evaluateSetRole, SET_ROLE_REQUIRED, type SetRoleCheck, type SetRoleRow } from './prereq.ts'
import { join } from 'node:path'

export interface RunOptions {
  environment: string
  url: string
  migrationsDir: string
  environmentsFile: string
  // Repository root, used by the git guard.
  repoRoot: string
  // CONSOLE_MIGRATE_AUTOTEST=1: skips the git guard and the typed confirmation, and ONLY when
  // the target is a loopback host. Ignored for any remote target.
  autotest: boolean
  // Test-only (never set by the CLI): skip just the git guard so the confirmation step can be
  // exercised. Like autotest it is honoured for loopback targets only.
  skipGitGuardForTests?: boolean
  confirm: (code: string) => Promise<boolean>
  out: (line: string) => void
}

interface Inspection {
  role: string
  databaseId: string | null
  gate: GateResult
  history: HistoryRow[] | null // null = console.migration_history does not exist (not initialised)
  files: MigrationFile[]
  invalidNames: string[]
  fingerprint: string
  analysis: Analysis | null
  setRole: SetRoleCheck
}

// The autotest escape hatches (skip git guard / confirmation) apply to loopback targets only.
export function autotestApplies(flag: boolean | undefined, conn: Pick<ConnectionInfo, 'loopback'>): boolean {
  return Boolean(flag) && conn.loopback
}

const OK = '[OK]'
const NG = '[NG]'

function openConnection(opts: RunOptions): postgres.Sql {
  return postgres(opts.url, {
    max: 1,
    prepare: false, // the URL may be a transaction-mode pooler
    connect_timeout: 15,
    idle_timeout: 5,
    onnotice: () => {},
    connection: { application_name: 'console-migrate-safe' },
  })
}

async function withConnection<T>(opts: RunOptions, fn: (sql: postgres.Sql, conn: ConnectionInfo, config: EnvironmentsConfig) => Promise<T>): Promise<T> {
  // Environment name is validated before anything is opened (production is refused here).
  assertEnvironmentName(opts.environment)
  const config = loadEnvironments(opts.environmentsFile)
  const conn = parseConnection(opts.url)
  const sql = openConnection(opts)
  try {
    return await fn(sql, conn, config)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function inspect(sql: postgres.Sql, conn: ConnectionInfo, config: EnvironmentsConfig, opts: RunOptions): Promise<Inspection> {
  const { files, invalidNames } = loadMigrationFiles(opts.migrationsDir)
  return await sql.begin('read only', async (tx) => {
    const [{ role }] = await tx<{ role: string }[]>`select current_user::text as role`

    let databaseId: string | null = null
    const [{ has }] = await tx<{ has: boolean }[]>`select to_regclass('sobae_meta.database_state') is not null as has`
    if (has) {
      const rows = await tx<{ id: string }[]>`select database_id::text as id from sobae_meta.database_state`
      if (rows.length > 1) throw new Error('sobae_meta.database_state に複数行があります（想定外の状態のため停止します）')
      databaseId = rows.length === 1 ? rows[0].id : null
    }

    const gate = evaluateGate({ environment: opts.environment, config, databaseId, connection: conn })

    let history: HistoryRow[] | null = null
    const [{ hasHistory }] = await tx<{ hasHistory: boolean }[]>`select to_regclass('console.migration_history') is not null as "hasHistory"`
    if (hasHistory) {
      history = await tx<HistoryRow[]>`
        select migration_version, filename, checksum_sha256, adopted, schema_fingerprint_after
        from console.migration_history order by migration_version`
    }

    // SET ROLE prerequisite (PostgreSQL 16+: the SET option of the membership; before 16: MEMBER).
    const setRows = await tx<SetRoleRow[]>`
      select r.rolname::text as rolname,
             case when current_setting('server_version_num')::int >= 160000
                  then pg_has_role(current_user, r.oid, 'SET')
                  else pg_has_role(current_user, r.oid, 'MEMBER') end as can_set
      from pg_roles r where r.rolname = any(${[...SET_ROLE_REQUIRED]})`
    const setRole = evaluateSetRole(setRows)

    const fingerprint = await computeFingerprint(tx)
    const analysis = history ? analyze(files, invalidNames, history) : null
    return { role, databaseId, gate, history, files, invalidNames, fingerprint, analysis, setRole }
  })
}

function short(fp: string): string {
  return fp === 'EMPTY' ? 'EMPTY' : fp.slice(0, 12)
}

function drift(ins: Inspection): { state: 'none' | 'drift' | 'n/a'; text: string } {
  if (!ins.history || ins.history.length === 0) return { state: 'n/a', text: '履歴なし（init 前）' }
  const last = ins.history[ins.history.length - 1].schema_fingerprint_after
  if (last === ins.fingerprint) return { state: 'none', text: `一致（${short(ins.fingerprint)}）` }
  return { state: 'drift', text: `不一致: 現在=${short(ins.fingerprint)} 記録=${short(last)}（履歴外の変更があります）` }
}

function printHeader(opts: RunOptions, ins: Inspection): void {
  opts.out(`環境: ${opts.environment}`)
  opts.out(`${ins.gate.ok ? OK : NG} 接続先の照合: ${ins.gate.detail}`)
  opts.out(`${ins.role === 'postgres' ? OK : NG} 接続ロール: ${ins.role}${ins.role === 'postgres' ? '' : '（postgres であることが必要です）'}`)
  opts.out(`${ins.setRole.ok ? OK : NG} 所有者ロールへの SET 権限: ${describeSetRole(ins.setRole, ins.role)}`)
}

function commonFailures(ins: Inspection): string[] {
  const reasons: string[] = []
  if (!ins.gate.ok) reasons.push('接続先の照合に失敗しました')
  if (ins.role !== 'postgres') reasons.push('接続ロールが postgres ではありません')
  return reasons
}

// Checked only by the commands that write (init, migrate) and by plan ("migrate possible?").
function writeFailures(ins: Inspection): string[] {
  const reasons = commonFailures(ins)
  if (!ins.setRole.ok) reasons.push('所有者ロールへの SET 権限がありません')
  return reasons
}

// ---------------------------------------------------------------- status
export async function cmdStatus(opts: RunOptions): Promise<number> {
  return await withConnection(opts, async (sql, conn, config) => {
    const ins = await inspect(sql, conn, config, opts)
    printHeader(opts, ins)
    if (!ins.history) {
      opts.out('履歴: 未初期化（console.migration_history がありません。init を実行してください）')
    } else {
      const last = ins.history[ins.history.length - 1]
      opts.out(`履歴: ${ins.history.length} 行（取り込み ${ins.history.filter((r) => r.adopted).length} 行）、最新 v${last?.migration_version ?? '-'} ${last?.filename ?? ''}`)
      const d = drift(ins)
      opts.out(`${d.state === 'drift' ? NG : OK} fingerprint: ${d.text}`)
      const pending = ins.analysis?.pending ?? []
      opts.out(`未適用: ${pending.length === 0 ? 'なし' : pending.map((f) => f.filename).join(', ')}`)
      for (const p of ins.analysis?.problems ?? []) opts.out(`${NG} ${p}`)
    }
    return commonFailures(ins).length === 0 ? 0 : 1
  })
}

// ---------------------------------------------------------------- plan
export async function cmdPlan(opts: RunOptions): Promise<number> {
  return await withConnection(opts, async (sql, conn, config) => {
    const ins = await inspect(sql, conn, config, opts)
    printHeader(opts, ins)
    const reasons = writeFailures(ins)
    if (!ins.history || !ins.analysis) {
      opts.out(`${NG} 履歴が未初期化です。先に init を実行してください`)
      return 1
    }
    const d = drift(ins)
    if (d.state === 'drift') reasons.push('履歴外のドリフトがあります')
    const a = ins.analysis
    opts.out(`未適用ファイル: ${a.pending.length} 件`)
    for (const f of a.pending) {
      const bad = a.findings.get(f.filename)
      opts.out(`  ${bad ? NG : OK} ${f.filename}  sha256=${f.sha256.slice(0, 12)}${bad ? '  ' + bad.map((x) => x.rule).join(',') : ''}`)
    }
    for (const p of a.problems) opts.out(`${NG} ${p}`)
    if (a.problems.length > 0) reasons.push('ファイルまたは履歴に問題があります')
    opts.out(reasons.length === 0 ? 'migrate 可能: はい' : `migrate 可能: いいえ（${reasons.join(' / ')}）`)
    return reasons.length === 0 ? 0 : 1
  })
}

// ---------------------------------------------------------------- verify
export async function cmdVerify(opts: RunOptions): Promise<number> {
  return await withConnection(opts, async (sql, conn, config) => {
    const ins = await inspect(sql, conn, config, opts)
    printHeader(opts, ins)
    const reasons = commonFailures(ins)
    if (!ins.history || !ins.analysis) {
      opts.out(`${NG} 履歴が未初期化です`)
      return 1
    }
    const d = drift(ins)
    opts.out(`${d.state === 'drift' ? NG : OK} fingerprint: ${d.text}`)
    if (d.state === 'drift') reasons.push('履歴外のドリフト')
    // For verify, problems with *pending* files are not failures of the recorded state; only the
    // recorded history vs the files on disk is checked here.
    const recorded = ins.analysis.problems.filter((p) => !ins.analysis!.pending.some((f) => p.startsWith(f.filename)))
    for (const p of recorded) opts.out(`${NG} ${p}`)
    if (recorded.length > 0) reasons.push('履歴とファイルの不一致')
    opts.out(`${ins.history.length} 件の履歴を確認しました`)
    opts.out(reasons.length === 0 ? 'verify: 問題なし' : `verify: 失敗（${reasons.join(' / ')}）`)
    return reasons.length === 0 ? 0 : 1
  })
}

// ---------------------------------------------------------------- shared write guards
function writeGuard(opts: RunOptions, conn: ConnectionInfo): { ok: boolean; commit: string | null } {
  if (autotestApplies(opts.autotest || opts.skipGitGuardForTests, conn)) {
    opts.out('（autotest: ループバックのため git ガードを省略します）')
    return { ok: true, commit: null }
  }
  if (opts.autotest && !autotestApplies(opts.autotest, conn)) {
    opts.out('（CONSOLE_MIGRATE_AUTOTEST は、ループバック以外では無視します）')
  }
  const info = collectGitInfo(opts.repoRoot, join('sql', 'migrations'))
  const g = evaluateGitGuard(info)
  opts.out(`${g.ok ? OK : NG} git ガード: ${g.reason}`)
  return { ok: g.ok, commit: g.ok ? info.head : null }
}

async function confirmed(opts: RunOptions, conn: ConnectionInfo): Promise<boolean> {
  if (autotestApplies(opts.autotest, conn)) return true
  const code = generateCode()
  const ok = await opts.confirm(code)
  if (!ok) opts.out(`${NG} 確認コードが一致しません。中止します`)
  return ok
}

// ---------------------------------------------------------------- init
export async function cmdInit(opts: RunOptions): Promise<number> {
  return await withConnection(opts, async (sql, conn, config) => {
    const ins = await inspect(sql, conn, config, opts)
    printHeader(opts, ins)
    if (writeFailures(ins).length > 0) return 1
    if (ins.history && ins.history.length > 0) {
      opts.out(`${OK} 既に初期化済みです（履歴 ${ins.history.length} 行）。何もしません`)
      return 0
    }
    const adopted = ins.files.find((f) => f.filename === ADOPTED_FILE)
    if (!adopted) {
      opts.out(`${NG} ${ADOPTED_FILE} が見つかりません（取り込みの対象）`)
      return 1
    }
    const guard = writeGuard(opts, conn)
    if (!guard.ok) return 1

    opts.out(`init: console スキーマと console.migration_history を作り、${ADOPTED_FILE} を「取り込み済み」として記録します。`)
    opts.out(`  ※ ${ADOPTED_FILE} の SQL は実行しません（適用済みの前提。ロールの存在だけを確認します）`)
    if (!(await confirmed(opts, conn))) return 1

    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`
      await tx.unsafe(`set local lock_timeout = '5s'`)
      await tx.unsafe(`set local statement_timeout = '60s'`)
      const roles = await tx<{ rolname: string }[]>`select rolname from pg_roles where rolname = any(${[...REQUIRED_ROLES]})`
      const missing = REQUIRED_ROLES.filter((r) => !roles.some((x) => x.rolname === r))
      if (missing.length > 0) throw new Error(`取り込みの前提のロールがありません: ${missing.join(', ')}`)
      await tx.unsafe(HISTORY_DDL)
      const [{ n }] = await tx<{ n: string }[]>`select count(*)::text as n from console.migration_history`
      if (n !== '0') throw new Error('console.migration_history に、すでに行があります（別の runner が初期化した可能性）')
      const fp = await computeFingerprint(tx)
      await tx`
        insert into console.migration_history
          (migration_version, filename, checksum_sha256, adopted, applied_by, source_git_commit, schema_fingerprint_before, schema_fingerprint_after)
        values (${adopted.version}, ${adopted.filename}, ${adopted.sha256}, true, ${appliedBy(ins.role)}, ${guard.commit}, null, ${fp})`
    })
    opts.out(`${OK} init 完了: ${ADOPTED_FILE} を取り込みました`)
    return 0
  })
}

function appliedBy(role: string): string {
  return `${role} (${process.env.USER ?? 'unknown'})`
}

// ---------------------------------------------------------------- migrate
export async function cmdMigrate(opts: RunOptions): Promise<number> {
  return await withConnection(opts, async (sql, conn, config) => {
    const ins = await inspect(sql, conn, config, opts)
    printHeader(opts, ins)
    if (writeFailures(ins).length > 0) return 1
    if (!ins.history || !ins.analysis) {
      opts.out(`${NG} 履歴が未初期化です。先に init を実行してください`)
      return 1
    }
    const d = drift(ins)
    opts.out(`${d.state === 'drift' ? NG : OK} fingerprint: ${d.text}`)
    if (d.state === 'drift') return 1
    const a = ins.analysis
    for (const p of a.problems) opts.out(`${NG} ${p}`)
    if (a.problems.length > 0) return 1
    if (a.pending.length === 0) {
      opts.out(`${OK} 適用するファイルはありません`)
      return 0
    }
    const guard = writeGuard(opts, conn)
    if (!guard.ok) return 1

    opts.out(`適用対象（${a.pending.length} 件、番号順に 1 件ずつ、各ファイルを 1 トランザクションで）:`)
    for (const f of a.pending) opts.out(`  ${f.filename}  sha256=${f.sha256.slice(0, 12)}`)
    opts.out(`現在の fingerprint: ${short(ins.fingerprint)}`)
    if (!(await confirmed(opts, conn))) return 1

    let prevVersion = ins.history[ins.history.length - 1].migration_version
    for (const f of a.pending) {
      try {
        await applyOne(sql, f, prevVersion, ins.role, guard.commit, opts)
      } catch (err) {
        opts.out(`${NG} ${f.filename} の適用に失敗しました。ロールバックされ、履歴にも残りません（自動での再試行はしません）`)
        throw err
      }
      prevVersion = f.version
    }
    opts.out(`${OK} migrate 完了`)
    return 0
  })
}

async function applyOne(sql: postgres.Sql, f: MigrationFile, prevVersion: number, role: string, commit: string | null, opts: RunOptions): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`
    await tx.unsafe(`set local lock_timeout = '5s'`)
    await tx.unsafe(`set local statement_timeout = '60s'`)

    // Re-validate inside the transaction (another runner may have applied something meanwhile).
    const latest = await tx<{ v: number; fp: string }[]>`
      select migration_version as v, schema_fingerprint_after as fp
      from console.migration_history order by migration_version desc limit 1`
    if (latest.length !== 1 || latest[0].v !== prevVersion) {
      throw new Error('履歴の最新が想定と違います（別の runner が先に適用した可能性）。中止します')
    }
    const before = await computeFingerprint(tx)
    if (before !== latest[0].fp) {
      throw new Error('適用直前の fingerprint が、履歴の記録と一致しません（履歴外の変更）。中止します')
    }

    await tx.unsafe(f.content)

    const after = await computeFingerprint(tx)
    await tx`
      insert into console.migration_history
        (migration_version, filename, checksum_sha256, adopted, applied_by, source_git_commit, schema_fingerprint_before, schema_fingerprint_after)
      values (${f.version}, ${f.filename}, ${f.sha256}, false, ${appliedBy(role)}, ${commit}, ${before}, ${after})`
    opts.out(`${OK} ${f.filename}  fingerprint ${short(before)} → ${short(after)}`)
  })
}

// Re-exported for tests.
export { sha256Hex }
