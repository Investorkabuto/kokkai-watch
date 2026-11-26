import { decodeAuto } from "@kokkai-watch/core";

export interface Env {
  DB: D1Database;
  /** 手動実行用のトークン(`wrangler secret put ADMIN_TOKEN`) */
  ADMIN_TOKEN?: string;
}

/** 外部サイトへのリクエストに使う汎用のクライアント名 */
const USER_AGENT = "kokkai-watch/0.1";

export async function fetchBytes(url: string, timeoutMs = 20_000): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** 文字コード(Shift_JIS など)を自動判定してテキストを取得 */
export async function fetchText(url: string): Promise<string> {
  return decodeAuto(await fetchBytes(url));
}

export async function fetchJson(url: string): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const nowIso = () => new Date().toISOString();

export async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** D1 の batch を一定件数ずつに分けて実行する */
export async function batchInChunks(db: D1Database, stmts: D1PreparedStatement[], size = 50): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size));
  }
}

export interface JobResult {
  summary: string;
}

/** 実行ログを残しながらジョブを実行する */
export async function runJob(env: Env, job: string, fn: () => Promise<JobResult>): Promise<JobResult> {
  const started = nowIso();
  const row = await env.DB.prepare("INSERT INTO collector_runs (job, started_at) VALUES (?, ?) RETURNING id")
    .bind(job, started)
    .first<{ id: number }>();
  try {
    const result = await fn();
    await env.DB.prepare("UPDATE collector_runs SET finished_at = ?, ok = 1, summary = ? WHERE id = ?")
      .bind(nowIso(), result.summary, row!.id)
      .run();
    console.log(`[${job}] ok: ${result.summary}`);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await env.DB.prepare("UPDATE collector_runs SET finished_at = ?, ok = 0, summary = ? WHERE id = ?")
      .bind(nowIso(), msg.slice(0, 1000), row!.id)
      .run();
    console.error(`[${job}] failed: ${msg}`);
    throw e;
  }
}
