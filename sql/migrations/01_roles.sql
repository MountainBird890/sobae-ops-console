-- 目的：sobae_ops_executorロールを作成し、スキーマ使用権限を付与する。既存の業務テーブル
--       （organization / office / services / staff / "system_user"）への直接アクセス権は
--       持たないことを明示する。SECURITY DEFINER関数・ビューへのGRANTは、それぞれの
--       関数/ビューを作成するファイル（04〜09）側で行う（sql/migrations/README.md §4）。
-- 作成日：2026-08-17
-- 依存する既存オブジェクト：organization, office, services, staff, "system_user"（既存Sobae_Worksスキーマ）
-- ロールバック方針：関連する全GRANTを取り消した上で `drop role sobae_ops_executor;`
--
-- パスワードはこのファイルに含めない（Gitへコミットしない）。適用後、別途以下のように
-- 設定し、生成した接続文字列はこのリポジトリの外（DATABASE_URL環境変数）で管理する：
--   alter role sobae_ops_executor with password '<ここに生成したパスワード、Git管理外>';

do $$
begin
  if not exists (select from pg_roles where rolname = 'sobae_ops_executor') then
    create role sobae_ops_executor with login;
  end if;
end
$$;

grant usage on schema public to sobae_ops_executor;

-- 既存業務テーブルへの直接DML権限は一切与えない（設計書SEC-002/SEC-003）。
-- contract_lifecycle_logは03で作成されるため、そちらでrevokeする。
revoke all on organization, office, services, staff, "system_user" from sobae_ops_executor;
