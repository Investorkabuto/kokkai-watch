-- フェーズ0〜1: 法案・審議経過・会議・発言・省庁発表・収集ログ
-- 特集(stories)・出典(sources/citations)・話題(topics)はフェーズ2のマイグレーションで追加する。

-- 法案(衆議院「議案の一覧」から)
CREATE TABLE bills (
  id              TEXT PRIMARY KEY,           -- 例: 222-kaku-2(提出回次-種類-番号)
  kind            TEXT NOT NULL,              -- 衆法 / 参法 / 閣法 / 条約
  session         INTEGER NOT NULL,           -- 提出回次
  number          INTEGER NOT NULL,
  title           TEXT NOT NULL,
  status_text     TEXT NOT NULL,              -- 一覧の審議状況(原文)
  status          TEXT NOT NULL,              -- pending / passed / rejected / withdrawn / lapsed / other
  submitter       TEXT,
  submitter_groups TEXT,                      -- JSON 配列
  law_number      TEXT,
  vote_json       TEXT,                       -- 衆参の会派態度・賛成/反対会派(JSON)
  keika_url       TEXT,
  honbun_url      TEXT,
  first_seen_at   TEXT NOT NULL,
  updated_at      TEXT NOT NULL,              -- 一覧の内容が変わった日時
  keika_fetched_at TEXT                       -- 審議経過を最後に取得した日時
);
CREATE INDEX idx_bills_status ON bills(status, session DESC);
CREATE INDEX idx_bills_session ON bills(session DESC, kind, number);

-- 審議経過
CREATE TABLE bill_events (
  bill_id   TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  stage     TEXT NOT NULL,                    -- preliminary_received / received / referred / committee_decided / plenary_decided / promulgated
  house     TEXT NOT NULL DEFAULT '',         -- 衆議院 / 参議院 / ''(公布)
  date      TEXT NOT NULL,                    -- YYYY-MM-DD
  committee TEXT,
  result    TEXT,
  PRIMARY KEY (bill_id, stage, house)
);
CREATE INDEX idx_bill_events_date ON bill_events(date DESC);

-- 会議(国会会議録検索システムから)
CREATE TABLE meetings (
  id            TEXT PRIMARY KEY,             -- issueID
  session       INTEGER NOT NULL,
  house         TEXT NOT NULL,
  name          TEXT NOT NULL,                -- 本会議 / ○○委員会
  issue         TEXT NOT NULL,                -- 第○号
  date          TEXT NOT NULL,
  url           TEXT NOT NULL,
  pdf_url       TEXT,
  speech_count  INTEGER NOT NULL DEFAULT 0,
  fetched_at    TEXT NOT NULL
);
CREATE INDEX idx_meetings_date ON meetings(date DESC);

-- 発言(メタデータのみ。本文は特集・法案に関係するものだけ後で保存する)
CREATE TABLE speeches (
  id          TEXT PRIMARY KEY,               -- speechID
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speech_order INTEGER NOT NULL,
  speaker     TEXT NOT NULL,
  url         TEXT NOT NULL,
  text        TEXT
);
CREATE INDEX idx_speeches_meeting ON speeches(meeting_id, speech_order);
CREATE INDEX idx_speeches_speaker ON speeches(speaker);

-- 省庁の発表(RSS から)
CREATE TABLE announcements (
  id           TEXT PRIMARY KEY,              -- URL の SHA-1
  ministry     TEXT NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  published_at TEXT,                          -- ISO 8601(UTC)
  date         TEXT NOT NULL,                 -- 日本時間の YYYY-MM-DD(並べ替え・タイムライン用)
  first_seen_at TEXT NOT NULL
);
CREATE INDEX idx_announcements_date ON announcements(date DESC, published_at DESC);
CREATE INDEX idx_announcements_ministry ON announcements(ministry, date DESC);

-- 収集の実行ログ
CREATE TABLE collector_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job         TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  ok          INTEGER,
  summary     TEXT
);
CREATE INDEX idx_collector_runs_job ON collector_runs(job, started_at DESC);
