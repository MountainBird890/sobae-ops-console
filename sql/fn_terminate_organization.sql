-- Terminates a contract. Legal from 'active' or 'suspended'; 'terminated' is
-- a terminal state so an already-terminated organization is rejected (no
-- terminated -> anything transition exists, by design).
-- Requires: organization_columns.sql, contract_lifecycle_log.sql.
--
-- Judgment call to review: sets contract_end_date to today if it isn't
-- already set. The design doc doesn't say whether termination should stamp
-- contract_end_date automatically or require it as an explicit input —
-- adjust (e.g. take it as a parameter instead) if that's wrong.

create or replace function fn_terminate_organization(
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

  if v_status_before not in ('active', 'suspended') then
    raise exception 'cannot terminate organization in status %: only active or suspended organizations can be terminated', v_status_before
      using errcode = '22023';
  end if;

  update organization
  set status = 'terminated',
      contract_end_date = coalesce(contract_end_date, current_date)
  where id = p_organization_id;

  insert into contract_lifecycle_log (
    organization_id, management_number, event_type, status_before, status_after, reason, applied_by
  )
  select p_organization_id, o.management_number, 'terminated', v_status_before, 'terminated', p_reason, p_applied_by
  from organization o
  where o.id = p_organization_id
  returning id into v_log_id;

  return query select p_organization_id, 'terminated'::text, v_log_id;
end;
$$;
