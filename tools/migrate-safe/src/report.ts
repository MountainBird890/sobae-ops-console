import { ConfirmationAborted } from './confirm.ts'
import { maskSecrets } from './mask.ts'

// Text printed to stderr for a fatal error. An aborted confirmation is not an "error": it starts on
// a fresh line (the prompt leaves the cursor after "> ") and says that nothing was changed.
export function formatFatal(err: unknown, secrets: readonly string[] = []): string {
  if (err instanceof ConfirmationAborted) return `\n${err.message}`
  return `エラー: ${maskSecrets(err instanceof Error ? err.message : String(err), secrets)}`
}
