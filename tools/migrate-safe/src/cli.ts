import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cmdInit, cmdMigrate, cmdPlan, cmdStatus, cmdVerify, type RunOptions } from './commands.ts'
import { askForCode } from './confirm.ts'
import { parseConnection } from './conn.ts'
import { parseArgs } from './args.ts'
import { assertEnvironmentName } from './env.ts'
import { maskSecrets } from './mask.ts'
import { formatFatal } from './report.ts'

const HANDLERS = { init: cmdInit, status: cmdStatus, plan: cmdPlan, migrate: cmdMigrate, verify: cmdVerify } as const

const TOOL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(TOOL_DIR, '..', '..')

async function main(): Promise<number> {
  const secrets: string[] = []
  const out = (line: string) => console.log(maskSecrets(line, secrets))
  try {
    const { command, environment } = parseArgs(process.argv.slice(2))
    assertEnvironmentName(environment) // production / unknown names are refused before anything else

    const url = process.env.CONSOLE_ADMIN_DATABASE_URL
    if (!url) throw new Error('環境変数 CONSOLE_ADMIN_DATABASE_URL が設定されていません')
    secrets.push(url, parseConnection(url).password)

    const opts: RunOptions = {
      environment,
      url,
      migrationsDir: join(REPO_ROOT, 'sql', 'migrations'),
      environmentsFile: join(TOOL_DIR, 'environments.json'),
      repoRoot: REPO_ROOT,
      autotest: process.env.CONSOLE_MIGRATE_AUTOTEST === '1',
      confirm: askForCode,
      out,
    }
    return await HANDLERS[command](opts)
  } catch (err) {
    console.error(formatFatal(err, secrets))
    return 1
  }
}

process.exitCode = await main()
