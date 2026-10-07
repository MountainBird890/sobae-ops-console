import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseArgs } from '../src/args.ts'
import { extractProjectRef, isLoopbackHost, parseConnection } from '../src/conn.ts'
import { assertEnvironmentName, evaluateGate, type EnvironmentsConfig } from '../src/env.ts'
import { autotestApplies } from '../src/commands.ts'
import { analyze, parseFilename, sha256Hex, type HistoryRow, type MigrationFile } from '../src/files.ts'
import { collectGitInfo, evaluateGitGuard, type GitInfo } from '../src/git.ts'
import { maskSecrets } from '../src/mask.ts'
import { describeSetRole, evaluateSetRole, SET_ROLE_REQUIRED } from '../src/prereq.ts'
import { findForbidden, stripSqlNoise } from '../src/sqlscan.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(HERE, '..', '..', '..', 'sql', 'migrations')

const REF = 'abcdefghijklmnopqrst' // 20 chars, a stand-in for a project ref
const STAGING_ID = '11111111-1111-1111-1111-111111111111'
const PROD_ID = '99999999-9999-9999-9999-999999999999'
const TEST_REF = 'tttttttttttttttttttt' // 20 chars, a stand-in for the test-onboarding project ref
const CONFIG: EnvironmentsConfig = {
  environments: {
    staging: { database_id: STAGING_ID, project_ref: REF },
    'test-onboarding': { project_ref: TEST_REF, require_no_database_id: true },
    local: { loopback_only: true },
  },
  refuse_database_ids: [PROD_ID],
}
const poolerConn = parseConnection(`postgresql://postgres.${REF}:secretpw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`)
const localConn = parseConnection('postgresql://postgres:secretpw@127.0.0.1:5433/postgres')
const testConn = parseConnection(`postgresql://postgres.${TEST_REF}:secretpw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`)

describe('maskSecrets', () => {
  it('masks credentials in URLs, including the pooler user (which carries the project ref)', () => {
    const out = maskSecrets(`failed: postgresql://postgres.${REF}:secretpw@host:5432/db`)
    assert.equal(out, 'failed: postgresql://***@host:5432/db')
    assert.ok(!out.includes('secretpw') && !out.includes(REF))
  })
  it('masks extra secrets wherever they appear', () => {
    assert.equal(maskSecrets('password is secretpw here', ['secretpw']), 'password is *** here')
  })
})

describe('connection helpers', () => {
  it('extracts the project ref from the pooler user name and from the direct host', () => {
    assert.equal(extractProjectRef('aws-0-x.pooler.supabase.com', `postgres.${REF}`), REF)
    assert.equal(extractProjectRef(`db.${REF}.supabase.co`, 'postgres'), REF)
  })
  it('returns null (callers fail closed) when no ref can be found', () => {
    assert.equal(extractProjectRef('127.0.0.1', 'postgres'), null)
    assert.equal(extractProjectRef('aws-0-x.pooler.supabase.com', 'postgres'), null)
  })
  it('detects loopback hosts only', () => {
    for (const h of ['localhost', '127.0.0.1', '::1', '[::1]']) assert.equal(isLoopbackHost(h), true)
    for (const h of ['db.example.com', '10.0.0.1', '127.0.0.1.evil.com']) assert.equal(isLoopbackHost(h), false)
  })
  it('never echoes the URL in parse errors', () => {
    assert.throws(() => parseConnection('not a url secretpw'), (e: Error) => !e.message.includes('secretpw'))
    assert.throws(() => parseConnection('mysql://u:secretpw@h/db'), (e: Error) => !e.message.includes('secretpw'))
  })
})

