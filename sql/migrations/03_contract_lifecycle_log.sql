-- 目的：事業所ライフサイクルの操作履歴（created/suspended/reactivated/terminated）を
--       記録する監査ログテーブルを作成する。application_id にUNIQUE制約を持たせ、
--       オンボーディングapplyの冪等性を担保する。
-- 作成日：2026-08-17（2026-08-19: テーブル名を実スキーマに合わせ organizations に修正）
-- 変更履歴：2026-10-07 consoleスキーマ化（再ベースライン。適用済みの管理環境が無いため既存ファイルを
--       直接書き直した。詳細は README.md §5）。関数のロジックは無変更。
-- 依存する既存オブジェクト：public.organizations(id)、02_console_schema.sql（consoleスキーマ）、
--       01_roles.sql（ロール作成済み）。本テーブル自体はorganizationsの新規カラム（旧02、
--       本体のmigrationへ移管）を直接参照しない
-- ロールバック方針：drop table if exists console.contract_lifecycle_log;
--
-- gen_random_uuid() は pgcrypto 拡張が必要（Supabaseプロジェクトではデフォルト有効）。
-- エラーになる場合は `create extension if not exists pgcrypto;` を先に実行すること
-- （拡張の作成は権限操作のため、このファイルの副作用として自動では行わない）。
--
-- application_id はUNIQUEだがNULL許容：「created」イベントのみ設定する（オンボーディング
-- applyの冪等性チェック用）。他のイベント種別はNULLのまま — それらの正当性は
-- UNIQUE制約ではなく、各fn_*関数が呼び出し時点のstatusを検証することで担保する。

create table if not exists console.contract_lifecycle_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  management_number text,
  application_id text unique,
  event_type text not null check (event_type in ('created', 'suspended', 'reactivated', 'terminated')),
  status_before text,
  status_after text,
  contract_date date,
  reason text,
  applied_at timestamptz not null default now(),
  applied_by text
);

create index if not exists idx_contract_lifecycle_log_organization_id
  on console.contract_lifecycle_log (organization_id);

-- 01_roles.sqlの続き：このテーブルはあの時点でまだ存在しなかったため、ここでrevokeする。
-- Supabaseの組み込みロールにも権限を与えない（既定権限に頼らず、明示的にrevoke）。
revoke all on console.contract_lifecycle_log from public, anon, authenticated, service_role, sobae_ops_executor;

-- fn_apply_onboarding等（04〜08、所有者はsobae_onboarding_executor）が読み書きする。
-- このテーブルはops console側で作った新規テーブルなので、Sobae_Works本体テーブルとは
-- 違い、ここで直接GRANTしてよい（実測で確認済み：GRANTが無いとSECURITY DEFINER関数から
-- でも "permission denied for table contract_lifecycle_log" になる）。
grant select, insert on console.contract_lifecycle_log to sobae_onboarding_executor;
