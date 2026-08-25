Database migrations and SQL definitions for the Ops Console.

**Status: draft, not applied anywhere.** Written against the schema documented
in `sobae_lifecycle_management_design_doc.md`'s ER diagram — nobody who wrote
these files has had access to inspect the real `organization` / `office` /
`services` / `staff` / `system_user` tables. Review each file's header
comments (assumptions, open questions) before running any of this against a
real database, staging included.

## Structure

Schema-changing SQL (DDL, GRANT/REVOKE) lives in `migrations/` as numbered,
append-only files — see `migrations/README.md` for the full convention. The
number prefix is the apply order; run them in order, `01_roles.sql` through
`09_v_organization_summary.sql`.

## Found while writing this

`system_user` is a **reserved keyword** in PostgreSQL (`select * from
pg_get_keywords() where word = 'system_user'` → fully reserved). If the real
table is genuinely named exactly `system_user`, every unquoted reference to
it is a syntax error — confirmed by actually hitting this against a scratch
Postgres 17 instance while drafting `fn_apply_onboarding.sql`. All references
to it under `migrations/` are double-quoted (`"system_user"`) as a result.
Worth double-checking the real table's actual name/quoting before relying on
this.

## Not covered here

- Creating the initial Supabase Auth admin user (F-012) — that's an Auth API
  call from the backend, not SQL.
- Backfilling `status`/`management_number`/dates for organizations that
  already exist before this migration — see the comment in
  `migrations/02_organization_alter.sql`.
- The `schema_migration_log` tracking table itself (see `migrations/README.md`
  §7) — not yet created.
- Production apply. Per the project's own rules: verify in staging first,
  never hand-run untested SQL against Production.
