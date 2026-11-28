-- フェーズ2: 話題検知・一次資料カタログ・特集記事・検証ログ・誤り報告

-- 発言に会派・肩書を追加(会議録の発言検索 API から取得)
ALTER TABLE speeches ADD COLUMN speaker_group TEXT;
ALTER TABLE speeches ADD COLUMN speaker_position TEXT;

-- 話題(法律名)
CREATE TABLE topics (
  id                   TEXT PRIMARY KEY,          -- tp_ + キーワードの SHA-1 先頭12桁(topicIdFor)
  keyword              TEXT NOT NULL UNIQUE,      -- 正規化した法律名(例: 不同意性交等罪、定数削減法)
  origin               TEXT NOT NULL,             -- news(自動検知)/ manual(Ingest API で登録)
  score                REAL NOT NULL DEFAULT 0,   -- 直近48時間の見出し数など
  mention_count        INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'candidate', -- candidate / open / published / ignored
  first_seen_at        TEXT NOT NULL,
  last_seen_at         TEXT NOT NULL,
  sources_collected_at TEXT
);
CREATE INDEX idx_topics_status ON topics(status, score DESC);

-- 話題の根拠となったニュース見出し(見出しと URL のみ。本文は保存しない)
CREATE TABLE topic_mentions (
  id           TEXT PRIMARY KEY,                  -- (topic_id + URL) の SHA-1
  topic_id     TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  headline     TEXT NOT NULL,
  url          TEXT NOT NULL,
  source       TEXT NOT NULL,                     -- Googleニュース / NHK など
  published_at TEXT,
  seen_at      TEXT NOT NULL
);
CREATE INDEX idx_topic_mentions_topic ON topic_mentions(topic_id, published_at DESC);

-- 特集に使える一次資料のカタログ
-- id の付け方:
--   src_sp_<speechID>                      会議録の発言(body = 発言本文)
--   src_bill_<billId>                      法案(body = 件名・提出者・審議状況)
--   src_be_<billId>_<stage>_<house|none>   審議経過の1件(body = 「日付 院 段階 結果」の文)
--   src_ann_<announcementId>               省庁の発表(body = 件名)
CREATE TABLE sources (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,                     -- speech / bill / bill_event / announcement
  ref_id       TEXT NOT NULL,                     -- 元テーブルの ID
  title        TEXT NOT NULL,                     -- 表示用(例: 参議院 法務委員会 第3号 仁比聡平(日本共産党))
  date         TEXT,                              -- YYYY-MM-DD
  url          TEXT NOT NULL,
  body         TEXT NOT NULL,                     -- 引用の照合に使う本文
  speaker      TEXT,                              -- 発言者(speech のみ)
  meta_json    TEXT,                              -- 院・会議名・会派・委員会など
  content_hash TEXT NOT NULL,                     -- body の SHA-1
  fetched_at   TEXT NOT NULL
);
CREATE INDEX idx_sources_kind_date ON sources(kind, date DESC);

CREATE TABLE topic_sources (
  topic_id  TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, source_id)
);
CREATE INDEX idx_topic_sources_source ON topic_sources(source_id);

-- 特集記事(1つの話題につき1本。更新時は version を上げて上書きする)
CREATE TABLE stories (
  id            TEXT PRIMARY KEY,                 -- st_ + topic_id の後半
  slug          TEXT NOT NULL UNIQUE,             -- URL 用(topic_id と同じ英数字)
  topic_id      TEXT NOT NULL UNIQUE REFERENCES topics(id),
  title         TEXT NOT NULL,
  content_json  TEXT NOT NULL,                    -- 検証に合格した StorySubmission(packages/core/src/story.ts)
  status        TEXT NOT NULL,                    -- published / withdrawn
  writer        TEXT NOT NULL,                    -- muse など
  version       INTEGER NOT NULL DEFAULT 1,
  published_at  TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_stories_status ON stories(status, updated_at DESC);

-- 記事が引用している一次資料(どの記事がどの資料にもとづくかを逆引きするため)
CREATE TABLE story_citations (
  story_id  TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  PRIMARY KEY (story_id, source_id)
);
CREATE INDEX idx_story_citations_source ON story_citations(source_id);

-- 投稿と自動検証の記録(不合格も含めてすべて残す)
CREATE TABLE story_submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id    TEXT NOT NULL,
  writer      TEXT NOT NULL,
  payload     TEXT NOT NULL,                      -- 投稿された JSON(原文)
  passed      INTEGER NOT NULL,
  issues_json TEXT NOT NULL,                      -- VerifyIssue[]
  story_id    TEXT,                               -- 合格して公開された場合
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_story_submissions_topic ON story_submissions(topic_id, created_at DESC);

-- 誤りの報告
CREATE TABLE corrections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  reporter    TEXT NOT NULL,                      -- 日付つきソルトで IP をハッシュ化したもの(重複の判定用)
  status      TEXT NOT NULL DEFAULT 'open',       -- open / resolved / dismissed
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_corrections_story ON corrections(story_id, status);
