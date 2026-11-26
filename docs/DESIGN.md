# kokkai-watch 設計書 v0.1

> 国会・法案・省庁発表・予算・新規政策をひとつのタイムラインで追い、
> 話題になった法律については「どういう経緯で生まれたか」を一次資料つきで示す、
> 一般公開・スマホ向けの Web アプリ。

- 作成日: 2026-11-26
- 状態: 構想〜設計段階(実装前)

---

## 1. 目的とコンセプト

国の動きは「国会」「各省庁」「予算」がバラバラに報じられる。
kokkai-watch はそれらを **1本の時系列** に並べ、つながりを見せる。

```
政策の発表 → 概算要求 → 法案の閣議決定・提出 → 委員会審議 → 本会議 → 成立・公布 → 施行
```

### 3つの層

| 層 | 役割 | 位置づけ |
|---|---|---|
| ① 特集「この法律はこうして生まれた」 | 話題の法律の経緯を一次資料つきストーリーで見せる | 入口(SNS・検索からの流入) |
| ② 法案トラッカー/タイムライン | 審議中の法案、会議、省庁発表、予算の最新の動き | 再訪の理由 |
| ③ データベース | 法案・会議録・発言・発表・予算の検索 | 信頼の裏付け |

### 決定事項

| 項目 | 決定 |
|---|---|
| 対象 | 一般公開 |
| 形態 | Web アプリ(スマホ優先、PWA) |
| 範囲 | 法案・国会・省庁発表・予算・新規政策のすべて |
| 目玉 | 話題の法律の経緯特集を前面に出し、アクセスを集める |
| 記事執筆 | すべて AI(Muse)が自律的に行う。人の執筆者は置かない |
| 収益 | 広告 |
| 特集テーマ | 固定しない。日々のニュースで話題に上がった法律を自動で拾う |
| 基盤 | Cloudflare Workers。将来的に独自ドメインを取得 |
| 名称 | kokkai-watch |

---

## 2. 全体アーキテクチャ(Cloudflare)

```
                    ┌──────────────────────────── Cloudflare ────────────────────────────┐
 一次資料            │                                                                    │
 ・国会会議録API ───▶│  [collector Worker]  Cron Triggers + Queues                        │
 ・衆参 議案ページ   │     収集 → 正規化 → D1 に保存 / 原文スナップショットを R2 に保存     │
 ・省庁 RSS          │     話題検知(ニュース見出し→法律名抽出)→ topics に登録            │
 ・e-Gov 法令API     │                         │                                          │
 ・予算資料          │                         ▼                                          │
 ニュース RSS ──────▶│                    ┌─────────┐   ┌────┐   ┌────┐                    │
 (見出しのみ)       │                    │   D1    │   │ R2 │   │ KV │                    │
                    │                    └─────────┘   └────┘   └────┘                    │
                    │                         ▲                                          │
   Muse(AI) ───────▶│  [api Worker]  Ingest API(認証あり)                               │
   話題取得・資料取得 │     記事受け取り → 自動検証 → 合格なら公開 / 不合格なら理由を返す   │
   記事投稿          │                         │                                          │
                    │                         ▼                                          │
   利用者(スマホ)──▶│  [web Worker]  SSR + 静的アセット、OGP画像生成、広告枠              │
                    └────────────────────────────────────────────────────────────────────┘
```

### Cloudflare の各サービスの使い分け

| サービス | 用途 |
|---|---|
| Workers | web(画面)、api(公開API + Ingest API)、collector(収集) |
| Cron Triggers | 定期収集(会議録・議案・RSS)、話題検知、再検証 |
| Queues | 収集ジョブの分割(1回の Worker 実行の CPU 時間制限を避ける) |
| D1 | メインの DB(SQLite)。FTS5 で全文検索 |
| R2 | 一次資料の原文スナップショット(HTML/JSON/PDF)、OGP画像 |
| KV | ページ・API レスポンスのキャッシュ、レート制限 |
| Turnstile | 「誤りを報告」フォームのボット対策 |

### 技術スタック(案)

- 言語: TypeScript
- api / collector: Hono
- web: Astro(Cloudflare アダプタ、SSR + 一部静的生成)※ React Router v7 も候補
- DB アクセス: Drizzle ORM(D1 対応、マイグレーション管理)
- OGP 画像: Satori 系(workers-og など)
- 構成: pnpm workspaces のモノレポ

