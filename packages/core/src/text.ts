/** 文字コード・テキスト処理の共通関数 */

/** バイト列を指定の文字コードで文字列にする(shift_jis / utf-8 など) */
export function decode(bytes: ArrayBuffer | Uint8Array, encoding = "utf-8"): string {
  return new TextDecoder(normalizeEncoding(encoding)).decode(bytes);
}

function normalizeEncoding(enc: string): string {
  const e = enc.trim().toLowerCase();
  if (e === "shift_jis" || e === "sjis" || e === "x-sjis" || e === "windows-31j" || e === "cp932") {
    return "shift_jis";
  }
  return e;
}

/** XML 宣言や meta タグから文字コードを推定する(先頭の ASCII 部分だけを見る) */
export function sniffEncoding(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  const m =
    head.match(/<\?xml[^>]*encoding=["']([\w-]+)["']/i) ??
    head.match(/<meta[^>]*charset=["']?([\w-]+)/i);
  return m?.[1] ? normalizeEncoding(m[1]) : "utf-8";
}

/** 文字コードを自動判定してデコード */
export function decodeAuto(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return decode(u8, sniffEncoding(u8));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** HTML/XML の文字参照を戻す */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? all;
  });
}

/** タグを除去し、空白を整えたテキストにする */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
    .replace(/[\s　]+/g, " ")
    .trim();
}

const ERA_OFFSET: Record<string, number> = { 令和: 2018, 平成: 1988, 昭和: 1925 };

/**
 * 和暦の日付(例: "令和 8年10月 9日"、"令和元年5月1日")を ISO 形式(YYYY-MM-DD)にする。
 * 解釈できなければ null。
 */
export function parseWarekiDate(s: string): string | null {
  const t = s.replace(/[\s　]/g, "").replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const m = t.match(/(令和|平成|昭和)(元|\d+)年(\d+)月(\d+)日/);
  if (!m) return null;
  const [, era, y, mo, d] = m;
  const year = ERA_OFFSET[era!]! + (y === "元" ? 1 : Number(y));
  return `${year}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

/** Date を日本時間の YYYY-MM-DD にする */
export function toJstDate(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
