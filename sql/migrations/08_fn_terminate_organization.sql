-- 目的：active/suspendedな事業所をterminatedへ遷移させるSECURITY DEFINER関数。
--       terminatedは終端状態であり、既にterminatedな事業所への操作は拒否する
--       （terminated→他状態への遷移は一切存在しない）。
-- 作成日：2026-08-17
-- 依存する既存オブジェクト：01_roles.sql, 02_organization_alter.sql, 03_contract_lifecycle_log.sql
-- ロールバック方針：drop function if exists fn_terminate_organization(uuid, text, text, date);
--
-- p_contract_end_date は任意の契約終了日を明示指定できるようにするための引数
-- （例：「来月末で終了」のようにその時点で決めた日付）。省略時は既存のcontract_end_date、
-- それも無ければ当日にフォールバックする — 明示的に渡した値が常に既存値より優先される。

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

grant execute on function fn_terminate_organization(uuid, text, text, date) to sobae_ops_executor;
