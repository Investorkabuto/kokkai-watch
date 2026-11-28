/**
 * kokkai-watch app
 * 画面(SSR)と公開 API を返す Worker。
 */
import { Hono } from "hono";
import {
  getBill,
  lastUpdated,
  listBills,
  recentAnnouncements,
  recentMeetings,
  timeline,
  type BillFilter,
  type Env,
  type TimelineKind,
} from "./db";
import { AboutPage, BillPage, BillsPage, HomePage, NotFoundPage, TimelinePage } from "./pages";

const app = new Hono<{ Bindings: Env }>();

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const billFilter = (s: string | undefined): BillFilter => (s === "passed" || s === "all" ? s : "pending");
const timelineKind = (s: string | undefined): TimelineKind =>
  s === "bill" || s === "meeting" || s === "announcement" ? s : "all";

// 画面は数分キャッシュ(データの更新は最短でも1時間ごと)
app.use("*", async (c, next) => {
  await next();
  if (c.req.method === "GET" && c.res.status === 200 && !c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "public, max-age=300");
  }
});

app.get("/", async (c) => {
  const db = c.env.DB;
  const [updated, pending, passed, meetings, announcements] = await Promise.all([
    lastUpdated(db),
    listBills(db, "pending", undefined, 8),
    listBills(db, "passed", undefined, 5),
    recentMeetings(db, 6),
    recentAnnouncements(db, 8),
  ]);
  return c.html(<HomePage {...{ updated, pending, passed, meetings, announcements }} />);
});

app.get("/bills", async (c) => {
  const filter = billFilter(c.req.query("status"));
  const kind = c.req.query("kind") || undefined;
  const [updated, bills] = await Promise.all([lastUpdated(c.env.DB), listBills(c.env.DB, filter, kind)]);
  return c.html(<BillsPage {...{ updated, filter, kind, bills }} />);
});

app.get("/bills/:id", async (c) => {
  const [updated, data] = await Promise.all([lastUpdated(c.env.DB), getBill(c.env.DB, c.req.param("id"))]);
  if (!data) return c.html(<NotFoundPage />, 404);
  return c.html(<BillPage updated={updated} bill={data.bill} events={data.events} />);
});

app.get("/timeline", async (c) => {
  const kind = timelineKind(c.req.query("kind"));
  const before = c.req.query("before");
  const [updated, t] = await Promise.all([
    lastUpdated(c.env.DB),
    timeline(c.env.DB, { kind, before: isDate(before) ? before : undefined, days: kind === "all" ? 3 : 7 }),
  ]);
  return c.html(<TimelinePage updated={updated} kind={kind} items={t.items} nextBefore={t.nextBefore} />);
});

app.get("/about", async (c) => c.html(<AboutPage updated={await lastUpdated(c.env.DB)} />));

// ---- 公開 API(JSON) ----
app.get("/api/bills", async (c) => {
  const bills = await listBills(c.env.DB, billFilter(c.req.query("status")), c.req.query("kind") || undefined);
  return c.json({ bills });
});

app.get("/api/bills/:id", async (c) => {
  const data = await getBill(c.env.DB, c.req.param("id"));
  return data ? c.json(data) : c.json({ error: "not found" }, 404);
});

app.get("/api/timeline", async (c) => {
  const before = c.req.query("before");
  const t = await timeline(c.env.DB, {
    kind: timelineKind(c.req.query("kind")),
    before: isDate(before) ? before : undefined,
    days: 7,
    ministry: c.req.query("ministry") || undefined,
  });
  return c.json(t);
});

app.get("/healthz", (c) => c.text("ok"));

app.notFound((c) => c.html(<NotFoundPage />, 404));

app.onError((err, c) => {
  console.error(err);
  return c.text("エラーが発生しました。時間をおいて再度お試しください。", 500);
});

export default app;
