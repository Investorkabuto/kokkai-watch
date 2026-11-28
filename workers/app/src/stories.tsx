/** 特集(話題の法律の経緯)の公開ページと誤りの報告 */
import type { Sentence, StorySubmission } from "@kokkai-watch/core";
import type { Hono } from "hono";
import type { Env } from "./db";
import { lastUpdated } from "./db";
import { formatDay, Layout } from "./layout";
import {
  addCorrection,
  getBillTitles,
  getStoryBySlug,
  getStorySources,
  listPublishedStories,
  parseContent,
  reporterHash,
  type ReportResult,
  type StoryRow,
  type StorySourceRow,
  type StorySummary,
} from "./storiesDb";

const KIND_LABEL: Record<string, string> = {
  speech: "会議録の発言",
  bill: "法案",
  bill_event: "審議経過",
  announcement: "省庁の発表",
};

const BILL_ID_RE = /^\d+-[a-z]+-\d+$/;

/** 出典から関連する法案 ID を取り出す(bill / bill_event のみ) */
function billIdOf(s: StorySourceRow): string | null {
  if (s.kind === "bill") return BILL_ID_RE.test(s.ref_id) ? s.ref_id : null;
  if (s.kind !== "bill_event") return null;
  try {
    const meta = s.meta_json ? (JSON.parse(s.meta_json) as { bill_id?: string }) : null;
    if (meta?.bill_id && BILL_ID_RE.test(meta.bill_id)) return meta.bill_id;
  } catch {
    // meta_json が壊れていても続行
  }
  if (BILL_ID_RE.test(s.ref_id)) return s.ref_id;
  return s.id.match(/^src_be_(\d+-[a-z]+-\d+)_/)?.[1] ?? null;
}

/** ISO 日時 → YYYY-MM-DD(日本時間) */
function jstDate(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
}

/** ページ内で同じ出典に同じ番号を振る(登場順) */
function numberCitations(story: StorySubmission) {
  const numbers = new Map<string, number>();
  const quotes = new Map<string, string[]>();
  const visit = (sentences: Sentence[]) => {
    for (const s of sentences) {
      for (const c of s.citations) {
        if (!numbers.has(c.source_id)) numbers.set(c.source_id, numbers.size + 1);
        if (c.quote) {
          const q = quotes.get(c.source_id) ?? [];
          if (!q.includes(c.quote)) q.push(c.quote);
          quotes.set(c.source_id, q);
        }
      }
    }
  };
  visit(story.lead);
  for (const it of story.items) visit(it.sentences);
  for (const p of story.perspectives) visit(p.sentences);
  return { numbers, quotes };
}

function SentenceText({ s, numbers }: { s: Sentence; numbers: Map<string, number> }) {
  const nums = [...new Set(s.citations.map((c) => numbers.get(c.source_id)!))].sort((a, b) => a - b);
  return (
    <>
      {s.text}
      {nums.map((n) => (
        <a class="cite" href={`#src-${n}`} aria-label={`出典${n}`}>
          {n}
        </a>
      ))}
    </>
  );
}

function Paragraphs({ sentences, numbers }: { sentences: Sentence[]; numbers: Map<string, number> }) {
  return (
    <>
      {sentences.map((s) => (
        <p>
          <SentenceText s={s} numbers={numbers} />
        </p>
      ))}
    </>
  );
}

function AiBadge() {
  return (
    <div>
      <span class="ai-badge">AI生成</span>
      <p class="ai-note">
        この記事は AI が一次資料のみをもとに作成し、自動検証に合格したものです。
        <a href="/about">仕組みについて</a>
      </p>
    </div>
  );
}

export function StoryCard({ s }: { s: StorySummary }) {
  return (
    <a class="feature" href={`/stories/${s.slug}`}>
      <span class="ai-badge">特集</span>
      <div class="t">{s.title}</div>
      {s.lead && <div class="l">{s.lead}</div>}
    </a>
  );
}