describe('forbidden SQL scan', () => {
  const rules = (sql: string) => findForbidden(sql).map((f) => f.rule)

  it('refuses transaction control and statements that cannot run in a transaction', () => {
    for (const sql of ['begin;', 'BEGIN', 'commit;', 'rollback;', 'end;', 'abort;', 'start transaction;', 'savepoint a;', 'release a;',
      'prepare transaction \'x\';', 'vacuum;', 'create index concurrently i on t (c);', 'create unique index concurrently i on t (c);',
      'drop index concurrently i;', 'reindex index concurrently i;', 'alter system set x = 1;', 'create database d;', 'drop database d;']) {
      assert.ok(rules(`select 1; ${sql}`).length > 0, `should refuse: ${sql}`)
    }
  })
  it('refuses psql meta-commands', () => {
    assert.deepEqual(rules('select 1;\n\\i other.sql\n'), ['psql-meta-command'])
  })
  it('does NOT flag begin/end/commit inside dollar-quoted bodies, strings or comments', () => {
    const sql = `
      -- commit; rollback; begin;
      /* nested /* commit; */ still comment begin; */
      select 'begin; commit;';
      select E'it\\'s begin; end;';
      select "commit" from t;
      do $$ begin perform 1; end $$;
      create or replace function f() returns int language plpgsql as $body$
      begin
        commit_not_really();
        return 1;
      end;
      $body$;`
    assert.deepEqual(findForbidden(sql), [])
  })
  it('reports unterminated constructs instead of guessing', () => {
    assert.equal(stripSqlNoise("select 'abc").unterminated !== null, true)
    assert.equal(stripSqlNoise('do $$ begin').unterminated !== null, true)
    assert.equal(stripSqlNoise('/* open').unterminated !== null, true)
  })
  it('every existing Console migration (01..11) passes the scan', () => {
    const names = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql'))
    assert.ok(names.length >= 10)
    for (const n of names) {
      const found = findForbidden(readFileSync(join(MIGRATIONS_DIR, n), 'utf8'))
      assert.deepEqual(found, [], `${n}: ${JSON.stringify(found)}`)
    }
  })
})

function file(version: number, name: string, content = 'select 1;'): MigrationFile {
  return { version, filename: name, sha256: sha256Hex(content), content }
}
function row(version: number, name: string, content = 'select 1;', adopted = false): HistoryRow {
  return { migration_version: version, filename: name, checksum_sha256: sha256Hex(content), adopted, schema_fingerprint_after: 'fp' }
}

describe('migration file analysis', () => {
  it('parses file names', () => {
    assert.deepEqual(parseFilename('02_console_schema.sql'), { version: 2, slug: 'console_schema' })
    assert.equal(parseFilename('README.md'), null)
    assert.equal(parseFilename('2_x.sql'), null)
    assert.equal(parseFilename('03_Bad_Case.sql'), null)
    assert.equal(parseFilename('03_x.SQL'), null)
  })
  it('accepts a clean history with contiguous pending files', () => {
    const a = analyze([file(1, '01_a.sql'), file(2, '02_b.sql'), file(3, '03_c.sql')], [], [row(1, '01_a.sql', 'select 1;', true), row(2, '02_b.sql')])
    assert.deepEqual(a.problems, [])
    assert.deepEqual(a.pending.map((f) => f.filename), ['03_c.sql'])
  })
  it('refuses a changed applied file (checksum mismatch)', () => {
    const a = analyze([file(1, '01_a.sql', 'select 2;')], [], [row(1, '01_a.sql')])
    assert.ok(a.problems.some((p) => p.includes('チェックサム')))
  })
  it('refuses a missing applied file, a renamed file, and a number gap', () => {
    assert.ok(analyze([], [], [row(1, '01_a.sql')]).problems.some((p) => p.includes('ファイルがありません')))
    assert.ok(analyze([file(1, '01_other.sql')], [], [row(1, '01_a.sql')]).problems.some((p) => p.includes('ファイル名が一致しません')))
    assert.ok(analyze([file(1, '01_a.sql'), file(3, '03_c.sql')], [], [row(1, '01_a.sql')]).problems.some((p) => p.includes('欠番')))
    assert.ok(analyze([file(1, '01_a.sql'), file(12, '12_z.sql')], [], [row(1, '01_a.sql'), row(2, '02_b.sql')]).problems.length > 0)
  })
  it('refuses duplicate numbers, invalid names, and an unrecorded file below the latest version', () => {
    assert.ok(analyze([file(2, '02_a.sql'), file(2, '02_b.sql')], [], [row(1, '01_a.sql')]).problems.some((p) => p.includes('重複')))
    assert.ok(analyze([], ['Bad.sql'], []).problems.some((p) => p.includes('命名規則')))
    assert.ok(analyze([file(1, '01_a.sql'), file(2, '02_b.sql'), file(3, '03_c.sql')], [], [row(1, '01_a.sql'), row(3, '03_c.sql')]).problems.some((p) => p.includes('履歴にありません')))
  })
  it('refuses pending files that contain forbidden SQL', () => {
    const a = analyze([file(1, '01_a.sql'), file(2, '02_bad.sql', 'select 1; commit;')], [], [row(1, '01_a.sql')])
    assert.ok(a.problems.some((p) => p.includes('02_bad.sql')))
    assert.equal(a.findings.get('02_bad.sql')?.[0].rule, 'transaction-control')
  })
})

