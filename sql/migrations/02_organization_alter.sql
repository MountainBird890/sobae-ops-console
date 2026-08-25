-- 目的：既存の organizations テーブルにライフサイクル管理用カラムを追加する
--       （management_number, contract_start_date, contract_end_date, status）。
-- 作成日：2026-08-17（2026-08-19: 実スキーマのpg_dump検証結果に合わせて全面改訂）
-- 依存する既存オブジェクト：organizations（id uuid primary key。pg_dump --schema-onlyで
--       実在確認済み。既存列: id, name, postal_code, address, phone, fax, email,
--       is_active, created_at, updated_at, login_code, next_staff_number）
-- ロールバック方針：
--   alter table organizations drop column if exists status,
--     drop column if exists contract_end_date, drop column if exists contract_start_date,
--     drop column if exists management_number;
--
-- 確認済み（以前は「実テーブル未確認」としていたが、pg_dumpで解消）：
--   * 以下4カラムは既存organizationsに存在せず、別名との衝突もない。
--   * management_number にUNIQUE制約を付与（重複不可の前提。制約が不要と判明したら外す）。
--
-- is_activeとの関係（重要）：organizationsには既に is_active boolean（デフォルトtrue）が
-- あり、コメントに「falseの場合はSOBAE側で無効化した法人」と明記されている——つまり
-- 本体アプリが既に持っている「法人を無効化する」ためのフラグそのもの。今回追加する
-- status（active/suspended/terminated の3値）はこれを置き換えるのではなく、is_activeの
-- 上位互換として扱う：status='active' の間だけ is_active=true、suspended/terminated
-- では is_active=false にする（06〜08の各関数側でセットする。このファイル自体は
-- 列追加のみで is_active には触れない）。
--
-- あえて決めていないこと（実データが無く判断できない）：status はNULL許容・デフォルト
-- なしのまま。既存行を一律'active'にするのは実データ未確認のまま断定することになるため
-- 避けた。バックフィルする場合の出発点（自動実行はしない）：
--   update organizations set status = 'active' where status is null;
-- 対象行を確認してから実行すること。

alter table organizations
  add column if not exists management_number text unique,
  add column if not exists contract_start_date date,
  add column if not exists contract_end_date date,
  add column if not exists status text;

alter table organizations
  drop constraint if exists organizations_status_check;

alter table organizations
  add constraint organizations_status_check
  check (status is null or status in ('active', 'suspended', 'terminated'));
