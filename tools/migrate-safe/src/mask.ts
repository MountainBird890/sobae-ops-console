// Everything that reaches stdout/stderr goes through maskSecrets(): connection strings
// (user, password, and the project ref embedded in the pooler user name) are never printed.

const URL_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s@/]*@/g

export function maskSecrets(text: string, extraSecrets: readonly string[] = []): string {
  let out = text.replace(URL_CREDENTIALS, '$1***@')
  for (const secret of extraSecrets) {
    if (secret.length >= 4) out = out.split(secret).join('***')
  }
  return out
}
