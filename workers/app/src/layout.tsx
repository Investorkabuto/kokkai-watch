import type { Child } from "hono/jsx";
import { raw } from "hono/html";

const CSS = `
:root{
  --bg:#f6f5f2;--surface:#ffffff;--surface-2:#efeee9;--text:#1c1c1a;--muted:#6b6a64;--line:#e2e0d9;
  --accent:#9b2335;--accent-soft:#f6e7e9;--ok:#2f6f4f;--ok-soft:#e3f1e9;--warn:#8a5a00;--warn-soft:#f8eed8;
  --bill:#9b2335;--meeting:#2d5d8a;--announcement:#5c6b2e;
  --radius:14px;--tab-h:60px;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#121211;--surface:#1c1c1a;--surface-2:#262624;--text:#ecebe6;--muted:#a3a29b;--line:#33322f;
    --accent:#e2707f;--accent-soft:#3a2226;--ok:#7cc59e;--ok-soft:#1d3127;--warn:#e0b25a;--warn-soft:#352b17;
    --bill:#e2707f;--meeting:#7eaee0;--announcement:#b5c46f;
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,sans-serif;
  line-height:1.65;font-size:16px;padding-bottom:calc(var(--tab-h) + env(safe-area-inset-bottom) + 16px)}
a{color:inherit}
.wrap{max-width:680px;margin:0 auto;padding:0 16px}
header.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;height:52px}
.brand{font-weight:800;letter-spacing:.02em;text-decoration:none;font-size:18px}
.brand span{color:var(--accent)}
.updated{font-size:12px;color:var(--muted)}
h1{font-size:22px;line-height:1.4;margin:20px 0 8px;word-break:auto-phrase;text-wrap:pretty}
h2{font-size:17px;margin:28px 0 10px;display:flex;align-items:baseline;justify-content:space-between}
h2 a{font-size:13px;font-weight:500;color:var(--muted);text-decoration:none}
.lead{color:var(--muted);font-size:14px;margin:0 0 12px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px}
.list{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.list li+li{border-top:1px solid var(--line)}
.list a.row,.list div.row{display:block;padding:12px 16px;text-decoration:none}
.list a.row:active{background:var(--surface-2)}
.row .t{font-weight:600;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.row .s{font-size:13px;color:var(--muted);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.chip{display:inline-block;font-size:12px;line-height:1;padding:5px 8px;border-radius:999px;background:var(--surface-2);color:var(--muted);white-space:nowrap}
.chip.pending{background:var(--warn-soft);color:var(--warn)}
.chip.passed{background:var(--ok-soft);color:var(--ok)}
.chip.rejected,.chip.withdrawn,.chip.lapsed{background:var(--accent-soft);color:var(--accent)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:2px}
.dot.bill{background:var(--bill)}.dot.meeting{background:var(--meeting)}.dot.announcement{background:var(--announcement)}
.tabs{display:flex;gap:8px;overflow-x:auto;padding:4px 0 12px;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tabs a{flex:none;text-decoration:none;font-size:14px;padding:7px 14px;border-radius:999px;border:1px solid var(--line);background:var(--surface)}
.tabs a.on{background:var(--text);color:var(--bg);border-color:var(--text)}
.day{font-size:13px;font-weight:700;color:var(--muted);margin:20px 4px 8px;position:sticky;top:52px;background:var(--bg);padding:4px 0;z-index:1}
.progress{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin:14px 0 6px}
.progress .step{text-align:center;font-size:11px;color:var(--muted)}
.progress .bar{height:6px;border-radius:3px;background:var(--surface-2);margin-bottom:6px}
.progress .done .bar{background:var(--ok)}
.progress .failed .bar{background:var(--accent)}
.progress .done{color:var(--text)}
.kv{display:grid;grid-template-columns:7em 1fr;gap:6px 12px;font-size:14px;margin:0}
.kv dt{color:var(--muted)}.kv dd{margin:0}
.events{list-style:none;margin:0;padding:0 0 0 18px;border-left:2px solid var(--line)}
.events li{position:relative;padding:0 0 16px 4px}
.events li::before{content:"";position:absolute;left:-26px;top:7px;width:10px;height:10px;border-radius:50%;background:var(--surface);border:2px solid var(--ok)}
.events .d{font-size:13px;color:var(--muted)}
.groups{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.btn{display:block;text-align:center;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--surface);text-decoration:none;font-weight:600;margin-top:12px}
.empty{color:var(--muted);text-align:center;padding:24px 0;font-size:14px}
.note{font-size:12px;color:var(--muted);margin-top:28px}
footer{font-size:12px;color:var(--muted);margin:36px 0 0;padding-top:16px;border-top:1px solid var(--line)}
footer a{color:var(--muted)}
nav.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:10;background:var(--surface);border-top:1px solid var(--line);
  padding-bottom:env(safe-area-inset-bottom)}
nav.tabbar .in{max-width:680px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr);height:var(--tab-h)}
nav.tabbar a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;text-decoration:none;font-size:11px;color:var(--muted)}
nav.tabbar a.on{color:var(--accent);font-weight:700}
nav.tabbar svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
`;

