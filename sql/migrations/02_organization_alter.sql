-- 目的：既存の organization テーブルにライフサイクル管理用カラムを追加する
--       （management_number, contract_start_date, contract_end_date, status）。
-- 作成日：2026-08-17
-- 依存する既存オブジェクト：organization（id uuid primary key を持つ想定。既存スキーマは
--       未確認 — 設計書ER図からの想定で、実テーブルの検証はできていない）
-- ロールバック方針：
--   alter table organization drop column if exists status,
--     drop column if exists contract_end_date, drop column if exists contract_start_date,
--     drop column if exists management_number;
--
-- 適用前提の確認事項（実テーブル未確認のため）：
--   * 以下4カラムが既に別名で存在していないこと。
--   * management_number は設計書の説明（「認識番号（契約管理用）」）からUNIQUE制約を
--     付与しているが、重複が許容される仕様であれば制約を外すこと。
--
-- あえて決めていないこと（実データが無く判断できない）：status はNULL許容・デフォルト
-- なしのまま。既存行を一律'active'にするのは実データ未確認のまま断定することになるため
-- 避けた。バックフィルする場合の出発点（自動実行はしない）：
--   update organization set status = 'active' where status is null;
-- 対象行を確認してから実行すること。

alter table organization
  add column if not exists management_number text unique,
  add column if not exists contract_start_date date,
  add column if not exists contract_end_date date,
  add column if not exists status text;

alter table organization
  drop constraint if exists organization_status_check;

alter table organization
  add constraint organization_status_check
  check (status is null or status in ('active', 'suspended', 'terminated'));
