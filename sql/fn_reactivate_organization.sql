-- Reactivates a suspended organization. Only 'suspended' -> 'active' is
-- legal; a 'terminated' organization can never be reactivated (terminal
-- state per the design doc — re-contracting is a brand new onboarding, not
-- a status flip). Requires: organization_columns.sql, contract_lifecycle_log.sql.

create or replace function fn_reactivate_organization(
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

  if v_status_before is distinct from 'suspended' then
    raise exception 'cannot reactivate organization in status %: only a suspended organization can be reactivated', v_status_before
      using errcode = '22023';
  end if;

  update organization
  set status = 'active'
  where id = p_organization_id;

  insert into contract_lifecycle_log (
    organization_id, management_number, event_type, status_before, status_after, reason, applied_by
  )
  select p_organization_id, o.management_number, 'reactivated', v_status_before, 'active', p_reason, p_applied_by
  from organization o
  where o.id = p_organization_id
  returning id into v_log_id;

  return query select p_organization_id, 'active'::text, v_log_id;
end;
$$;
