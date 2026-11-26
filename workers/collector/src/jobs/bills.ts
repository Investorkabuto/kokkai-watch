/** 衆議院の議案一覧と審議経過を収集する */
import {
  normalizeBillStatus,
  parseBillKeika,
  parseBillList,
  SHUGIIN_BILL_MENU_URL,
  type BillListEntry,
} from "@kokkai-watch/core";
import { batchInChunks, fetchText, nowIso, sleep, type Env, type JobResult } from "../util";

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
  const changed: BillListEntry[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const b of list) {
    const prev = existing.get(b.id);
    if (prev && prev.title === b.title && prev.status_text === b.statusText && prev.keika_url === b.keikaUrl) {
      continue;
    }
    changed.push(b);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO bills (id, kind, session, number, title, status_text, status, keika_url, honbun_url, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, status_text = excluded.status_text, status = excluded.status,
           keika_url = excluded.keika_url, honbun_url = excluded.honbun_url, updated_at = excluded.updated_at`,
      ).bind(b.id, b.kind, b.session, b.number, b.title, b.statusText, normalizeBillStatus(b.statusText), b.keikaUrl, b.honbunUrl, now, now),
    );
  }
  await batchInChunks(env.DB, stmts);

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

  let fetched = 0;
  const errors: string[] = [];
  for (const { b } of targets) {
    try {
      const k = parseBillKeika(await fetchText(b.keikaUrl!));
      const vote = { shugiin: k.shugiinVote, sangiin: k.sangiinVote };
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE bills SET submitter = ?, submitter_groups = ?, law_number = ?, vote_json = ?, keika_fetched_at = ? WHERE id = ?",
        ).bind(k.submitter, JSON.stringify(k.submitterGroups), k.lawNumber, JSON.stringify(vote), nowIso(), b.id),
        env.DB.prepare("DELETE FROM bill_events WHERE bill_id = ?").bind(b.id),
        ...k.events.map((e) =>
          env.DB.prepare(
            "INSERT OR REPLACE INTO bill_events (bill_id, stage, house, date, committee, result) VALUES (?, ?, ?, ?, ?, ?)",
          ).bind(b.id, e.stage, e.house ?? "", e.date, e.committee, e.result),
        ),
      ]);
      fetched++;
    } catch (e) {
      errors.push(`${b.id}: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(500);
  }

  const summary = `一覧 ${list.length} 件(更新 ${changed.length})、審議経過 ${fetched}/${targets.length} 件取得`;
  return { summary: errors.length ? `${summary}、エラー ${errors.length}: ${errors.slice(0, 3).join(" / ")}` : summary };
}
