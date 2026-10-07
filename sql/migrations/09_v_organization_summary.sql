-- 目的：Ops Consoleの一覧・ダッシュボード画面向けの読み取り専用ビューを作成する。
-- 作成日：2026-08-17（2026-08-19: テーブル名を実スキーマに合わせ organizations に修正。
--       ビュー所有者をsobae_onboarding_executorに設定——Postgresのビューはデフォルトで
--       「クエリを投げた側」ではなく「ビューの所有者」の権限で実表を参照するため、
--       organizationsへのSELECT権限を持つロールを明示的に所有者にする必要がある）
-- 変更履歴：2026-10-07 consoleスキーマ化（再ベースライン。適用済みの管理環境が無いため既存ファイルを
--       直接書き直した。詳細は README.md §5）。関数のロジックは無変更。
-- 依存する既存オブジェクト：01_roles.sql, 02_console_schema.sql、および本体のmigration
--       （organizationsの4列。旧02の内容。番号は本体側が決定、250想定）。本体がこのビューが
--       参照する列を変更・削除・型変更すると、このビューが壊れる（本体との約束事）。
-- ロールバック方針：drop view if exists console.v_organization_summary;
--
-- backend/src/routes/organizations.ts が参照する列構成と完全に一致させている。
-- ここを変更する場合はそちらのファイルも合わせて更新すること（逆も同様）。

create or replace view console.v_organization_summary as
select
  id,
  name,
  management_number,
  status,
  contract_start_date,
  contract_end_date
from public.organizations;

-- 既定権限に頼らず、明示的にrevokeする（所有者変更の前）。
revoke all on console.v_organization_summary from public, anon, authenticated, service_role;
alter view console.v_organization_summary owner to sobae_onboarding_executor;
grant select on console.v_organization_summary to sobae_ops_executor;
