# sql/migrations/ 運用ルール（Claude Code向け）

このリポジトリでは、Supabase CLIの自動マイグレーション管理は使わず、`sql/migrations/`配下に手動で連番SQLファイルを置く運用方式を採用している。新しいSQLファイルを作成・編集する際は、必ず以下のルールに従うこと。

## 1. マイグレーションの定義

以下の性質をすべて満たすSQLだけを、「マイグレーション」として`sql/migrations/`に置く。

- DBの「構造」を変える操作である（DDL：CREATE / ALTER / DROP、権限操作：GRANT / REVOKE）
- 適用順序に意味がある（後続のファイルが前のファイルの適用済みを前提にする）
- 1回だけ適用されることを想定している（同じ内容を2回流すと壊れる/無意味）

該当するもの例：`CREATE ROLE`、`ALTER TABLE ... ADD COLUMN`、`CREATE TABLE`、`CREATE FUNCTION`（SECURITY DEFINER含む）、`CREATE VIEW`、`CREATE TRIGGER`、`GRANT` / `REVOKE`

## 2. マイグレーションではないもの（sql/migrations/に置かない）

- 集計・確認用のSELECTクエリ
- 一度きりの調査・デバッグ用スクリプト
- seedデータ投入用のINSERT文（`sql/seed/`など別ディレクトリを使う）
- レポート出力用の定型クエリ

判断に迷ったら、そのSQLをもう一度実行したら何が起きるかを考える。DBの構造を変える／エラーになる → マイグレーション。何度実行しても同じ結果を返すだけ（読み取りのみ） → マイグレーションではない。

## 3. 命名規則

```
sql/migrations/NN_snake_case_description.sql
```

- `NN`は2桁以上のゼロ埋め連番（01, 02, 03...）、適用順序を表す
- 既存ファイルの番号を変更しない。番号が飛んでいても詰めない
- 例：`01_roles.sql`、`02_console_schema.sql`、`03_contract_lifecycle_log.sql`、`04_fn_apply_onboarding.sql`
- **02の経緯（2026-10-07）**：旧`02_organization_alter.sql`（`organizations`への4列とCHECKの追加）は、Sobae_Works本体のテーブルの構造変更であるため、**本体のmigration（番号は本体側が決定。250想定）に移管**した。この番号は、03より前に必要となる`console`スキーマの作成（`02_console_schema.sql`）に再利用している。旧02のSQLは、このディレクトリのどのファイルにも含まれない（Consoleのrunnerが`public.organizations`を変更すると、本体のfingerprintが動くため）。旧02の内容はgit履歴に残っている。

## 4. ファイル分割の粒度

- 1ファイル＝1つの目的とする（ロール作成、テーブル追加、関数作成などはそれぞれ別ファイルに分ける）
- 依存関係がある場合、依存先を必ず後の番号にする（例：ロールへのGRANT文は、そのロールを作成する`CREATE ROLE`のファイルより後）
- SECURITY DEFINER関数を作成する場合、対応するGRANT文（該当ロールへのEXECUTE権限付与）は同じファイルまたは直後の番号のファイルに必ず含める。関数だけ作ってGRANTを漏らした状態を作らない

## 5. 不変性（Append-only）原則

- 一度Staging以降の環境に適用されたマイグレーションファイルは、内容を書き換えない
- 適用後に修正が必要になった場合は、新しい番号の修正用マイグレーションファイルを追加する（例：`07_fix_organization_status_default.sql`でALTER文により直す）
- ローカルでまだどの環境にも適用していない段階に限り、直前に自分が作成したファイルを編集してよい
- **例外（2026-10-07、1回限りの再ベースライン）**：Consoleのオブジェクトを`public`から`console`スキーマへ分離するため、03〜10を直接書き直した。管理対象の環境（staging親・本番）には01のロール以外のConsole由来のオブジェクトが一切無く（staging親は2026-10-07に本体側が読み取りで確認）、書き直しの影響を受ける適用済みの環境が無いことが理由。test-onboarding（実験用の複製DB）に適用済みの旧`public`版は、新しいファイルで作り直す（DROPして再作成）。この例外は今回限りで、以後は上記の原則（適用後は新しい番号で追加）に戻る

## 6. 各ファイルの冒頭に含めるコメント

```sql
-- 目的：
-- 作成日：
-- 依存する既存オブジェクト：
-- ロールバック方針（可能な範囲で）：
```

## 7. 適用記録

各マイグレーション適用後、適用履歴（filename, checksum, applied_at, applied_by, source_git_commit, fingerprintの前後）が`console.migration_history`に記録される。記録は、Console側のrunner（`tools/migrate-safe/`。使い方はそのREADMEを参照）が自動で行う。Sobae_Works本体の`sobae_meta.migration_history`とは別に管理する（共有しない）。記録用のINSERT文は、各マイグレーションファイルの末尾に含めない。

runnerは、チェックサム、番号の欠番・重複、禁止SQL（`BEGIN`/`COMMIT`等）を検査し、1ファイル=1トランザクションで適用する。`01_roles.sql`は、環境によっては手作業で適用済みのため、`init`で「取り込み済み」として記録する（SQLは実行しない）。

## 8. 特に厳守すること

- Supabaseダッシュボードやpsqlからスキーマ変更を直接実行しない。スキーマ変更は必ずこのディレクトリのマイグレーションファイルを経由し、**適用は`tools/migrate-safe/`のrunnerで行う**（psqlで`-f`適用すると、履歴・fingerprintから外れる）
- staging親・test-onboarding・本番に対するrunnerの実行は、ユーザーの承認を得てから行う。本番（`sobae-works-production-tokyo`）は、runnerが拒否する
- 1つのマイグレーションファイルに、無関係な複数の変更を混ぜない
- 迷ったら新しいファイルを追加する。既存ファイルを書き直すより積み増しを優先する

## 9. `console` スキーマの規約

- Console所有のオブジェクト（`contract_lifecycle_log`、`fn_*`、`v_organization_summary`）は`console`スキーマに作る。Sobae_Works本体のテーブル（`organizations`等）は`public`のまま参照する
- `console`のオブジェクトは、SQL・backendのどちらでも**`console.`で修飾**して参照する（`search_path`に頼らない）。SECURITY DEFINER関数の`set search_path = pg_catalog, public`は変えない
- 各関数・ビュー・テーブルのファイルに、**明示的なrevoke**（`public, anon, authenticated, service_role`）を入れる。関数は所有者変更（`alter ... owner to`）の前にrevokeする。理由：PUBLIC/anonへのEXECUTEが付かないのは、作成者`postgres`のグローバル既定権限（本体Migration 215）に依存しているだけで、作成者が別ロールになると失われる（本体のMigration 230の事例）
- 関数は`postgres`で作成する（`create or replace`は所有者・権限を維持する。`drop`して作り直すと既定権限が再適用される）
- Data API（PostgREST）の公開スキーマに`console`を追加しない
- `console`が参照する`public`の列（`organizations`の列など）を本体が変更・削除・型変更すると、ビュー・関数が壊れる。本体との約束事として、適用後の監査で依存関係（`pg_depend`）を確認する
