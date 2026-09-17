import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Context } from 'hono'
import bcrypt from 'bcryptjs'
import postgres from 'postgres'
import { DatabaseNotConfiguredError, getSql } from '../db/client.js'
import type { AuthVariables } from '../auth/middleware.js'

// Payload contract mirrors sql/migrations/04_fn_apply_onboarding.sql's header
// comment (fn_apply_onboarding/fn_dryrun_onboarding). Keep the two in sync —
// there is no single source of truth yet, the SQL header says as much.
const POSTAL_CODE_RE = /^\d{7}$/
// Shared by organization.login_code and initial_admin.login_id — both map to
// Postgres CHECK constraints with the same pattern (organizations_login_code_
// format_check, system_users_login_id_format_check; confirmed via
// pg_get_constraintdef 2026-09-14).
const LOGIN_ID_RE = /^[a-z0-9-]+$/
const ROLE_CODES = ['admin', 'supervisor', 'staff'] as const
// staff.employment_type CHECK constraint's allowed values (confirmed via
// pg_get_constraintdef against the real Sobae_Works schema, 2026-09-14) —
// presumed coding of 常勤専従/常勤兼務/非常勤専従/非常勤兼務.
const EMPLOYMENT_TYPE_CODES = ['full_time_excl', 'full_time_conc', 'part_time_excl', 'part_time_conc'] as const

const serviceRegistrationSchema = z.object({
  service_code: z.string().trim().min(1, 'サービス種別を選択してください').max(10, '10文字以内で入力してください'),
  provider_number: z.string().trim().min(1, '1文字以上で入力してください').max(50, '50文字以内で入力してください').optional(),
  service_office_name: z.string().trim().min(1, '1文字以上で入力してください').max(100, '100文字以内で入力してください').optional(),
})

const officeSchema = z.object({
  code: z.string().trim().min(1, '必須項目です').max(50, '50文字以内で入力してください'),
  name: z.string().trim().min(1, '必須項目です').max(200, '200文字以内で入力してください'),
  postal_code: z.string().trim().regex(POSTAL_CODE_RE, '7桁の数字で入力してください').optional(),
  address: z.string().trim().min(1, '1文字以上で入力してください').max(300, '300文字以内で入力してください').optional(),
  phone: z.string().trim().min(1, '1文字以上で入力してください').max(30, '30文字以内で入力してください').optional(),
  fax: z.string().trim().min(1, '1文字以上で入力してください').max(30, '30文字以内で入力してください').optional(),
  email: z.email('メールアドレスの形式で入力してください').optional(),
  display_name: z.string().trim().min(1, '1文字以上で入力してください').max(200, '200文字以内で入力してください').optional(),
  service_registrations: z.array(serviceRegistrationSchema).default([]),
})

const organizationSchema = z.object({
  name: z.string().trim().min(1, '必須項目です').max(200, '200文字以内で入力してください'),
  login_code: z.string().trim().regex(LOGIN_ID_RE, '半角英小文字・数字・ハイフンのみ使用できます').max(50, '50文字以内で入力してください').optional(),
  postal_code: z.string().trim().regex(POSTAL_CODE_RE, '7桁の数字で入力してください').optional(),
  address: z.string().trim().min(1, '1文字以上で入力してください').max(300, '300文字以内で入力してください').optional(),
  phone: z.string().trim().min(1, '1文字以上で入力してください').max(30, '30文字以内で入力してください').optional(),
  fax: z.string().trim().min(1, '1文字以上で入力してください').max(30, '30文字以内で入力してください').optional(),
  email: z.email('メールアドレスの形式で入力してください').optional(),
  management_number: z.string().trim().min(1, '必須項目です').max(50, '50文字以内で入力してください'),
  contract_start_date: z.iso.date('日付の形式（YYYY-MM-DD）で入力してください'),
})

