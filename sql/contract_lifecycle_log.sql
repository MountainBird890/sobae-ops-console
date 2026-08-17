-- Audit log for organization lifecycle events (create/suspend/reactivate/terminate).
-- Depends on: organization(id) already existing (run after organization_columns.sql
-- if you want the FK to also see the new status/management_number columns, though
-- this table doesn't reference them directly).
--
-- `gen_random_uuid()` requires the `pgcrypto` extension (enabled by default on
-- Supabase projects). If it errors, run `create extension if not exists pgcrypto;`
-- first — not included here since extension creation is a privileged operation
-- best done deliberately, not as a side effect of this migration.
--
-- application_id is UNIQUE but nullable: only the "created" event sets it
-- (idempotency check for onboarding apply). Other event types leave it null;
-- their own idempotency/legality is enforced by the fn_* functions checking
-- the organization's current status before acting, not by a UNIQUE constraint.

create table if not exists contract_lifecycle_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  management_number text,
  application_id text unique,
  event_type text not null check (event_type in ('created', 'suspended', 'reactivated', 'terminated')),
  status_before text,
  status_after text,
  contract_date date,
  reason text,
  applied_at timestamptz not null default now(),
  applied_by text
);

create index if not exists idx_contract_lifecycle_log_organization_id
  on contract_lifecycle_log (organization_id);
