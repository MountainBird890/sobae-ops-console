-- Adds lifecycle-management columns to the existing `organization` table.
--
-- ASSUMPTIONS TO VERIFY BEFORE APPLYING (column list/types are taken from the
-- design doc's ER diagram, not from an inspection of the real table — nobody
-- on this task has DB access):
--   * `organization` already exists with an `id uuid primary key`.
--   * None of the four columns below already exist under a different name.
--   * `management_number` should be unique per the design doc's description
--     ("認識番号（契約管理用）") — added as UNIQUE here. If that turns out to
--     be wrong (e.g. duplicates are expected), drop the constraint.
--
-- NOT decided here (needs your judgment, no existing data to base a default
-- on): `status` is left NULLABLE with no default, since defaulting every
-- existing row to 'active' would be a guess about real contract state. Any
-- row with status IS NULL will fail assumptions made by the frontend/backend
-- code (which always expects a non-null status) until backfilled. A starting
-- point, NOT auto-run:
--
--   update organization set status = 'active' where status is null;
--
-- review which rows that actually applies to before running it.

alter table organization
  add column if not exists management_number text unique,
  add column if not exists contract_start_date date,
  add column if not exists contract_end_date date,
  add column if not exists status text;

alter table organization
  drop constraint if exists organization_status_check;

alter table organization
  add constraint organization_status_check
  check (status is null or status in ('active', 'suspended', 'terminated'));
