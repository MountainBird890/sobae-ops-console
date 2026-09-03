import type { Context, Next } from 'hono'
import { createClient, type User } from '@supabase/supabase-js'

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

  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) {
    return c.json({ error: 'unauthorized', message: 'Invalid or expired token.' }, 401)
  }

  c.set('user', data.user)
  await next()
}
