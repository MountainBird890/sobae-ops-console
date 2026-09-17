import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getAdminClient } from '../auth/middleware.js'

const inviteSchema = z.object({
  email: z.email(),
})

const staff = new Hono()

// Invites a new Ops Console user (SOBAE internal staff) via Supabase Auth.
// The invited person receives an email and sets their own password by
// following the link to FRONTEND_URL/accept-invite — no plaintext password
// ever passes through this API.
staff.post('/invite', zValidator('json', inviteSchema), async (c) => {
  const { email } = c.req.valid('json')

  const client = getAdminClient()
  if (!client) {
    return c.json({ error: 'auth_not_configured', message: 'Authentication is not configured yet.' }, 503)
  }

  const frontendUrl = process.env.FRONTEND_URL
  if (!frontendUrl) {
    return c.json({ error: 'frontend_url_not_configured', message: 'FRONTEND_URL is not configured.' }, 503)
  }

  const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${frontendUrl}/accept-invite`,
  })

  if (error) {
    const status = error.status === 422 ? 409 : 500
    return c.json({ error: status === 409 ? 'conflict' : 'internal_error', message: error.message }, status)
  }

  return c.json({ user: { id: data.user.id, email: data.user.email } }, 201)
})

export default staff
