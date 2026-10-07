-- 目的：suspendedな事業所をactiveへ遷移させるSECURITY DEFINER関数。suspended以外
--       （terminated含む）からの遷移は拒否する。terminatedは終端状態であり、再契約は
--       新規オンボーディングとして扱う（設計書の方針、ステータスの巻き戻しはしない）。
-- 作成日：2026-08-17（2026-08-19: 実スキーマ確認結果に合わせて全面改訂。テーブル名を
--       organizations に修正し、app._procedure_context対応・is_active同期を追加）
-- 変更履歴：2026-10-07 consoleスキーマ化（再ベースライン。適用済みの管理環境が無いため既存ファイルを
--       直接書き直した。詳細は README.md §5）。関数のロジックは無変更。
-- 依存する既存オブジェクト：01_roles.sql, 02_console_schema.sql, 03_contract_lifecycle_log.sql、
--       および本体のmigration（organizationsの4列とCHECK。旧02の内容。番号は本体側が決定、250想定）
-- ロールバック方針：drop function if exists console.fn_reactivate_organization(uuid, text, text);
--
-- app._procedure_context / is_active同期は06_fn_suspend_organization.sql参照。

create or replace function console.fn_reactivate_organization(
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
set search_path = pg_catalog, public
as $$
declare
  v_status_before text;
  v_log_id uuid;
begin
  perform set_config('app._procedure_context', 'true', true);

  select o.status into v_status_before
  from organizations o
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

  update organizations
  set status = 'active', is_active = true
  where id = p_organization_id;

  insert into console.contract_lifecycle_log (
    organization_id, management_number, event_type, status_before, status_after, reason, applied_by
  )
  select p_organization_id, o.management_number, 'reactivated', v_status_before, 'active', p_reason, p_applied_by
  from organizations o
  where o.id = p_organization_id
  returning id into v_log_id;

  perform set_config('app._procedure_context', '', true);

  return query select p_organization_id, 'active'::text, v_log_id;
end;
$$;

-- 既定権限（作成者postgresのグローバル既定。本体Migration 215）に頼らず、明示的にrevokeする
-- （所有者変更の前に実行）。
revoke execute on function console.fn_reactivate_organization(uuid, text, text) from public, anon, authenticated, service_role;
alter function console.fn_reactivate_organization(uuid, text, text) owner to sobae_onboarding_executor;
grant execute on function console.fn_reactivate_organization(uuid, text, text) to sobae_ops_executor;
