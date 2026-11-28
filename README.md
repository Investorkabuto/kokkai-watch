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

Cloudflare の Workers Builds(ダッシュボードから GitHub リポジトリを接続する方式)でデプロイします。
`main` に push されるたびに自動でデプロイされます。

### Workers Builds の設定

Workers & Pages → `kokkai-watch` → Settings → Builds で次のように設定します。

| 項目 | 値 |
|---|---|
| Root directory | 空欄(リポジトリのルート) |
| Build command | 空欄 |
| Deploy command | `pnpm run deploy` |

`pnpm run deploy` は次を順に実行します。

1. 収集 Worker(`kokkai-watch-collector`)をデプロイ。D1 データベース `kokkai-watch` がなければ Wrangler が作成する
2. 本番 D1 にマイグレーションを適用
3. アプリ Worker(`kokkai-watch`)をデプロイ

D1 の `database_id` は設定ファイルに書かず、Wrangler が `database_name` で検索して接続します。

デプロイ後は Cron Triggers により自動で収集されます(省庁RSS: 毎時、議案: 3時間ごと、会議録: 6時間ごと)。

### 収集 Worker の手動実行(任意)

収集 Worker に手動実行用のトークンを設定すると、Cron を待たずにデータを入れられます。

```bash
cd workers/collector && npx wrangler secret put ADMIN_TOKEN
```

```bash
curl -X POST -H "Authorization: Bearer <トークン>" https://kokkai-watch-collector.<サブドメイン>.workers.dev/run/bills
```
