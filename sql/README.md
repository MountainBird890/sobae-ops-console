Database migrations and SQL definitions for the Ops Console.

**Status (2026-10-07):** `01_roles.sql` is applied on the staging parent
(`sobae-works-staging-tokyo` main). `02`–`10` are **not** applied there yet; an
older, `public`-schema version was applied to the experimental `test-onboarding`
branch (to be re-created from these files). The objects below `02` now live in the
`console` schema (see `migrations/README.md` §3, §5, §9). Review each file's header
comments before running any of this against a real database, staging included.

## Structure

Schema-changing SQL (DDL, GRANT/REVOKE) lives in `migrations/` as numbered,
append-only files — see `migrations/README.md` for the full convention. The
number prefix is the apply order; run them in order, `01_roles.sql` through
`10_fn_apply_onboarding_employment_type_check.sql`.

`02_console_schema.sql` creates the `console` schema that holds the Console-owned
objects (`contract_lifecycle_log`, the `fn_*` functions, `v_organization_summary`).
The former `02` (extra columns on `organizations`) moved to a Sobae_Works migration
(number chosen by the Sobae_Works side, 250 expected) — it must be applied **before**
`03`–`10` are used.

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
  already exist: not done by design. `status` stays NULL for them (the former
  `02_organization_alter.sql`, now in git history, explains why). `fn_terminate_organization`
  can terminate NULL-status organizations on purpose; `fn_suspend_organization` /
  `fn_reactivate_organization` reject them.
- The migration history table (`console.migration_history`, see
  `migrations/README.md` §7) and the Console-side runner — not yet implemented.
- Production apply. Per the project's own rules: verify in staging first,
  never hand-run untested SQL against Production.
