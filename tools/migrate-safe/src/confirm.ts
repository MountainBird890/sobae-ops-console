import { randomInt } from 'node:crypto'
import { createInterface } from 'node:readline/promises'

// Unambiguous characters only (no 0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateCode(length = 6): string {
  let code = ''
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

// The code is read from an interactive terminal only (never from arguments or env vars),
// so the step cannot be scripted away.
export async function askForCode(expected: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('確認コードの入力には、対話的な端末（TTY）が必要です')
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`続行するには、次のコードを入力してください: ${expected}\n> `)
    return answer.trim() === expected
  } finally {
    rl.close()
  }
}
