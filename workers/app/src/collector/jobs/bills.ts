/** 衆議院の議案一覧と審議経過を収集する */
import {
  normalizeBillStatus,
  parseBillKeika,
  parseBillList,
  SHUGIIN_BILL_MENU_URL,
  type BillListEntry,
} from "@kokkai-watch/core";
import { fetchText, nowIso, sleep, writeJsonRows, type Env, type JobResult } from "../util";

/** 1回の実行で取得する審議経過ページの上限(サブリクエスト数と相手サイトへの負荷を抑える) */
const MAX_KEIKA_PER_RUN = 30;
/** 審議中の法案の審議経過を取り直す間隔 */
const KEIKA_REFRESH_MS = 12 * 3600_000;

interface ExistingBill {
  id: string;
  title: string;
  status_text: string;
  keika_url: string | null;
  keika_fetched_at: string | null;
  status: string;
}

/*
 * D1 のクエリ数(1回の実行): 既存の法案 1 + 一覧の UPSERT 1 + 審議経過(法案の更新 1・経過の削除 1・経過の追加 1)
 * + runJob の記録 2 = 7 前後(JSON が大きい場合のみ分割で増える)
 */
export async function collectBills(env: Env): Promise<JobResult> {
  const html = await fetchText(SHUGIIN_BILL_MENU_URL);
  const list = parseBillList(html);
  if (list.length === 0) throw new Error("議案の一覧が空でした(ページ構造が変わった可能性があります)");

  const existing = new Map<string, ExistingBill>();
  const { results } = await env.DB.prepare(
    "SELECT id, title, status_text, keika_url, keika_fetched_at, status FROM bills",
  ).all<ExistingBill>();
  for (const r of results) existing.set(r.id, r);

  const now = nowIso();
  const changed: BillListEntry[] = list.filter((b) => {
    const prev = existing.get(b.id);
    return !(prev && prev.title === b.title && prev.status_text === b.statusText && prev.keika_url === b.keikaUrl);
  });
  await writeJsonRows(
    env.DB,
    `INSERT INTO bills (id, kind, session, number, title, status_text, status, keika_url, honbun_url, first_seen_at, updated_at)
     SELECT value->>'$.id', value->>'$.kind', value->>'$.session', value->>'$.number', value->>'$.title',
       value->>'$.statusText', value->>'$.status', value->>'$.keikaUrl', value->>'$.honbunUrl', ?2, ?2
     FROM json_each(?1) WHERE true
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, status_text = excluded.status_text, status = excluded.status,
       keika_url = excluded.keika_url, honbun_url = excluded.honbun_url, updated_at = excluded.updated_at`,
    changed.map((b) => ({
      id: b.id,
      kind: b.kind,
      session: b.session,
      number: b.number,
      title: b.title,
      statusText: b.statusText,
      status: normalizeBillStatus(b.statusText),
      keikaUrl: b.keikaUrl,
      honbunUrl: b.honbunUrl,
    })),
    [now],
  );

  // 審議経過を取得する対象: 新規・変更あり・未取得・審議中で一定時間たったもの
  const changedIds = new Set(changed.map((b) => b.id));
  const targets = list
    .filter((b) => b.keikaUrl)
    .map((b) => ({ b, prev: existing.get(b.id) }))
    .filter(({ b, prev }) => {
      if (changedIds.has(b.id) || !prev?.keika_fetched_at) return true;
      const stale = Date.now() - Date.parse(prev.keika_fetched_at) > KEIKA_REFRESH_MS;
      return stale && normalizeBillStatus(b.statusText) === "pending";
    })
    // 取得が古い順
    .sort((x, y) => (x.prev?.keika_fetched_at ?? "").localeCompare(y.prev?.keika_fetched_at ?? ""))
    .slice(0, MAX_KEIKA_PER_RUN);

  // 取得できた分を最後にまとめて書き込む(1法案ごとに文を発行しない)
  const billUpdates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const errors: string[] = [];
  for (const { b } of targets) {
    try {
      const k = parseBillKeika(await fetchText(b.keikaUrl!));
      billUpdates.push({
        id: b.id,
        submitter: k.submitter,
        groups: JSON.stringify(k.submitterGroups),
        lawNumber: k.lawNumber,
        vote: JSON.stringify({ shugiin: k.shugiinVote, sangiin: k.sangiinVote }),
        fetchedAt: nowIso(),
      });
      for (const e of k.events) {
        events.push({
          billId: b.id,
          stage: e.stage,
          house: e.house ?? "",
          date: e.date,
          committee: e.committee,
          result: e.result,
        });
      }
    } catch (e) {
      errors.push(`${b.id}: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(500);
  }

  if (billUpdates.length) {
    await writeJsonRows(
      env.DB,
      `UPDATE bills SET submitter = j.submitter, submitter_groups = j.groups, law_number = j.law_number,
         vote_json = j.vote, keika_fetched_at = j.fetched_at
       FROM (SELECT value->>'$.id' AS id, value->>'$.submitter' AS submitter, value->>'$.groups' AS groups,
               value->>'$.lawNumber' AS law_number, value->>'$.vote' AS vote, value->>'$.fetchedAt' AS fetched_at
             FROM json_each(?1)) AS j
       WHERE bills.id = j.id`,
      billUpdates,
    );
    // 取得し直した法案の経過は入れ替える(ID の数は最大30なので1文で足りる)
    await env.DB.prepare("DELETE FROM bill_events WHERE bill_id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(billUpdates.map((u) => u.id)))
      .run();
    await writeJsonRows(
      env.DB,
      `INSERT OR REPLACE INTO bill_events (bill_id, stage, house, date, committee, result)
       SELECT value->>'$.billId', value->>'$.stage', value->>'$.house', value->>'$.date',
         value->>'$.committee', value->>'$.result'
       FROM json_each(?1)`,
      events,
    );
  }

  const summary = `一覧 ${list.length} 件(更新 ${changed.length})、審議経過 ${billUpdates.length}/${targets.length} 件取得`;
  return { summary: errors.length ? `${summary}、エラー ${errors.length}: ${errors.slice(0, 3).join(" / ")}` : summary };
}
