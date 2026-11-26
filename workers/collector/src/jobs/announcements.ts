/** 省庁の RSS から発表を収集する */
import { MINISTRY_FEEDS, parseFeed, toJstDate } from "@kokkai-watch/core";
import { batchInChunks, fetchText, nowIso, sha1Hex, type Env, type JobResult } from "../util";

export async function collectAnnouncements(env: Env): Promise<JobResult> {
  const now = nowIso();
  const results = await Promise.allSettled(
    MINISTRY_FEEDS.map(async (f) => ({ ministry: f.ministry, items: parseFeed(await fetchText(f.url)) })),
  );

  const stmts: D1PreparedStatement[] = [];
  const errors: string[] = [];
  let count = 0;
  for (const [i, r] of results.entries()) {
    if (r.status === "rejected") {
      errors.push(`${MINISTRY_FEEDS[i]!.ministry}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      continue;
    }
    for (const item of r.value.items) {
      count++;
      const date = toJstDate(item.publishedAt ? new Date(item.publishedAt) : new Date());
      stmts.push(
        env.DB.prepare(
          `INSERT INTO announcements (id, ministry, title, url, published_at, date, first_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title`,
        ).bind(await sha1Hex(item.url), r.value.ministry, item.title, item.url, item.publishedAt, date, now),
      );
    }
  }
  await batchInChunks(env.DB, stmts);

  const summary = `${MINISTRY_FEEDS.length - errors.length}/${MINISTRY_FEEDS.length} 省庁、${count} 件を確認`;
  return { summary: errors.length ? `${summary}、エラー: ${errors.join(" / ")}` : summary };
}
