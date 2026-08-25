-- 目的：sobae_ops_executorロールを作成し、スキーマ使用権限を付与する。既存の業務テーブル
--       （organizations / offices / staff / system_users / office_service_registrations）
--       への直接アクセス権は持たないことを明示する。SECURITY DEFINER関数・ビューへの
--       GRANTは、それぞれの関数/ビューを作成するファイル（04〜09）側で行う
--       （sql/migrations/README.md §4）。
-- 作成日：2026-08-17（2026-08-19: 実スキーマのpg_dump検証結果に合わせて全面改訂。
--       テーブル名は単数形で設計していたが、実際は複数形（organizations等）だった。
--       会話ログ参照：実テーブルはSobae_Works本体のClaude Codeセッションでダンプ取得・検証済み）
-- 依存する既存オブジェクト：organizations, offices, staff, system_users,
--       office_service_registrations, service_types, roles（既存Sobae_Worksスキーマ、
--       pg_dump --schema-onlyで実在確認済み）
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

-- sobae_onboarding_executor: 04〜08のSECURITY DEFINER関数（fn_apply_onboarding等）の
-- 所有者ロール。sobae_ops_executor（backendが接続に使う、EXECUTE権限のみのロール）とは
-- 別に用意する。理由：SECURITY DEFINER関数は「所有者」の権限で実行されるため、
-- organizations/offices等への実際のINSERT/UPDATE権限はこのロールが持つ必要がある。
-- 既存のsobae_app_executor（Sobae_Works本体アプリ全体が使う既存ロール）を使い回す
-- 選択肢もあったが、本体の他機能（シフト・請求・ケアプラン等）まで含む広い権限セットに
-- 相乗りすると、この関数のバグ・脆弱性の影響範囲がops console外まで広がってしまう。
-- そのため、この関数群が実際に触る7テーブル（organizations, offices, staff,
-- system_users, office_service_registrations, roles, service_types）＋
-- contract_lifecycle_logだけに絞った最小権限の専用ロールとして新設する。
-- login権限は不要（このロールで直接接続することはなく、関数所有者としてのみ使う）。
--
-- 注意：このロール自体はここ（ops console側のmigration）で作成するが、
-- organizations/offices/staff/system_users/office_service_registrations/roles/
-- service_typesへのGRANTと、organizations/offices向けのRLS INSERTポリシー追加は、
-- それらのテーブルを所有するSobae_Works本体側のmigrationとして別途依頼する
-- （sobae_ops_executorが最初から本体テーブルに触れない設計を踏襲し、本体テーブルへの
-- 権限操作は本体のmigration履歴に残す）。
do $$
begin
  if not exists (select from pg_roles where rolname = 'sobae_onboarding_executor') then
    create role sobae_onboarding_executor;
  end if;
end
$$;

grant usage on schema public to sobae_ops_executor;
grant usage on schema public to sobae_onboarding_executor;

-- 既存業務テーブルへの直接DML権限は一切与えない（設計書SEC-002/SEC-003）。
-- FORCE ROW LEVEL SECURITYが効いている4テーブル（organizations/offices/staff/
-- system_users）はSobae_Works本体のRLSポリシーがapp._procedure_context前提のため、
-- 素のsobae_ops_executorから直接INSERT/UPDATEしても弾かれる（SECURITY DEFINER関数
-- 経由でのみ書き込む設計）。office_service_registrationsも同様。
-- contract_lifecycle_logは03で作成されるため、そちらでrevokeする。
revoke all on organizations, offices, staff, system_users, office_service_registrations from sobae_ops_executor;

-- service_typesはRLS無効のマスタデータ（サービス種別カタログ）。オンボーディング画面で
-- 選択肢を表示する用途のため、直接SELECTのみ許可する（書き込みは不要・許可しない）。
grant select on service_types to sobae_ops_executor;
