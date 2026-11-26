/** D1 への問い合わせ */
import type { BillStage } from "@kokkai-watch/core";

export interface Env {
  DB: D1Database;
}

export interface BillRow {
  id: string;
  kind: string;
  session: number;
  number: number;
  title: string;
  status_text: string;
  status: string;
  submitter: string | null;
  submitter_groups: string | null;
  law_number: string | null;
  vote_json: string | null;
  keika_url: string | null;
  honbun_url: string | null;
  updated_at: string;
  /** 最新の審議経過の日付(一覧用) */
  last_event_date?: string | null;
}

export interface BillEventRow {
  bill_id: string;
  stage: BillStage;
  house: string;
  date: string;
  committee: string | null;
  result: string | null;
}

export interface MeetingRow {
  id: string;
  session: number;
  house: string;
  name: string;
  issue: string;
  date: string;
  url: string;
  speech_count: number;
}

export interface AnnouncementRow {
  id: string;
  ministry: string;
  title: string;
  url: string;
  published_at: string | null;
  date: string;
}

export type BillFilter = "pending" | "passed" | "all";

const BILL_COLUMNS = `b.id, b.kind, b.session, b.number, b.title, b.status_text, b.status, b.submitter, b.submitter_groups,
  b.law_number, b.vote_json, b.keika_url, b.honbun_url, b.updated_at,
  (SELECT max(date) FROM bill_events e WHERE e.bill_id = b.id) AS last_event_date`;

export async function listBills(db: D1Database, filter: BillFilter, kind?: string, limit = 200): Promise<BillRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter === "pending") where.push("b.status = 'pending'");
  if (filter === "passed") where.push("b.status = 'passed'");
  if (kind) {
    where.push("b.kind = ?");
    binds.push(kind);
  }
  const sql = `SELECT ${BILL_COLUMNS} FROM bills b ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY last_event_date IS NULL, last_event_date DESC, b.session DESC, b.number DESC LIMIT ?`;
  const { results } = await db.prepare(sql).bind(...binds, limit).all<BillRow>();
  return results;
}

export async function getBill(db: D1Database, id: string): Promise<{ bill: BillRow; events: BillEventRow[] } | null> {
  const bill = await db.prepare(`SELECT ${BILL_COLUMNS} FROM bills b WHERE b.id = ?`).bind(id).first<BillRow>();
  if (!bill) return null;
  const { results } = await db
    .prepare("SELECT * FROM bill_events WHERE bill_id = ? ORDER BY date, CASE stage WHEN 'promulgated' THEN 9 ELSE 0 END")
    .bind(id)
    .all<BillEventRow>();
  return { bill, events: results };
}

export async function recentMeetings(db: D1Database, limit = 10): Promise<MeetingRow[]> {
  const { results } = await db
    .prepare("SELECT id, session, house, name, issue, date, url, speech_count FROM meetings ORDER BY date DESC, house, name LIMIT ?")
    .bind(limit)
    .all<MeetingRow>();
  return results;
}

export async function recentAnnouncements(db: D1Database, limit = 10, ministry?: string): Promise<AnnouncementRow[]> {
  const sql = `SELECT id, ministry, title, url, published_at, date FROM announcements
    ${ministry ? "WHERE ministry = ?" : ""} ORDER BY date DESC, published_at DESC LIMIT ?`;
  const stmt = ministry ? db.prepare(sql).bind(ministry, limit) : db.prepare(sql).bind(limit);
  const { results } = await stmt.all<AnnouncementRow>();
  return results;
}

/** 統合タイムラインの1件 */
export interface TimelineItem {
  kind: "bill" | "meeting" | "announcement";
  date: string;
  title: string;
  sub: string;
  /** 自サイト内のリンク(法案)または外部の一次資料 */
  href: string;
  external: boolean;
  stage?: BillStage;
  result?: string | null;
}

export type TimelineKind = TimelineItem["kind"] | "all";

