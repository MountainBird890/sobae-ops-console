-- ステータス：Sobae_Works本体への依頼用SQL（このリポジトリの「マイグレーション」ではない）
--
-- 位置づけ：sql/migrations/README.md の定義上、これは本リポジトリのマイグレーションでは
-- ない（対象がSobae_Works本体が所有するテーブル・ロールであり、このリポジトリが
-- 管理する構造ではないため）。sql/migrations/ に混ぜず、ここに独立して置く。
--
-- 目的：チーム内でのマイグレーション作成のコンフリクトを防ぐため、Sobae_Works本体に
-- 正式なmigrationファイル作成を依頼する前に、まずops console側でここに書かれている
-- 内容を実際に検証した（Sobae_WorksのローカルDockerコンテナ、ポート5433、
-- npm run db:local:reset 直後のクリーンな状態から適用）。
--
-- 検証内容：sql/migrations/01〜09（sobae_onboarding_executorロール新設・
-- fn_apply_onboarding等の全面書き直し）を適用した状態で、このファイルをSobae_Works本体
-- 側のロールとして流し込み、以下がすべて成功することを確認済み：
--   dry-run → apply → 冪等性チェック(再applyの拒否) → suspend → reactivate → terminate
--   → v_organization_summary からの参照
--
-- 廃止予定：Sobae_Works本体側で、この内容を反映した正式なmigrationファイルが
-- 作成され次第、このファイルは不要になる（削除してよい）。それまでの一時的な
-- 「依頼内容の記録」として置いている。
--
-- 対象ロール sobae_onboarding_executor は、このリポジトリ側の
-- sql/migrations/01_roles.sql で作成される（Sobae_Works側でロールを新規作成する
-- 必要はなく、既存ロールへのGRANT/POLICY追加のみでよい）。
--
-- 適用順序の注意：sql/migrations/01_roles.sql（sobae_onboarding_executor作成）が先に
-- 適用されていないと、このファイルのGRANT/POLICY文はロールが存在せずエラーになる。

-- === GRANT ===
grant select, insert, update on organizations to sobae_onboarding_executor;
grant select, insert on offices to sobae_onboarding_executor;
grant select, insert on staff to sobae_onboarding_executor;
grant select, insert on system_users to sobae_onboarding_executor;
grant select, insert on office_service_registrations to sobae_onboarding_executor;
grant select on roles to sobae_onboarding_executor;
grant select on service_types to sobae_onboarding_executor;

-- RLSポリシー内で参照されるfn_current_*関数群。SECURITY DEFINER関数の所有者
-- (sobae_onboarding_executor)がこれらを呼び出せる必要がある（実測で確認：
-- 無いと "permission denied for function fn_current_office_id" 等でエラーになる）
grant execute on function fn_current_execution_mode() to sobae_onboarding_executor;
grant execute on function fn_current_office_id() to sobae_onboarding_executor;
grant execute on function fn_current_request_id() to sobae_onboarding_executor;
grant execute on function fn_current_staff_id() to sobae_onboarding_executor;
grant execute on function fn_current_user_id() to sobae_onboarding_executor;
grant execute on function fn_current_user_role() to sobae_onboarding_executor;

-- === RLS policies（すべて追加。既存ポリシーは無変更・無削除） ===

-- organizations/offices には元々INSERT用ポリシーが存在しない（実測で確認：
-- INSERTしようとすると "new row violates row-level security policy" になる）
create policy rls_organizations_insert on organizations for insert
  with check (current_setting('app._procedure_context', true) = 'true');

create policy rls_offices_insert on offices for insert
  with check (current_setting('app._procedure_context', true) = 'true');

-- INSERT...RETURNING は、対象行がSELECTポリシーの可視性チェックも通過する必要がある
-- （実測で確認：通らないと "permission denied for table offices" や
-- "new row violates row-level security policy for table organizations" になる）
create policy rls_organizations_select_procedure on organizations for select
  using (current_setting('app._procedure_context', true) = 'true');

create policy rls_offices_select_procedure on offices for select
  using (current_setting('app._procedure_context', true) = 'true');

-- SELECT ... FOR UPDATE は、SELECTポリシーだけでなくUPDATEポリシーの通過も要求する
-- （実測で確認した重要な仕様。これが無いと、UPDATE文自体はエラーにならず
-- "0件更新"のまま静かに成功したように見えてしまう——実際にnext_staff_numberの
-- 更新やstatus遷移が反映されない、というバグとして顕在化した）
create policy rls_organizations_update_procedure on organizations for update
  using (current_setting('app._procedure_context', true) = 'true')
  with check (current_setting('app._procedure_context', true) = 'true');

create policy rls_staff_select_procedure on staff for select
  using (current_setting('app._procedure_context', true) = 'true');

create policy rls_su_select_procedure on system_users for select
  using (current_setting('app._procedure_context', true) = 'true');

-- v_organization_summary（ops console側のビュー、sql/migrations/09で定義。
-- organizationsを参照する）向け：ビューは「呼び出し元」ではなく「所有者」の権限で
-- 実表のRLSを評価する（実測で確認したPostgresの挙動）。ビューの所有者は
-- sobae_onboarding_executor（09_v_organization_summary.sql参照）なので、
-- このロールに全件可視性を与える必要がある。既存の rls_su_select_auth_executor
-- （特定ロール専用の全件SELECTポリシー）と同じ考え方。
create policy rls_organizations_select_onboarding_executor on organizations for select to sobae_onboarding_executor
  using (true);
