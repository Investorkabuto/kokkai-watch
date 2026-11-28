import { buildProgress, STAGE_LABEL, type BillStage } from "@kokkai-watch/core";
import type { AnnouncementRow, BillEventRow, BillFilter, BillRow, MeetingRow, TimelineItem, TimelineKind } from "./db";
import { formatDay, Layout } from "./layout";
import { StoryCard } from "./stories";
import type { StorySummary } from "./storiesDb";

function BillRowItem({ b }: { b: BillRow }) {
  return (
    <li>
      <a class="row" href={`/bills/${b.id}`}>
        <div class="t">{b.title}</div>
        <div class="s">
          <span class={`chip ${b.status}`}>{b.status_text}</span>
          <span>
            {b.kind} 第{b.session}回 {b.number}号
          </span>
          {b.last_event_date && <span>{formatDay(b.last_event_date)}</span>}
        </div>
      </a>
    </li>
  );
}

function ExternalRow({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <li>
      <a class="row" href={href} target="_blank" rel="noopener">
        <div class="t">{title}</div>
        <div class="s">{sub}</div>
      </a>
    </li>
  );
}

export function HomePage(p: {
  updated: string | null;
  pending: BillRow[];
  passed: BillRow[];
  meetings: MeetingRow[];
  announcements: AnnouncementRow[];
  stories?: StorySummary[];
}) {
  return (
    <Layout tab="home" updated={p.updated}>
      <h1>国の動きを、ひとつのタイムラインで</h1>
      <p class="lead">国会の審議、法案の進み具合、各省庁の発表を一次資料から集めています。</p>

      {p.stories && p.stories.length > 0 && (
        <>
          <h2>
            特集 <a href="/stories">すべて見る</a>
          </h2>
          {p.stories.map((s) => (
            <StoryCard s={s} />
          ))}
        </>
      )}

      <h2>
        審議中の法案 <a href="/bills?status=pending">すべて見る</a>
      </h2>
      {p.pending.length ? (
        <ul class="list">
          {p.pending.map((b) => (
            <BillRowItem b={b} />
          ))}
        </ul>
      ) : (
        <p class="empty">審議中の法案はありません</p>
      )}

      <h2>
        最近成立した法律 <a href="/bills?status=passed">すべて見る</a>
      </h2>
      <ul class="list">
        {p.passed.map((b) => (
          <BillRowItem b={b} />
        ))}
      </ul>

      <h2>
        最近の会議 <a href="/timeline?kind=meeting">すべて見る</a>
      </h2>
      <ul class="list">
        {p.meetings.map((m) => (
          <ExternalRow href={m.url} title={`${m.house} ${m.name}`} sub={`${formatDay(m.date)} · ${m.issue} · 発言 ${m.speech_count} 件`} />
        ))}
      </ul>
      <p class="note">会議録は公開まで1〜2週間ほどかかります。</p>

      <h2>
        省庁の新着 <a href="/timeline?kind=announcement">すべて見る</a>
      </h2>
      <ul class="list">
        {p.announcements.map((a) => (
          <ExternalRow href={a.url} title={a.title} sub={`${a.ministry} · ${formatDay(a.date)}`} />
        ))}
      </ul>
    </Layout>
  );
}

const BILL_FILTERS: { id: BillFilter; label: string }[] = [
  { id: "pending", label: "審議中" },
  { id: "passed", label: "成立" },
  { id: "all", label: "すべて" },
];
const BILL_KINDS = ["閣法", "衆法", "参法", "条約"];

