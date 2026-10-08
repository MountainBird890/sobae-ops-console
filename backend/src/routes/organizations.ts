import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { DatabaseNotConfiguredError, getSql } from '../db/client.js'
import type { AuthVariables } from '../auth/middleware.js'
import { displayStatus, lifecycleBodySchema, lifecycleErrorResponse, OFFICE_COLUMNS, uuidParamSchema, type OfficeSummaryRow } from '../lifecycle.js'

// Shape this route expects from console.v_organization_summary (see
// sql/migrations/09_v_organization_summary.sql). The view lives in the `console`
// schema — always schema-qualify, never rely on search_path.
// Organizations that existed before the status column was added (migration 250, not
// backfilled) have NULL status, management_number and contract_start_date. The view's
// `status` is the *effective* status (migration 11): NULL + is_active = true is reported
// as 'active'; NULL + is_active = false stays NULL ("needs review", counted as `unconfirmed`).
// management_number / contract_start_date can still be NULL for such legacy rows.
const ORGANIZATION_STATUSES = ['active', 'suspended', 'terminated'] as const

interface OrganizationSummaryRow {
  id: string
  name: string
  management_number: string | null
  status: (typeof ORGANIZATION_STATUSES)[number] | null
  contract_start_date: string | null
  contract_end_date: string | null
  // Latest organization-level suspend / reactivate (JST date, 'YYYY-MM-DD'); NULL if never.
  last_suspended_at: string | null
  last_reactivated_at: string | null
}

const listQuerySchema = z.object({
  status: z.enum(ORGANIZATION_STATUSES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
})

const organizations = new Hono<{ Variables: AuthVariables }>()

organizations.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { status, q } = c.req.valid('query')

  try {
    const sql = getSql()
    const rows = await sql<OrganizationSummaryRow[]>`
      select id, name, management_number, status,
             contract_start_date::text as contract_start_date,
             contract_end_date::text as contract_end_date,
             to_char(last_suspended_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as last_suspended_at,
             to_char(last_reactivated_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as last_reactivated_at
      from console.v_organization_summary
      where (${status ?? null}::text is null or status = ${status ?? null})
        and (
          ${q ?? null}::text is null
          or name ilike '%' || ${q ?? null} || '%'
          or management_number ilike '%' || ${q ?? null} || '%'
        )
      order by contract_start_date desc nulls last, name
    `
    return c.json({ organizations: rows })
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return c.json({ error: 'database_not_configured', message: 'Database connection is not configured yet.' }, 503)
    }
    console.error('Failed to list organizations', err)
    return c.json({ error: 'internal_error', message: 'Failed to load organizations.' }, 500)
  }
})

organizations.get('/summary', async (c) => {
  try {
    const sql = getSql()
    const rows = await sql<{ status: string | null; count: string }[]>`
      select status, count(*) as count from console.v_organization_summary group by status
    `

    const counts: Record<(typeof ORGANIZATION_STATUSES)[number], number> = {
      active: 0,
      suspended: 0,
      terminated: 0,
    }
    let total = 0
    let unconfirmed = 0
    for (const row of rows) {
      if (row.status !== null && (ORGANIZATION_STATUSES as readonly string[]).includes(row.status)) {
        counts[row.status as (typeof ORGANIZATION_STATUSES)[number]] = Number(row.count)
      } else {
        // NULL (legacy organization that is not active) or an unexpected value.
        unconfirmed += Number(row.count)
      }
      total += Number(row.count)
    }

    return c.json({ ...counts, unconfirmed, total })
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return c.json({ error: 'database_not_configured', message: 'Database connection is not configured yet.' }, 503)
    }
    console.error('Failed to summarize organizations', err)
    return c.json({ error: 'internal_error', message: 'Failed to load organization summary.' }, 500)
  }
})

organizations.get('/:id', zValidator('param', z.object({ id: z.uuid() })), async (c) => {
  const { id } = c.req.valid('param')

  try {
    const sql = getSql()
    const rows = await sql<OrganizationSummaryRow[]>`
      select id, name, management_number, status,
             contract_start_date::text as contract_start_date,
             contract_end_date::text as contract_end_date,
             to_char(last_suspended_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as last_suspended_at,
             to_char(last_reactivated_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as last_reactivated_at
      from console.v_organization_summary
      where id = ${id}
    `
    const organization = rows[0]
    if (!organization) {
      return c.json({ error: 'not_found', message: 'Organization not found.' }, 404)
    }
    return c.json({ organization })
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return c.json({ error: 'database_not_configured', message: 'Database connection is not configured yet.' }, 503)
    }
    console.error('Failed to fetch organization', err)
    return c.json({ error: 'internal_error', message: 'Failed to load organization.' }, 500)
  }
})