function StoriesPage(p: { updated: string | null; stories: StorySummary[] }) {
  return (
    <Layout tab="home" title="特集" updated={p.updated} description="話題の法律が、どのような議論を経て生まれたのかを一次資料でたどる特集。">
      <h1>特集</h1>
      <p class="lead">話題の法律が、どのような議論を経て生まれたのかを一次資料でたどります。</p>
      {p.stories.length === 0 && <p class="empty">公開中の特集はまだありません</p>}
      {p.stories.map((s) => (
        <a class="feature" href={`/stories/${s.slug}`}>
          <div class="t" style="margin-top:0">
            {s.title}
          </div>
          {s.lead && <div class="l">{s.lead}</div>}
          <div class="s" style="font-size:12px;color:var(--muted);margin-top:6px">
            更新 {formatDay(jstDate(s.updated_at), true)} · 第{s.version}版
          </div>
        </a>
      ))}
    </Layout>
  );
}

function StoryPage(p: {
  updated: string | null;
  row: StoryRow;
  story: StorySubmission;
  sources: Map<string, StorySourceRow>;
  billTitles: Map<string, string>;
}) {
  const { row, story, sources } = p;
  const { numbers, quotes } = numberCitations(story);
  const ordered = [...numbers.entries()].sort((a, b) => a[1] - b[1]);
  const leadText = story.lead.map((s) => s.text).join("");
  const description = leadText.length > 120 ? leadText.slice(0, 119) + "…" : leadText;
  const bills = [...new Set([...sources.values()].map(billIdOf).filter((x): x is string => !!x))];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: story.title,
    description,
    datePublished: row.published_at,
    dateModified: row.updated_at,
    inLanguage: "ja",
    author: { "@type": "Organization", name: "kokkai-watch(AI による自動作成)" },
    isBasedOn: ordered.map(([id]) => sources.get(id)?.url).filter(Boolean),
  };

  return (
    <Layout tab="home" title={story.title} description={description} updated={p.updated} ogType="article" jsonLd={jsonLd}>
      <div style="margin-top:20px">
        <AiBadge />
      </div>
      <h1>{story.title}</h1>
      <div class="s" style="font-size:12px;color:var(--muted)">
        更新 {formatDay(jstDate(row.updated_at), true)} · 第{row.version}版
      </div>
      <div class="story-lead">
        <Paragraphs sentences={story.lead} numbers={numbers} />
      </div>

      <h2>経緯</h2>
      <div class="card">
        <ol class="story-items">
          {story.items.map((it) => (
            <li>
              <div class="d">{formatDay(it.date, true)}</div>
              <h3>{it.heading}</h3>
              <Paragraphs sentences={it.sentences} numbers={numbers} />
            </li>
          ))}
        </ol>
      </div>

      {story.perspectives.length > 0 && (
        <>
          <h2>議論の論点</h2>
          <p class="lead">審議などで示された主な立場です。並び順に優劣はありません。</p>
          <div class="persp">
            {story.perspectives.map((pp) => (
              <div class="card">
                <h3>{pp.stance}</h3>
                <Paragraphs sentences={pp.sentences} numbers={numbers} />
              </div>
            ))}
          </div>
        </>
      )}

      {bills.length > 0 && (
        <>
          <h2>関連する法案</h2>
          {bills.map((id) => (
            <a class="btn" href={`/bills/${id}`}>
              {p.billTitles.get(id) ?? id} の審議状況 →
            </a>
          ))}
        </>
      )}

      <h2>出典</h2>
      <div class="card">
        <ol class="sources">
          {ordered.map(([id, n]) => {
            const s = sources.get(id);
            return (
              <li id={`src-${n}`}>
                <span class="n">[{n}]</span>
                {s ? (
                  <>
                    <span class="k">
                      {KIND_LABEL[s.kind] ?? s.kind}
                      {s.date && ` · ${formatDay(s.date, true)}`}
                    </span>
                    <div>
                      <a href={s.url} target="_blank" rel="noopener">
                        {s.title} ↗
                      </a>
                    </div>
                  </>
                ) : (
                  <span class="k">出典情報を取得できませんでした({id})</span>
                )}
                {(quotes.get(id) ?? []).map((q) => (
                  <blockquote>{q}</blockquote>
                ))}
              </li>
            );
          })}
        </ol>
      </div>

      <h2>誤りを報告</h2>
      <form class="report" method="post" action={`/stories/${row.slug}/report`}>
        <p class="lead">一次資料と食い違う点などがあればお知らせください(10〜2000文字)。複数の報告があった記事は確認のため一時的に非公開になります。</p>
        <textarea name="body" required minlength={10} maxlength={2000} placeholder="どの部分が、どの資料とどう違うか" />
        <button type="submit">報告する</button>
      </form>
    </Layout>
  );
}

