// Integration tests against a throwaway database cloned from the local Docker dev DB.
// Runs only when CONSOLE_TEST_LOCAL_DB_URL is set (an admin URL on a LOOPBACK host, pointing at
// the `template1` database). Never touches anything that is not a loopback database.
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { cmdInit, cmdMigrate, cmdPlan, cmdStatus, cmdVerify, type RunOptions } from '../src/commands.ts'
import { ConfirmationAborted } from '../src/confirm.ts'
import { isLoopbackHost } from '../src/conn.ts'

const ADMIN_URL = process.env.CONSOLE_TEST_LOCAL_DB_URL
const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL_DIR = join(HERE, '..')
const REPO_ROOT = join(TOOL_DIR, '..', '..')
const REAL_MIGRATIONS = join(REPO_ROOT, 'sql', 'migrations')
const SOBAE_FINGERPRINT_SQL = '/home/arachnet/App/SOBAE-WORKS/db/migrate-safe/fingerprint.sql'

function withDatabase(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

describe('migrate-safe against a throwaway local database', { skip: !ADMIN_URL }, () => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const dbName = `console_ms_test_${suffix}`
  const otherRole = `console_ms_other_${suffix}`
  let admin: postgres.Sql // connected to template1
  let sql: postgres.Sql // connected to the test database (superuser)
  let testUrl = ''
  let dir = ''
  let lines: string[] = []
  let publicFingerprintBefore: string | null = null
  // Roles are cluster-global. `init` requires both Console roles to exist (01_roles.sql creates them
  // in real environments); a freshly reset local dev DB may lack them. Create the missing ones for
  // the run and drop only those afterwards.
  const REQUIRED_ROLES = ['sobae_onboarding_executor', 'sobae_ops_executor']
  const createdRoles: string[] = []

  const run = (environment = 'local', url = testUrl, extra: Partial<RunOptions> = {}): RunOptions => ({
    environment,
    url,
    migrationsDir: dir,
    environmentsFile: join(TOOL_DIR, 'environments.json'),
    repoRoot: REPO_ROOT,
    autotest: true,
    confirm: async () => true,
    out: (l) => lines.push(l),
    ...extra,
  })
  // The confirmation step really runs (only the git guard is skipped; loopback target).
  const prompting = (confirm: (code: string) => Promise<boolean>) =>
    run('local', testUrl, { autotest: false, skipGitGuardForTests: true, confirm })
  const text = () => lines.join('\n')
  const history = async () => await sql<{ migration_version: number; adopted: boolean }[]>`select migration_version, adopted from console.migration_history order by 1`
  // Runs Sobae_Works' own fingerprint.sql (read-only SELECT) so "the runner never touches public"
  // is checked with the same yardstick Sobae_Works' migrate-safe uses. A database cloned from a
  // template does not inherit per-database settings, so search_path is set explicitly (digest()
  // lives in the `extensions` schema). A failure here is a test failure, not a skip.
  const publicFingerprint = async (): Promise<string | null> => {
    if (!existsSync(SOBAE_FINGERPRINT_SQL)) return null
    await sql.unsafe('set search_path = "$user", public, extensions')
    const rows = await sql.unsafe<{ schema_fingerprint: string }[]>(readFileSync(SOBAE_FINGERPRINT_SQL, 'utf8'))
    assert.equal(rows.length, 1)
    return rows[0].schema_fingerprint
  }

  before(async () => {
    assert.ok(ADMIN_URL)
    assert.ok(isLoopbackHost(new URL(ADMIN_URL).hostname), 'CONSOLE_TEST_LOCAL_DB_URL must point at a loopback host')
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} })
    for (const role of REQUIRED_ROLES) {
      const [{ n }] = await admin<{ n: number }[]>`select count(*)::int as n from pg_roles where rolname = ${role}`
      if (n === 0) {
        await admin.unsafe(`create role ${role} nologin`)
        createdRoles.push(role)
      }
    }
    await admin.unsafe(`create database ${dbName} template postgres`)
    testUrl = withDatabase(ADMIN_URL, dbName)
    sql = postgres(testUrl, { max: 1, onnotice: () => {} })
    // Migration 12 refuses to run unless offices has an unconditional SELECT policy for the Console
    // owner role (Sobae_Works adds it in its own migration; the local dev DB may not have it yet).
    // Simulate it in the throwaway database.
    const [{ n: policies }] = await sql<{ n: number }[]>`
      select count(*)::int as n from pg_policy p
      where p.polrelid = 'public.offices'::regclass and p.polcmd = 'r'
        and pg_get_expr(p.polqual, p.polrelid) = 'true'
        and exists (select 1 from pg_roles r where r.rolname = 'sobae_onboarding_executor' and r.oid = any (p.polroles))`
    if (policies === 0) {
      await sql.unsafe(`create policy zz_test_offices_select_owner on public.offices for select to sobae_onboarding_executor using (true)`)
    }
    // Start from the state of a fresh environment: no Console objects in public (the dev DB may
    // still hold the older public-schema versions).
    await sql.unsafe(`
      drop view if exists public.v_organization_summary;
      drop function if exists public.fn_dryrun_onboarding(jsonb, text);
      drop function if exists public.fn_apply_onboarding(jsonb, text);
      drop function if exists public.fn_suspend_organization(uuid, text, text);
      drop function if exists public.fn_reactivate_organization(uuid, text, text);
      drop function if exists public.fn_terminate_organization(uuid, text, text, date);
      drop table if exists public.contract_lifecycle_log;`)
    dir = mkdtempSync(join(tmpdir(), 'console-ms-'))
    for (const n of readdirSync(REAL_MIGRATIONS)) if (n.endsWith('.sql')) copyFileSync(join(REAL_MIGRATIONS, n), join(dir, n))
    publicFingerprintBefore = await publicFingerprint()
  })

  after(async () => {
    try { await sql?.end({ timeout: 5 }) } catch { /* ignore */ }
    if (process.env.CONSOLE_TEST_KEEP_DB === '1') {
      console.log(`CONSOLE_TEST_KEEP_DB=1: database ${dbName} kept; drop it manually`)
    } else {
      try { await admin?.unsafe(`drop database if exists ${dbName}`) } catch { /* ignore */ }
    }
    try { await admin?.unsafe(`drop role if exists ${otherRole}`) } catch { /* ignore */ }
    for (const role of createdRoles) {
      try { await admin?.unsafe(`drop role if exists ${role}`) } catch { /* ignore (e.g. CONSOLE_TEST_KEEP_DB=1 keeps objects that depend on it) */ }
    }
    try { await admin?.end({ timeout: 5 }) } catch { /* ignore */ }
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('before init: status works (gate OK), plan and migrate refuse', async () => {
    lines = []
    assert.equal(await cmdStatus(run()), 0)
    assert.match(text(), /\[OK\] 接続先の照合/)
    assert.match(text(), /未初期化/)
    assert.match(text(), /\[OK\] 所有者ロールへの SET 権限/)
    lines = []
    assert.equal(await cmdPlan(run()), 1)
    lines = []
    assert.equal(await cmdMigrate(run()), 1)
    assert.match(text(), /init/)
  })

  it('init with a wrong confirmation code, or an abort (Ctrl-C), changes nothing', async () => {
    lines = []
    assert.equal(await cmdInit(prompting(async () => false)), 1)
    assert.match(text(), /確認コードが一致しません/)
    assert.equal((await sql`select to_regclass('console.migration_history') as t`)[0].t, null)
    assert.equal((await sql`select to_regclass('console.contract_lifecycle_log') as t`)[0].t, null)
    await assert.rejects(cmdInit(prompting(async () => { throw new ConfirmationAborted() })), ConfirmationAborted)
    assert.equal((await sql`select to_regclass('console.migration_history') as t`)[0].t, null)
    // a prompt is actually shown a code to type (the callback receives it)
    let seen = ''
    await cmdInit(prompting(async (code) => { seen = code; return false }))
    assert.match(seen, /^[A-Z2-9]{6}$/)
  })

  it('init adopts 01 and is idempotent', async () => {
    lines = []
    assert.equal(await cmdInit(run()), 0)
    const h = await history()
    assert.deepEqual(h.map((r) => [r.migration_version, r.adopted]), [[1, true]])
    lines = []
    assert.equal(await cmdInit(run()), 0)
    assert.match(text(), /既に初期化済み/)
    assert.equal((await history()).length, 1)
  })

  it('migrate with a wrong confirmation code, or an abort (Ctrl-C), applies nothing', async () => {
    lines = []
    assert.equal(await cmdMigrate(prompting(async () => false)), 1)
    assert.match(text(), /確認コードが一致しません/)
    assert.equal((await history()).length, 1)
    await assert.rejects(cmdMigrate(prompting(async () => { throw new ConfirmationAborted() })), ConfirmationAborted)
    assert.equal((await history()).length, 1)
    assert.equal((await sql`select to_regclass('console.contract_lifecycle_log') as t`)[0].t, null)
    lines = []
    assert.equal(await cmdVerify(run()), 0)
  })

  it('plan lists 02..12 as pending and passes every check', async () => {
    lines = []
    assert.equal(await cmdPlan(run()), 0)
    assert.match(text(), /未適用ファイル: 11 件/)
    assert.match(text(), /migrate 可能: はい/)
  })

  it('migrate applies 02..12, then status / verify are clean and a second migrate is a no-op', async () => {
    lines = []
    assert.equal(await cmdMigrate(run()), 0)
    const h = await history()
    assert.deepEqual(h.map((r) => r.migration_version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    lines = []
    assert.equal(await cmdStatus(run()), 0)
    assert.match(text(), /未適用: なし/)
    assert.match(text(), /fingerprint: 一致/)
    lines = []
    assert.equal(await cmdVerify(run()), 0)
    assert.match(text(), /verify: 問題なし/)
    lines = []
    assert.equal(await cmdMigrate(run()), 0)
    assert.match(text(), /適用するファイルはありません/)
  })

  it('the applied objects are closed to PUBLIC / anon / authenticated / service_role', async () => {
    const fns = await sql<{ fn: string; leaked: boolean; ops: boolean; owner: string }[]>`
      select p.oid::regprocedure::text as fn,
             (has_function_privilege('public', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')
              or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE')) as leaked,
             has_function_privilege('sobae_ops_executor', p.oid, 'EXECUTE') as ops,
             pg_get_userbyid(p.proowner)::text as owner
      from pg_proc p where p.pronamespace = 'console'::regnamespace`
    assert.equal(fns.length, 7) // 5 from 04..08 + fn_suspend_office / fn_reactivate_office (12)
    for (const f of fns) {
      assert.equal(f.leaked, false, f.fn)
      assert.equal(f.ops, true, f.fn)
      assert.equal(f.owner, 'sobae_onboarding_executor', f.fn)
    }
    const rels = await sql<{ relname: string; leaked: boolean }[]>`
      select c.relname::text, (has_table_privilege('public', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'SELECT')
             or has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('service_role', c.oid, 'SELECT')) as leaked
      from pg_class c where c.relnamespace = 'console'::regnamespace and c.relkind in ('r','v')`
    for (const r of rels) assert.equal(r.leaked, false, r.relname)
    const [{ usage }] = await sql<{ usage: boolean }[]>`select (has_schema_privilege('anon','console','USAGE') or has_schema_privilege('authenticated','console','USAGE') or has_schema_privilege('public','console','USAGE')) as usage`
    assert.equal(usage, false)
  })

  it('refuses a changed applied file (checksum) in verify and migrate', async () => {
    const target = join(dir, '05_fn_dryrun_onboarding.sql')
    const original = readFileSync(target, 'utf8')
    appendFileSync(target, '\n-- tampered\n')
    try {
      lines = []
      assert.equal(await cmdVerify(run()), 1)
      assert.match(text(), /チェックサム/)
      writeFileSync(join(dir, '13_ok.sql'), 'create table console.zz_probe (id int);\n')
      lines = []
      assert.equal(await cmdMigrate(run()), 1)
      assert.equal((await sql`select to_regclass('console.zz_probe') as t`)[0].t, null)
    } finally {
      writeFileSync(target, original)
      rmSync(join(dir, '13_ok.sql'), { force: true })
    }
    lines = []
    assert.equal(await cmdVerify(run()), 0)
  })

  it('refuses out-of-band drift and recovers when it is undone', async () => {
    await sql.unsafe('alter table console.contract_lifecycle_log add column zz_drift int')
    writeFileSync(join(dir, '13_ok.sql'), 'create table console.zz_probe (id int);\n')
    try {
      lines = []
      assert.equal(await cmdVerify(run()), 1)
      assert.match(text(), /不一致/)
      lines = []
      assert.equal(await cmdMigrate(run()), 1)
      assert.equal((await sql`select to_regclass('console.zz_probe') as t`)[0].t, null)
    } finally {
      await sql.unsafe('alter table console.contract_lifecycle_log drop column zz_drift')
      rmSync(join(dir, '13_ok.sql'), { force: true })
    }
    lines = []
    assert.equal(await cmdVerify(run()), 0)
  })

  it('a failing migration is rolled back completely and leaves no history', async () => {
    // syntax error
    writeFileSync(join(dir, '13_bad_syntax.sql'), 'create table console.zz_bad (id int;\n')
    lines = []
    await assert.rejects(cmdMigrate(run()))
    // partial failure after a successful statement: the whole file must roll back
    writeFileSync(join(dir, '13_bad_syntax.sql'), 'create table console.zz_partial (id int);\nselect 1/0;\n')
    lines = []
    await assert.rejects(cmdMigrate(run()))
    rmSync(join(dir, '13_bad_syntax.sql'), { force: true })
    assert.equal((await history()).length, 12)
    assert.equal((await sql`select to_regclass('console.zz_partial') as t`)[0].t, null)
    lines = []
    assert.equal(await cmdVerify(run()), 0)
  })

  it('refuses forbidden SQL and number gaps in plan and migrate', async () => {
    writeFileSync(join(dir, '13_commit.sql'), 'create table console.zz_c (id int);\ncommit;\n')
    lines = []
    assert.equal(await cmdPlan(run()), 1)
    assert.match(text(), /トランザクション制御/)
    lines = []
    assert.equal(await cmdMigrate(run()), 1)
    assert.equal((await sql`select to_regclass('console.zz_c') as t`)[0].t, null)
    rmSync(join(dir, '13_commit.sql'), { force: true })

    writeFileSync(join(dir, '14_gap.sql'), 'create table console.zz_gap (id int);\n')
    lines = []
    assert.equal(await cmdPlan(run()), 1)
    assert.match(text(), /欠番/)
    lines = []
    assert.equal(await cmdMigrate(run()), 1)
    assert.equal((await sql`select to_regclass('console.zz_gap') as t`)[0].t, null)
    rmSync(join(dir, '14_gap.sql'), { force: true })
  })

  it('the staging profile refuses this database (database_id / project_ref mismatch)', async () => {
    lines = []
    assert.equal(await cmdStatus(run('staging')), 1)
    assert.match(text(), /\[NG\] 接続先の照合/)
    lines = []
    assert.equal(await cmdMigrate(run('staging')), 1)
  })

  it('refuses to run as a role other than postgres', async () => {
    await admin.unsafe(`create role ${otherRole} login superuser password 'pw_${suffix}'`)
    const u = new URL(testUrl)
    u.username = otherRole
    u.password = `pw_${suffix}`
    lines = []
    assert.equal(await cmdStatus(run('local', u.toString())), 1)
    assert.match(text(), /\[NG\] 接続ロール/)
    lines = []
    assert.equal(await cmdMigrate(run('local', u.toString())), 1)
  })

  it('applies a valid new migration (13) and records before/after fingerprints', async () => {
    writeFileSync(join(dir, '13_zz_probe.sql'), 'create table console.zz_probe (id int);\n')
    lines = []
    assert.equal(await cmdMigrate(run()), 0)
    const rows = await sql<{ before: string; after: string }[]>`
      select schema_fingerprint_before as before, schema_fingerprint_after as after from console.migration_history where migration_version = 13`
    assert.equal(rows.length, 1)
    assert.notEqual(rows[0].before, rows[0].after)
    lines = []
    assert.equal(await cmdVerify(run()), 0)
  })

  it('never changed the public schema (Sobae_Works fingerprint identical before/after)', async () => {
    const after = await publicFingerprint()
    if (publicFingerprintBefore === null || after === null) {
      console.log('NOT CHECKED: the Sobae_Works fingerprint.sql file is not available on this machine')
      return
    }
    assert.match(after, /^[0-9a-f]{64}$/)
    assert.equal(after, publicFingerprintBefore)
  })
})
