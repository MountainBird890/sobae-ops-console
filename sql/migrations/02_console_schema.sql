-- 目的：Console（ops console）が所有するDBオブジェクト（contract_lifecycle_log、
--       fn_*関数、v_organization_summary）を置く `console` スキーマを作成し、最小限の
--       権限を設定する。Sobae_Works本体のmigrate-safe（fingerprint・acl-audit）は
--       `public` スキーマだけを対象にするため、Consoleのオブジェクトを `console` に
--       分離することで、本体の履歴・fingerprintとの二重管理（ドリフト）を避ける。
-- 作成日：2026-10-07（旧 02_organization_alter.sql の番号を再利用。下記「経緯」参照）
-- 依存する既存オブジェクト：01_roles.sql（sobae_ops_executor、sobae_onboarding_executor）
-- ロールバック方針：`console` スキーマ内のオブジェクトを全て削除した後に
--   drop schema console;（cascade は使わない）
--
-- 経緯：旧02（organizations への列追加 management_number / contract_start_date /
-- contract_end_date / status と organizations_status_check の追加）は、Sobae_Works本体の
-- テーブル（public.organizations）の構造変更であるため、本体のmigration（番号は本体側が
-- 決定。250想定）に移管した。この番号を、03より前に必要となる `console` スキーマの
-- 作成に再利用している（README §4: 依存先は前の番号）。旧02のSQLはこのファイルに含めない
-- （Consoleのrunnerが public.organizations を変更すると、本体のfingerprintが動くため）。
-- 旧02の内容は git 履歴（sql/migrations/02_organization_alter.sql）に残っている。
--
-- Data API（PostgREST）の公開スキーマに `console` を追加しないこと。sobae_ops_executor は
-- backendからの直接接続で使うロールであり、Data API経由で呼ばれる設計ではない。

create schema if not exists console;

-- 新規スキーマにPUBLICの権限は付かないが、意図を明示して残す。
revoke all on schema console from public;

-- Supabaseの組み込みロールには何も与えない（念のため明示的にrevoke。Supabase環境では
-- 3ロールとも常に存在する）。
revoke all on schema console from anon, authenticated, service_role;

-- backendの接続ロール：関数のEXECUTEとビューのSELECTのため、スキーマの使用権のみ。
grant usage on schema console to sobae_ops_executor;

-- 関数・ビューの所有者：スキーマ内のオブジェクトの所有者になる（alter ... owner to の
-- 実行条件：新所有者に対象スキーマのCREATE権限が必要）ため、usage + create を与える。
grant usage, create on schema console to sobae_onboarding_executor;
