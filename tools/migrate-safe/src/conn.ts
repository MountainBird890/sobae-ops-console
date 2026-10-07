// Connection-string helpers. Nothing here ever includes the URL (or any part of it) in an
// error message.

export interface ConnectionInfo {
  hostname: string
  port: string
  username: string
  password: string
  projectRef: string | null
  loopback: boolean
}

// Supabase project refs are 20 lowercase alphanumerics.
const DIRECT_HOST_RE = /^db\.([a-z0-9]{20})\.supabase\.co$/
const POOLER_USER_RE = /^[^.]+\.([a-z0-9]{20})$/

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
}

// Direct connection: host db.<ref>.supabase.co. Pooler: user name <role>.<ref>.
// Returns null when neither shape matches (callers must fail closed).
export function extractProjectRef(hostname: string, username: string): string | null {
  const direct = DIRECT_HOST_RE.exec(hostname.toLowerCase())
  if (direct) return direct[1]
  const pooler = POOLER_USER_RE.exec(username)
  if (pooler) return pooler[1]
  return null
}

export function parseConnection(url: string): ConnectionInfo {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('接続文字列を URL として解釈できません（値は表示しません）')
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('接続文字列のスキームが postgres:// または postgresql:// ではありません')
  }
  const username = decodeURIComponent(parsed.username)
  return {
    hostname: parsed.hostname,
    port: parsed.port,
    username,
    password: decodeURIComponent(parsed.password),
    projectRef: extractProjectRef(parsed.hostname, username),
    loopback: isLoopbackHost(parsed.hostname),
  }
}
