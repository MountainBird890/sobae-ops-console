import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const TOOL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

function runCli(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: TOOL_DIR,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
    timeout: 30_000,
  })
}

// The URL below points at a port nothing listens on: if the CLI ever tried to connect, the
// run would fail differently (connection error) — these cases must be refused earlier.
const BOGUS_URL = 'postgresql://postgres:secretpw@127.0.0.1:1/postgres'

describe('CLI refusals happen before any connection', () => {
  it('refuses --environment=production', () => {
    const r = runCli(['migrate', '--environment=production'], { CONSOLE_ADMIN_DATABASE_URL: BOGUS_URL })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /production/)
    assert.doesNotMatch(r.stderr, /ECONNREFUSED|connect/i)
  })
  it('refuses an unknown environment and a missing --environment', () => {
    const unknown = runCli(['status', '--environment=some-other-env'], { CONSOLE_ADMIN_DATABASE_URL: BOGUS_URL })
    assert.equal(unknown.status, 1)
    assert.match(unknown.stderr, /未知/)
    assert.doesNotMatch(unknown.stderr, /ECONNREFUSED|connect/i)
    assert.equal(runCli(['status'], { CONSOLE_ADMIN_DATABASE_URL: BOGUS_URL }).status, 1)
  })
  it('requires CONSOLE_ADMIN_DATABASE_URL and never prints its value', () => {
    const none = runCli(['status', '--environment=staging'])
    assert.equal(none.status, 1)
    assert.match(none.stderr, /CONSOLE_ADMIN_DATABASE_URL/)
    const bad = runCli(['status', '--environment=local'], { CONSOLE_ADMIN_DATABASE_URL: BOGUS_URL })
    assert.equal(bad.status, 1)
    assert.doesNotMatch(bad.stdout + bad.stderr, /secretpw/)
  })
})
