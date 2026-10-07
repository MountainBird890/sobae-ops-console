-- 目的：active/suspendedな事業所をterminatedへ遷移させるSECURITY DEFINER関数。
--       terminatedは終端状態であり、既にterminatedな事業所への操作は拒否する
--       （terminated→他状態への遷移は一切存在しない）。
-- 作成日：2026-08-17（2026-08-19: 実スキーマ確認結果に合わせて全面改訂。テーブル名を
--       organizations に修正し、app._procedure_context対応・is_active同期を追加）
-- 変更履歴：2026-10-07 consoleスキーマ化（再ベースライン。適用済みの管理環境が無いため既存ファイルを
--       直接書き直した。詳細は README.md §5）。関数のロジックは無変更。
-- 依存する既存オブジェクト：01_roles.sql, 02_console_schema.sql, 03_contract_lifecycle_log.sql、
--       および本体のmigration（organizationsの4列とCHECK。旧02の内容。番号は本体側が決定、250想定）
-- ロールバック方針：drop function if exists console.fn_terminate_organization(uuid, text, text, date);
--
-- p_contract_end_date は任意の契約終了日を明示指定できるようにするための引数
-- （例：「来月末で終了」のようにその時点で決めた日付）。省略時は既存のcontract_end_date、
-- それも無ければ当日にフォールバックする — 明示的に渡した値が常に既存値より優先される。
--
-- app._procedure_context / is_active同期は06_fn_suspend_organization.sql参照。

create or replace function console.fn_terminate_organization(
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

  -- 【意図的な動作】status が NULL の法人（旧02の適用前から存在した法人。旧02は既存行を
  -- バックフィルしない）も、この関数で解約できる。`not in` は左辺が NULL のとき NULL を返し、
  -- IF は偽として扱うため、下の例外が投げられない（NULL は active/suspended のどちらでもないが、
  -- 既存の顧客の契約終了を可能にするため、この動作を維持する。2026-10-07 決定）。
  -- 06 / 07 は `is distinct from` を使うため NULL の法人を拒否する（非対称）。ログの
  -- status_before には NULL がそのまま記録される。この条件を変更する場合は設計判断が必要
  -- （NULL を拒否する形に直すと、既存の法人の解約ができなくなる）。
  if v_status_before not in ('active', 'suspended') then
    raise exception 'cannot terminate organization in status %: only active or suspended organizations can be terminated', v_status_before
      using errcode = '22023';
  end if;

  update organizations
  set status = 'terminated',
      is_active = false,
      contract_end_date = coalesce(p_contract_end_date, contract_end_date, current_date)
  where id = p_organization_id;

  insert into console.contract_lifecycle_log (
    organization_id, management_number, event_type, status_before, status_after, reason, applied_by
  )
  select p_organization_id, o.management_number, 'terminated', v_status_before, 'terminated', p_reason, p_applied_by
  from organizations o
  where o.id = p_organization_id
  returning id into v_log_id;

  perform set_config('app._procedure_context', '', true);

  return query select p_organization_id, 'terminated'::text, v_log_id;
end;
$$;

-- 既定権限（作成者postgresのグローバル既定。本体Migration 215）に頼らず、明示的にrevokeする
-- （所有者変更の前に実行）。
revoke execute on function console.fn_terminate_organization(uuid, text, text, date) from public, anon, authenticated, service_role;
alter function console.fn_terminate_organization(uuid, text, text, date) owner to sobae_onboarding_executor;
grant execute on function console.fn_terminate_organization(uuid, text, text, date) to sobae_ops_executor;
