import { execFileSync } from 'node:child_process'

// Which branch a write command may run from: staging for staging / test-onboarding / local, main for production.
export type BaseBranch = 'staging' | 'main'

export interface GitInfo {
  branch: string
  head: string
  baseBranch: BaseBranch
  // origin/<baseBranch>
  originBase: string
  // true when files under the migrations directory differ from what is committed
  migrationsDirty: boolean
}

export type Exec = (cmd: string, args: string[], cwd: string) => string

const defaultExec: Exec = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// execFileSync errors look like "Command failed: git fetch ...\n<stderr>". Keep only the useful
// part (git's own message), a few lines at most.
function gitReason(err: unknown): string {
  const e = err as { stderr?: string | Buffer; message?: string }
  const raw = (e.stderr ? String(e.stderr) : '') || e.message || String(err)
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('Command failed:'))
  return lines.slice(0, 3).join(' / ') || '（git の出力なし）'
}

// A failed git call is never ignored: the guard refuses (fail closed), with a message that says
// what to check.
export class GitGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitGuardError'
  }
}

export function collectGitInfo(cwd: string, migrationsPath: string, exec: Exec = defaultExec, baseBranch: BaseBranch = 'staging'): GitInfo {
  try {
    exec('git', ['fetch', '--quiet', 'origin', baseBranch], cwd)
  } catch (err) {
    throw new GitGuardError(`git fetch に失敗しました（ネットワーク、認証、origin/${baseBranch} の存在を確認してください）: ${gitReason(err)}`)
  }
  try {
    return {
      branch: exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
      head: exec('git', ['rev-parse', 'HEAD'], cwd),
      baseBranch,
      originBase: exec('git', ['rev-parse', `origin/${baseBranch}`], cwd),
      migrationsDirty: exec('git', ['status', '--porcelain', '--', migrationsPath], cwd) !== '',
    }
  } catch (err) {
    throw new GitGuardError(`git の情報を取得できません（git リポジトリの中で実行していますか。origin/${baseBranch} はありますか）: ${gitReason(err)}`)
  }
}

// Staging migrations are applied from the `staging` branch only, identical to origin/staging; production
// migrations only from `main`, identical to origin/main. What is applied is exactly what was reviewed and merged.
export function evaluateGitGuard(info: GitInfo): { ok: boolean; reason: string } {
  const base = info.baseBranch
  if (info.branch === 'HEAD') {
    return { ok: false, reason: `detached HEAD です。${base} ブランチをチェックアウトしてください` }
  }
  if (info.branch !== base) {
    return { ok: false, reason: `migrate は ${base} ブランチでのみ実行できます（現在: ${info.branch}）` }
  }
  if (info.head !== info.originBase) {
    return { ok: false, reason: `ローカルの ${base} が origin/${base} と一致しません（pull して一致させてください）` }
  }
  if (info.migrationsDirty) {
    return { ok: false, reason: 'migrations ディレクトリに、コミットされていない変更があります' }
  }
  return { ok: true, reason: `${base} ブランチが origin/${base} と一致しています` }
}
