# kokkai-watch

国会・法案・省庁発表・予算・新規政策をひとつのタイムラインで追う、一般公開・スマホ向けの Web アプリ。

- 設計書: [docs/DESIGN.md](docs/DESIGN.md)

## 構成

```
packages/core/       一次資料のパーサ(衆議院の議案・審議経過、会議録API、省庁RSS)と共通ロジック
workers/app/         Worker 本体。画面(Hono JSX による SSR)と公開 API を返し、
                     Cron Triggers で一次資料を定期収集して D1 に保存する(src/collector/)
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

```bash
cp workers/app/.dev.vars.example workers/app/.dev.vars
```

```bash
pnpm dev
```

別のターミナルから収集ジョブを手動で実行し、データを入れます。

```bash
for job in bills meetings announcements; do curl -s -X POST -H "Authorization: Bearer local-dev-token" localhost:8787/admin/run/$job; echo; done
```

ブラウザで http://localhost:8787 を開きます。

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

1. Worker(`kokkai-watch`)をデプロイ。D1 データベース `kokkai-watch` がなければ Wrangler が作成する
2. 本番 D1 にマイグレーションを適用

Workers Builds は接続した1つの Worker の名前(`kokkai-watch`)でしかデプロイできないため、
画面・API・定期収集を1つの Worker にまとめています。

D1 の `database_id` は設定ファイルに書かず、Wrangler が `database_name` で検索して接続します。

デプロイ後は Cron Triggers により自動で収集されます(省庁RSS: 毎時、議案: 3時間ごと、会議録: 6時間ごと)。

### 収集の手動実行(任意)

手動実行用のトークンを設定すると、Cron を待たずにデータを入れられます。

```bash
cd workers/app && npx wrangler secret put ADMIN_TOKEN
```

```bash
curl -X POST -H "Authorization: Bearer <トークン>" https://kokkai-watch.<サブドメイン>.workers.dev/admin/run/bills
```

### D1 の無料枠について

D1 の無料枠(1日あたりの読み取り行数など)はアカウント全体で共有されます。
同じアカウントの別プロジェクトで使い切ると、このアプリのデプロイ(マイグレーション)や表示も失敗します。
上限は毎日 0:00 UTC(日本時間 9:00)にリセットされます。
