/**
 * Muse(AI)向けの Ingest API。`/ingest/v1` にマウントする。
 * すべてのエンドポイントで `Authorization: Bearer <INGEST_TOKEN>` が必要。
 * 投稿された記事は一次資料と照合して自動検証し、合格したものだけを公開する。
 */
import { topicIdFor, verifyStory, type SourceForVerify, type SourceKind } from "@kokkai-watch/core";
import { Hono } from "hono";
import { collectSourcesForTopic } from "./collector/jobs/sources";
import type { Env } from "./db";

/** リクエストボディの上限 */
const MAX_BODY_BYTES = 256 * 1024;

export const ingestApp = new Hono<{ Bindings: Env }>();

const nowIso = () => new Date().toISOString();

/** 定数時間で文字列を比較する(トークンの照合用) */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// ---- 認証 ----
ingestApp.use("*", async (c, next) => {
  const expected = c.env.INGEST_TOKEN;
  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !safeEqual(token, expected)) {
    return c.json(
      { error: "unauthorized", message: "Authorization: Bearer <INGEST_TOKEN> ヘッダーが必要です。トークンが正しいか確認してください。" },
      401,
    );
  }
  await next();
});

/** JSON ボディを上限つきで読む */
async function readJsonBody(req: Request): Promise<{ ok: true; value: unknown; raw: string } | { ok: false; status: 400 | 413; message: string }> {
  const len = Number(req.headers.get("Content-Length") ?? "0");
  if (len > MAX_BODY_BYTES) {
    return { ok: false, status: 413, message: `リクエストが大きすぎます(上限 ${MAX_BODY_BYTES / 1024}KB)。記事を短くしてください。` };
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, message: `リクエストが大きすぎます(上限 ${MAX_BODY_BYTES / 1024}KB)。記事を短くしてください。` };
  }
  try {
    return { ok: true, value: JSON.parse(raw), raw };
  } catch {
    return { ok: false, status: 400, message: "ボディを JSON として解釈できませんでした。Content-Type: application/json で正しい JSON を送ってください。" };
  }
}

