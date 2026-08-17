-- 目的：Ops Consoleの一覧・ダッシュボード画面向けの読み取り専用ビューを作成する。
-- 作成日：2026-08-17
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
from organization;

grant select on v_organization_summary to sobae_ops_executor;
