-- Suspends an active organization. Rejects any organization not currently
-- 'active' (including already-suspended — this is not idempotent by design,
-- per the design doc's confirm-modal-guarded "one deliberate action" model).
-- Requires: organization_columns.sql, contract_lifecycle_log.sql.
--
-- p_applied_by is the acting user's identity (e.g. their email), resolved by
-- the backend from the verified Supabase session — this function has no
-- session context of its own since sobae_ops_executor is a plain direct
-- Postgres connection, not a Supabase/PostgREST request.

create or replace function fn_suspend_organization(
  p_organization_id uuid,
  p_reason text,
  p_applied_by text
)
returns table (
  organization_id uuid,
  status text,
  log_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_before text;
  v_log_id uuid;
begin
  select o.status into v_status_before
  from organization o
  where o.id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found: %', p_organization_id
      using errcode = 'P0002';
  end if;

  if v_status_before is distinct from 'active' then
    raise exception 'cannot suspend organization in status %: only an active organization can be suspended', v_status_before
      using errcode = '22023';
  end if;

  update organization
  set status = 'suspended'
  where id = p_organization_id;

  insert into contract_lifecycle_log (
    organization_id, management_number, event_type, status_before, status_after, reason, applied_by
  )
  select p_organization_id, o.management_number, 'suspended', v_status_before, 'suspended', p_reason, p_applied_by
  from organization o
  where o.id = p_organization_id
  returning id into v_log_id;

  return query select p_organization_id, 'suspended'::text, v_log_id;
end;
$$;
