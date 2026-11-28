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

## Cloudflare へのデプロイ

`main` にマージされると、GitHub Actions(`.github/workflows/deploy.yml`)が自動でデプロイします。
D1 データベースがまだなければ、ワークフローが作成します。

### 初回の準備(1回だけ)

1. Cloudflare のアカウントを作り、ダッシュボードの「Workers & Pages」を一度開いて workers.dev のサブドメインを決めます。
2. API トークンを作ります: My Profile → API Tokens → Create Token → テンプレート「Edit Cloudflare Workers」を選び、
   Permissions に「Account / D1 / Edit」を追加して作成します。
3. アカウント ID を控えます(ダッシュボードの「Workers & Pages」画面の右側、または URL の `dash.cloudflare.com/<ここ>`)。
4. GitHub のリポジトリで Settings → Secrets and variables → Actions → New repository secret から、次の2つを登録します。
   - `CLOUDFLARE_API_TOKEN`: 手順2のトークン
   - `CLOUDFLARE_ACCOUNT_ID`: 手順3のアカウント ID
   - (任意)`COLLECTOR_ADMIN_TOKEN`: 収集 Worker を手動実行するための任意の長い文字列
5. GitHub の Actions タブ → Deploy → Run workflow で実行します(以降は `main` へのマージで自動実行)。

デプロイ後は Cron Triggers により自動で収集されます(省庁RSS: 毎時、議案: 3時間ごと、会議録: 6時間ごと)。
アプリは `https://kokkai-watch.<サブドメイン>.workers.dev` で公開されます。
