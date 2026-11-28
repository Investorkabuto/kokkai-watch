/**
 * 話題の検知: ニュース RSS の見出しから法律名を抽出し、topics / topic_mentions に保存する。
 * 見出しと URL だけを使い、記事本文は取得しない。
 */
import { extractLawTerms, NEWS_FEEDS, parseFeed, stripSourceSuffix, topicIdFor } from "@kokkai-watch/core";
import { fetchText, nowIso, sha1Hex, writeJsonRows, type Env, type JobResult } from "../util";

/** 話題として数える期間 */
const WINDOW_MS = 48 * 3600_000;
/** candidate → open に昇格する見出し数 */
const OPEN_THRESHOLD = 3;

interface Mention {
  topicId: string;
  keyword: string;
  headline: string;
  url: string;
  source: string;
  publishedAt: string;
}

export async function collectTopics(env: Env): Promise<JobResult> {
  const now = nowIso();
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();

  const results = await Promise.allSettled(
    NEWS_FEEDS.map(async (f) => ({ source: f.source, items: parseFeed(await fetchText(f.url)) })),
  );

  const errors: string[] = [];
  const mentions: Mention[] = [];
  const seen = new Set<string>();
  let headlines = 0;
  for (const [i, r] of results.entries()) {
    if (r.status === "rejected") {
      errors.push(`${NEWS_FEEDS[i]!.source}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      continue;
    }
    for (const item of r.value.items) {
      // 公開日時がない、または古い見出しは使わない
      if (!item.publishedAt || item.publishedAt < cutoff) continue;
      headlines++;
      const headline = stripSourceSuffix(item.title);
      for (const keyword of extractLawTerms(item.title)) {
        const topicId = await topicIdFor(keyword);
        const key = `${topicId}\n${item.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mentions.push({ topicId, keyword, headline, url: item.url, source: r.value.source, publishedAt: item.publishedAt });
      }
    }
  }

  // topics を UPSERT(既存の status は変えない)し、見出しを保存する
  const topics = new Map<string, string>();
  for (const m of mentions) topics.set(m.topicId, m.keyword);
  // D1 のクエリ数: 話題の UPSERT 1 + 見出し 1 + 集計 1 + 更新 1(+ runJob の記録 2)
  await writeJsonRows(
    env.DB,
    `INSERT INTO topics (id, keyword, origin, status, first_seen_at, last_seen_at)
     SELECT value->>'$.id', value->>'$.keyword', 'news', 'candidate', ?2, ?2
     FROM json_each(?1) WHERE true
     ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    [...topics].map(([id, keyword]) => ({ id, keyword })),
    [now],
  );
  const mentionRows: Record<string, unknown>[] = [];
  for (const m of mentions) {
    mentionRows.push({
      id: await sha1Hex(m.topicId + m.url),
      topicId: m.topicId,
      headline: m.headline,
      url: m.url,
      source: m.source,
      publishedAt: m.publishedAt,
    });
  }
  await writeJsonRows(
    env.DB,
    `INSERT OR IGNORE INTO topic_mentions (id, topic_id, headline, url, source, published_at, seen_at)
     SELECT value->>'$.id', value->>'$.topicId', value->>'$.headline', value->>'$.url', value->>'$.source',
       value->>'$.publishedAt', ?2
     FROM json_each(?1)`,
    mentionRows,
    [now],
  );

  // 今回出てきた話題だけ、直近48時間の見出し数で score を更新する(インデックス topic_id, published_at を使う)
  const ids = [...topics.keys()];
  const counts = new Map<string, number>();
  if (ids.length) {
    const { results: rows } = await env.DB.prepare(
      `SELECT topic_id, count(DISTINCT url) AS n FROM topic_mentions
       WHERE topic_id IN (SELECT value FROM json_each(?1)) AND published_at >= ?2
       GROUP BY topic_id`,
    )
      .bind(JSON.stringify(ids), cutoff)
      .all<{ topic_id: string; n: number }>();
    for (const r of rows) counts.set(r.topic_id, r.n);
  }
  let opened = 0;
  for (const n of counts.values()) if (n >= OPEN_THRESHOLD) opened++;
  await writeJsonRows(
    env.DB,
    `UPDATE topics SET score = j.n, mention_count = j.n, last_seen_at = ?2,
       status = CASE WHEN topics.status = 'candidate' AND j.n >= ?3 THEN 'open' ELSE topics.status END
     FROM (SELECT value->>'$.id' AS id, value->>'$.n' AS n FROM json_each(?1)) AS j
     WHERE topics.id = j.id`,
    [...counts].map(([id, n]) => ({ id, n })),
    [now, OPEN_THRESHOLD],
  );

  const summary = `見出し ${headlines} 件から法律名 ${topics.size} 件(${OPEN_THRESHOLD} 件以上の見出し: ${opened} 件)`;
  return { summary: errors.length ? `${summary}、エラー: ${errors.join(" / ")}` : summary };
}
