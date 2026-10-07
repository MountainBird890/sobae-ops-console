import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { DatabaseNotConfiguredError, getSql } from '../db/client.js'

// Shape this route expects from console.v_organization_summary (see
// sql/migrations/09_v_organization_summary.sql). The view lives in the `console`
// schema — always schema-qualify, never rely on search_path.
// Note: `status` is NULL for organizations that existed before the status column
// was added (not backfilled by design); those rows are not counted in any of the
// three statuses below.
const ORGANIZATION_STATUSES = ['active', 'suspended', 'terminated'] as const

interface OrganizationSummaryRow {
  id: string
  name: string
  management_number: string
  status: (typeof ORGANIZATION_STATUSES)[number]
  contract_start_date: string
  contract_end_date: string | null
}

const listQuerySchema = z.object({
  status: z.enum(ORGANIZATION_STATUSES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
})

const organizations = new Hono()

organizations.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { status, q } = c.req.valid('query')

  try {
    const sql = getSql()
    const rows = await sql<OrganizationSummaryRow[]>`
      select id, name, management_number, status, contract_start_date, contract_end_date
      from console.v_organization_summary
      where (${status ?? null}::text is null or status = ${status ?? null})
        and (
          ${q ?? null}::text is null
          or name ilike '%' || ${q ?? null} || '%'
          or management_number ilike '%' || ${q ?? null} || '%'
        )
      order by contract_start_date desc
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
    const rows = await sql<{ status: string; count: string }[]>`
      select status, count(*) as count from console.v_organization_summary group by status
    `

    const counts: Record<(typeof ORGANIZATION_STATUSES)[number], number> = {
      active: 0,
      suspended: 0,
      terminated: 0,
    }
    let total = 0
    for (const row of rows) {
      if ((ORGANIZATION_STATUSES as readonly string[]).includes(row.status)) {
        counts[row.status as (typeof ORGANIZATION_STATUSES)[number]] = Number(row.count)
      }
      total += Number(row.count)
    }

    return c.json({ ...counts, total })
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
      select id, name, management_number, status, contract_start_date, contract_end_date
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

export default organizations
