# Sobae Ops Console

Sobae Works運営側向けの契約事業所ライフサイクル管理コンソール。詳細な仕様は `sobae_lifecycle_management_design_doc.md` を参照。

このリポジトリは Sobae_Works 本体とは別アプリケーション・別リポジトリ。DBは本体と同一の Supabase PostgreSQL を共有するが、書込みは SECURITY DEFINER 関数経由のみに限定する（詳細は設計書参照）。

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

## 環境変数

`frontend/.env.example`・`backend/.env.example` を参照し、それぞれ `.env.local` にコピーして実値を設定する。実値はGitにコミットしない。

- frontendは `VITE_` prefixのついた変数のみブラウザに公開される想定。service_role key等の秘密情報を `VITE_` 変数として定義しないこと。
- backend用の実際に必要な環境変数（DB接続方式含む）は、`db/client.ts` 実装時に確定する。現時点ではプレースホルダーのみ。

## Supabase

Production Supabaseプロジェクトが既に存在する（本体 Sobae_Works と共有）。Staging/Preview用のSupabaseプロジェクトの要否は未整理。今回の環境構築では実際の接続は行っていない。

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
