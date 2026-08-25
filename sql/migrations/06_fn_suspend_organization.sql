-- 目的：activeな事業所をsuspendedへ遷移させるSECURITY DEFINER関数。activeでない
--       事業所（suspended/terminated含む）への操作は拒否する（冪等な操作にはしない —
--       設計書の確認モーダル＋事業所名再入力による「一度きりの意図的操作」モデルに従う）。
-- 作成日：2026-08-17（2026-08-19: 実スキーマ確認結果に合わせて全面改訂。テーブル名を
--       organizations に修正し、app._procedure_context対応・is_active同期を追加）
-- 依存する既存オブジェクト：01_roles.sql, 02_organization_alter.sql, 03_contract_lifecycle_log.sql
-- ロールバック方針：drop function if exists fn_suspend_organization(uuid, text, text);
--
-- p_applied_by は操作者の識別子（例：メールアドレス）。backend側が検証済みのSupabase
-- セッションから解決して渡す想定。sobae_ops_executorは素のPostgres直接接続であり、
-- Supabase/PostgRESTのようなセッションコンテキストを持たないため、この関数自身は
-- 「誰が呼んでいるか」を知る手段を持たない。
--
-- app._procedure_context / is_active同期について：organizationsはFORCE ROW LEVEL
-- SECURITYが有効で、UPDATE用ポリシーがapp._procedure_context = 'true' を前提にしている
-- （実測確認済み。本体のproc_*と同じパターン）。また、organizations.is_active（既存bool、
-- 「falseの場合はSOBAE側で無効化した法人」）と、こちらが追加したstatus列の整合を取るため、
-- suspendではis_activeもfalseにする（02_organization_alter.sqlのコメント参照）。

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

  if v_status_before is distinct from 'active' then
    raise exception 'cannot suspend organization in status %: only an active organization can be suspended', v_status_before
      using errcode = '22023';
  end if;

  update organizations
  set status = 'suspended', is_active = false
  where id = p_organization_id;

  insert into contract_lifecycle_log (
    organization_id, management_number, event_type, status_before, status_after, reason, applied_by
  )
  select p_organization_id, o.management_number, 'suspended', v_status_before, 'suspended', p_reason, p_applied_by
  from organizations o
  where o.id = p_organization_id
  returning id into v_log_id;

  perform set_config('app._procedure_context', '', true);

  return query select p_organization_id, 'suspended'::text, v_log_id;
end;
$$;

alter function fn_suspend_organization(uuid, text, text) owner to sobae_onboarding_executor;
grant execute on function fn_suspend_organization(uuid, text, text) to sobae_ops_executor;