```
kokkai-watch/
├─ apps/web/            Astro(画面)
├─ workers/api/         Hono(公開API + Ingest API + 検証)
├─ workers/collector/   Hono(Cron + Queues による収集・話題検知)
├─ packages/db/         Drizzle スキーマ・マイグレーション
├─ packages/core/       共通の型、検証ロジック、パーサ
└─ docs/
```

### D1 の容量への配慮

国会会議録の全文をすべて取り込むと D1 の容量上限(1DB あたり 10GB)を圧迫する。

- 会議と発言は **メタデータ + 特集・法案に関係する発言の本文のみ** を保存する
- それ以外の本文は国会会議録検索システムへのリンクで参照する
- 原文のスナップショットは R2 に置く(証拠保全と再検証用)

---

## 3. データ源

| データ | 取得元 | 形式 | 状態(2026-11-26 確認) | 頻度(案) |
|---|---|---|---|---|
| 会議録・発言 | 国立国会図書館 国会会議録検索システム API | JSON | 取得可。第222回国会まで確認 | 1日数回 |
| 法案・審議経過(衆) | 衆議院「議案の一覧」 | HTML(Shift_JIS) | 取得可。スクレイピング | 1日数回 |
| 法案・審議経過(参) | 参議院「議案情報」 | HTML | 未確認 | 1日数回 |
| 法令本文・施行 | e-Gov 法令API v2 | JSON | 応答あり | 1日1回 |
| 省庁発表 | 各省庁 RSS(財務省・デジタル庁などで確認) | RSS/Atom | 一部確認。首相官邸は試したURLが404で要調査 | 1時間ごと |
| 予算 | 財務省 予算・決算資料 | PDF/Excel | 半自動での整理が必要 | 予算の節目ごと |
| 法制審議会など | 法務省ほか各審議会のページ | HTML/PDF | 未確認 | 話題ごと |
| 話題検知 | ニュース RSS(NHK、Google ニュースなど) | RSS | 未確認 | 1時間ごと |

### 要検証事項

- 各サイトの利用規約・クローリングの可否、アクセス間隔の配慮(User-Agent は汎用名、低頻度)
- Workers 上の `TextDecoder` で Shift_JIS がデコードできるか(できなければ変換ライブラリを同梱)
- 会議録 API のレート制限

### ニュースの扱い(著作権)

ニュース記事は **「何が話題か」を知るためだけ** に使う。
見出しと URL から法律名・法案名を抽出するのみで、本文の転載・要約はしない。
特集の中身はすべて国会・省庁などの一次資料から作る。

---

## 4. DB スキーマ(D1 / 案)

```
bills              法案
  id, session(回次), house(衆/参), bill_type(閣法/衆法/参法), number,
  title, submitter, ministry(所管), status, submitted_at, passed_at,
  promulgated_at, law_id(→laws), source_url, updated_at

bill_events        審議経過
  id, bill_id, date, house, stage(提出/付託/委員会可決/本会議可決/成立 等),
  committee, result, source_url

meetings           会議
  id(issueID), session, house, name(本会議/○○委員会), issue_no, date, url

speeches           発言(関係するもののみ本文保存)
  id(speechID), meeting_id, order, speaker, speaker_group, speaker_position,
  text, url

announcements      省庁発表
  id, ministry, title, url, published_at, category

budgets            予算
  id, fiscal_year, ministry, stage(概算要求/政府案/成立/補正), item, amount, source_url

laws               法令
  id(e-Gov法令ID), title, law_number, promulgated_at, enforced_at, url

events             統合タイムライン用ビュー(各テーブルから生成)
  id, date, kind(bill/meeting/announcement/budget/law/policy), ref_id, title, ministry

topics             話題検知の結果
  id, keyword, normalized_law_name, score, first_seen_at, last_seen_at,
  status(open/assigned/published/ignored), bill_id, law_id

topic_mentions     話題の根拠(ニュース見出し)
  id, topic_id, headline, url, source, published_at

sources            特集に使える一次資料のカタログ
  id, kind(speech/bill_event/law/announcement/council_doc/gazette),
  ref_id, title, date, url, r2_key(原文スナップショット), content_hash

stories            特集記事
  id, slug, topic_id, title, lead, status(submitted/rejected/published/withdrawn),
  writer(muse 等), version, published_at, updated_at, og_image_key

story_items        特集の各項目(タイムラインの1行)
  id, story_id, order, date, heading, body

citations          文と出典の対応
  id, story_item_id, sentence_index, source_id, quote(原文引用、任意)

verifications      自動検証の結果
  id, story_id, version, passed, checks(JSON), created_at

corrections        誤りの報告
  id, story_id, story_item_id, body, status(open/reverified/fixed/dismissed), created_at
```

