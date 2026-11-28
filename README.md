# kokkai-watch

国会・法案・省庁発表・予算・新規政策をひとつのタイムラインで追う、一般公開・スマホ向けの Web アプリ。

- 設計書: [docs/DESIGN.md](docs/DESIGN.md)

## 構成

```
packages/core/       一次資料のパーサ(衆議院の議案・審議経過、会議録API、省庁RSS)と共通ロジック
workers/app/         Worker 本体
  src/index.tsx        画面(Hono JSX による SSR)と公開 API
  src/stories.tsx      特集ページと誤りの報告
  src/ingest.ts        Muse(AI)向けの投稿 API(/ingest/v1)
  src/collector/       Cron Triggers による定期収集(議案・会議録・省庁RSS・話題検知・一次資料の収集)
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

## 特集記事の投稿 API(Muse 向け)

AI(Muse)は `/ingest/v1` の API で、話題の取得 → 一次資料の取得 → 記事の投稿を行います。
すべてのリクエストに `Authorization: Bearer <INGEST_TOKEN>` が必要です。
投稿された記事はサーバー側で自動検証され(`packages/core/src/verify.ts`)、合格したものだけが `/stories/<slug>` で公開されます。

| メソッド・パス | 内容 |
|---|---|
| `GET /ingest/v1/guide` | 執筆ガイド(手順・JSON 形式・ルール・検証項目)。Muse にはまずこれを読ませる |
| `GET /ingest/v1/topics?status=open` | 執筆対象の話題(ニュースから自動検知、または手動登録) |
| `POST /ingest/v1/topics` | 話題を登録(`{"keyword":"不同意性交等罪"}`)し、一次資料を収集 |
| `POST /ingest/v1/topics/:id/collect` | 一次資料を再収集 |
| `GET /ingest/v1/topics/:id/sources` | 記事に使える一次資料(会議録の発言本文、審議経過、省庁発表) |
| `POST /ingest/v1/stories` | 記事を投稿。不合格は 422 と修正点(issues)、合格は 201 と公開 URL |
| `GET /ingest/v1/submissions/:id` | 投稿の検証結果 |

ローカルでは `INGEST_TOKEN=local-ingest-token`(`.dev.vars`)で試せます。

```bash
curl -s -H "Authorization: Bearer local-ingest-token" localhost:8787/ingest/v1/guide
```

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

### 秘密の値(トークン)の設定

Cloudflare のダッシュボードで Workers & Pages → `kokkai-watch` → Settings → Variables and Secrets から、
種類「Secret」で次を登録します(値は推測されにくい長い文字列にします)。

| 名前 | 用途 |
|---|---|
| `INGEST_TOKEN` | Muse(AI)が投稿 API(`/ingest/v1`)を使うためのトークン |
| `ADMIN_TOKEN` | 収集ジョブの手動実行(`/admin/run/{job}`)用。任意 |

### 収集の手動実行(任意)

`ADMIN_TOKEN` を設定すると、Cron を待たずにデータを入れられます。

```bash
curl -X POST -H "Authorization: Bearer <トークン>" https://kokkai-watch.<サブドメイン>.workers.dev/admin/run/bills
```

### D1 の無料枠について

D1 の無料枠(1日あたりの読み取り行数など)はアカウント全体で共有されます。
同じアカウントの別プロジェクトで使い切ると、このアプリのデプロイ(マイグレーション)や表示も失敗します。
上限は毎日 0:00 UTC(日本時間 9:00)にリセットされます。
