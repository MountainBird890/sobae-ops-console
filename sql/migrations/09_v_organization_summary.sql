-- 目的：Ops Consoleの一覧・ダッシュボード画面向けの読み取り専用ビューを作成する。
-- 作成日：2026-08-17（2026-08-19: テーブル名を実スキーマに合わせ organizations に修正。
--       ビュー所有者をsobae_onboarding_executorに設定——Postgresのビューはデフォルトで
--       「クエリを投げた側」ではなく「ビューの所有者」の権限で実表を参照するため、
--       organizationsへのSELECT権限を持つロールを明示的に所有者にする必要がある）
-- 依存する既存オブジェクト：01_roles.sql, 02_organization_alter.sql
-- ロールバック方針：drop view if exists v_organization_summary;
--
-- backend/src/routes/organizations.ts が参照する列構成と完全に一致させている。
-- ここを変更する場合はそちらのファイルも合わせて更新すること（逆も同様）。

create or replace view v_organization_summary as
select
  id,
  name,
  management_number,
  status,
  contract_start_date,
  contract_end_date
from organizations;

alter view v_organization_summary owner to sobae_onboarding_executor;
grant select on v_organization_summary to sobae_ops_executor;