describe('environment gate', () => {
  const gate = (environment: string, databaseId: string | null, connection = poolerConn) =>
    evaluateGate({ environment, config: CONFIG, databaseId, connection })

  it('refuses production and unknown environment names before connecting', () => {
    assert.throws(() => assertEnvironmentName('production'), /production/)
    assert.throws(() => assertEnvironmentName('some-other-env'), /未知/)
    assert.throws(() => assertEnvironmentName(''), /未知/)
    assert.doesNotThrow(() => assertEnvironmentName('staging'))
    assert.doesNotThrow(() => assertEnvironmentName('test-onboarding'))
    assert.doesNotThrow(() => assertEnvironmentName('local'))
  })
  it('staging: matches only on the exact database_id (and project_ref)', () => {
    assert.equal(gate('staging', STAGING_ID).ok, true)
    assert.equal(gate('staging', 'other-id').status, 'mismatch')
    assert.equal(gate('staging', null).status, 'no_database_state')
  })
  it('staging: refuses when the project ref differs or cannot be read (fail closed)', () => {
    const otherRef = parseConnection('postgresql://postgres.zzzzzzzzzzzzzzzzzzzz:pw@aws-0-x.pooler.supabase.com:5432/postgres')
    assert.equal(gate('staging', STAGING_ID, otherRef).status, 'project_ref_mismatch')
    assert.equal(gate('staging', STAGING_ID, localConn).status, 'project_ref_mismatch')
  })
  it('refuses the production database_id whatever environment is requested', () => {
    assert.equal(gate('staging', PROD_ID).status, 'refused_database_id')
    assert.equal(gate('local', PROD_ID, localConn).status, 'refused_database_id')
  })
  it('local: loopback only, no database_id needed', () => {
    assert.equal(gate('local', null, localConn).ok, true)
    assert.equal(gate('local', 'anything', localConn).ok, true)
    assert.equal(gate('local', null, poolerConn).status, 'loopback_required')
  })
  it('test-onboarding: accepted only for a database WITHOUT a registered database_id and a matching project_ref', () => {
    assert.equal(gate('test-onboarding', null, testConn).ok, true)
    assert.equal(gate('test-onboarding', null, testConn).status, 'match')
  })
  it('test-onboarding: a database that has a database_id (staging parent / production) is never accepted under this name', () => {
    assert.equal(gate('test-onboarding', STAGING_ID, testConn).status, 'database_id_registered')
    assert.equal(gate('test-onboarding', 'any-other-id', testConn).status, 'database_id_registered')
    // the production id is refused outright, before anything else
    assert.equal(gate('test-onboarding', PROD_ID, testConn).status, 'refused_database_id')
    // even when the staging parent is reached with the test-onboarding project ref in the URL
    assert.equal(gate('test-onboarding', STAGING_ID, poolerConn).ok, false)
  })
  it('test-onboarding: refuses a different project (staging parent URL) and an unreadable ref (fail closed)', () => {
    assert.equal(gate('test-onboarding', null, poolerConn).status, 'project_ref_mismatch') // staging parent ref
    assert.equal(gate('test-onboarding', null, localConn).status, 'project_ref_mismatch') // no ref in a loopback URL
  })
  it('staging profile still refuses the test-onboarding database (no database_id there)', () => {
    assert.equal(gate('staging', null, testConn).status, 'no_database_state')
  })
  it('test-onboarding: configuration errors are reported (no project_ref, or both database_id and require_no_database_id)', () => {
    const noRef: EnvironmentsConfig = { environments: { 'test-onboarding': { require_no_database_id: true } }, refuse_database_ids: [] }
    assert.equal(evaluateGate({ environment: 'test-onboarding', config: noRef, databaseId: null, connection: testConn }).status, 'config_error')
    const both: EnvironmentsConfig = { environments: { 'test-onboarding': { project_ref: TEST_REF, database_id: 'x', require_no_database_id: true } }, refuse_database_ids: [] }
    assert.equal(evaluateGate({ environment: 'test-onboarding', config: both, databaseId: null, connection: testConn }).status, 'config_error')
  })
  it('messages never contain database_id or project_ref values', () => {
    const results = [
      gate('staging', 'other-id'), gate('staging', PROD_ID), gate('staging', STAGING_ID, localConn), gate('staging', STAGING_ID),
      gate('test-onboarding', STAGING_ID, testConn), gate('test-onboarding', null, poolerConn), gate('test-onboarding', null, testConn),
    ]
    for (const r of results) {
      for (const secret of [STAGING_ID, PROD_ID, REF, TEST_REF, 'other-id']) assert.ok(!r.detail.includes(secret), r.detail)
    }
  })
  it('reports configuration errors (unknown profile, staging id equal to a refused id)', () => {
    assert.equal(evaluateGate({ environment: 'staging', config: { environments: {}, refuse_database_ids: [] }, databaseId: 'x', connection: poolerConn }).status, 'config_error')
    const bad: EnvironmentsConfig = { environments: { staging: { database_id: PROD_ID } }, refuse_database_ids: [PROD_ID] }
    assert.equal(evaluateGate({ environment: 'staging', config: bad, databaseId: PROD_ID, connection: poolerConn }).status, 'config_error')
  })
})