const initialAdminSchema = z.object({
  office_code: z.string().trim().min(1, '必須項目です').max(50, '50文字以内で入力してください'),
  last_name: z.string().trim().min(1, '必須項目です').max(100, '100文字以内で入力してください'),
  first_name: z.string().trim().min(1, '必須項目です').max(100, '100文字以内で入力してください'),
  last_name_kana: z.string().trim().min(1, '1文字以上で入力してください').max(100, '100文字以内で入力してください').optional(),
  first_name_kana: z.string().trim().min(1, '1文字以上で入力してください').max(100, '100文字以内で入力してください').optional(),
  // 許可コードはDBのCHECK制約由来（staff_employment_type_check）。フロント側の
  // 入力欄はまだ自由入力のままなので、不正値は「雇用形態の値が不正です」としか
  // 出せない。選択式UIへの変更は別課題（技術実績台帳15章参照、本対応では未着手）。
  employment_type: z.enum(EMPLOYMENT_TYPE_CODES, { message: '雇用形態の値が不正です' }).optional(),
  phone: z.string().trim().min(1, '1文字以上で入力してください').max(30, '30文字以内で入力してください').optional(),
  email: z.email('メールアドレスの形式で入力してください').optional(),
  postal_code: z.string().trim().regex(POSTAL_CODE_RE, '7桁の数字で入力してください').optional(),
  address: z.string().trim().min(1, '1文字以上で入力してください').max(300, '300文字以内で入力してください').optional(),
  hire_date: z.iso.date('日付の形式（YYYY-MM-DD）で入力してください').optional(),
  role_code: z.enum(ROLE_CODES).default('admin'),
  login_id: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, '3文字以上で入力してください')
    .max(50, '50文字以内で入力してください')
    .regex(LOGIN_ID_RE, '半角英小文字・数字・ハイフンのみ使用できます'),
  // Plaintext, never forwarded past this route: hashed into password_hash
  // before the payload reaches fn_dryrun_onboarding/fn_apply_onboarding.
  password: z.string().min(8, '8文字以上で入力してください').max(200, '200文字以内で入力してください'),
})

const onboardingPayloadSchema = z.object({
  application_id: z.string().trim().min(1, '必須項目です').max(100, '100文字以内で入力してください'),
  organization: organizationSchema,
  offices: z.array(officeSchema).min(1, '事業所を1つ以上登録してください'),
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

// Returns a 400 with per-field messages instead of letting @hono/zod-validator's
// default hook dump the raw ZodError (its `message` is a JSON-stringified issue
// array nested under `error.message`, which the frontend has no reason to know
// how to parse). `path` mirrors the payload shape (e.g. ["organization",
// "postal_code"], ["offices", 0, "postal_code"]) so the frontend can key its
// per-field error display off `path.join('.')`.
function zodFieldErrorsHook(
  result: { success: true } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } },
  c: Context,
) {
  if (!result.success) {
    const fieldErrors = result.error.issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message,
    }))
    return c.json({ error: 'validation_failed', fieldErrors }, 400)
  }
}

// Known fixed-format messages explicitly raised by fn_apply_onboarding (see
// sql/migrations/04_fn_apply_onboarding.sql and 10_fn_apply_onboarding_
// employment_type_check.sql). Matched by pattern since most interpolate a
// value via `%`. Tried before CONSTRAINT_MESSAGES below.
const KNOWN_DB_MESSAGE_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /^application_id is required$/, message: '申請IDが未入力です。' },
  {
    pattern: /^application .+ has already been applied$/,
    message: 'この申請は既に登録済みです。同じ内容を重複して登録することはできません。',
  },
  { pattern: /^invalid initial_admin\.role_code: .+$/, message: '権限の指定が不正です。' },
  {
    pattern: /^role not found in roles table: .+$/,
    message: '指定された権限がシステムに登録されていません。システム管理者にご確認ください。',
  },
  { pattern: /^unknown initial_admin service_code: .+$/, message: '指定されたサービス種別が見つかりません。' },
  {
    pattern: /^initial_admin\.office_code .+ does not match any office in this application$/,
    message: '初期管理者の所属事業所コードが、登録しようとしている事業所の中に見つかりません。',
  },
  { pattern: /^initial_admin\.last_name is required$/, message: '初期管理者の姓は必須項目です。' },
  { pattern: /^initial_admin\.first_name is required$/, message: '初期管理者の名は必須項目です。' },
  { pattern: /^initial_admin\.login_id is required$/, message: '初期管理者のログインIDは必須項目です。' },
  { pattern: /^initial_admin\.password_hash is required$/, message: '初期管理者のパスワードは必須項目です。' },
  { pattern: /^invalid initial_admin\.employment_type: .+$/, message: '雇用形態の値が不正です。' },
]