全文検索は FTS5 の仮想テーブルを `bills.title`、`speeches.text`、`announcements.title`、
`stories` に対して作る。日本語は trigram トークナイザを想定(D1 での動作は要検証)。

---

## 5. AI(Muse)による自律的な記事作成

### 5.1 Muse について(前提と注意)

Muse は Meta の個人向け AI エージェントとして紹介されている。
調べた範囲では開発者向けの公開 API は見当たらず、外部サービスとは
「利用者が渡した認証情報」または「ブラウザ操作」でつながる方式とされている。

そのため kokkai-watch 側は、**Muse が呼び出す HTTP API(Ingest API)を用意する**。
Muse は「話題を取得 → 資料を取得 → 記事を投稿」という手順を自律的に実行する。

設計上の方針:

- **書き手は差し替え可能にする**:Ingest API は特定の AI に依存しない。
  Muse の仕様変更や停止に備え、他の LLM(API で呼べるもの)を
  collector から直接呼ぶ代替経路を後から足せるようにする。
- **検証はサーバー側で行う**:AI の自己申告は信用しない。公開の可否は
  kokkai-watch のサーバーが一次資料と照合して決める。
- **最小権限**:Muse に渡すトークンは Ingest API 専用。DB の直接操作や
  公開済み記事の削除はできない。トークンは定期的に更新し、すぐ無効化できるようにする。
  (Muse は利用者のメール等へのアクセスが報告されているため、
  専用アカウント・専用の認証情報で運用する)

### 5.2 パイプライン

```
① 話題検知(collector / Cron)
   ニュース RSS の見出し → 法律名・法案名の抽出(辞書: bills.title, laws.title)
   + 会議録で発言数が急増したキーワード
   → topics(status=open)にスコア順で登録

② 資料収集(collector)
   topic に関係する一次資料を自動で集め、sources に登録
   会議録の発言 / 審議経過 / 法令 / 審議会資料 / 省庁発表
   原文は R2 にスナップショット保存(content_hash 付き)

③ 執筆(Muse)
   GET  /ingest/v1/topics?status=open      執筆すべき話題を取得
   GET  /ingest/v1/topics/:id/sources      使ってよい一次資料の一覧と本文を取得
   POST /ingest/v1/stories                 記事を投稿(下記の JSON 形式)

④ 自動検証(api / 投稿時に同期実行)
   不合格 → 422 と理由を返す。Muse は理由を見て書き直して再投稿
   合格   → status=published として公開

⑤ 公開後
   「AI生成」と明記。出典チップをタップすると原文を表示
   「誤りを報告」→ 該当記事を一時非公開にし、再検証。topic を open に戻して書き直しを依頼
   一次資料が更新されたら(審議が進んだら)topic を open に戻し、記事の更新を依頼
```

### 5.3 投稿データの形式(Ingest API)

```json
{
  "topic_id": "tp_123",
  "title": "不同意性交等罪は、どのような議論を経て生まれたのか",
  "lead": "2023年の刑法改正で…",
  "items": [
    {
      "date": "2023-06-16",
      "heading": "参議院本会議で可決・成立",
      "sentences": [
        {
          "text": "改正刑法は参議院本会議で可決され、成立した。",
          "citations": [{ "source_id": "src_bill_event_456" }]
        },
        {
          "text": "審議では「…」という意見が出た。",
          "citations": [{ "source_id": "src_speech_789", "quote": "…(原文どおり)…" }]
        }
      ]
    }
  ],
  "perspectives": [
    { "stance": "賛成", "summary": "…", "citations": [{ "source_id": "…", "quote": "…" }] },
    { "stance": "反対・慎重", "summary": "…", "citations": [{ "source_id": "…", "quote": "…" }] }
  ]
}
```

### 5.4 自動検証の項目

