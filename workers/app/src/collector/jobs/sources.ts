/**
 * 一次資料の収集: 話題(法律名)に関係する会議録の発言・法案と審議経過・省庁の発表を集め、
 * sources(特集に使える資料のカタログ)に登録して topic_sources で話題に紐づける。
 */
import { parseSpeechList, searchStem, speechListUrl, STAGE_LABEL, type BillStage } from "@kokkai-watch/core";
import { fetchJson, nowIso, sha1Hex, sleep, writeJsonRows, type Env, type JobResult } from "../util";

/** 会議録の発言を取得するページ数(1ページ100件、新しい順) */
const SPEECH_PAGES = 2;
const MAX_ANNOUNCEMENTS = 50;

interface SourceRow {
  id: string;
  kind: "speech" | "bill" | "bill_event" | "announcement";
  refId: string;
  title: string;
  date: string | null;
  url: string;
  body: string;
  speaker: string | null;
  meta: Record<string, unknown> | null;
}

/** YYYY-MM-DD → 「2026年10月30日」 */
function jpDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** LIKE 用にワイルドカードをエスケープする */
function likePattern(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function collectSourcesForTopic(env: Env, topicId: string): Promise<{ summary: string; count: number }> {
  const topic = await env.DB.prepare("SELECT id, keyword FROM topics WHERE id = ?")
    .bind(topicId)
    .first<{ id: string; keyword: string }>();
  if (!topic) throw new Error(`topic not found: ${topicId}`);
  const stem = searchStem(topic.keyword);
  const now = nowIso();
  const sources: SourceRow[] = [];
  const meetingRows = new Map<string, Record<string, unknown>>();
  const speechRows: Record<string, unknown>[] = [];

  // ---- 会議録の発言 ----
  let speechTotal = 0;
  let start: number | undefined = 1;
  for (let page = 0; page < SPEECH_PAGES && start; page++) {
    const res = parseSpeechList(await fetchJson(speechListUrl({ any: stem, start, max: 100 })));
    speechTotal = res.total;
    for (const s of res.speeches) {
      meetingRows.set(s.issueID, {
        id: s.issueID,
        session: s.session,
        house: s.house,
        name: s.meetingName,
        issue: s.issue,
        date: s.date,
        url: s.meetingUrl,
      });
      speechRows.push({
        id: s.speechID,
        meetingId: s.issueID,
        order: s.order,
        speaker: s.speaker,
        url: s.url,
        text: s.text,
        group: s.speakerGroup,
        position: s.speakerPosition,
      });
      sources.push({
        id: `src_sp_${s.speechID}`,
        kind: "speech",
        refId: s.speechID,
        title: `${s.house} ${s.meetingName} ${s.issue} ${s.speaker}${s.speakerGroup ? `(${s.speakerGroup})` : ""}`,
        date: s.date,
        url: s.url,
        body: s.text,
        speaker: s.speaker,
        meta: {
          session: s.session,
          house: s.house,
          meeting: s.meetingName,
          issue: s.issue,
          speakerGroup: s.speakerGroup,
          speakerPosition: s.speakerPosition,
          meetingUrl: s.meetingUrl,
        },
      });
    }
    start = res.nextRecordPosition ?? undefined;
    if (start && page + 1 < SPEECH_PAGES) await sleep(1000);
  }

  // ---- 法案と審議経過 ----
  const pattern = likePattern(stem);
  const { results: bills } = await env.DB.prepare(
    `SELECT id, kind, session, number, title, status_text, submitter, keika_url, honbun_url
     FROM bills WHERE title LIKE ? ESCAPE '\\' LIMIT 20`,
  )
    .bind(pattern)
    .all<{
      id: string;
      kind: string;
      session: number;
      number: number;
      title: string;
      status_text: string;
      submitter: string | null;
      keika_url: string | null;
      honbun_url: string | null;
    }>();
  // 審議経過は対象法案の分をまとめて1回で取得する
  type EventRow = { bill_id: string; stage: BillStage; house: string; date: string; committee: string | null; result: string | null };
  const eventsByBill = new Map<string, EventRow[]>();
  if (bills.length) {
    const { results: allEvents } = await env.DB.prepare(
      `SELECT bill_id, stage, house, date, committee, result FROM bill_events
       WHERE bill_id IN (${bills.map(() => "?").join(",")}) ORDER BY date`,
    )
      .bind(...bills.map((b) => b.id))
      .all<EventRow>();
    for (const e of allEvents) {
      const list = eventsByBill.get(e.bill_id) ?? [];
      list.push(e);
      eventsByBill.set(e.bill_id, list);
    }
  }
  for (const b of bills) {
    const url = b.keika_url ?? b.honbun_url ?? "https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm";
    sources.push({
      id: `src_bill_${b.id}`,
      kind: "bill",
      refId: b.id,
      title: `${b.title}(${b.kind} 第${b.session}回国会 ${b.number}号)`,
      date: null,
      url,
      body: `${b.title}(${b.kind} 第${b.session}回国会 ${b.number}号)。提出者: ${b.submitter ?? "不明"}。審議状況: ${b.status_text}。`,
      speaker: null,
      meta: { kind: b.kind, session: b.session, number: b.number, status: b.status_text },
    });
    for (const e of eventsByBill.get(b.id) ?? []) {
      const label = STAGE_LABEL[e.stage] ?? e.stage;
      const parts = [jpDate(e.date), e.house || null, e.stage === "referred" && e.committee ? `${label}(${e.committee}委員会)` : label];
      if (e.stage === "promulgated" && e.result) parts.push(`法律第${e.result}号`);
      else if (e.result) parts.push(e.result);
      const body = `${b.title}: ${parts.filter(Boolean).join(" ")}`;
      sources.push({
        id: `src_be_${b.id}_${e.stage}_${e.house || "none"}`,
        kind: "bill_event",
        refId: b.id,
        title: `${b.title} — ${e.house ? `${e.house} ` : ""}${label}`,
        date: e.date,
        url,
        body,
        speaker: null,
        meta: { billId: b.id, stage: e.stage, house: e.house || null, committee: e.committee, result: e.result },
      });
    }
  }

  // ---- 省庁の発表 ----
  const { results: anns } = await env.DB.prepare(
    `SELECT id, ministry, title, url, date FROM announcements WHERE title LIKE ? ESCAPE '\\'
     ORDER BY date DESC LIMIT ?`,
  )
    .bind(pattern, MAX_ANNOUNCEMENTS)
    .all<{ id: string; ministry: string; title: string; url: string; date: string }>();
  for (const a of anns) {
    sources.push({
      id: `src_ann_${a.id}`,
      kind: "announcement",
      refId: a.id,
      title: `${a.ministry}: ${a.title}`,
      date: a.date,
      url: a.url,
      body: a.title,
      speaker: null,
      meta: { ministry: a.ministry },
    });
  }

  // ---- 保存(D1 のクエリ数上限への対策として、各テーブルとも JSON にまとめて書き込む) ----
  // 発言本文が長いと JSON が大きくなるため、writeJsonRows が自動で数文に分割する
  await writeJsonRows(
    env.DB,
    `INSERT OR IGNORE INTO meetings (id, session, house, name, issue, date, url, pdf_url, speech_count, fetched_at)
     SELECT value->>'$.id', value->>'$.session', value->>'$.house', value->>'$.name', value->>'$.issue',
       value->>'$.date', value->>'$.url', NULL, 0, ?2
     FROM json_each(?1)`,
    [...meetingRows.values()],
    [now],
  );
  await writeJsonRows(
    env.DB,
    `INSERT INTO speeches (id, meeting_id, speech_order, speaker, url, text, speaker_group, speaker_position)
     SELECT value->>'$.id', value->>'$.meetingId', value->>'$.order', value->>'$.speaker', value->>'$.url',
       value->>'$.text', value->>'$.group', value->>'$.position'
     FROM json_each(?1) WHERE true
     ON CONFLICT(id) DO UPDATE SET text = excluded.text, speaker_group = excluded.speaker_group,
       speaker_position = excluded.speaker_position`,
    speechRows,
  );
  const sourceRows: Record<string, unknown>[] = [];
  for (const s of sources) {
    sourceRows.push({
      id: s.id,
      kind: s.kind,
      refId: s.refId,
      title: s.title,
      date: s.date,
      url: s.url,
      body: s.body,
      speaker: s.speaker,
      meta: s.meta ? JSON.stringify(s.meta) : null,
      hash: await sha1Hex(s.body),
    });
  }
  await writeJsonRows(
    env.DB,
    `INSERT INTO sources (id, kind, ref_id, title, date, url, body, speaker, meta_json, content_hash, fetched_at)
     SELECT value->>'$.id', value->>'$.kind', value->>'$.refId', value->>'$.title', value->>'$.date',
       value->>'$.url', value->>'$.body', value->>'$.speaker', value->>'$.meta', value->>'$.hash', ?2
     FROM json_each(?1) WHERE true
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, date = excluded.date, url = excluded.url,
       body = excluded.body, speaker = excluded.speaker, meta_json = excluded.meta_json,
       content_hash = excluded.content_hash, fetched_at = excluded.fetched_at`,
    sourceRows,
    [now],
  );
  await writeJsonRows(
    env.DB,
    `INSERT OR IGNORE INTO topic_sources (topic_id, source_id)
     SELECT ?2, value->>'$.id' FROM json_each(?1)`,
    sources.map((s) => ({ id: s.id })),
    [topic.id],
  );
  await env.DB.prepare("UPDATE topics SET sources_collected_at = ? WHERE id = ?").bind(now, topic.id).run();

  const speeches = sources.filter((s) => s.kind === "speech").length;
  const events = sources.filter((s) => s.kind === "bill_event").length;
  return {
    count: sources.length,
    summary:
      `「${topic.keyword}」(検索語「${stem}」): 発言 ${speeches}/${speechTotal} 件、法案 ${bills.length} 件・審議経過 ${events} 件、` +
      `省庁の発表 ${anns.length} 件 → 資料 ${sources.length} 件`,
  };
}

/** status=open で資料が未収集の話題を、score の高い順に1件処理する */
export async function collectPendingSources(env: Env): Promise<JobResult> {
  const topic = await env.DB.prepare(
    "SELECT id FROM topics WHERE status = 'open' AND sources_collected_at IS NULL ORDER BY score DESC LIMIT 1",
  ).first<{ id: string }>();
  if (!topic) return { summary: "資料の収集が必要な話題はありません" };
  const r = await collectSourcesForTopic(env, topic.id);
  return { summary: r.summary };
}
