/**
 * 衆議院「議案の一覧」と「審議経過情報」のパーサ。
 * https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm
 */
import { parseWarekiDate, stripTags } from "./text";

export const SHUGIIN_BILL_MENU_URL = "https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm";

/** 議案の種類 */
export type BillKind = "衆法" | "参法" | "閣法" | "条約";

const KIND_CODE: Record<BillKind, string> = { 衆法: "shu", 参法: "san", 閣法: "kaku", 条約: "joyaku" };

export interface BillListEntry {
  /** 例: "222-kaku-2"(提出回次-種類-番号) */
  id: string;
  kind: BillKind;
  session: number;
  number: number;
  title: string;
  /** 一覧に表示されている審議状況(例: "衆議院で審議中"、"成立") */
  statusText: string;
  /** 審議経過ページの絶対 URL */
  keikaUrl: string | null;
  /** 本文ページの絶対 URL */
  honbunUrl: string | null;
}

export function billId(session: number, kind: BillKind, number: number): string {
  return `${session}-${KIND_CODE[kind]}-${number}`;
}

/** 一覧ページ(UTF-8 にデコード済みの HTML)から議案を抽出する */
export function parseBillList(html: string, baseUrl = SHUGIIN_BILL_MENU_URL): BillListEntry[] {
  const out: BillListEntry[] = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  for (const t of html.matchAll(tableRe)) {
    const body = t[1]!;
    const caption = stripTags(body.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? "");
    const kind = (["衆法", "参法", "閣法", "条約"] as const).find((k) => caption.startsWith(k));
    if (!kind) continue;
    for (const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]!);
      if (cells.length < 4) continue;
      const session = Number(stripTags(cells[0]!));
      const number = Number(stripTags(cells[1]!));
      if (!Number.isInteger(session) || !Number.isInteger(number) || session <= 0) continue;
      const linkIn = (cell: string | undefined) => {
        const href = cell?.match(/href="([^"]+)"/i)?.[1];
        return href ? new URL(href, baseUrl).toString() : null;
      };
      const keikaCell = cells.find((c) => /title="経過"/.test(c));
      const honbunCell = cells.find((c) => /title="本文"/.test(c));
      out.push({
        id: billId(session, kind, number),
        kind,
        session,
        number,
        title: stripTags(cells[2]!),
        statusText: stripTags(cells[3]!),
        keikaUrl: linkIn(keikaCell),
        honbunUrl: linkIn(honbunCell),
      });
    }
  }
  return out;
}

export type House = "衆議院" | "参議院";

export type BillStage =
  | "preliminary_received" // 予備審査のための受理
  | "received" // 議案受理
  | "referred" // 委員会に付託
  | "committee_decided" // 委員会の審査終了
  | "plenary_decided" // 本会議の審議終了
  | "promulgated"; // 公布

export interface BillEventData {
  date: string;
  house: House | null;
  stage: BillStage;
  committee: string | null;
  result: string | null;
}

export interface BillKeika {
  /** 項目名 → 内容(原文のまま、空白は整形済み) */
  fields: Record<string, string>;
  submitter: string | null;
  submitterGroups: string[];
  events: BillEventData[];
  /** 衆議院の審議時の賛成・反対会派 */
  shugiinVote: { attitude: string | null; for: string[]; against: string[] };
  sangiinVote: { attitude: string | null; for: string[]; against: string[] };
  lawNumber: string | null;
}

/** 審議経過ページ(UTF-8 にデコード済み)を解析する */
export function parseBillKeika(html: string): BillKeika {
  const fields: Record<string, string> = {};
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<td[^>]*>([\s\S]*?)(?=<td|$)/gi)].map((c) => stripTags(c[1]!));
    if (cells.length < 2) continue;
    fields[cells[0]!] = cells[1]!;
  }

  const split = (v: string | undefined) => (v ?? "").split(/[;；]/).map((s) => s.trim()).filter(Boolean);
  /** "日付／内容" 形式の値を分ける */
  const pair = (key: string): [string | null, string | null] => {
    const v = fields[key];
    if (v === undefined) return [null, null];
    const [a = "", b = ""] = v.split("／").map((s) => s.trim());
    return [parseWarekiDate(a), b || null];
  };
  const single = (key: string) => (fields[key] ? parseWarekiDate(fields[key]!) : null);

  const events: BillEventData[] = [];
  const push = (date: string | null, house: House | null, stage: BillStage, extra: Partial<BillEventData> = {}) => {
    if (date) events.push({ date, house, stage, committee: null, result: null, ...extra });
  };

  for (const house of ["衆議院", "参議院"] as const) {
    push(single(`${house}予備審査議案受理年月日`), house, "preliminary_received");
    push(single(`${house}議案受理年月日`), house, "received");
    const [refDate, committee] = pair(`${house}付託年月日／${house}付託委員会`);
    push(refDate, house, "referred", { committee });
    const [cDate, cResult] = pair(`${house}審査終了年月日／${house}審査結果`);
    push(cDate, house, "committee_decided", { result: cResult, committee });
    const [pDate, pResult] = pair(`${house}審議終了年月日／${house}審議結果`);
    push(pDate, house, "plenary_decided", { result: pResult });
  }
  const [promDate, lawNo] = pair("公布年月日／法律番号");
  push(promDate, null, "promulgated", { result: lawNo });

  events.sort((a, b) => a.date.localeCompare(b.date));

  const vote = (house: House) => ({
    attitude: fields[`${house}審議時会派態度`] || null,
    for: split(fields[`${house}審議時賛成会派`]),
    against: split(fields[`${house}審議時反対会派`]),
  });

  return {
    fields,
    submitter: fields["議案提出者"] || null,
    submitterGroups: split(fields["議案提出会派"]),
    events,
    shugiinVote: vote("衆議院"),
    sangiinVote: vote("参議院"),
    lawNumber: lawNo,
  };
}

/** 一覧の審議状況テキストを、絞り込み用の状態コードにする */
export type BillStatus = "pending" | "passed" | "rejected" | "withdrawn" | "lapsed" | "other";

export function normalizeBillStatus(statusText: string): BillStatus {
  if (/成立|承認|承諾/.test(statusText) && !/不承認|不承諾/.test(statusText)) return "passed";
  if (/審議中|閉会中審査|継続/.test(statusText)) return "pending";
  if (/否決|不承認|不承諾/.test(statusText)) return "rejected";
  if (/撤回/.test(statusText)) return "withdrawn";
  if (/未了/.test(statusText)) return "lapsed";
  return "other";
}