| # | チェック | 不合格の条件 |
|---|---|---|
| 1 | 出典の網羅 | 出典のない文がある |
| 2 | 出典の実在 | `source_id` が sources にない、または topic と無関係 |
| 3 | 引用の一致 | `quote` が原文と一字一句一致しない(空白・改行の正規化のみ許容) |
| 4 | 日付の一致 | 項目の日付が出典の日付と一致しない |
| 5 | 固有名詞の一致 | 発言者名・委員会名・回次が出典のデータと一致しない |
| 6 | 根拠の判定 | 別の LLM による判定で、出典に書かれていない内容を含むと判定された |
| 7 | 両論併記 | 争点がある記事で、`perspectives` に複数の立場がない |
| 8 | 表現ルール | 禁止表現(断定的な非難、煽り、センシティブなテーマのガイドライン違反)を含む |

#1〜#5 と #7・#8 は機械的に判定できる。#6 だけが LLM を使う。

### 5.5 記事の書き方のルール(AI への指示として公開する)

- 事実は出典つきで書く。論点は発言の引用で示す。AI 自身の評価・意見は書かない
- 審議で出た賛成・反対の主張を、会議録から両方引用する
- 見出しは興味を引く型(「実は○年前から議論されていた」など)を可とする。
  ただし煽りや断定(「○○党が隠していた」など)は禁止
- 性犯罪などセンシティブなテーマには、別途の表現ガイドラインを適用する
- 実在の人物の発言は、必ず会議録の原文どおりに引用する

このルールと検証項目は「編集方針」ページとしてサイト上で公開する。

---

## 6. 画面構成(スマホ優先)

下部タブバー: **ホーム / 法案 / タイムライン / 検索**

| 画面 | 内容 |
|---|---|
| ホーム | 話題の特集(大きなカード)→ 今週の国会 → 審議中の法案 → 省庁の新着 |
| 特集ページ `/stories/:slug` | 縦タイムライン。出典チップをタップすると原文をボトムシートで表示。両論の比較。共有ボタン |
| 法案ページ `/bills/:id` | 進み具合のバー、審議経過、関連発言、関連する特集 |
| タイムライン `/timeline` | 全イベントの時系列。種類・省庁・期間で絞り込み |
| 検索 `/search` | 法案・発言・議員・キーワード |
| 編集方針 `/policy` | AI による執筆と検証の仕組み、誤りの報告方法 |

- PWA 対応(ホーム画面への追加、将来的にプッシュ通知)
- 特集ページと法案ページは SEO を重視し、構造化データ(JSON-LD)と OGP 画像を出す
- OGP 画像は特集ごとに自動生成(タイトル + 年表の抜粋)

---

## 7. 広告と収益化

- Google AdSense を想定。**審査には独自ドメインが必要**なため、ドメイン取得後に申請する
- 価値の低い量産記事と見なされないよう、一次資料と DB に裏付けられた記事に限定して公開する
- センシティブなテーマ(性犯罪など)のページでは、広告の表示が制限される可能性がある
- 広告は記事の内容と明確に分けて表示する(中立性の見え方を守る)

---

## 8. 運用・セキュリティ

- Ingest API: Bearer トークン、レート制限(KV)、リクエストサイズ上限、全リクエストのログ
- 収集: アクセス間隔を空ける、User-Agent は汎用のクライアント名、失敗時は指数バックオフ
- 監視: Workers のログ、収集失敗・検証不合格率の通知
- 秘密情報: `wrangler secret` で管理し、リポジトリには置かない
- 公開済み記事は版管理し、差し替え履歴を残す

---

## 9. フェーズ計画

| フェーズ | 内容 |
|---|---|
| 0. 土台 | モノレポ、D1 スキーマ、Workers のデプロイ、CI |
| 1. 収集 | 会議録 API、衆議院の議案、主要省庁の RSS → 法案トラッカー + タイムライン |
| 2. 特集 | 話題検知、sources カタログ、Ingest API、自動検証、特集ページ、OGP |
| 3. 公開準備 | 独自ドメイン、編集方針ページ、誤り報告、AdSense 申請 |
| 4. 拡充 | 参議院、予算の可視化、e-Gov 法令、ウォッチリスト・通知 |

---

## 10. 未決事項

- Muse から HTTP API を呼べるか、定期実行できるかの実地確認(できない場合は代替の LLM 経路を先に作る)
- 独自ドメインの名前と取得時期
- 参議院の議案情報の取得方法
- 予算データの整理方法(どこまで自動化するか)
