-- 目的：suspendedな事業所をactiveへ遷移させるSECURITY DEFINER関数。suspended以外
--       （terminated含む）からの遷移は拒否する。terminatedは終端状態であり、再契約は
--       新規オンボーディングとして扱う（設計書の方針、ステータスの巻き戻しはしない）。
-- 作成日：2026-08-17
-- 依存する既存オブジェクト：01_roles.sql, 02_organization_alter.sql, 03_contract_lifecycle_log.sql
-- ロールバック方針：drop function if exists fn_reactivate_organization(uuid, text, text);

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

grant execute on function fn_reactivate_organization(uuid, text, text) to sobae_ops_executor;