function WithdrawnPage(p: { updated: string | null; row: StoryRow }) {
  return (
    <Layout tab="home" title={p.row.title} updated={p.updated}>
      <h1>{p.row.title}</h1>
      <div class="notice">この記事は誤りの報告を受けて確認中です。確認が終わるまで本文を非公開にしています。</div>
      <a class="btn" href="/stories">
        ほかの特集を見る
      </a>
    </Layout>
  );
}

const REPORT_MESSAGE: Record<ReportResult, string> = {
  accepted: "報告を受け付けました。ご協力ありがとうございます。",
  duplicate: "この記事への報告は本日すでに受け付けています。ご協力ありがとうございます。",
  withdrawn: "報告を受け付けました。複数の報告があったため、この記事は確認のため一時的に非公開になりました。",
};

function ReportDonePage(p: { slug: string; title: string; message: string; error?: boolean }) {
  return (
    <Layout tab="home" title="誤りの報告">
      <h1>{p.error ? "報告を送信できませんでした" : "報告を受け付けました"}</h1>
      <div class={p.error ? "notice" : "card"}>{p.message}</div>
      <a class="btn" href={`/stories/${p.slug}`}>
        「{p.title}」に戻る
      </a>
    </Layout>
  );
}

export function registerStoryRoutes(app: Hono<{ Bindings: Env }>) {
  app.get("/stories", async (c) => {
    const [updated, stories] = await Promise.all([lastUpdated(c.env.DB), listPublishedStories(c.env.DB)]);
    return c.html(<StoriesPage updated={updated} stories={stories} />);
  });

  app.get("/stories/:slug", async (c) => {
    const [updated, row] = await Promise.all([lastUpdated(c.env.DB), getStoryBySlug(c.env.DB, c.req.param("slug"))]);
    if (!row) return c.notFound();
    if (row.status !== "published") return c.html(<WithdrawnPage updated={updated} row={row} />);
    const story = parseContent(row);
    if (!story) return c.notFound();
    const sources = await getStorySources(c.env.DB, row.id);
    const billIds = [...new Set([...sources.values()].map(billIdOf).filter((x): x is string => !!x))];
    const billTitles = await getBillTitles(c.env.DB, billIds);
    return c.html(<StoryPage updated={updated} row={row} story={story} sources={sources} billTitles={billTitles} />);
  });

  app.post("/stories/:slug/report", async (c) => {
    c.header("Cache-Control", "no-store");
    const row = await getStoryBySlug(c.env.DB, c.req.param("slug"));
    if (!row) return c.notFound();
    const form = await c.req.parseBody();
    const body = typeof form.body === "string" ? form.body.trim() : "";
    if (body.length < 10 || body.length > 2000) {
      return c.html(
        <ReportDonePage slug={row.slug} title={row.title} message="報告は10〜2000文字で入力してください。" error />,
        400,
      );
    }
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const today = jstDate(new Date().toISOString());
    const result = await addCorrection(c.env.DB, row, body, await reporterHash(ip, today));
    return c.html(<ReportDonePage slug={row.slug} title={row.title} message={REPORT_MESSAGE[result]} />);
  });
}
