Database migrations and SQL definitions for the Ops Console.

**Status: draft, not applied anywhere.** Written against the schema documented
in `sobae_lifecycle_management_design_doc.md`'s ER diagram — nobody who wrote
these files has had access to inspect the real `organization` / `office` /
`services` / `staff` / `system_user` tables. Review each file's header
comments (assumptions, open questions) before running any of this against a
real database, staging included.

## Apply order

Objects depend on each other, so order matters:

1. `organization_columns.sql` — adds `management_number`, `contract_start_date`,
   `contract_end_date`, `status` to the existing `organization` table
2. `contract_lifecycle_log.sql` — new table
3. `fn_apply_onboarding.sql`
4. `fn_dryrun_onboarding.sql` — calls `fn_apply_onboarding`, so must come after it
5. `fn_suspend_organization.sql`
6. `fn_reactivate_organization.sql`
7. `fn_terminate_organization.sql`
8. `v_organization_summary.sql`
9. `roles.sql` — creates `sobae_ops_executor` and grants EXECUTE/SELECT on
   everything above; must run last, since the GRANTs need their targets to
   already exist. Also: does not (and must not) commit a real password — see
   that file's header.

Steps 3–7 are independent of each other and can run in any order relative to
one another, as long as all of them come after step 2 and before step 9.

## Found while writing this

`system_user` is a **reserved keyword** in PostgreSQL (`select * from pg_get_keywords() where word = 'system_user'` → fully reserved). If the real table is genuinely named exactly `system_user`, every unquoted reference to it is a syntax error — confirmed by actually hitting this against a scratch Postgres 17 instance while drafting `fn_apply_onboarding.sql`. All references to it in this directory are double-quoted (`"system_user"`) as a result. Worth double-checking the real table's actual name/quoting before relying on this.

## Not covered here

- Creating the initial Supabase Auth admin user (F-012) — that's an Auth API
  call from the backend, not SQL.
- Backfilling `status`/`management_number`/dates for organizations that
  already exist before this migration — see the comment in
  `organization_columns.sql`.
- Production apply. Per the project's own rules: verify in staging first,
  never hand-run untested SQL against Production.