// Offices of one organization (the organization detail screen). `display_status` is what the screen shows:
// the organization's state wins unless it is active (an office under a suspended / terminated organization
// cannot log in whatever its own status says).
organizations.get('/:id/offices', zValidator('param', uuidParamSchema), async (c) => {
  const { id } = c.req.valid('param')

  try {
    const sql = getSql()
    const rows = await sql.unsafe<OfficeSummaryRow[]>(
      `select ${OFFICE_COLUMNS} from console.v_office_summary where organization_id = $1 order by code`,
      [id],
    )
    return c.json({ offices: rows.map((o) => ({ ...o, display_status: displayStatus(o.organization_status, o.status) })) })
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return c.json({ error: 'database_not_configured', message: 'Database connection is not configured yet.' }, 503)
    }
    console.error('Failed to list offices', err)
    return c.json({ error: 'internal_error', message: 'Failed to load offices.' }, 500)
  }
})

// Organization-level suspend / reactivate / terminate. The operator must send the organization's name again
// (`confirm_name`, SEC-004); the screen already blocks the button until it matches, this re-checks it.
// `applied_by` is resolved from the verified session by the caller, never taken from the request body.
type OrganizationAction = 'suspend' | 'reactivate' | 'terminate'
type ActionRow = { organization_id: string; status: string; log_id: string }

async function runOrganizationAction(
  action: OrganizationAction,
  input: { id: string; reason: string | undefined; confirmName: string; appliedBy: string },
): Promise<{ status: 200 | 400 | 404 | 409 | 500 | 503; body: Record<string, unknown> }> {
  try {
    const sql = getSql()
    const [target] = await sql<{ name: string }[]>`select name from console.v_organization_summary where id = ${input.id}`
    if (!target) {
      return { status: 404, body: { error: 'not_found', message: '法人が見つかりませんでした。' } }
    }
    if (input.confirmName.trim() !== target.name.trim()) {
      return { status: 400, body: { error: 'confirmation_mismatch', message: '確認のために入力した法人名が一致しません。' } }
    }

    const reason = input.reason ?? null
    const rows =
      action === 'suspend'
        ? await sql<ActionRow[]>`select * from console.fn_suspend_organization(${input.id}::uuid, ${reason}, ${input.appliedBy})`
        : action === 'reactivate'
          ? await sql<ActionRow[]>`select * from console.fn_reactivate_organization(${input.id}::uuid, ${reason}, ${input.appliedBy})`
          : await sql<ActionRow[]>`select * from console.fn_terminate_organization(${input.id}::uuid, ${reason}, ${input.appliedBy}, null::date)`
    return { status: 200, body: { result: rows[0] } }
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return { status: 503, body: { error: 'database_not_configured', message: 'Database connection is not configured yet.' } }
    }
    const mapped = lifecycleErrorResponse(err)
    if (mapped) return { status: mapped.status, body: mapped.body }
    console.error(`Failed to ${action} organization`, err)
    return { status: 500, body: { error: 'internal_error', message: '操作に失敗しました。時間をおいて再度お試しください。' } }
  }
}

organizations.post('/:id/suspend', zValidator('param', uuidParamSchema), zValidator('json', lifecycleBodySchema), async (c) => {
  const { id } = c.req.valid('param')
  const { reason, confirm_name } = c.req.valid('json')
  const r = await runOrganizationAction('suspend', { id, reason, confirmName: confirm_name, appliedBy: c.get('user').email ?? c.get('user').id })
  return c.json(r.body, r.status)
})

organizations.post('/:id/reactivate', zValidator('param', uuidParamSchema), zValidator('json', lifecycleBodySchema), async (c) => {
  const { id } = c.req.valid('param')
  const { reason, confirm_name } = c.req.valid('json')
  const r = await runOrganizationAction('reactivate', { id, reason, confirmName: confirm_name, appliedBy: c.get('user').email ?? c.get('user').id })
  return c.json(r.body, r.status)
})

organizations.post('/:id/terminate', zValidator('param', uuidParamSchema), zValidator('json', lifecycleBodySchema), async (c) => {
  const { id } = c.req.valid('param')
  const { reason, confirm_name } = c.req.valid('json')
  const r = await runOrganizationAction('terminate', { id, reason, confirmName: confirm_name, appliedBy: c.get('user').email ?? c.get('user').id })
  return c.json(r.body, r.status)
})

export default organizations