type Tab = "home" | "bills" | "timeline" | "about";

const ICONS: Record<Tab, string> = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  bills: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  timeline: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
};

const TABS: { id: Tab; href: string; label: string }[] = [
  { id: "home", href: "/", label: "ホーム" },
  { id: "bills", href: "/bills", label: "法案" },
  { id: "timeline", href: "/timeline", label: "タイムライン" },
  { id: "about", href: "/about", label: "このサイト" },
];

export function Layout(props: {
  title?: string;
  description?: string;
  tab: Tab;
  updated?: string | null;
  children: Child;
}) {
  const title = props.title ? `${props.title} | kokkai-watch` : "kokkai-watch — 国の動きを、ひとつのタイムラインで";
  const description =
    props.description ?? "国会の審議、法案の進み具合、各省庁の発表を一次資料から集めて、時系列で表示します。";
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta name="theme-color" content="#f6f5f2" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#121211" media="(prefers-color-scheme: dark)" />
        <style>{raw(CSS)}</style>
      </head>
      <body>
        <header class="top">
          <div class="wrap">
            <a class="brand" href="/">
              kokkai<span>-</span>watch
            </a>
            {props.updated && <span class="updated">更新 {formatDateTime(props.updated)}</span>}
          </div>
        </header>
        <main class="wrap">
          {props.children}
          <footer>
            出典: 衆議院「議案情報」、国立国会図書館「国会会議録検索システム」、各府省の新着情報(RSS)。
            内容は各一次資料のリンク先でご確認ください。 <a href="/about">このサイトについて</a>
          </footer>
        </main>
        <nav class="tabbar" aria-label="メインメニュー">
          <div class="in">
            {TABS.map((t) => (
              <a href={t.href} class={t.id === props.tab ? "on" : ""} aria-current={t.id === props.tab ? "page" : undefined}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {raw(ICONS[t.id])}
                </svg>
                {t.label}
              </a>
            ))}
          </div>
        </nav>
      </body>
    </html>
  );
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

/** YYYY-MM-DD → 「11月26日(木)」 */
export function formatDay(date: string, withYear = false): string {
  const [y, m, d] = date.split("-").map(Number);
  const w = WEEK[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()];
  return `${withYear ? `${y}年` : ""}${m}月${d}日(${w})`;
}

/** ISO 日時 → 日本時間の「11/26 21:05」 */
export function formatDateTime(iso: string): string {
  const t = new Date(Date.parse(iso) + 9 * 3600_000);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "審議中",
  passed: "成立",
  rejected: "否決",
  withdrawn: "撤回",
  lapsed: "未了",
  other: "その他",
};