// ---- 執筆ガイド ----
const GUIDE = `# kokkai-watch 特集記事 執筆ガイド(AI 向け)

kokkai-watch は、話題になった法律が「どういう経緯で生まれたか」を、国会会議録などの一次資料だけを根拠に時系列で示すサイトです。
あなた(AI)が書いた記事は、サーバーが一次資料と機械的に照合し、合格したものだけが「AI生成」と明記して公開されます。

## 手順

1. \`GET /ingest/v1/topics?status=open\` で執筆すべき話題を取得する(score の高い順)。
   - 話題を自分で追加したい場合は \`POST /ingest/v1/topics\` に \`{"keyword": "法律名"}\` を送る。資料が自動で集められる。
2. \`GET /ingest/v1/topics/{id}/sources?offset=0&limit=50\` で、その話題に使ってよい一次資料を **すべて** 取得する(\`next_offset\` が null になるまで繰り返す)。
   - 資料が少なすぎる場合は \`POST /ingest/v1/topics/{id}/collect\` で再収集できる。
3. 取得した資料 **だけ** を根拠に記事を書く。資料にないことは書かない。
4. \`POST /ingest/v1/stories\` に下記の JSON を送る。
   - 201: 合格して公開された(\`url\` が記事のページ)。
   - 422: 不合格。\`issues\` の \`path\` と \`message\` を読み、該当箇所を直して **同じ topic_id で再投稿** する。
5. 審議が進んだら、同じ topic_id で再投稿すれば記事が更新される(version が上がる)。

## JSON の形式

\`\`\`json
{
  "topic_id": "tp_0123456789ab",
  "writer": "muse",
  "title": "○○法は、どのような議論を経て生まれたのか",
  "lead": [
    { "text": "○○法案は2026年10月に国会へ提出された。", "citations": [{ "source_id": "src_be_222-kaku-1_received_衆議院" }] }
  ],
  "items": [
    {
      "date": "2026-11-05",
      "heading": "参議院法務委員会で質疑",
      "sentences": [
        {
          "text": "仁比聡平議員(日本共産党)は「性暴力という用語を」めぐって大臣にただした。",
          "citations": [{ "source_id": "src_sp_122215206X00320261105_123", "quote": "性暴力という用語を" }]
        }
      ]
    }
  ],
  "perspectives": [
    { "stance": "賛成", "sentences": [{ "text": "…", "citations": [{ "source_id": "src_sp_…", "quote": "…" }] }] },
    { "stance": "反対・慎重", "sentences": [{ "text": "…", "citations": [{ "source_id": "src_sp_…", "quote": "…" }] }] }
  ]
}
\`\`\`

- \`lead\`: 記事の要約(1〜3文)。
- \`items\`: 時系列の項目(3件以上、日付の古い順)。\`date\` は YYYY-MM-DD。
- \`perspectives\`: 審議で出た立場ごとの主張(2つ以上の立場)。
- \`citations[].source_id\`: sources の \`id\`。\`quote\` は任意だが、書く場合は資料の \`body\` からの **一字一句そのままの抜き出し**。

## ルール

- **出典のない文は書かない。** すべての文に1つ以上の \`citations\` を付ける。
- **引用は原文どおり。** 文中の「」内の発言や \`quote\` は、資料の本文と完全に一致させる(空白・改行の違いのみ許容)。
- **AI 自身の意見・評価・推測を書かない。** 「〜と考えられる」「〜すべきだ」「画期的な」なども避ける。
- **両論を併記する。** 審議で出た賛成と反対(慎重)の主張を、それぞれ会議録の発言から引用する。
- **発言者を取り違えない。** 文中に議員名を書く場合、その文の出典はその議員の発言にする。
- **日付は出典と一致させる。** 各項目の \`date\` は、その項目で引用した資料のいずれかの日付と同じにする。
- **見出し・タイトル**: 興味を引く型(「実は○年前から議論されていた」など)は可。ただし煽り・断定・特定の政党や人物への非難(「○○党が隠していた」など)は不可。
- **センシティブなテーマ**(性犯罪、差別、災害、事件の被害など)では、被害を軽く扱う表現や刺激の強い描写を避け、事実と制度の説明に徹する。
- **禁止表現**: 侮辱・罵倒、断定的な非難、扇情的な語(例: 売国、隠蔽、暴挙、最悪、許せない、嘘つき など)。

## 自動検証の項目

| code | 内容 |
|---|---|
| schema | JSON の形式・必須項目・件数(items 3件以上、perspectives 2つ以上 など) |
| missing_citation | 出典のない文がある |
| unknown_source | source_id が存在しない、またはこの話題の資料ではない |
| quote_mismatch | quote や「」内の引用が出典の本文と一致しない |
| date_mismatch | 項目の日付が、その項目の出典の日付と一致しない |
| speaker_mismatch | 文中の発言者名が、その文の出典の発言者と一致しない |
| perspectives | 立場が2つ未満、または立場ごとの主張に出典がない |
| banned_expression | 禁止表現を含む |

不合格の場合は \`issues\` に、どこ(\`path\`、例: \`items[2].sentences[0]\`)が、なぜ不合格か(\`message\`)が入ります。
`;

ingestApp.get("/guide", (c) => c.body(GUIDE, 200, { "Content-Type": "text/markdown; charset=utf-8" }));

// ---- 話題 ----
const TOPIC_STATUSES = new Set(["open", "candidate", "published", "all"]);

interface TopicRow {
  id: string;
  keyword: string;
  origin: string;
  status: string;
  score: number;
  mention_count: number;
  first_seen_at: string;
  last_seen_at: string;
  sources_collected_at: string | null;
  source_count: number;
  story_slug: string | null;
  story_version: number | null;
}

