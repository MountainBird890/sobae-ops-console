import { randomInt } from 'node:crypto'
import { createInterface } from 'node:readline/promises'

// Unambiguous characters only (no 0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateCode(length = 6): string {
  let code = ''
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

// Raised when the operator aborts the prompt (Ctrl-C, or the input closes). Nothing has been
// changed at that point; the CLI prints the message without an "error" prefix.
export class ConfirmationAborted extends Error {
  constructor() {
    super('確認コードの入力を中止しました（何も変更していません）')
    this.name = 'ConfirmationAborted'
  }
}

export interface ConfirmIO {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  // Both stdin and stdout must be an interactive terminal.
  isTTY: boolean
}

export function processIO(): ConfirmIO {
  return { input: process.stdin, output: process.stdout, isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY) }
}

// The code is read from an interactive terminal only (never from arguments or env vars),
// so the step cannot be scripted away.
export async function askForCode(expected: string, io: ConfirmIO = processIO()): Promise<boolean> {
  if (!io.isTTY) {
    throw new Error('確認コードの入力には、対話的な端末（TTY）が必要です')
  }
  const rl = createInterface({ input: io.input, output: io.output })
  // If the input closes before an answer arrives (Ctrl-C, Ctrl-D), treat it as an abort.
  const closed = new Promise<never>((_, reject) => rl.once('close', () => reject(new ConfirmationAborted())))
  closed.catch(() => {})
  try {
    const answer = await Promise.race([rl.question(`続行するには、次のコードを入力してください: ${expected}\n> `), closed])
    return answer.trim() === expected
  } catch (err) {
    const e = err as { name?: string; code?: string }
    if (err instanceof ConfirmationAborted || e.name === 'AbortError' || e.code === 'ABORT_ERR') throw new ConfirmationAborted()
    throw err
  } finally {
    rl.close()
  }
}
