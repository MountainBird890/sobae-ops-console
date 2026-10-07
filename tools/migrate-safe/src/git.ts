import { execFileSync } from 'node:child_process'

export interface GitInfo {
  branch: string
  head: string
  originStaging: string
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

export function collectGitInfo(cwd: string, migrationsPath: string, exec: Exec = defaultExec): GitInfo {
  try {
    exec('git', ['fetch', '--quiet', 'origin', 'staging'], cwd)
  } catch (err) {
    throw new GitGuardError(`git fetch に失敗しました（ネットワーク、認証、origin/staging の存在を確認してください）: ${gitReason(err)}`)
  }
  try {
    return {
      branch: exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
      head: exec('git', ['rev-parse', 'HEAD'], cwd),
      originStaging: exec('git', ['rev-parse', 'origin/staging'], cwd),
      migrationsDirty: exec('git', ['status', '--porcelain', '--', migrationsPath], cwd) !== '',
    }
  } catch (err) {
    throw new GitGuardError(`git の情報を取得できません（git リポジトリの中で実行していますか。origin/staging はありますか）: ${gitReason(err)}`)
  }
}

// Staging migrations are applied from the `staging` branch only, identical to origin/staging,
// so what is applied is exactly what was reviewed and merged.
export function evaluateGitGuard(info: GitInfo): { ok: boolean; reason: string } {
  if (info.branch === 'HEAD') {
    return { ok: false, reason: 'detached HEAD です。staging ブランチをチェックアウトしてください' }
  }
  if (info.branch !== 'staging') {
    return { ok: false, reason: `migrate は staging ブランチでのみ実行できます（現在: ${info.branch}）` }
  }
  if (info.head !== info.originStaging) {
    return { ok: false, reason: 'ローカルの staging が origin/staging と一致しません（pull して一致させてください）' }
  }
  if (info.migrationsDirty) {
    return { ok: false, reason: 'migrations ディレクトリに、コミットされていない変更があります' }
  }
  return { ok: true, reason: 'staging ブランチが origin/staging と一致しています' }
}
