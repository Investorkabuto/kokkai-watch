# kokkai-watch

国会・法案・省庁発表・予算・新規政策をひとつのタイムラインで追う、一般公開・スマホ向けの Web アプリ。

- 設計書: [docs/DESIGN.md](docs/DESIGN.md)

## 構成

```
packages/core/       一次資料のパーサ(衆議院の議案・審議経過、会議録API、省庁RSS)と共通ロジック
workers/collector/   収集 Worker(Cron Triggers で定期実行 → D1 に保存)
workers/app/         画面(Hono JSX による SSR)と公開 API を返す Worker
migrations/          D1 のマイグレーション(SQL)
```

## ローカルで動かす

必要なもの: Node.js 22、pnpm 10

```bash
pnpm install
```

```bash
pnpm db:migrate:local
```

収集 Worker を起動し(ポート 8788)、別のターミナルから各ジョブを手動で実行します。

```bash
cp workers/collector/.dev.vars.example workers/collector/.dev.vars
```

```bash
pnpm dev:collector
```

```bash
for job in bills meetings announcements; do curl -s -X POST -H "Authorization: Bearer local-dev-token" localhost:8788/run/$job; echo; done
```

画面を起動します(ポート 8787)。

```bash
pnpm dev:app
```

ブラウザで http://localhost:8787 を開きます。2つの Worker は `.wrangler/state` のローカル D1 を共有します。

テストと型チェック:

```bash
pnpm test && pnpm typecheck
```

## Cloudflare へのデプロイ(初回)

1. D1 データベースを作成し、表示された `database_id` を `workers/app/wrangler.jsonc` と `workers/collector/wrangler.jsonc` の両方に書き込みます。

   ```bash
   npx wrangler d1 create kokkai-watch
   ```

2. 本番の D1 にマイグレーションを適用します。

   ```bash
   npx wrangler d1 migrations apply kokkai-watch --remote -c workers/app/wrangler.jsonc
   ```

3. 収集 Worker の手動実行用トークンを設定し、デプロイします。

   ```bash
   cd workers/collector && npx wrangler secret put ADMIN_TOKEN && npx wrangler deploy
   ```

4. 画面の Worker をデプロイします。

   ```bash
   cd workers/app && npx wrangler deploy
   ```

デプロイ後は Cron Triggers により自動で収集されます(省庁RSS: 毎時、議案: 3時間ごと、会議録: 6時間ごと)。
最初のデータをすぐに入れたい場合は、手順3のトークンを使って `https://kokkai-watch-collector.<アカウント>.workers.dev/run/{bills|meetings|announcements}` に POST します。
