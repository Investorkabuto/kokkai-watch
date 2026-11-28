/** 国会会議録検索システムから会議と発言(メタデータ)を収集する */
import { meetingListUrl, parseMeetingList, toJstDate, type MeetingData } from "@kokkai-watch/core";
import { batchInChunks, fetchJson, nowIso, sleep, type Env, type JobResult } from "../util";

/** 会議録は公開まで日数がかかるため、過去30日分を毎回見直す */
const LOOKBACK_DAYS = 30;
const MAX_PAGES = 5;

export async function collectMeetings(env: Env, opts: { from?: string; until?: string } = {}): Promise<JobResult> {
  const from = opts.from ?? toJstDate(new Date(Date.now() - LOOKBACK_DAYS * 86400_000));
  const until = opts.until;

  const meetings: MeetingData[] = [];
  let start: number | undefined = 1;
  let total = 0;
  for (let page = 0; page < MAX_PAGES && start; page++) {
    const res = parseMeetingList(await fetchJson(meetingListUrl({ from, until, start, max: 100 })));
    total = res.total;
    meetings.push(...res.meetings);
    start = res.nextRecordPosition ?? undefined;
    if (start) await sleep(1000);
  }

  // 保存済みで発言数が同じ会議は書き込まない
  const existing = new Map<string, number>();
  const { results } = await env.DB.prepare("SELECT id, speech_count FROM meetings WHERE date >= ?")
    .bind(from)
    .all<{ id: string; speech_count: number }>();
  for (const r of results) existing.set(r.id, r.speech_count);

  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  let written = 0;
  for (const m of meetings) {
    if (existing.get(m.id) === m.speeches.length) continue;
    written++;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO meetings (id, session, house, name, issue, date, url, pdf_url, speech_count, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, issue = excluded.issue, url = excluded.url,
           pdf_url = excluded.pdf_url, speech_count = excluded.speech_count, fetched_at = excluded.fetched_at`,
      ).bind(m.id, m.session, m.house, m.name, m.issue, m.date, m.url, m.pdfUrl, m.speeches.length, now),
    );
    for (const s of m.speeches) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO speeches (id, meeting_id, speech_order, speaker, url) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET speaker = excluded.speaker, url = excluded.url`,
        ).bind(s.id, m.id, s.order, s.speaker, s.url),
      );
    }
  }
  await batchInChunks(env.DB, stmts, 100);

  return { summary: `${from}〜 の会議 ${meetings.length}/${total} 件を確認、${written} 件を保存` };
}