export function BillsPage(p: { updated: string | null; filter: BillFilter; kind?: string; bills: BillRow[] }) {
  const q = (filter: BillFilter, kind?: string) => `/bills?status=${filter}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`;
  return (
    <Layout tab="bills" title="法案" updated={p.updated} description="今国会の法案の一覧と、審議の進み具合。">
      <h1>法案</h1>
      <p class="lead">
        閣法は内閣が、衆法・参法は議員が提出した法律案です。一覧は衆議院の議案情報にもとづきます。
      </p>
      <div class="tabs">
        {BILL_FILTERS.map((f) => (
          <a href={q(f.id, p.kind)} class={p.filter === f.id ? "on" : ""}>
            {f.label}
          </a>
        ))}
      </div>
      <div class="tabs">
        <a href={q(p.filter)} class={!p.kind ? "on" : ""}>
          全種類
        </a>
        {BILL_KINDS.map((k) => (
          <a href={q(p.filter, k)} class={p.kind === k ? "on" : ""}>
            {k}
          </a>
        ))}
      </div>
      {p.bills.length ? (
        <ul class="list">
          {p.bills.map((b) => (
            <BillRowItem b={b} />
          ))}
        </ul>
      ) : (
        <p class="empty">該当する法案はありません</p>
      )}
    </Layout>
  );
}

interface Vote {
  attitude: string | null;
  for: string[];
  against: string[];
}