describe('git guard', () => {
  const base: GitInfo = { branch: 'staging', head: 'abc', originStaging: 'abc', migrationsDirty: false }
  it('allows only a clean staging branch identical to origin/staging', () => {
    assert.equal(evaluateGitGuard(base).ok, true)
    assert.equal(evaluateGitGuard({ ...base, branch: 'feature/x' }).ok, false)
    assert.equal(evaluateGitGuard({ ...base, branch: 'main' }).ok, false)
    assert.equal(evaluateGitGuard({ ...base, branch: 'HEAD' }).ok, false)
    assert.equal(evaluateGitGuard({ ...base, head: 'def' }).ok, false)
    assert.equal(evaluateGitGuard({ ...base, migrationsDirty: true }).ok, false)
  })
  it('collects git info with injected commands (fetch first, no real git needed)', () => {
    const calls: string[] = []
    const info = collectGitInfo('/repo', 'sql/migrations', (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`)
      if (args[0] === 'status') return ' M sql/migrations/x.sql'
      if (args.includes('--abbrev-ref')) return 'staging'
      return 'sha'
    })
    assert.equal(info.migrationsDirty, true)
    assert.equal(info.branch, 'staging')
    assert.equal(calls[0], 'git fetch --quiet origin staging')
  })
})

describe('argument parsing', () => {
  it('accepts <command> --environment=<name>', () => {
    assert.deepEqual(parseArgs(['status', '--environment=staging']), { command: 'status', environment: 'staging' })
  })
  it('rejects unknown commands, missing/duplicate/empty environment and unknown flags', () => {
    assert.throws(() => parseArgs([]), /未知のコマンド/)
    assert.throws(() => parseArgs(['nope', '--environment=staging']), /未知のコマンド/)
    assert.throws(() => parseArgs(['status']), /必須/)
    assert.throws(() => parseArgs(['status', '--environment=']), /値/)
    assert.throws(() => parseArgs(['status', '--environment=staging', '--environment=local']), /複数回/)
    assert.throws(() => parseArgs(['status', '--environment=staging', '--force']), /未知の引数/)
    assert.throws(() => parseArgs(['status', '--env=staging']), /未知の引数/)
  })
})

describe('autotest escape hatch', () => {
  it('applies only to loopback targets and only when requested', () => {
    assert.equal(autotestApplies(true, { loopback: true }), true)
    assert.equal(autotestApplies(true, { loopback: false }), false)
    assert.equal(autotestApplies(false, { loopback: true }), false)
    assert.equal(autotestApplies(undefined, { loopback: true }), false)
  })
  it('is never honoured for the connections used against Supabase', () => {
    assert.equal(autotestApplies(true, poolerConn), false)
    assert.equal(autotestApplies(true, testConn), false)
    assert.equal(autotestApplies(true, localConn), true)
  })
})

describe('SET ROLE prerequisite', () => {
  const OWNER = 'sobae_onboarding_executor'
  it('passes when the connected role can SET ROLE to the owner role', () => {
    const c = evaluateSetRole([{ rolname: OWNER, can_set: true }])
    assert.deepEqual(c, { ok: true, blocked: [], missing: [] })
    assert.match(describeSetRole(c, 'postgres'), /SET ROLE できます/)
  })
  it('fails when the role exists but SET is not granted (ADMIN OPTION only, the 2026-10-07 staging parent state)', () => {
    const c = evaluateSetRole([{ rolname: OWNER, can_set: false }])
    assert.equal(c.ok, false)
    assert.deepEqual(c.blocked, [OWNER])
    const msg = describeSetRole(c, 'postgres')
    assert.match(msg, /SET ROLE できません/)
    assert.match(msg, /with inherit true, set true/)
    assert.match(msg, /承認/)
  })
  it('does not treat a missing role as a SET failure (init reports missing roles itself)', () => {
    const c = evaluateSetRole([])
    assert.equal(c.ok, true)
    assert.deepEqual(c.missing, [...SET_ROLE_REQUIRED])
    assert.match(describeSetRole(c, 'postgres'), /まだありません/)
  })
  it('ignores roles that are not required', () => {
    const c = evaluateSetRole([{ rolname: 'some_other_role', can_set: false }, { rolname: OWNER, can_set: true }])
    assert.equal(c.ok, true)
  })
})
