/**
 * 国立国会図書館 国会会議録検索システム API のクライアント。
 * https://kokkai.ndl.go.jp/api.html
 */

export const KOKKAI_API_BASE = "https://kokkai.ndl.go.jp/api";

export interface MeetingData {
  /** 会議録 ID(issueID) */
  id: string;
  session: number;
  house: string;
  name: string;
  issue: string;
  date: string;
  url: string;
  pdfUrl: string | null;
  speeches: SpeechMeta[];
}

export interface SpeechMeta {
  id: string;
  order: number;
  speaker: string;
  url: string;
}

export interface MeetingListPage {
  total: number;
  nextRecordPosition: number | null;
  meetings: MeetingData[];
}

interface RawSpeech {
  speechID: string;
  speechOrder: number;
  speaker: string;
  speechURL: string;
}
interface RawMeeting {
  issueID: string;
  session: number;
  nameOfHouse: string;
  nameOfMeeting: string;
  issue: string;
  date: string;
  meetingURL?: string;
  pdfURL?: string | null;
  speechRecord?: RawSpeech[];
}
interface RawMeetingList {
  numberOfRecords?: number;
  nextRecordPosition?: number | null;
  meetingRecord?: RawMeeting[];
  message?: string;
}

/** meeting_list API の URL を作る(maximumRecords は 1〜100) */
export function meetingListUrl(params: { from?: string; until?: string; start?: number; max?: number }): string {
  const q = new URLSearchParams({ recordPacking: "json", maximumRecords: String(params.max ?? 100) });
  if (params.from) q.set("from", params.from);
  if (params.until) q.set("until", params.until);
  if (params.start) q.set("startRecord", String(params.start));
  return `${KOKKAI_API_BASE}/meeting_list?${q}`;
}

/** meeting_list API のレスポンス(JSON)を解析する */
export function parseMeetingList(json: unknown): MeetingListPage {
  const raw = json as RawMeetingList;
  if (raw.message && !raw.meetingRecord) {
    throw new Error(`kokkai API error: ${raw.message}`);
  }
  const meetings = (raw.meetingRecord ?? []).map(
    (m): MeetingData => ({
      id: m.issueID,
      session: m.session,
      house: m.nameOfHouse,
      name: m.nameOfMeeting,
      issue: m.issue,
      date: m.date,
      url: m.meetingURL ?? `https://kokkai.ndl.go.jp/txt/${m.issueID}`,
      pdfUrl: m.pdfURL ?? null,
      speeches: (m.speechRecord ?? [])
        // speechOrder 0 は「会議録情報」(出席者などのヘッダ)
        .filter((s) => s.speechOrder > 0)
        .map((s) => ({ id: s.speechID, order: s.speechOrder, speaker: s.speaker, url: s.speechURL })),
    }),
  );
  return {
    total: raw.numberOfRecords ?? 0,
    nextRecordPosition: raw.nextRecordPosition ?? null,
    meetings,
  };
}

// ---- 発言検索 API(/api/speech) ----

export interface SpeechRecord {
  speechID: string;
  issueID: string;
  session: number;
  house: string;
  meetingName: string;
  issue: string;
  date: string;
  order: number;
  speaker: string;
  speakerGroup: string | null;
  speakerPosition: string | null;
  /** 発言本文(先頭の「○氏名君 」などの話者表記を含む原文) */
  text: string;
  url: string;
  meetingUrl: string;
}

export interface SpeechListPage {
  total: number;
  nextRecordPosition: number | null;
  speeches: SpeechRecord[];
}

interface RawSpeechRecord {
  speechID: string;
  issueID: string;
  session: number;
  nameOfHouse: string;
  nameOfMeeting: string;
  issue: string;
  date: string;
  speechOrder: number;
  speaker: string;
  speakerGroup?: string | null;
  speakerPosition?: string | null;
  speech?: string;
  speechURL: string;
  meetingURL?: string;
}

/** speech API の URL を作る(maximumRecords は 1〜100。結果は新しい順) */
export function speechListUrl(params: { any: string; from?: string; until?: string; start?: number; max?: number }): string {
  const q = new URLSearchParams({
    recordPacking: "json",
    any: params.any,
    maximumRecords: String(Math.min(Math.max(params.max ?? 100, 1), 100)),
  });
  if (params.from) q.set("from", params.from);
  if (params.until) q.set("until", params.until);
  if (params.start) q.set("startRecord", String(params.start));
  return `${KOKKAI_API_BASE}/speech?${q}`;
}

/** speech API のレスポンス(JSON)を解析する */
export function parseSpeechList(json: unknown): SpeechListPage {
  const raw = json as { numberOfRecords?: number; nextRecordPosition?: number | null; speechRecord?: RawSpeechRecord[]; message?: string };
  if (raw.message && !raw.speechRecord) {
    throw new Error(`kokkai API error: ${raw.message}`);
  }
  return {
    total: raw.numberOfRecords ?? 0,
    nextRecordPosition: raw.nextRecordPosition ?? null,
    speeches: (raw.speechRecord ?? []).map((s) => ({
      speechID: s.speechID,
      issueID: s.issueID,
      session: s.session,
      house: s.nameOfHouse,
      meetingName: s.nameOfMeeting,
      issue: s.issue,
      date: s.date,
      order: s.speechOrder,
      speaker: s.speaker,
      speakerGroup: s.speakerGroup || null,
      speakerPosition: s.speakerPosition || null,
      text: s.speech ?? "",
      url: s.speechURL,
      meetingUrl: s.meetingURL ?? `https://kokkai.ndl.go.jp/txt/${s.issueID}`,
    })),
  };
}