function VoteBlock({ house, v }: { house: string; v: Vote | undefined }) {
  if (!v || (!v.attitude && !v.for.length && !v.against.length)) return null;
  return (
    <div class="card" style="margin-top:10px">
      <strong>{house}での採決</strong> {v.attitude && <span class="chip">{v.attitude}</span>}
      {v.for.length > 0 && (
        <div style="margin-top:8px">
          <div class="d" style="font-size:13px;color:var(--muted)">賛成</div>
          <div class="groups">
            {v.for.map((g) => (
              <span class="chip passed">{g}</span>
            ))}
          </div>
        </div>
      )}
      {v.against.length > 0 && (
        <div style="margin-top:8px">
          <div class="d" style="font-size:13px;color:var(--muted)">反対</div>
          <div class="groups">
            {v.against.map((g) => (
              <span class="chip rejected">{g}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function BillPage(p: { updated: string | null; bill: BillRow; events: BillEventRow[] }) {
  const { bill, events } = p;
  const progress = buildProgress(events.map((e) => ({ ...e, house: (e.house || null) as never })));
  const groups = parseJson<string[]>(bill.submitter_groups, []);
  const vote = parseJson<{ shugiin?: Vote; sangiin?: Vote }>(bill.vote_json, {});
  const shown = events.filter((e) => e.stage !== "preliminary_received");
  return (
    <Layout
      tab="bills"
      title={bill.title}
      updated={p.updated}
      description={`${bill.title}(${bill.kind} 第${bill.session}回国会 ${bill.number}号)の審議の進み具合: ${bill.status_text}`}
    >
      <h1>{bill.title}</h1>
      <div class="s" style="display:flex;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--muted)">
        <span class={`chip ${bill.status}`}>{bill.status_text}</span>
        <span class="chip">{bill.kind}</span>
        <span class="chip">
          第{bill.session}回国会 {bill.number}号
        </span>
        {bill.law_number && <span class="chip">法律第{bill.law_number}号</span>}
      </div>

      <div class="progress" role="list" aria-label="審議の進み具合">
        {progress.map((s) => (
          <div class={`step ${s.state}`} role="listitem" aria-label={`${s.label}: ${s.state === "done" ? (s.result ?? "済") : s.state === "failed" ? s.result : "未"}`}>
            <div class="bar" />
            {s.label}
          </div>
        ))}
      </div>

      <h2>基本情報</h2>
      <div class="card">
        <dl class="kv">
          <dt>提出者</dt>
          <dd>{bill.submitter ?? "—"}</dd>
          {groups.length > 0 && (
            <>
              <dt>提出会派</dt>
              <dd>{groups.join("、")}</dd>
            </>
          )}
          <dt>状態</dt>
          <dd>{bill.status_text}</dd>
        </dl>
      </div>

      <h2>審議の経過</h2>
      {shown.length ? (
        <div class="card">
          <ul class="events">
            {shown.map((e) => (
              <li>
                <div class="d">{formatDay(e.date, true)}</div>
                <div>
                  {e.house && `${e.house} `}
                  {STAGE_LABEL[e.stage as BillStage] ?? e.stage}
                  {e.committee && e.stage === "referred" && `(${e.committee}委員会)`}
                  {e.result && e.stage !== "promulgated" && ` — ${e.result}`}
                  {e.stage === "promulgated" && e.result && `(法律第${e.result}号)`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p class="empty">審議経過の情報はまだありません</p>
      )}

      <VoteBlock house="衆議院" v={vote.shugiin} />
      <VoteBlock house="参議院" v={vote.sangiin} />

      <h2>一次資料</h2>
      {bill.keika_url && (
        <a class="btn" href={bill.keika_url} target="_blank" rel="noopener">
          衆議院 審議経過情報を開く ↗
        </a>
      )}
      {bill.honbun_url && (
        <a class="btn" href={bill.honbun_url} target="_blank" rel="noopener">
          法律案の本文を開く ↗
        </a>
      )}
    </Layout>
  );
}

const KIND_TABS: { id: TimelineKind; label: string }[] = [
  { id: "all", label: "すべて" },
  { id: "bill", label: "法案" },
  { id: "meeting", label: "会議" },
  { id: "announcement", label: "省庁" },
];

const KIND_LABEL: Record<TimelineItem["kind"], string> = { bill: "法案", meeting: "会議", announcement: "省庁" };

export function TimelinePage(p: {
  updated: string | null;
  kind: TimelineKind;
  items: TimelineItem[];
  nextBefore: string | null;
}) {
  const days: [string, TimelineItem[]][] = [];
  for (const it of p.items) {
    const last = days.at(-1);
    if (last && last[0] === it.date) last[1].push(it);
    else days.push([it.date, [it]]);
  }
  return (
    <Layout tab="timeline" title="タイムライン" updated={p.updated} description="法案の審議、国会の会議、省庁の発表を時系列で。">
      <h1>タイムライン</h1>
      <div class="tabs">
        {KIND_TABS.map((t) => (
          <a href={`/timeline?kind=${t.id}`} class={p.kind === t.id ? "on" : ""}>
            {t.label}
          </a>
        ))}
      </div>
      {days.length === 0 && <p class="empty">まだデータがありません</p>}
      {days.map(([date, items]) => (
        <section>
          <div class="day">{formatDay(date, true)}</div>
          <ul class="list">
            {items.map((it) => (
              <li>
                <a class="row" href={it.href} {...(it.external ? { target: "_blank", rel: "noopener" } : {})}>
                  <div class="s" style="margin:0 0 2px">
                    <span>
                      <span class={`dot ${it.kind}`} />
                      {KIND_LABEL[it.kind]}
                    </span>
                    {it.stage && (
                      <span>
                        {STAGE_LABEL[it.stage]}
                        {it.result && it.stage !== "promulgated" ? ` — ${it.result}` : ""}
                      </span>
                    )}
                  </div>
                  <div class="t">{it.title}</div>
                  <div class="s">{it.sub}</div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {p.nextBefore && (
        <a class="btn" href={`/timeline?kind=${p.kind}&before=${p.nextBefore}`}>
          さらに前を見る
        </a>
      )}
    </Layout>
  );
}

export function AboutPage(p: { updated: string | null }) {
  return (
    <Layout tab="about" title="このサイトについて" updated={p.updated}>
      <h1>このサイトについて</h1>
      <div class="card">
        <p style="margin-top:0">
          kokkai-watch は、国会の審議、法案の進み具合、各省庁の発表を一次資料から自動で集め、時系列で表示するサイトです。
        </p>
        <p>現在のデータ源:</p>
        <ul>
          <li>衆議院「議案情報」(法案の一覧と審議経過)</li>
          <li>国立国会図書館「国会会議録検索システム」(会議と発言者)</li>
          <li>各府省の新着情報 RSS(内閣府、総務省、財務省、文部科学省、厚生労働省、農林水産省、国土交通省、デジタル庁)</li>
        </ul>
        <p style="margin-bottom:0">
          データは定期的に自動で更新しています。正確な内容は、各ページのリンクから一次資料をご確認ください。
        </p>
      </div>
      <p class="note">今後、話題になった法律の成り立ちを一次資料でたどる「特集」を追加する予定です。</p>
    </Layout>
  );
}

export function NotFoundPage() {
  return (
    <Layout tab="home" title="ページが見つかりません">
      <h1>ページが見つかりません</h1>
      <a class="btn" href="/">
        ホームへ戻る
      </a>
    </Layout>
  );
}
