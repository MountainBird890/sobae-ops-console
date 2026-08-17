-- Terminates a contract. Legal from 'active' or 'suspended'; 'terminated' is
-- a terminal state so an already-terminated organization is rejected (no
-- terminated -> anything transition exists, by design).
-- Requires: organization_columns.sql, contract_lifecycle_log.sql.
--
-- p_contract_end_date lets the caller set an arbitrary termination date
-- (e.g. "end of next month" decided at the time of the operation). Falls
-- back to the organization's existing contract_end_date if omitted, and
-- only defaults to today if neither is set — an explicit argument always
-- wins over whatever was already on the row.

create or replace function fn_terminate_organization(
  p_organization_id uuid,
  p_reason text,
  p_applied_by text,
  p_contract_end_date date default null
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
      contract_end_date = coalesce(p_contract_end_date, contract_end_date, current_date)
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
