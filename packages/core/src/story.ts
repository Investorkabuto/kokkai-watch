/**
 * 特集記事のデータ形式(Ingest API の投稿形式であり、stories.content_json の保存形式)。
 * すべての文は1つ以上の出典(sources.id)を持つ。
 */

export interface Citation {
  /** sources.id(例: src_sp_122215206X00320261105_123) */
  source_id: string;
  /** 原文からの引用(任意)。指定した場合は出典の本文と一字一句一致する必要がある */
  quote?: string;
}

export interface Sentence {
  text: string;
  citations: Citation[];
}

export interface StoryItem {
  /** YYYY-MM-DD。項目内のいずれかの出典の日付と一致する必要がある */
  date: string;
  heading: string;
  sentences: Sentence[];
}

export interface Perspective {
  /** 例: 賛成 / 反対・慎重 */
  stance: string;
  sentences: Sentence[];
}

export interface StorySubmission {
  topic_id: string;
  /** 書き手の名前(例: muse) */
  writer?: string;
  title: string;
  lead: Sentence[];
  items: StoryItem[];
  perspectives: Perspective[];
}

export type SourceKind = "speech" | "bill" | "bill_event" | "announcement";

/** 検証に使う一次資料(sources テーブルの行から作る) */
export interface SourceForVerify {
  id: string;
  kind: SourceKind;
  date: string | null;
  title: string;
  body: string;
  speaker: string | null;
}

export interface VerifyIssue {
  /** 例: missing_citation / unknown_source / quote_mismatch / date_mismatch / speaker_mismatch / perspectives / banned_expression / schema */
  code: string;
  /** 例: items[2].sentences[0] */
  path: string;
  message: string;
}

export interface VerifyResult {
  passed: boolean;
  issues: VerifyIssue[];
  /** 検証に合格した場合の正規化済みデータ */
  story?: StorySubmission;
}
