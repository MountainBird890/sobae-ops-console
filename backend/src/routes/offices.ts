import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { DatabaseNotConfiguredError, getSql } from '../db/client.js'
import type { AuthVariables } from '../auth/middleware.js'
import {
  displayStatus,
  lifecycleBodySchema,
  lifecycleErrorResponse,
  OFFICE_COLUMNS,
  uuidParamSchema,
  type OfficeSummaryRow,
} from '../lifecycle.js'

// Office detail and office-level suspend / reactivate (REQ-0001 F-006 / F-007). Office termination is
// not offered yet (shelved 2026-10-08). All reads go through console.v_office_summary; writes only through
// the console.fn_*_office SECURITY DEFINER functions.
const offices = new Hono<{ Variables: AuthVariables }>()

offices.get('/:id', zValidator('param', uuidParamSchema), async (c) => {
  const { id } = c.req.valid('param')

  try {
    const sql = getSql()
    const rows = await sql.unsafe<OfficeSummaryRow[]>(`select ${OFFICE_COLUMNS} from console.v_office_summary where id = $1`, [id])
    const office = rows[0]
    if (!office) {
      return c.json({ error: 'not_found', message: '事業所が見つかりませんでした。' }, 404)
    }
    return c.json({ office: { ...office, display_status: displayStatus(office.organization_status, office.status) } })
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return c.json({ error: 'database_not_configured', message: 'Database connection is not configured yet.' }, 503)
    }
    console.error('Failed to fetch office', err)
    return c.json({ error: 'internal_error', message: 'Failed to load office.' }, 500)
  }
})

type OfficeAction = 'suspend' | 'reactivate'
type OfficeActionRow = { office_id: string; status: string; log_id: string }

// `confirm_name` is the office's name typed again (SEC-004), re-checked here so a direct API call cannot skip
// the confirmation. `applied_by` comes from the verified session.
async function runOfficeAction(
  action: OfficeAction,
  input: { id: string; reason: string | undefined; confirmName: string; appliedBy: string },
): Promise<{ status: 200 | 400 | 404 | 409 | 500 | 503; body: Record<string, unknown> }> {
  try {
    const sql = getSql()
    const [target] = await sql<{ name: string }[]>`select name from console.v_office_summary where id = ${input.id}`
    if (!target) {
      return { status: 404, body: { error: 'not_found', message: '事業所が見つかりませんでした。' } }
    }
    if (input.confirmName.trim() !== target.name.trim()) {
      return { status: 400, body: { error: 'confirmation_mismatch', message: '確認のために入力した事業所名が一致しません。' } }
    }

    const reason = input.reason ?? null
    const rows =
      action === 'suspend'
        ? await sql<OfficeActionRow[]>`select * from console.fn_suspend_office(${input.id}::uuid, ${reason}, ${input.appliedBy})`
        : await sql<OfficeActionRow[]>`select * from console.fn_reactivate_office(${input.id}::uuid, ${reason}, ${input.appliedBy})`
    return { status: 200, body: { result: rows[0] } }
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      return { status: 503, body: { error: 'database_not_configured', message: 'Database connection is not configured yet.' } }
    }
    const mapped = lifecycleErrorResponse(err)
    if (mapped) return { status: mapped.status, body: mapped.body }
    console.error(`Failed to ${action} office`, err)
    return { status: 500, body: { error: 'internal_error', message: '操作に失敗しました。時間をおいて再度お試しください。' } }
  }
}

offices.post('/:id/suspend', zValidator('param', uuidParamSchema), zValidator('json', lifecycleBodySchema), async (c) => {
  const { id } = c.req.valid('param')
  const { reason, confirm_name } = c.req.valid('json')
  const r = await runOfficeAction('suspend', { id, reason, confirmName: confirm_name, appliedBy: c.get('user').email ?? c.get('user').id })
  return c.json(r.body, r.status)
})

offices.post('/:id/reactivate', zValidator('param', uuidParamSchema), zValidator('json', lifecycleBodySchema), async (c) => {
  const { id } = c.req.valid('param')
  const { reason, confirm_name } = c.req.valid('json')
  const r = await runOfficeAction('reactivate', { id, reason, confirmName: confirm_name, appliedBy: c.get('user').email ?? c.get('user').id })
  return c.json(r.body, r.status)
})

export default offices
