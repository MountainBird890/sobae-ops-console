import type { Context, Next } from 'hono'
import { createClient, isAuthRetryableFetchError, type AuthError, type User } from '@supabase/supabase-js'

export interface AuthVariables {
  user: User
}

let adminClient: ReturnType<typeof createClient> | undefined

export function getAdminClient() {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  if (!adminClient) {
    adminClient = createClient(url, secretKey)
  }
  return adminClient
}

// Fails closed: if Supabase isn't configured yet, every request under this
// middleware is rejected rather than allowed through unauthenticated.
export async function requireAuth(c: Context<{ Variables: AuthVariables }>, next: Next) {
  const client = getAdminClient()
  if (!client) {
    return c.json({ error: 'auth_not_configured', message: 'Authentication is not configured yet.' }, 503)
  }

  const authHeader = c.req.header('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined
  if (!token) {
    return c.json({ error: 'unauthorized', message: 'Missing bearer token.' }, 401)
  }

  // A failure to *reach* the Auth server (network trouble, timeout, 5xx) is not the same as a rejected
  // token: reporting it as 401 made a flaky connection look like "Invalid or expired token". Retry once,
  // then answer 503. Only the error's name / status / message are logged — never the token.
  let result = await client.auth.getUser(token)
  if (result.error && isUnreachable(result.error)) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    result = await client.auth.getUser(token)
  }
  const { data, error } = result

  if (error && isUnreachable(error)) {
    console.error('Auth server unreachable while verifying the token', error.name, error.status, error.message)
    return c.json(
      { error: 'auth_unavailable', message: '認証サーバーに接続できませんでした。通信環境を確認して、もう一度お試しください。' },
      503,
    )
  }
  if (error || !data.user) {
    console.error('Token rejected', error?.name, error?.status, error?.message)
    return c.json({ error: 'unauthorized', message: 'Invalid or expired token.' }, 401)
  }

  c.set('user', data.user)
  await next()
}

function isUnreachable(error: AuthError): boolean {
  return isAuthRetryableFetchError(error) || (typeof error.status === 'number' && error.status >= 500)
}
