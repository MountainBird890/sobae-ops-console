import postgres from 'postgres'

let sql: postgres.Sql | undefined

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('DATABASE_URL is not set')
    this.name = 'DatabaseNotConfiguredError'
  }
}

// Must connect as the sobae_ops_executor role, which only has EXECUTE on the
// fn_* SECURITY DEFINER functions and SELECT on v_organization_summary — no
// direct table DML. See sobae_lifecycle_management_design_doc.md and sql/.
export function getSql(): postgres.Sql {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new DatabaseNotConfiguredError()
  }
  if (!sql) {
    // prepare: false — DATABASE_URL may point at Supabase's pooled connection
    // (PgBouncer/Supavisor in transaction mode), which doesn't guarantee a
    // prepared statement survives across queries on the same logical
    // connection. Without this, queries intermittently fail with "prepared
    // statement ... does not exist" (SQLSTATE 26000).
    sql = postgres(connectionString, { prepare: false })
  }
  return sql
}