/** 指定日(含まない)より前の、直近 days 日分のタイムライン */
export async function timeline(
  db: D1Database,
  opts: { before?: string; days?: number; kind?: TimelineKind; ministry?: string },
): Promise<{ items: TimelineItem[]; nextBefore: string | null }> {
  const kind = opts.kind ?? "all";
  const before = opts.before ?? "9999-12-31";
  // 期間を区切るため、まず対象の日付一覧を求める
  const parts: string[] = [];
  if (kind === "all" || kind === "bill") parts.push("SELECT date FROM bill_events WHERE date < ?1 AND stage != 'preliminary_received'");
  if (kind === "all" || kind === "meeting") parts.push("SELECT date FROM meetings WHERE date < ?1");
  if (kind === "all" || kind === "announcement") {
    parts.push(`SELECT date FROM announcements WHERE date < ?1 ${opts.ministry ? "AND ministry = ?2" : ""}`);
  }
  const dateRows = await db
    .prepare(`SELECT DISTINCT date FROM (${parts.join(" UNION ALL ")}) ORDER BY date DESC LIMIT ?3`)
    .bind(before, opts.ministry ?? null, (opts.days ?? 7) + 1)
    .all<{ date: string }>();
  const dates = dateRows.results.map((r) => r.date);
  if (dates.length === 0) return { items: [], nextBefore: null };
  const hasMore = dates.length > (opts.days ?? 7);
  const shown = hasMore ? dates.slice(0, -1) : dates;
  const from = shown.at(-1)!;

  const items: TimelineItem[] = [];
  const stmts: Promise<void>[] = [];
  if (kind === "all" || kind === "bill") {
    stmts.push(
      db
        .prepare(
          `SELECT e.bill_id, e.stage, e.house, e.date, e.committee, e.result, b.title, b.kind
           FROM bill_events e JOIN bills b ON b.id = e.bill_id
           WHERE e.date >= ? AND e.date < ? AND e.stage != 'preliminary_received'`,
        )
        .bind(from, before)
        .all<BillEventRow & { title: string; kind: string }>()
        .then(({ results }) => {
          for (const r of results) {
            items.push({
              kind: "bill",
              date: r.date,
              title: r.title,
              sub: [r.kind, r.house, r.committee ? `${r.committee}委員会` : null].filter(Boolean).join(" · "),
              href: `/bills/${r.bill_id}`,
              external: false,
              stage: r.stage,
              result: r.result,
            });
          }
        }),
    );
  }
  if (kind === "all" || kind === "meeting") {
    stmts.push(
      db
        .prepare("SELECT * FROM meetings WHERE date >= ? AND date < ?")
        .bind(from, before)
        .all<MeetingRow>()
        .then(({ results }) => {
          for (const r of results) {
            items.push({
              kind: "meeting",
              date: r.date,
              title: `${r.house} ${r.name}`,
              sub: `第${r.session}回国会 ${r.issue} · 発言 ${r.speech_count} 件`,
              href: r.url,
              external: true,
            });
          }
        }),
    );
  }
  if (kind === "all" || kind === "announcement") {
    const sql = `SELECT * FROM announcements WHERE date >= ? AND date < ? ${opts.ministry ? "AND ministry = ?" : ""}`;
    const stmt = opts.ministry ? db.prepare(sql).bind(from, before, opts.ministry) : db.prepare(sql).bind(from, before);
    stmts.push(
      stmt.all<AnnouncementRow>().then(({ results }) => {
        for (const r of results) {
          items.push({ kind: "announcement", date: r.date, title: r.title, sub: r.ministry, href: r.url, external: true });
        }
      }),
    );
  }
  await Promise.all(stmts);

  const order = { bill: 0, meeting: 1, announcement: 2 } as const;
  items.sort((a, b) => b.date.localeCompare(a.date) || order[a.kind] - order[b.kind]);
  return { items, nextBefore: hasMore ? from : null };
}

export async function lastUpdated(db: D1Database): Promise<string | null> {
  const r = await db.prepare("SELECT max(finished_at) AS t FROM collector_runs WHERE ok = 1").first<{ t: string | null }>();
  return r?.t ?? null;
}
