import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { DatabaseNotConfiguredError, getPool } from '../db/client.js'

// Shape this route expects from v_organization_summary. That view does not
// exist yet (DB role/function/view design is owned by Shimo, not this repo's
// backend code — see design doc RACI table). Columns below are taken from the
// ORGANIZATION entity in the design doc's ER diagram; confirm against the
// real view once it's created and adjust this file if the shape differs.
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
    const pool = getPool()
    const { rows } = await pool.query<OrganizationSummaryRow>(
      `select id, name, management_number, status, contract_start_date, contract_end_date
       from v_organization_summary
       where ($1::text is null or status = $1)
         and ($2::text is null or name ilike '%' || $2 || '%' or management_number ilike '%' || $2 || '%')
       order by contract_start_date desc`,
      [status ?? null, q ?? null],
    )
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
    const pool = getPool()
    const { rows } = await pool.query<{ status: string; count: string }>(
      `select status, count(*) as count from v_organization_summary group by status`,
    )

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

export default organizations
