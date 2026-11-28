/**
 * 一次資料の定期収集(Cron Triggers から呼ばれる)
 */
import { collectAnnouncements } from "./jobs/announcements";
import { collectBills } from "./jobs/bills";
import { collectMeetings } from "./jobs/meetings";
import { runJob, type Env, type JobResult } from "./util";

export const JOBS: Record<string, (env: Env, params: URLSearchParams) => Promise<JobResult>> = {
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

export async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  const job = CRON_TO_JOB[event.cron];
  if (!job) {
    console.warn(`unknown cron: ${event.cron}`);
    return;
  }
  await runJob(env, job, () => JOBS[job]!(env, new URLSearchParams()));
}

/** 手動実行: POST /admin/run/{job}(Authorization: Bearer ADMIN_TOKEN) */
export async function handleManualRun(req: Request, env: Env, job: string): Promise<Response> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return new Response("unauthorized", { status: 401 });
  const fn = JOBS[job];
  if (!fn) return new Response("unknown job", { status: 404 });
  try {
    const result = await runJob(env, job, () => fn(env, new URL(req.url).searchParams));
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
