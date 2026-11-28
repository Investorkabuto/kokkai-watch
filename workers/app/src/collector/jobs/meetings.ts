/** 国会会議録検索システムから会議と発言(メタデータ)を収集する */
import { meetingListUrl, parseMeetingList, toJstDate, type MeetingData } from "@kokkai-watch/core";
import { fetchJson, nowIso, sleep, writeJsonRows, type Env, type JobResult } from "../util";

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
  const toWrite = meetings.filter((m) => existing.get(m.id) !== m.speeches.length);
  const written = toWrite.length;
  // 会議と発言はそれぞれ JSON にまとめて書き込む(発言数千件でも数文で済む)
  await writeJsonRows(
    env.DB,
    `INSERT INTO meetings (id, session, house, name, issue, date, url, pdf_url, speech_count, fetched_at)
     SELECT value->>'$.id', value->>'$.session', value->>'$.house', value->>'$.name', value->>'$.issue',
       value->>'$.date', value->>'$.url', value->>'$.pdfUrl', value->>'$.speechCount', ?2
     FROM json_each(?1) WHERE true
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, issue = excluded.issue, url = excluded.url,
       pdf_url = excluded.pdf_url, speech_count = excluded.speech_count, fetched_at = excluded.fetched_at`,
    toWrite.map((m) => ({
      id: m.id,
      session: m.session,
      house: m.house,
      name: m.name,
      issue: m.issue,
      date: m.date,
      url: m.url,
      pdfUrl: m.pdfUrl,
      speechCount: m.speeches.length,
    })),
    [now],
  );
  await writeJsonRows(
    env.DB,
    `INSERT INTO speeches (id, meeting_id, speech_order, speaker, url)
     SELECT value->>'$.id', value->>'$.meetingId', value->>'$.order', value->>'$.speaker', value->>'$.url'
     FROM json_each(?1) WHERE true
     ON CONFLICT(id) DO UPDATE SET speaker = excluded.speaker, url = excluded.url`,
    toWrite.flatMap((m) => m.speeches.map((sp) => ({ id: sp.id, meetingId: m.id, order: sp.order, speaker: sp.speaker, url: sp.url }))),
  );

  return { summary: `${from}〜 の会議 ${meetings.length}/${total} 件を確認、${written} 件を保存` };
}