// Postgres constraint name → friendly message, for raw constraint-violation
// text that reaches us without a pre-check catching it first (defense in
// depth — see 10_fn_apply_onboarding_employment_type_check.sql's header).
// Scoped to constraints confirmed (via pg_get_constraintdef, 2026-09-14) on
// the tables this function actually writes to: organizations / offices /
// staff / system_users / office_service_registrations. Constraints on
// columns this payload never sets (e.g. staff.gender, staff.employee_number)
// are intentionally omitted — they can't fire from onboarding input, so they
// fall through to GENERIC_DB_ERROR_MESSAGE if something unexpected happens.
const CONSTRAINT_MESSAGES: Record<string, string> = {
  offices_code_key: 'この事業所コードは既に使用されています。',
  staff_employment_type_check: '雇用形態の値が不正です。',
  staff_postal_code_format_check: '初期管理者の郵便番号は半角数字7桁で入力してください。',
  staff_role_check: '権限の指定が不正です。',
  system_users_login_id_format_check: 'ログインIDの形式が不正です。半角英小文字・数字・ハイフンのみ使用できます。',
  organizations_login_code_format_check: 'ログインコードの形式が不正です。半角英小文字・数字・ハイフンのみ使用できます。',
  organizations_management_number_key: 'この管理番号は既に登録されています。',
  office_service_registrations_office_id_service_type_id_key: '同じ事業所に同じサービス種別が重複して登録されています。',
}

const GENERIC_DB_ERROR_MESSAGE = '入力内容に問題があります。内容をご確認のうえ、解決しない場合はシステム管理者にご連絡ください。'

// Translates a raw Postgres/PL-pgSQL error message (SQLERRM) into a friendly
// Japanese one. Falls through known-pattern → constraint-name → generic, so
// an error we haven't seen before still degrades to something coherent
// instead of leaking raw SQL text to the screen.
function friendlyDbMessage(raw: string): string {
  for (const { pattern, message } of KNOWN_DB_MESSAGE_PATTERNS) {
    if (pattern.test(raw)) return message
  }
  const constraintMatch = raw.match(/constraint "([a-zA-Z0-9_]+)"/)
  if (constraintMatch) {
    const friendly = CONSTRAINT_MESSAGES[constraintMatch[1]]
    if (friendly) return friendly
  }
  return GENERIC_DB_ERROR_MESSAGE
}

// fn_apply_onboarding raises rather than catching its own errors (unlike
// fn_dryrun_onboarding, which always returns 200 with valid:false) — map the
// SQLSTATEs it actually uses (see 04_fn_apply_onboarding.sql) to HTTP status.
function applyErrorResponse(err: unknown): { body: { error: string; message: string; detail?: string }; status: 400 | 409 | 500 } {
  if (err instanceof postgres.PostgresError) {
    if (err.code === '23505') {
      return { body: { error: 'conflict', message: friendlyDbMessage(err.message), detail: err.message }, status: 409 }
    }
    // Class 22 (data exception, e.g. fn_apply_onboarding's own 22023 checks,
    // or a plain column-constraint violation like a too-long value) and the
    // rest of class 23 (integrity constraint violation, e.g. a NOT NULL or
    // CHECK failure) both mean the submitted payload was invalid, not that
    // the server is broken.
    if (err.code?.startsWith('22') || err.code?.startsWith('23')) {
      return { body: { error: 'invalid_payload', message: friendlyDbMessage(err.message), detail: err.message }, status: 400 }
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

onboarding.post('/dry-run', zValidator('json', onboardingPayloadSchema, zodFieldErrorsHook), async (c) => {
  const payload = c.req.valid('json')
  const appliedBy = c.get('user').email ?? c.get('user').id

  try {
    const dbPayload = await toDbPayload(payload)
    const sql = getSql()
    const rows = await sql<{ result: DryRunResult }[]>`
      select fn_dryrun_onboarding(${sql.json(dbPayload)}, ${appliedBy}) as result
    `
    const result = rows[0].result
    if (!result.valid) {
      return c.json({ ...result, errors: result.errors.map(friendlyDbMessage) })
    }
    return c.json(result)
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return c.json({ error: 'database_not_configured', message: 'Database connection is not configured yet.' }, 503)
    }
    console.error('Failed to dry-run onboarding', err)
    return c.json({ error: 'internal_error', message: 'Failed to validate onboarding application.' }, 500)
  }
})

onboarding.post('/apply', zValidator('json', onboardingPayloadSchema, zodFieldErrorsHook), async (c) => {
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
