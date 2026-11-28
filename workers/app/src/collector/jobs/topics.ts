/**
 * 話題の検知: ニュース RSS の見出しから法律名を抽出し、topics / topic_mentions に保存する。
 * 見出しと URL だけを使い、記事本文は取得しない。
 */
import { extractLawTerms, NEWS_FEEDS, parseFeed, stripSourceSuffix, topicIdFor } from "@kokkai-watch/core";
import { batchInChunks, fetchText, nowIso, sha1Hex, type Env, type JobResult } from "../util";

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
  const stmts: D1PreparedStatement[] = [];
  for (const [id, keyword] of topics) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO topics (id, keyword, origin, status, first_seen_at, last_seen_at)
         VALUES (?, ?, 'news', 'candidate', ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      ).bind(id, keyword, now, now),
    );
  }
  for (const m of mentions) {
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO topic_mentions (id, topic_id, headline, url, source, published_at, seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(await sha1Hex(m.topicId + m.url), m.topicId, m.headline, m.url, m.source, m.publishedAt, now),
    );
  }
  await batchInChunks(env.DB, stmts);

  // 今回出てきた話題だけ、直近48時間の見出し数で score を更新する(インデックス topic_id, published_at を使う)
  const ids = [...topics.keys()];
  const counts = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 50) {
    const rows = await env.DB.batch<{ topic_id: string; n: number }>(
      ids.slice(i, i + 50).map((id) =>
        env.DB.prepare(
          "SELECT ? AS topic_id, count(DISTINCT url) AS n FROM topic_mentions WHERE topic_id = ? AND published_at >= ?",
        ).bind(id, id, cutoff),
      ),
    );
    for (const r of rows) {
      const row = r.results[0];
      if (row) counts.set(row.topic_id, row.n);
    }
  }
  let opened = 0;
  const updates: D1PreparedStatement[] = [];
  for (const [id, n] of counts) {
    if (n >= OPEN_THRESHOLD) opened++;
    updates.push(
      env.DB.prepare(
        `UPDATE topics SET score = ?, mention_count = ?, last_seen_at = ?,
           status = CASE WHEN status = 'candidate' AND ? >= ? THEN 'open' ELSE status END
         WHERE id = ?`,
      ).bind(n, n, now, n, OPEN_THRESHOLD, id),
    );
  }
  await batchInChunks(env.DB, updates);

  const summary = `見出し ${headlines} 件から法律名 ${topics.size} 件(${OPEN_THRESHOLD} 件以上の見出し: ${opened} 件)`;
  return { summary: errors.length ? `${summary}、エラー: ${errors.join(" / ")}` : summary };
}
