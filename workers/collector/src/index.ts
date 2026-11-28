/**
 * kokkai-watch collector
 * Cron Triggers で一次資料を定期収集し、D1 に保存する。
 * 手動実行: POST /run/{bills|meetings|announcements}(Authorization: Bearer ADMIN_TOKEN)
 */
import { collectAnnouncements } from "./jobs/announcements";
import { collectBills } from "./jobs/bills";
import { collectMeetings } from "./jobs/meetings";
import { runJob, type Env, type JobResult } from "./util";

const JOBS: Record<string, (env: Env, params: URLSearchParams) => Promise<JobResult>> = {
  announcements: (env) => collectAnnouncements(env),
  bills: (env) => collectBills(env),
  meetings: (env, p) => collectMeetings(env, { from: p.get("from") ?? undefined, until: p.get("until") ?? undefined }),
};

/** wrangler.jsonc の crons と対応させる */
const CRON_TO_JOB: Record<string, string> = {
  "5 * * * *": "announcements",
  "20 */3 * * *": "bills",
  "40 */6 * * *": "meetings",
};

export default {
  async scheduled(event, env, ctx) {
    const job = CRON_TO_JOB[event.cron];
    if (!job) {
      console.warn(`unknown cron: ${event.cron}`);
      return;
    }
    ctx.waitUntil(runJob(env, job, () => JOBS[job]!(env, new URLSearchParams())));
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/run\/(\w+)$/);
    if (req.method !== "POST" || !m) return new Response("kokkai-watch collector", { status: 404 });

    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return new Response("unauthorized", { status: 401 });

    const job = JOBS[m[1]!];
    if (!job) return new Response("unknown job", { status: 404 });
    try {
      const result = await runJob(env, m[1]!, () => job(env, url.searchParams));
      return Response.json({ ok: true, ...result });
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
