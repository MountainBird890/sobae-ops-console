# tools/migrate-safe — Console 用の安全なマイグレーション runner

`sql/migrations/` の SQL ファイルを、**`console` スキーマ**に対して、安全に適用するための最小構成の runner です。
Sobae_Works 本体の migrate-safe（`db/migrate-safe.mjs`）を手本にしていますが、別のツールです。
本体の履歴（`sobae_meta.migration_history`）・fingerprint・acl-audit には、一切、触れません。

## 何をするか

- 適用履歴を `console.migration_history` に記録する（本体の履歴とは別。共有しない）。
- ファイルのチェックサム、番号の欠番・重複、禁止 SQL を検査し、**1 ファイルを 1 トランザクション**で適用する。失敗したらロールバックされ、履歴にも残らない。
- `console` スキーマの構造の fingerprint（SHA-256）を、適用の前後で記録し、履歴外の変更（ドリフト）を検出する。
- 接続先が、想定した環境であることを、DB の中の `database_id` で照合する。

## 安全方針（要点）

| 項目 | 内容 |
|---|---|
| 本番 | `--environment=production` は、DB に接続する前に拒否する。接続先の `database_id` が拒否リスト（本番）と一致した場合も、環境の指定に関わらず拒否する |
| 環境の識別 | `environments.json` の `database_id` と、接続先の `sobae_meta.database_state.database_id` の完全一致。ホスト名では判定しない。`project_ref`（接続文字列から取り出す）は、**拒否を増やすだけ**の追加確認（取り出せないときは拒否） |
| 接続ロール | `postgres` 以外は拒否（関数の既定権限が、作成者 `postgres` のグローバル既定に依存するため。`sql/migrations/README.md` §9） |
| 接続文字列 | 環境変数 `CONSOLE_ADMIN_DATABASE_URL` からのみ。ファイルに置かない。出力・エラーメッセージには、マスクして出す |
| 書き込み | `init` と `migrate` は、`staging` ブランチが `origin/staging` と一致しているときだけ。確認コードを、対話的な端末から手入力する（引数・環境変数では受け取らない） |
| autotest | `CONSOLE_MIGRATE_AUTOTEST=1` は、git ガードと確認コードを省略する。**接続先がループバックのときだけ有効**で、リモートでは無視される（テスト用） |

**staging 親・test-onboarding・本番に対して、この runner を実行するのは、ユーザーの承認を得てから**（`sql/migrations/README.md` を参照）。

## コマンド

すべて `--environment=<name>`（`staging` または `local`）が必須です。

```sh
export CONSOLE_ADMIN_DATABASE_URL=...   # 履歴に残さない方法で設定する（例: read -rs）
npm run migrate-safe -- init    --environment=staging   # 初回のみ: console スキーマ・履歴テーブルを作り、01 を「取り込み」として記録
npm run migrate-safe -- status  --environment=staging   # 読み取り専用: 照合結果（[OK]/[NG]）、履歴、未適用、ドリフト
npm run migrate-safe -- plan    --environment=staging   # 読み取り専用: 未適用ファイルの検査
npm run migrate-safe -- migrate --environment=staging   # 未適用ファイルを番号順に 1 件ずつ適用
npm run migrate-safe -- verify  --environment=staging   # 読み取り専用: 履歴とファイルのチェックサム、ドリフト
```

推奨の流れ: `status`（接続先の照合が `[OK]`）→ `plan` → `migrate` → `status` → `verify`。

## 取り込み（init）について

`01_roles.sql`（ロール作成）は、環境によっては、手作業で適用済みです。`init` は 01 の SQL を**実行せず**、「取り込み済み」として履歴に記録するだけです（ロールの存在は確認します）。
01 のファイルと、実環境の状態は、完全には同じでない場合があります（例: staging 親の `service_types` の権限は、本体の migration 249 に揃っています）。取り込みは、01 の効果の完全な証明ではありません。

## 新しい migration を足すとき

1. `sql/migrations/NN_snake_case.sql`（NN は直前の番号 + 1。欠番・重複は拒否される）。
2. `BEGIN` / `COMMIT` / `ROLLBACK` / `CONCURRENTLY` / `VACUUM` / psql のメタコマンドは書かない。
3. オブジェクトは `console.` で修飾する。関数は所有者変更の前に明示的な `REVOKE`（`sql/migrations/README.md` §9）。
4. 適用済みのファイルは変更しない（チェックサム不一致で、以降の migrate がすべて拒否される）。修正は、新しい番号で足す。
5. 本体の `public` のテーブルを変更する SQL は、ここに置かない（本体の migration として実装する）。

## 開発とテスト

```sh
npm install
npm run typecheck
npm run lint
npm test            # 単体テスト（DB 不要）。統合テストは、環境変数が無ければ skip される
```

統合テスト（ローカルの Docker DB の使い捨ての複製）は、`CONSOLE_TEST_LOCAL_DB_URL`（ループバックの管理者 URL。`template1` を指す）を設定したときだけ実行される。
ループバック以外の URL は、拒否される。`CONSOLE_TEST_KEEP_DB=1` で、テスト用 DB を残せる（手動で削除すること）。

## 本体の migrate-safe との違い（省略した機能）

bootstrap-legacy / initialize-baseline、fingerprint v3、master data の fingerprint、cutover 系、restore-preflight、sync-shift、
acl-audit / acl-remediation、production 向けの機能、履歴の記録の細かい種別。必要になったら、段階的に足す。

## 注意

- fingerprint は `console` スキーマの構造・所有者・権限（スキーマ自体と、既定の ACL のままのオブジェクトの PUBLIC を含む）が対象。行データは対象外。
- Supabase の実環境（プール接続など）では、まだ実行していない。接続文字列に `sslmode=require` が必要な場合は、URL に含める。
