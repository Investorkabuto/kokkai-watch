/** 省庁の RSS から発表を収集する */
import { MINISTRY_FEEDS, parseFeed, toJstDate } from "@kokkai-watch/core";
import { fetchText, nowIso, sha1Hex, writeJsonRows, type Env, type JobResult } from "../util";

export async function collectAnnouncements(env: Env): Promise<JobResult> {
  const now = nowIso();
  const results = await Promise.allSettled(
    MINISTRY_FEEDS.map(async (f) => ({ ministry: f.ministry, items: parseFeed(await fetchText(f.url)) })),
  );

  const rows: Record<string, unknown>[] = [];
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
      rows.push({
        id: await sha1Hex(item.url),
        ministry: r.value.ministry,
        title: item.title,
        url: item.url,
        publishedAt: item.publishedAt,
        date,
      });
    }
  }
  // 全件を1文で書き込む(D1 のクエリ数上限への対策)
  await writeJsonRows(
    env.DB,
    `INSERT INTO announcements (id, ministry, title, url, published_at, date, first_seen_at)
     SELECT value->>'$.id', value->>'$.ministry', value->>'$.title', value->>'$.url',
       value->>'$.publishedAt', value->>'$.date', ?2
     FROM json_each(?1) WHERE true
     ON CONFLICT(id) DO UPDATE SET title = excluded.title`,
    rows,
    [now],
  );

  const summary = `${MINISTRY_FEEDS.length - errors.length}/${MINISTRY_FEEDS.length} 省庁、${count} 件を確認`;
  return { summary: errors.length ? `${summary}、エラー: ${errors.join(" / ")}` : summary };
}