const TOPIC_SELECT = `SELECT t.id, t.keyword, t.origin, t.status, t.score, t.mention_count, t.first_seen_at, t.last_seen_at,
    t.sources_collected_at,
    (SELECT count(*) FROM topic_sources ts WHERE ts.topic_id = t.id) AS source_count,
    s.slug AS story_slug, s.version AS story_version
  FROM topics t LEFT JOIN stories s ON s.topic_id = t.id AND s.status = 'published'`;

async function topicHeadlines(db: D1Database, ids: string[]): Promise<Map<string, { headline: string; url: string }[]>> {
  const map = new Map<string, { headline: string; url: string }[]>();
  if (ids.length === 0) return map;
  // 話題ごとに新しい見出し3件
  const { results } = await db
    .prepare(
      `SELECT topic_id, headline, url FROM (
         SELECT topic_id, headline, url,
           row_number() OVER (PARTITION BY topic_id ORDER BY published_at DESC) AS rn
         FROM topic_mentions WHERE topic_id IN (${ids.map(() => "?").join(",")})
       ) WHERE rn <= 3`,
    )
    .bind(...ids)
    .all<{ topic_id: string; headline: string; url: string }>();
  for (const r of results) {
    const list = map.get(r.topic_id) ?? [];
    list.push({ headline: r.headline, url: r.url });
    map.set(r.topic_id, list);
  }
  return map;
}

function topicJson(t: TopicRow, headlines: { headline: string; url: string }[] = []) {
  return {
    id: t.id,
    keyword: t.keyword,
    origin: t.origin,
    status: t.status,
    score: t.score,
    mention_count: t.mention_count,
    first_seen_at: t.first_seen_at,
    last_seen_at: t.last_seen_at,
    sources_collected_at: t.sources_collected_at,
    source_count: t.source_count,
    story: t.story_slug ? { url: `/stories/${t.story_slug}`, version: t.story_version } : null,
    headlines,
  };
}

async function getTopic(db: D1Database, id: string): Promise<TopicRow | null> {
  return db.prepare(`${TOPIC_SELECT} WHERE t.id = ?`).bind(id).first<TopicRow>();
}

ingestApp.get("/topics", async (c) => {
  const status = c.req.query("status") ?? "open";
  if (!TOPIC_STATUSES.has(status)) {
    return c.json({ error: "bad_request", message: "status は open / candidate / published / all のいずれかを指定してください。" }, 400);
  }
  const stmt =
    status === "all"
      ? c.env.DB.prepare(`${TOPIC_SELECT} ORDER BY t.score DESC, t.last_seen_at DESC LIMIT 50`)
      : c.env.DB.prepare(`${TOPIC_SELECT} WHERE t.status = ? ORDER BY t.score DESC, t.last_seen_at DESC LIMIT 50`).bind(status);
  const { results } = await stmt.all<TopicRow>();
  const headlines = await topicHeadlines(c.env.DB, results.map((t) => t.id));
  return c.json({ topics: results.map((t) => topicJson(t, headlines.get(t.id))) });
});

