/** 特集記事・出典・誤り報告の D1 クエリ */
import type { StorySubmission } from "@kokkai-watch/core";

export interface StoryRow {
  id: string;
  slug: string;
  topic_id: string;
  title: string;
  content_json: string;
  status: string;
  writer: string;
  version: number;
  published_at: string;
  updated_at: string;
}

export interface StorySourceRow {
  id: string;
  kind: string;
  ref_id: string;
  title: string;
  date: string | null;
  url: string;
  speaker: string | null;
  meta_json: string | null;
}

export interface StorySummary {
  slug: string;
  title: string;
  lead: string;
  version: number;
  updated_at: string;
}

export function parseContent(row: Pick<StoryRow, "content_json">): StorySubmission | null {
  try {
    return JSON.parse(row.content_json) as StorySubmission;
  } catch {
    return null;
  }
}

/** 公開中の特集(新しい順) */
export async function listPublishedStories(db: D1Database, limit = 50): Promise<StorySummary[]> {
  const { results } = await db
    .prepare(
      "SELECT slug, title, content_json, version, updated_at FROM stories WHERE status = 'published' ORDER BY updated_at DESC LIMIT ?",
    )
    .bind(limit)
    .all<Pick<StoryRow, "slug" | "title" | "content_json" | "version" | "updated_at">>();
  return results.map((r) => ({
    slug: r.slug,
    title: r.title,
    lead: parseContent(r)?.lead[0]?.text ?? "",
    version: r.version,
    updated_at: r.updated_at,
  }));
}

export async function getStoryBySlug(db: D1Database, slug: string): Promise<StoryRow | null> {
  return db.prepare("SELECT * FROM stories WHERE slug = ?").bind(slug).first<StoryRow>();
}

/** 記事が引用している出典の詳細 */
export async function getStorySources(db: D1Database, storyId: string): Promise<Map<string, StorySourceRow>> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.kind, s.ref_id, s.title, s.date, s.url, s.speaker, s.meta_json
       FROM story_citations c JOIN sources s ON s.id = c.source_id WHERE c.story_id = ?`,
    )
    .bind(storyId)
    .all<StorySourceRow>();
  return new Map(results.map((r) => [r.id, r]));
}

/** 報告の上限・自動取り下げのしきい値 */
export const WITHDRAW_THRESHOLD = 3;

export type ReportResult = "accepted" | "duplicate" | "withdrawn";

/**
 * 誤りの報告を保存する。同じ reporter・同じ記事は1日1件まで(reporter は日付つきハッシュなので日ごとに変わる)。
 * 別々の reporter から open の報告がしきい値に達したら、記事を取り下げて話題を open に戻す。
 */
export async function addCorrection(
  db: D1Database,
  story: Pick<StoryRow, "id" | "topic_id" | "status">,
  body: string,
  reporter: string,
): Promise<ReportResult> {
  const dup = await db
    .prepare("SELECT 1 FROM corrections WHERE story_id = ? AND reporter = ? LIMIT 1")
    .bind(story.id, reporter)
    .first();
  if (dup) return "duplicate";

  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO corrections (story_id, body, reporter, status, created_at) VALUES (?, ?, ?, 'open', ?)")
    .bind(story.id, body, reporter, now)
    .run();

  const r = await db
    .prepare("SELECT count(DISTINCT reporter) AS n FROM corrections WHERE story_id = ? AND status = 'open'")
    .bind(story.id)
    .first<{ n: number }>();
  if (story.status === "published" && (r?.n ?? 0) >= WITHDRAW_THRESHOLD) {
    await db.batch([
      db.prepare("UPDATE stories SET status = 'withdrawn', updated_at = ? WHERE id = ?").bind(now, story.id),
      db.prepare("UPDATE topics SET status = 'open' WHERE id = ?").bind(story.topic_id),
    ]);
    return "withdrawn";
  }
  return "accepted";
}

/** 報告者の識別子: sha256(IP + 当日の日付 + ソルト) の先頭16桁 */
export async function reporterHash(ip: string, date: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${date}|kokkai-watch-report-v1`));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** 法案 ID → 件名 */
export async function getBillTitles(db: D1Database, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { results } = await db
    .prepare(`SELECT id, title FROM bills WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: string; title: string }>();
  return new Map(results.map((r) => [r.id, r.title]));
}
