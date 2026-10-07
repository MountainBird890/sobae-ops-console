// Tiny program used by confirm.test.ts: asks for the code ABC123 and prints how it ended.
import { askForCode, ConfirmationAborted } from '../../src/confirm.ts'

try {
  const ok = await askForCode('ABC123')
  console.log(`RESULT:${ok ? 'match' : 'mismatch'}`)
} catch (err) {
  if (err instanceof ConfirmationAborted) {
    console.log('RESULT:aborted')
    process.exitCode = 2
  } else {
    console.log(`RESULT:error:${(err as Error).message}`)
    process.exitCode = 1
  }
}
