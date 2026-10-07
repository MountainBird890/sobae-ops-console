// The git guard against REAL git commands, in throwaway repositories (no network, no dependence on
// this checkout's branch): a local bare "origin" plus a working clone.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { collectGitInfo, evaluateGitGuard, GitGuardError } from '../src/git.ts'

const MIGRATIONS = 'sql/migrations'
let root = ''
let work = ''

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function commitFile(rel: string, content: string, message: string) {
  mkdirSync(join(work, rel, '..'), { recursive: true })
  writeFileSync(join(work, rel), content)
  git(work, 'add', rel)
  git(work, 'commit', '-q', '-m', message)
}

describe('git guard with real git', () => {
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'console-ms-git-'))
    git(root, 'init', '-q', '--bare', '-b', 'staging', 'origin.git')
    work = join(root, 'work')
    git(root, 'init', '-q', '-b', 'staging', 'work')
    commitFile(`${MIGRATIONS}/01_a.sql`, 'select 1;\n', 'init')
    git(work, 'remote', 'add', 'origin', join(root, 'origin.git'))
    git(work, 'push', '-q', '-u', 'origin', 'staging')
  })
  after(() => rmSync(root, { recursive: true, force: true }))

  const check = () => {
    const info = collectGitInfo(work, MIGRATIONS)
    return { info, guard: evaluateGitGuard(info) }
  }

  it('allows a clean staging branch identical to origin/staging', () => {
    const { info, guard } = check()
    assert.equal(info.branch, 'staging')
    assert.equal(info.migrationsDirty, false)
    assert.equal(guard.ok, true)
  })

  it('refuses an untracked file and a modified tracked file under the migrations directory', () => {
    writeFileSync(join(work, MIGRATIONS, '02_probe.sql'), 'select 1;\n')
    assert.equal(check().guard.ok, false)
    assert.equal(check().info.migrationsDirty, true)
    rmSync(join(work, MIGRATIONS, '02_probe.sql'))
    assert.equal(check().guard.ok, true)

    writeFileSync(join(work, MIGRATIONS, '01_a.sql'), 'select 2;\n')
    assert.equal(check().guard.ok, false)
    git(work, 'checkout', '--', `${MIGRATIONS}/01_a.sql`)
    assert.equal(check().guard.ok, true)
  })

  it('ignores changes outside the migrations directory', () => {
    writeFileSync(join(work, 'unrelated.txt'), 'x\n')
    assert.equal(check().guard.ok, true)
    rmSync(join(work, 'unrelated.txt'))
  })

  it('refuses a local commit that origin/staging does not have, and another branch', () => {
    commitFile(`${MIGRATIONS}/02_local_only.sql`, 'select 1;\n', 'local only')
    const ahead = check()
    assert.equal(ahead.guard.ok, false)
    assert.match(ahead.guard.reason, /origin\/staging/)
    git(work, 'reset', '-q', '--hard', 'origin/staging')
    assert.equal(check().guard.ok, true)

    git(work, 'checkout', '-q', '-b', 'feature/x')
    const other = check()
    assert.equal(other.guard.ok, false)
    assert.match(other.guard.reason, /staging ブランチでのみ/)
    git(work, 'checkout', '-q', 'staging')
  })

  it('refuses a detached HEAD', () => {
    git(work, 'checkout', '-q', '--detach')
    assert.equal(check().guard.ok, false)
    git(work, 'checkout', '-q', 'staging')
  })

  it('a failing git fetch is refused with a readable message (not the raw "Command failed")', () => {
    git(work, 'remote', 'set-url', 'origin', join(root, 'does-not-exist.git'))
    try {
      assert.throws(() => collectGitInfo(work, MIGRATIONS), (e: Error) => {
        assert.ok(e instanceof GitGuardError)
        assert.match(e.message, /git fetch に失敗しました/)
        assert.match(e.message, /ネットワーク、認証/)
        assert.ok(!e.message.includes('Command failed'), e.message)
        return true
      })
    } finally {
      git(work, 'remote', 'set-url', 'origin', join(root, 'origin.git'))
    }
    assert.equal(check().guard.ok, true)
  })

  it('a directory that is not a git repository is refused the same way', () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'console-ms-notgit-'))
    try {
      assert.throws(() => collectGitInfo(notRepo, MIGRATIONS), GitGuardError)
    } finally {
      rmSync(notRepo, { recursive: true, force: true })
    }
  })
})

describe('git failure messages (injected commands)', () => {
  it('reports a failing rev-parse / status call as a git guard error with the git reason', () => {
    const exec = (_c: string, args: string[]) => {
      if (args[0] === 'fetch') return ''
      const err = new Error('Command failed: git rev-parse\nfatal: not a git repository') as Error & { stderr: string }
      err.stderr = 'fatal: not a git repository (or any of the parent directories): .git\n'
      throw err
    }
    assert.throws(() => collectGitInfo('/x', MIGRATIONS, exec), (e: Error) => {
      assert.ok(e instanceof GitGuardError)
      assert.match(e.message, /git の情報を取得できません/)
      assert.match(e.message, /not a git repository/)
      assert.ok(!e.message.includes('Command failed'))
      return true
    })
  })
  it('keeps only a few lines of git output', () => {
    const exec = () => {
      const err = new Error('Command failed: git fetch') as Error & { stderr: string }
      err.stderr = ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n')
      throw err
    }
    assert.throws(() => collectGitInfo('/x', MIGRATIONS, exec), (e: Error) => e.message.includes('l3') && !e.message.includes('l4'))
  })
})
