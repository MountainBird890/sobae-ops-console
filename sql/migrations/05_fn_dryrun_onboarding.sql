-- 目的：fn_apply_onboarding()を実際に呼び出した上で強制ロールバックすることで、
--       オンボーディング申請内容を副作用なしに検証するSECURITY DEFINER関数。
--       オンボーディングフローの手順1（dry-run → 2:apply、詳細は
--       04_fn_apply_onboarding.sqlのヘッダー参照）を担う。
-- 作成日：2026-08-17（2026-08-19: 実スキーマ確認に伴いfn_apply_onboarding側が全面改訂
--       されたためヘッダーも更新。ロジック本体（BEGIN/EXCEPTIONによる強制ロールバック）
--       は無変更）
-- 依存する既存オブジェクト：04_fn_apply_onboarding.sql（同一ペイロード契約。ロジックの
--       重複を避けるためfn_apply_onboarding自体を呼び出す）
-- ロールバック方針：drop function if exists fn_dryrun_onboarding(jsonb, text);
--
-- BEGIN/EXCEPTIONブロックはPL/pgSQLの暗黙のセーブポイントとして機能する。ブロック内で
-- 例外を発生させると、そのブロックが行った変更はロールバックされる（ただしローカル変数
-- への代入はロールバックされないため、v_resultはロールバック後も値を保持する）。
--
-- 呼び出し側への注意：system_users.login_id / password_hash は外部API呼び出し無しに
-- アプリ側だけで用意できる値なので、dry-run時点から常にpayloadへ含めてよい（旧版は
-- Supabase Auth前提でauth_uidを省略する必要があったが、今の実装にその制約は無い。
-- 含めることでlogin_idの重複もdry-runの時点で検知できる）。

create or replace function fn_dryrun_onboarding(p_payload jsonb, p_applied_by text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
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

-- fn_apply_onboardingと同じ所有者に揃える（01_roles.sql参照）。
alter function fn_dryrun_onboarding(jsonb, text) owner to sobae_onboarding_executor;
grant execute on function fn_dryrun_onboarding(jsonb, text) to sobae_ops_executor;
