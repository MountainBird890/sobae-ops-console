import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import postgres from 'postgres'
import { DatabaseNotConfiguredError, getSql } from '../db/client.js'
import type { AuthVariables } from '../auth/middleware.js'

// Payload contract mirrors sql/migrations/04_fn_apply_onboarding.sql's header
// comment (fn_apply_onboarding/fn_dryrun_onboarding). Keep the two in sync —
// there is no single source of truth yet, the SQL header says as much.
const POSTAL_CODE_RE = /^\d{7}$/
const LOGIN_ID_RE = /^[a-z0-9-]+$/
const ROLE_CODES = ['admin', 'supervisor', 'staff'] as const

const serviceRegistrationSchema = z.object({
  service_code: z.string().trim().min(1).max(10),
  provider_number: z.string().trim().min(1).max(50).optional(),
  service_office_name: z.string().trim().min(1).max(100).optional(),
})

const officeSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  postal_code: z.string().trim().regex(POSTAL_CODE_RE, '7桁の数字で入力してください').optional(),
  address: z.string().trim().min(1).max(300).optional(),
  phone: z.string().trim().min(1).max(30).optional(),
  fax: z.string().trim().min(1).max(30).optional(),
  email: z.email().optional(),
  display_name: z.string().trim().min(1).max(200).optional(),
  service_registrations: z.array(serviceRegistrationSchema).default([]),
})

const organizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  login_code: z.string().trim().min(1).max(50).optional(),
  postal_code: z.string().trim().regex(POSTAL_CODE_RE, '7桁の数字で入力してください').optional(),
  address: z.string().trim().min(1).max(300).optional(),
  phone: z.string().trim().min(1).max(30).optional(),
  fax: z.string().trim().min(1).max(30).optional(),
  email: z.email().optional(),
  management_number: z.string().trim().min(1).max(50),
  contract_start_date: z.iso.date(),
})

const initialAdminSchema = z.object({
  office_code: z.string().trim().min(1).max(50),
  last_name: z.string().trim().min(1).max(100),
  first_name: z.string().trim().min(1).max(100),
  last_name_kana: z.string().trim().min(1).max(100).optional(),
  first_name_kana: z.string().trim().min(1).max(100).optional(),
  employment_type: z.string().trim().min(1).max(50).optional(),
  phone: z.string().trim().min(1).max(30).optional(),
  email: z.email().optional(),
  postal_code: z.string().trim().regex(POSTAL_CODE_RE, '7桁の数字で入力してください').optional(),
  address: z.string().trim().min(1).max(300).optional(),
  hire_date: z.iso.date().optional(),
  role_code: z.enum(ROLE_CODES).default('admin'),
  login_id: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(50)
    .regex(LOGIN_ID_RE, '半角英小文字・数字・ハイフンのみ使用できます'),
  // Plaintext, never forwarded past this route: hashed into password_hash
  // before the payload reaches fn_dryrun_onboarding/fn_apply_onboarding.
  password: z.string().min(8).max(200),
})

const onboardingPayloadSchema = z.object({
  application_id: z.string().trim().min(1).max(100),
  organization: organizationSchema,
  offices: z.array(officeSchema).min(1),
  initial_admin: initialAdminSchema,
})

type OnboardingPayload = z.infer<typeof onboardingPayloadSchema>

interface DryRunResult {
  valid: boolean
  preview?: { organization_id: string; staff_id: string; system_user_id: string; log_id: string }
  errors: string[]
}

interface ApplyResult {
  organization_id: string
  staff_id: string
  system_user_id: string
  log_id: string
}

interface ServiceTypeRow {
  code: string
  name: string
  category: string
}

async function toDbPayload(payload: OnboardingPayload) {
  const { password, ...adminRest } = payload.initial_admin
  const password_hash = await bcrypt.hash(password, 12)
  return {
    ...payload,
    initial_admin: { ...adminRest, password_hash },
  }
}

// fn_apply_onboarding raises rather than catching its own errors (unlike
// fn_dryrun_onboarding, which always returns 200 with valid:false) — map the
// SQLSTATEs it actually uses (see 04_fn_apply_onboarding.sql) to HTTP status.
function applyErrorResponse(err: unknown): { body: { error: string; message: string }; status: 400 | 409 | 500 } {
  if (err instanceof postgres.PostgresError) {
    if (err.code === '23505') {
      return { body: { error: 'conflict', message: err.message }, status: 409 }
    }
    // Class 22 (data exception, e.g. fn_apply_onboarding's own 22023 checks,
    // or a plain column-constraint violation like a too-long value) and the
    // rest of class 23 (integrity constraint violation, e.g. a NOT NULL or
    // CHECK failure) both mean the submitted payload was invalid, not that
    // the server is broken.
    if (err.code?.startsWith('22') || err.code?.startsWith('23')) {
      return { body: { error: 'invalid_payload', message: err.message }, status: 400 }
    }
  }
  console.error('Failed to apply onboarding', err)
  return { body: { error: 'internal_error', message: 'Failed to apply onboarding application.' }, status: 500 }
}

const onboarding = new Hono<{ Variables: AuthVariables }>()

onboarding.get('/service-types', async (c) => {
  try {
    const sql = getSql()
    const rows = await sql<ServiceTypeRow[]>`
      select code, name, category
      from service_types
      where is_active = true
      order by category, code
    `
    return c.json({ service_types: rows })
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return c.json({ error: 'database_not_configured', message: 'Database connection is not configured yet.' }, 503)
    }
    console.error('Failed to list service types', err)
    return c.json({ error: 'internal_error', message: 'Failed to load service types.' }, 500)
  }
})

onboarding.post('/dry-run', zValidator('json', onboardingPayloadSchema), async (c) => {
  const payload = c.req.valid('json')
  const appliedBy = c.get('user').email ?? c.get('user').id

  try {
    const dbPayload = await toDbPayload(payload)
    const sql = getSql()
    const rows = await sql<{ result: DryRunResult }[]>`
      select fn_dryrun_onboarding(${sql.json(dbPayload)}, ${appliedBy}) as result
    `
    return c.json(rows[0].result)
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return c.json({ error: 'database_not_configured', message: 'Database connection is not configured yet.' }, 503)
    }
    console.error('Failed to dry-run onboarding', err)
    return c.json({ error: 'internal_error', message: 'Failed to validate onboarding application.' }, 500)
  }
})

onboarding.post('/apply', zValidator('json', onboardingPayloadSchema), async (c) => {
  const payload = c.req.valid('json')
  const appliedBy = c.get('user').email ?? c.get('user').id

  try {
    const dbPayload = await toDbPayload(payload)
    const sql = getSql()
    const rows = await sql<{ result: ApplyResult }[]>`
      select fn_apply_onboarding(${sql.json(dbPayload)}, ${appliedBy}) as result
    `
    return c.json({ organization: rows[0].result }, 201)
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return c.json({ error: 'database_not_configured', message: 'Database connection is not configured yet.' }, 503)
    }
    const { body, status } = applyErrorResponse(err)
    return c.json(body, status)
  }
})

export default onboarding
