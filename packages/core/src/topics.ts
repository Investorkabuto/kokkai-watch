/**
 * ニュースの見出しから法律名・法案名を抽出する(話題の検知)。
 * 見出しは「何が話題か」を知るためだけに使い、本文は取得・転載しない。
 */

/** 法律名ではない「〜法」「〜罪」 */
const NOT_LAW = new Set([
  "方法", "手法", "違法", "合法", "不法", "司法", "立法", "文法", "魔法", "寸法", "療法", "製法", "用法",
  "作法", "技法", "論法", "説法", "兵法", "便法", "脱法", "適法", "無法", "新法", "同法", "本法", "法",
  "犯罪", "有罪", "無罪", "謝罪", "断罪", "重罪", "罪",
]);

/** 法律名にならない一般的な語幹(「重要法案」「提出法案」など) */
const GENERIC_STEMS = /^(重要|提出|審議|成立|可決|対象|一連|関連|同|各|全|両|当該|上記|今回|政府提出|議員提出|\d+大|\d+年度?)$/;

/** 外国の法律を示す接頭辞 */
const FOREIGN_PREFIX = /^(米|豪|英|仏|独|露|EU|欧州|韓国|中国|台湾|米国|米連邦)/;

/** 1文字+「法」でも法律名として扱うもの */
const SHORT_LAWS = new Set(["刑法", "民法", "憲法", "商法"]);

/** 先頭から取り除く語(「改正入管法」→「入管法」など) */
const PREFIXES = ["衆院", "参院", "両院", "政府", "与党", "野党", "改正", "新", "同"];

// 「〜法案」「〜条約」などは後ろに漢字が続いてもよい(「法案可決」)。単独の「法」「罪」は後ろに漢字が続くと別の語(「法務」「罪名」)
const TERM_RE =
  /([\p{Script=Han}々\p{Script=Katakana}ーA-Za-z0-9・]{1,24}?)(法改正案|法改正|改正法案|法案|条約|(?:法|罪)(?![\p{Script=Han}]))/gu;

/** 見出しの末尾につく媒体名(Google ニュースの「 - 媒体名」)を除く */
export function stripSourceSuffix(headline: string): string {
  const i = headline.lastIndexOf(" - ");
  return i > 0 ? headline.slice(0, i) : headline;
}

/**
 * 見出しから法律名の候補を抽出し、正規化して返す(重複なし)。
 * 「〜法案」「〜法改正案」は「〜法」にそろえる。
 */
export function extractLawTerms(headline: string): string[] {
  const text = stripSourceSuffix(headline).normalize("NFKC");
  const out = new Set<string>();
  for (const m of text.matchAll(TERM_RE)) {
    let stem = m[1]!.replace(/^・+|・+$/g, "");
    const suffix = m[2]!;
    for (const p of PREFIXES) {
      if (stem.startsWith(p) && stem.length > p.length) stem = stem.slice(p.length);
    }
    const kind = suffix === "罪" ? "罪" : suffix === "条約" ? "条約" : "法";
    const term = stem + kind;
    if (NOT_LAW.has(term)) continue;
    if (/^\d+$/.test(stem) || GENERIC_STEMS.test(stem) || FOREIGN_PREFIX.test(stem)) continue;
    if (kind === "法" && stem.length < 2 && !SHORT_LAWS.has(term)) continue;
    if (kind === "罪" && stem.length < 2) continue;
    out.add(term);
  }
  return [...out];
}

/** ニュース RSS(見出しのみ利用) */
export const NEWS_FEEDS: { source: string; url: string }[] = [
  {
    source: "Googleニュース",
    url: "https://news.google.com/rss/search?q=%E6%B3%95%E6%A1%88+OR+%E6%B3%95%E6%94%B9%E6%AD%A3&hl=ja&gl=JP&ceid=JP:ja",
  },
  {
    source: "Googleニュース",
    url: "https://news.google.com/rss/search?q=%E5%9B%BD%E4%BC%9A+%E5%AF%A9%E8%AD%B0&hl=ja&gl=JP&ceid=JP:ja",
  },
  { source: "NHK", url: "https://www3.nhk.or.jp/rss/news/cat4.xml" },
];

/** 話題の ID(キーワードから決まる) */
export async function topicIdFor(keyword: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(keyword.normalize("NFKC")));
  return "tp_" + [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 法律名から、検索に使う語を作る(「消費税減税法」→「消費税減税」) */
export function searchStem(keyword: string): string {
  const k = keyword.normalize("NFKC");
  const stem = k.replace(/(法|罪|条約)$/, "");
  return stem.length >= 2 ? stem : k;
}
