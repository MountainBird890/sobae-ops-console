-- Creates organization + office(s) + services + initial admin staff/"system_user"
-- as one atomic operation, and logs it. Requires: organization_columns.sql,
-- contract_lifecycle_log.sql already applied.
--
-- DRAFT PAYLOAD CONTRACT — there is no backend/src/schema/application.ts yet
-- to be the actual source of truth, so this function currently defines the
-- shape by itself. Keep the two in sync once that Zod schema exists; treat
-- this as a starting proposal, not a settled contract.
--
--   {
--     "application_id": "string, required — unique per onboarding submission,
--                         re-applying the same one is rejected, not silently
--                         no-op'd (see the exists-check below)",
--     "organization": {
--       "name": "string", "login_code": "string",
--       "management_number": "string", "contract_start_date": "YYYY-MM-DD"
--     },
--     "offices": [
--       {
--         "code": "string", "name": "string", "postal_code": "string",
--         "address": "string", "phone": "string", "email": "string",
--         "services": [ { "service_code": "string", "provider_number": "string" } ]
--       }
--     ],
--     "initial_admin": {
--       "office_code": "string — must match one of offices[].code above",
--       "last_name": "string", "first_name": "string", "employment_type": "string",
--       "auth_uid": "uuid — a Supabase Auth user that ALREADY EXISTS. This
--                    function does not create/invite the Auth user itself
--                    (SQL functions can't call the Supabase Auth API) — the
--                    backend route is expected to create/invite that user
--                    first and pass its id in here.",
--       "role": "string"
--     }
--   }
--
-- OPEN QUESTION for whoever wires up routes/onboarding.ts: does the backend
-- create the Supabase Auth user before or after a successful dry-run? If
-- before, a failed/abandoned dry-run could leave an orphaned Auth user with
-- no corresponding organization. Not resolved here.

create or replace function fn_apply_onboarding(p_payload jsonb, p_applied_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application_id text := p_payload ->> 'application_id';
  v_organization_id uuid;
  v_office jsonb;
  v_service jsonb;
  v_office_id uuid;
  v_office_code_to_id jsonb := '{}'::jsonb;
  v_admin jsonb := p_payload -> 'initial_admin';
  v_admin_office_id uuid;
  v_staff_id uuid;
  v_log_id uuid;
begin
  if v_application_id is null or v_application_id = '' then
    raise exception 'application_id is required' using errcode = '22023';
  end if;

  if exists (select 1 from contract_lifecycle_log where application_id = v_application_id) then
    raise exception 'application % has already been applied', v_application_id
      using errcode = '23505';
  end if;

  insert into organization (name, login_code, management_number, contract_start_date, status)
  values (
    p_payload -> 'organization' ->> 'name',
    p_payload -> 'organization' ->> 'login_code',
    p_payload -> 'organization' ->> 'management_number',
    (p_payload -> 'organization' ->> 'contract_start_date')::date,
    'active'
  )
  returning id into v_organization_id;

  for v_office in select jsonb_array_elements(p_payload -> 'offices')
  loop
    insert into office (organization_id, code, name, postal_code, address, phone, email)
    values (
      v_organization_id,
      v_office ->> 'code',
      v_office ->> 'name',
      v_office ->> 'postal_code',
      v_office ->> 'address',
      v_office ->> 'phone',
      v_office ->> 'email'
    )
    returning id into v_office_id;

    v_office_code_to_id := v_office_code_to_id || jsonb_build_object(v_office ->> 'code', v_office_id::text);

    for v_service in select jsonb_array_elements(coalesce(v_office -> 'services', '[]'::jsonb))
    loop
      insert into services (office_id, service_code, provider_number)
      values (v_office_id, v_service ->> 'service_code', v_service ->> 'provider_number');
    end loop;
  end loop;

  v_admin_office_id := (v_office_code_to_id ->> (v_admin ->> 'office_code'))::uuid;
  if v_admin_office_id is null then
    raise exception 'initial_admin.office_code % does not match any office in this application', v_admin ->> 'office_code'
      using errcode = '22023';
  end if;

  insert into staff (office_id, last_name, first_name, employment_type)
  values (v_admin_office_id, v_admin ->> 'last_name', v_admin ->> 'first_name', v_admin ->> 'employment_type')
  returning id into v_staff_id;

  insert into "system_user" (staff_id, auth_uid, role)
  values (v_staff_id, (v_admin ->> 'auth_uid')::uuid, v_admin ->> 'role');

  insert into contract_lifecycle_log (
    organization_id, management_number, application_id, event_type, status_before, status_after, contract_date, applied_by
  )
  values (
    v_organization_id,
    p_payload -> 'organization' ->> 'management_number',
    v_application_id,
    'created',
    null,
    'active',
    (p_payload -> 'organization' ->> 'contract_start_date')::date,
    p_applied_by
  )
  returning id into v_log_id;

  return jsonb_build_object('organization_id', v_organization_id, 'log_id', v_log_id);
end;
$$;
