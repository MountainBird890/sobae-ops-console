import { KNOWN_ENVIRONMENTS } from './env.ts'

export const COMMANDS = ['init', 'status', 'plan', 'migrate', 'verify'] as const
export type CommandName = (typeof COMMANDS)[number]

export function usage(): string {
  return [
    '使い方: tsx src/cli.ts <command> --environment=<name>',
    `  command: ${COMMANDS.join(' | ')}`,
    `  --environment=<name> は必須です（${KNOWN_ENVIRONMENTS.join(' | ')}。production は、環境変数 CONSOLE_ALLOW_PRODUCTION=1 の明示が必要です）`,
    '  接続文字列は、環境変数 CONSOLE_ADMIN_DATABASE_URL から読みます',
  ].join('\n')
}

// Accepts exactly: <command> --environment=<name>. Anything else stops before any connection.
export function parseArgs(argv: string[]): { command: CommandName; environment: string } {
  const [command, ...rest] = argv
  if (!command || !(COMMANDS as readonly string[]).includes(command)) throw new Error(`未知のコマンドです。\n${usage()}`)
  let environment: string | null = null
  for (const arg of rest) {
    const m = /^--environment=(.*)$/.exec(arg)
    if (!m) throw new Error(`未知の引数です: ${arg}（受け付けるのは --environment=<name> のみです）`)
    if (m[1] === '') throw new Error('--environment に値を指定してください')
    if (environment !== null) throw new Error('--environment が複数回指定されています')
    environment = m[1]
  }
  if (environment === null) throw new Error(`--environment=<name> の指定が必須です\n${usage()}`)
  return { command: command as CommandName, environment }
}

