-- 目的：fn_apply_onboarding()を実際に呼び出した上で強制ロールバックすることで、
--       オンボーディング申請内容を副作用なしに検証するSECURITY DEFINER関数。
-- 作成日：2026-08-17
-- 依存する既存オブジェクト：04_fn_apply_onboarding.sql（同一ペイロード契約。ロジックの
--       重複を避けるためfn_apply_onboarding自体を呼び出す）
-- ロールバック方針：drop function if exists fn_dryrun_onboarding(jsonb, text);
--
-- BEGIN/EXCEPTIONブロックはPL/pgSQLの暗黙のセーブポイントとして機能する。ブロック内で
-- 例外を発生させると、そのブロックが行った変更はロールバックされる（ただしローカル変数
-- への代入はロールバックされないため、v_resultはロールバック後も値を保持する）。

create or replace function fn_dryrun_onboarding(p_payload jsonb, p_applied_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  begin
    v_result := fn_apply_onboarding(p_payload, p_applied_by);
    raise exception using errcode = 'DRYRN';
  exception
    when sqlstate 'DRYRN' then
      return jsonb_build_object('valid', true, 'preview', v_result, 'errors', '[]'::jsonb);
    when others then
      return jsonb_build_object('valid', false, 'errors', jsonb_build_array(sqlerrm));
  end;
end;
$$;

grant execute on function fn_dryrun_onboarding(jsonb, text) to sobae_ops_executor;
