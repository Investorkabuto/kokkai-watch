/**
 * RSS 2.0 / RSS 1.0(RDF) / Atom の簡易パーサ。
 * Workers には DOMParser がないため、正規表現で必要な要素だけを取り出す。
 */
import { decodeEntities, stripTags } from "./text";

export interface FeedItem {
  title: string;
  url: string;
  /** ISO 8601(取得できなければ null) */
  publishedAt: string | null;
}

function tag(block: string, names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
    const m = block.match(re);
    if (m) return unwrapCdata(m[1]!);
  }
  return null;
}

function unwrapCdata(s: string): string {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1]! : s;
}

function toIso(s: string | null): string | null {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseFeed(xml: string): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  const items: FeedItem[] = [];
  for (const b of blocks) {
    const block = b[2]!;
    const title = stripTags(decodeEntities(tag(block, ["title"]) ?? ""));
    let url = tag(block, ["link"])?.trim() ?? "";
    if (!url) {
      // Atom: <link href="..."/>(rel="alternate" を優先)
      const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]!);
      const alt = links.find((a) => /rel=["']alternate["']/i.test(a)) ?? links[0];
      url = alt?.match(/href=["']([^"']+)["']/i)?.[1] ?? "";
    }
    if (!url) {
      url = b[0].match(/rdf:about=["']([^"']+)["']/i)?.[1] ?? "";
    }
    url = decodeEntities(url.trim());
    if (!title || !url) continue;
    const publishedAt = toIso(tag(block, ["pubDate", "dc:date", "published", "updated"]));
    items.push({ title, url, publishedAt });
  }
  return items;
}

/** 収集対象の省庁 RSS(2026-11-26 に取得できることを確認したもの) */
export const MINISTRY_FEEDS: { ministry: string; url: string }[] = [
  { ministry: "内閣府", url: "https://www.cao.go.jp/rss/news.rdf" },
  { ministry: "総務省", url: "https://www.soumu.go.jp/news.rdf" },
  { ministry: "財務省", url: "https://www.mof.go.jp/news.rss" },
  { ministry: "文部科学省", url: "https://www.mext.go.jp/b_menu/news/index.rdf" },
  { ministry: "厚生労働省", url: "https://www.mhlw.go.jp/stf/news.rdf" },
  { ministry: "農林水産省", url: "https://www.maff.go.jp/j/press/rss.xml" },
  { ministry: "国土交通省", url: "https://www.mlit.go.jp/index.rdf" },
  { ministry: "デジタル庁", url: "https://www.digital.go.jp/rss/news.xml" },
];
