# Sobae Ops Console

Sobae Works運営側向けの契約事業所ライフサイクル管理コンソール。詳細な仕様は `sobae_lifecycle_management_design_doc.md` を参照。

このリポジトリは Sobae_Works 本体とは別アプリケーション・別リポジトリ。業務データのDB（`DATABASE_URL`）は本体（`sobae-works-staging-tokyo`。現在はそのプレビューブランチ `test-onboarding` に接続）と同一の Supabase PostgreSQL を共有するが、書込みは SECURITY DEFINER 関数経由のみに限定する（詳細は設計書参照）。一方、Console自体のログイン認証（Supabase Auth／`SUPABASE_URL`・`SUPABASE_SECRET_KEY`・`VITE_SUPABASE_URL`・`VITE_SUPABASE_PUBLISHABLE_KEY`）は本体とは別の、Console専用プロジェクト `SOBAE-WORKS-CONSOLE-STAGING` を使う。

## 構成

```
sobae-ops-console/
├── frontend/   # React + Vite + TypeScript（管理コンソールGUI）
├── backend/    # Hono + TypeScript + Zod（Ops API Server）
└── sql/        # DBマイグレーション・SECURITY DEFINER関数（未実装）
```

## 必要環境

- Node.js `24.x`（`.nvmrc` 参照。Vercelプロジェクトの実行時バージョンと合わせている）
- npm（lockファイルなしの新規プロジェクトのため npm を採用）

## セットアップ

```bash
nvm use          # .nvmrc に従い Node 24.x を使用
cd frontend && npm install
cd ../backend && npm install
```

## frontend起動

```bash
cd frontend
cp .env.example .env.local   # VITE_API_BASE_URL=http://localhost:3000 等を設定
npm run dev        # http://localhost:5173
npm run build       # tsc -b && vite build
npm run lint         # oxlint
```

## backend起動

Vercel CLI（`vc` / `vercel`）を使ったローカル開発を前提とする（Honoの公式Vercelテンプレート方式）。

```bash
cd backend
npm install
vercel dev          # http://localhost:3000 、GET /health で {"status":"ok"} を返す
vercel build         # ビルド確認
npm run typecheck    # tsc --noEmit
```

補足：`backend/package.json` の `devDependencies.typescript` は `~6.0.2` に固定している。TypeScript 7.0.2（npm の `latest`）は現時点の `@vercel/hono` ビルダーと非互換で、`vercel build` が `TS2688: Cannot find type definition file for 'node'` で失敗することを確認済み。

## backend API

| メソッド | パス | 概要 |
| --- | --- | --- |
| GET | `/health` | 疎通確認。`{"status":"ok"}` |
| GET | `/api/organizations` | 事業所一覧（`?status=active\|suspended\|terminated`, `?q=検索語`） |
| GET | `/api/organizations/summary` | ダッシュボード用件数集計（active/suspended/terminated/total） |
| GET | `/api/organizations/:id` | 事業所詳細1件。`id`はUUID形式必須（不正なら400）、存在しなければ404 |

いずれも `v_organization_summary` ビューを参照する実装だが、**このビューはまだ存在しない**（DBロール・関数・ビュー設計は設計書のRACI表よりShimoさんの担当）。ビュー未作成／`DATABASE_URL`未設定の間は `503 {"error":"database_not_configured"}` を返す。`routes/organizations.ts` 内のコメントに、コードが前提としている列構成（`id`, `name`, `management_number`, `status`, `contract_start_date`, `contract_end_date`）を明記している。実際のビュー作成時に形が異なる場合はどちらかを調整する。

`/api/*` は認証必須（`auth/middleware.ts`）。`Authorization: Bearer <Supabase access token>` を要求し、`SUPABASE_URL`/`SUPABASE_SECRET_KEY` 未設定時は `503 {"error":"auth_not_configured"}`、トークン欠落・不正時は `401 {"error":"unauthorized"}` を返す（fail-closed）。`/health` のみ認証不要。

## 環境変数

`frontend/.env.example`・`backend/.env.example` を参照し、それぞれ `.env.local` にコピーして実値を設定する。実値はGitにコミットしない。

- frontendは `VITE_` prefixのついた変数のみブラウザに公開される想定。secret key等の秘密情報を `VITE_` 変数として定義しないこと。
- backend用の実際に必要な環境変数（DB接続方式含む）は、`db/client.ts` 実装時に確定する。現時点ではプレースホルダーのみ。
- **重要**：backend（`vercel dev`）はNext.js系アプリと異なり、ルート直下に手で置いた `.env.local` を読み込まない（実測で確認済み）。ローカルでbackendの環境変数（例：`ALLOWED_ORIGIN`）を効かせるには、Vercelプロジェクトに登録する必要がある。

  ```bash
  cd backend
  printf 'http://localhost:5173' | vercel env add ALLOWED_ORIGIN development
  ```

  frontend側（Vite）はルート直下の `.env.local` を通常どおり読み込む。

## Supabase

認証（Auth）用のSupabaseプロジェクトとして `SOBAE-WORKS-CONSOLE-STAGING` が既に存在する。これは本体 Sobae_Works とは別の、Console専用プロジェクト（DBは共有しない。ログインアカウント／Auth設定のみ）。

業務データ（`DATABASE_URL`経由）は本体 Sobae_Works の Supabase プロジェクト `sobae-works-staging-tokyo` を参照する。現時点では本体の実データではなく、そのプレビューブランチ `test-onboarding`（実験用の複製DB）に接続してonboarding機能の検証を行っている。

ログイン画面（`frontend/src/pages/Login.tsx`, SEC-001）・認証状態管理（`contexts/AuthContext.tsx`）・保護ルート（`components/RequireAuth.tsx`）・backend側トークン検証（`backend/src/auth/middleware.ts`）は実装済みだが、`VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_URL`/`SUPABASE_SECRET_KEY` が未設定の間は「未設定」表示・`503`応答で安全側に倒れる作りになっている。ログイン方式はメール＋パスワードのみ（自己サインアップUIなし。許可リスト方式のため、アカウントは別途Supabase側で払い出す前提）。実際のログイン動作は実接続後に確認が必要。

## Vercel

Vercelチーム `sobaeworks`（本体 `sobae-works` プロジェクトと同一チーム）配下に、モノレポ構成で2プロジェクトをリンク済み。

| プロジェクト | Root Directory | 対応 |
| --- | --- | --- |
| `sobae-ops-console` | `frontend` | Vite |
| `sobae-ops-console-backend` | `backend` | Hono |

いずれもGitHubリポジトリ `MountainBird890/sobae-ops-console` に接続済み。ブランチ push で Preview Deployment が発行される。

## Gitブランチルール

```text
main
 ↑
staging
 ↑
feature/*, fix/*
```

- `feature/*` または `fix/*` は必ず `staging` から分岐する
- `feature → main` の直接マージは禁止
- 流れ：`staging` → 分岐 → push → Vercel Preview確認 → `staging` へ統合 → 最終確認 → `main` へ統合 → Production反映
- `main` への直接commit/push、force push、`git reset --hard`、履歴を書き換えるrebase は行わない