ingestApp.post("/topics", async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (!body.ok) return c.json({ error: "bad_request", message: body.message }, body.status);
  const keywordRaw = (body.value as { keyword?: unknown })?.keyword;
  if (typeof keywordRaw !== "string") {
    return c.json({ error: "bad_request", message: '{"keyword": "法律名"} の形式で送ってください。' }, 400);
  }
  const keyword = keywordRaw.normalize("NFKC").trim();
  if (keyword.length < 2 || keyword.length > 60) {
    return c.json({ error: "bad_request", message: "keyword は2〜60文字の法律名にしてください(例: 不同意性交等罪、定数削減法)。" }, 400);
  }
  const id = await topicIdFor(keyword);
  const existing = await getTopic(c.env.DB, id);
  if (existing) {
    return c.json({ created: false, topic: topicJson(existing), message: "この話題はすでに登録されています。" });
  }
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO topics (id, keyword, origin, score, mention_count, status, first_seen_at, last_seen_at)
     VALUES (?, ?, 'manual', 0, 0, 'open', ?, ?)`,
  )
    .bind(id, keyword, now, now)
    .run();
  let collect: { summary: string; count: number } | { error: string };
  try {
    collect = await collectSourcesForTopic(c.env, id);
  } catch (e) {
    collect = { error: `資料の収集に失敗しました: ${e instanceof Error ? e.message : String(e)}。POST /ingest/v1/topics/${id}/collect で再試行できます。` };
  }
  const topic = await getTopic(c.env.DB, id);
  return c.json({ created: true, topic: topic ? topicJson(topic) : { id, keyword }, collect }, 201);
});

ingestApp.post("/topics/:id/collect", async (c) => {
  const id = c.req.param("id");
  const topic = await getTopic(c.env.DB, id);
  if (!topic) return c.json({ error: "not_found", message: `話題 ${id} は存在しません。GET /ingest/v1/topics で ID を確認してください。` }, 404);
  try {
    const collect = await collectSourcesForTopic(c.env, id);
    const updated = await getTopic(c.env.DB, id);
    return c.json({ topic: updated ? topicJson(updated) : topicJson(topic), collect });
  } catch (e) {
    return c.json({ error: "collect_failed", message: `資料の収集に失敗しました: ${e instanceof Error ? e.message : String(e)}。時間をおいて再試行してください。` }, 502);
  }
});

const SOURCE_KINDS = new Set(["speech", "bill", "bill_event", "announcement"]);

ingestApp.get("/topics/:id/sources", async (c) => {
  const id = c.req.param("id");
  const topic = await c.env.DB.prepare("SELECT id FROM topics WHERE id = ?").bind(id).first();
  if (!topic) return c.json({ error: "not_found", message: `話題 ${id} は存在しません。GET /ingest/v1/topics で ID を確認してください。` }, 404);

  const kind = c.req.query("kind");
  if (kind && !SOURCE_KINDS.has(kind)) {
    return c.json({ error: "bad_request", message: "kind は speech / bill / bill_event / announcement のいずれかです。" }, 400);
  }
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20) || 20, 1), 50);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);

  const where = `ts.topic_id = ?${kind ? " AND s.kind = ?" : ""}`;
  const binds: unknown[] = kind ? [id, kind] : [id];
  const [countRow, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT count(*) AS n FROM topic_sources ts JOIN sources s ON s.id = ts.source_id WHERE ${where}`)
      .bind(...binds)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT s.id, s.kind, s.title, s.date, s.url, s.speaker, s.body
       FROM topic_sources ts JOIN sources s ON s.id = ts.source_id
       WHERE ${where} ORDER BY s.date DESC, s.id LIMIT ? OFFSET ?`,
    )
      .bind(...binds, limit, offset)
      .all(),
  ]);
  const total = countRow?.n ?? 0;
  const next = offset + rows.results.length;
  return c.json({ topic_id: id, total, offset, limit, next_offset: next < total ? next : null, sources: rows.results });
});

// ---- 記事の投稿 ----
interface SourceRow {
  id: string;
  kind: SourceKind;
  date: string | null;
  title: string;
  body: string;
  speaker: string | null;
}

ingestApp.post("/stories", async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (!body.ok) return c.json({ error: "bad_request", message: body.message }, body.status);
  const input = body.value as { topic_id?: unknown; writer?: unknown };
  const topicId = typeof input?.topic_id === "string" ? input.topic_id : "";
  const writer = typeof input?.writer === "string" && input.writer.trim() ? input.writer.trim().slice(0, 40) : "muse";

  const topic = topicId ? await c.env.DB.prepare("SELECT id, keyword FROM topics WHERE id = ?").bind(topicId).first<{ id: string; keyword: string }>() : null;
  if (!topic) {
    return c.json(
      { error: "not_found", message: `topic_id「${topicId}」の話題が存在しません。GET /ingest/v1/topics で取得した id を topic_id に指定してください。` },
      404,
    );
  }

  // 対象の話題に紐づく資料だけを読み込む
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.kind, s.date, s.title, s.body, s.speaker
     FROM topic_sources ts JOIN sources s ON s.id = ts.source_id WHERE ts.topic_id = ?`,
  )
    .bind(topicId)
    .all<SourceRow>();
  const sources = new Map<string, SourceForVerify>();
  for (const r of results) sources.set(r.id, r);

  const result = verifyStory(body.value, sources, topicId);
  const now = nowIso();

  if (!result.passed || !result.story) {
    const sub = await c.env.DB.prepare(
      `INSERT INTO story_submissions (topic_id, writer, payload, passed, issues_json, created_at)
       VALUES (?, ?, ?, 0, ?, ?) RETURNING id`,
    )
      .bind(topicId, writer, body.raw, JSON.stringify(result.issues), now)
      .first<{ id: number }>();
    return c.json(
      {
        passed: false,
        submission_id: sub?.id ?? null,
        message: "自動検証に不合格でした。issues の path と message を読んで該当箇所を直し、同じ topic_id で再投稿してください。",
        issues: result.issues,
      },
      422,
    );
  }

  const story = result.story;
  const key = topicId.replace(/^tp_/, "");
  const storyId = `st_${key}`;
  const slug = key;
  const citedIds = new Set<string>();
  const collect = (sentences: { citations: { source_id: string }[] }[]) => {
    for (const s of sentences) for (const ci of s.citations) citedIds.add(ci.source_id);
  };
  collect(story.lead);
  for (const it of story.items) collect(it.sentences);
  for (const p of story.perspectives) collect(p.sentences);

  const existing = await c.env.DB.prepare("SELECT version FROM stories WHERE id = ?").bind(storyId).first<{ version: number }>();
  const version = existing ? existing.version + 1 : 1;
  const contentJson = JSON.stringify({ ...story, writer: story.writer ?? writer });

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO stories (id, slug, topic_id, title, content_json, status, writer, version, published_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, content_json = excluded.content_json, status = 'published',
         writer = excluded.writer, version = excluded.version, updated_at = excluded.updated_at`,
    ).bind(storyId, slug, topicId, story.title, contentJson, writer, version, now, now),
    c.env.DB.prepare("DELETE FROM story_citations WHERE story_id = ?").bind(storyId),
    ...[...citedIds].map((sid) => c.env.DB.prepare("INSERT INTO story_citations (story_id, source_id) VALUES (?, ?)").bind(storyId, sid)),
    c.env.DB.prepare("UPDATE topics SET status = 'published' WHERE id = ?").bind(topicId),
    c.env.DB.prepare(
      `INSERT INTO story_submissions (topic_id, writer, payload, passed, issues_json, story_id, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
    ).bind(topicId, writer, body.raw, JSON.stringify(result.issues), storyId, now),
  ];
  const res = await c.env.DB.batch(stmts);
  const submissionId = res.at(-1)?.meta.last_row_id ?? null;

  return c.json({ passed: true, story_id: storyId, url: `/stories/${slug}`, version, submission_id: submissionId }, 201);
});

ingestApp.get("/submissions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad_request", message: "submission の id は正の整数です。" }, 400);
  const row = await c.env.DB.prepare(
    "SELECT id, topic_id, writer, passed, issues_json, story_id, created_at FROM story_submissions WHERE id = ?",
  )
    .bind(id)
    .first<{ id: number; topic_id: string; writer: string; passed: number; issues_json: string; story_id: string | null; created_at: string }>();
  if (!row) return c.json({ error: "not_found", message: `投稿 ${id} は存在しません。` }, 404);
  return c.json({
    id: row.id,
    topic_id: row.topic_id,
    writer: row.writer,
    passed: row.passed === 1,
    issues: JSON.parse(row.issues_json),
    story_id: row.story_id,
    created_at: row.created_at,
  });
});

ingestApp.notFound((c) =>
  c.json({ error: "not_found", message: "このエンドポイントはありません。GET /ingest/v1/guide で使い方を確認してください。" }, 404),
);

ingestApp.onError((err, c) => {
  console.error("[ingest]", err);
  return c.json({ error: "internal_error", message: "サーバーでエラーが発生しました。時間をおいて再試行してください。" }, 500);
});
