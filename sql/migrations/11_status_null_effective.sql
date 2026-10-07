-- 目的：statusがNULLの既存の法人（本体migration 250の適用前から存在する法人。250はバックフィルしない）を、
--       Consoleの画面と操作で扱えるようにする。
--       (1) console.v_organization_summaryが実効ステータスを返す：statusがあればそのまま、NULLかつ
--           is_active=trueならactive、NULLかつis_active=falseはNULLのまま（画面では「要確認」）。
--       (2) console.fn_suspend_organizationが、同じ規則で実効ステータスを判定する：NULLかつis_active=trueの
--           法人は利用停止できる（停止するとstatus='suspended'、is_active=falseが書かれ、以後はNULLでなくなる）。
-- 作成日：2026-10-08
-- 依存する既存オブジェクト：06_fn_suspend_organization.sql、09_v_organization_summary.sql、
--       本体のmigration（organizationsのstatus・management_number・contract_*列とis_active列）。
--       ※ビューが参照する本体の列に、is_activeが加わった（従来の6列 + is_active。本体との約束事）。
-- 変更しないもの：
--   * 07（再開）：suspended以外は拒否のまま。NULLかつis_active=trueは実効active、NULLかつfalseは実効NULLで、
--     どちらも再開の対象外（従来どおり22023）。
--   * 08（契約終了）：NULLでも契約終了できる挙動を維持する（2026-10-07決定。三値論理に依存した意図的な仕様）。
--   * ログインの遮断：本体の認証ゲートはorganizations.is_activeだけを見る。statusは表示用のラベル。
-- 監査ログ：06のstatus_beforeには実効ステータス（NULL→activeの場合は'active'）を記録する。
-- ロールバック方針：09と06の定義（git履歴）に戻す create or replace。

-- (1) ビュー：列の名前・型・順序は09と同じ（statusの値だけが実効値になる）。
create or replace view console.v_organization_summary as
select
  id,
  name,
  management_number,
  case
    when status is not null then status
    when is_active then 'active'
    else null
  end as status,
  contract_start_date,
  contract_end_date
from public.organizations;

-- 09と同じ権限（create or replaceは所有者・権限を維持するが、明示的に再指定する）。
revoke all on console.v_organization_summary from public, anon, authenticated, service_role;
alter view console.v_organization_summary owner to sobae_onboarding_executor;
grant select on console.v_organization_summary to sobae_ops_executor;

-- (2) 06の再定義（実効ステータスの判定のみ変更）。
create or replace function console.fn_suspend_organization(
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

  -- 実効ステータス：statusがNULLの法人（本体migration 250の適用前から存在する法人）は、
  -- is_activeがtrueならactiveとして扱う。is_activeがfalseのNULLはNULLのまま（下で拒否する）。
  select coalesce(o.status, case when o.is_active then 'active' end) into v_status_before
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

  insert into console.contract_lifecycle_log (
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

revoke execute on function console.fn_suspend_organization(uuid, text, text) from public, anon, authenticated, service_role;
alter function console.fn_suspend_organization(uuid, text, text) owner to sobae_onboarding_executor;
grant execute on function console.fn_suspend_organization(uuid, text, text) to sobae_ops_executor;
