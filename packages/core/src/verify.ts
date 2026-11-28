/**
 * 特集記事の自動検証。
 * AI(Muse)の投稿を一次資料と機械的に照合し、合格したものだけを公開する。
 * ネットワークや DB に依存しない純粋関数。
 */
import type {
  Citation,
  Perspective,
  Sentence,
  SourceForVerify,
  StoryItem,
  StorySubmission,
  VerifyIssue,
  VerifyResult,
} from "./story";

/** 断定的な非難・煽りの表現(引用「」の外で使うと不合格) */
export const BANNED_EXPRESSIONS = [
  "隠蔽",
  "売国",
  "許せない",
  "最悪",
  "暴挙",
  "嘘つき",
  "犯罪者",
  "独裁",
  "愚か",
  "国賊",
  "反日",
  "亡国",
  "クズ",
  "無能",
  "悪質",
  "卑劣",
  "ゴミ",
  "でっち上げ",
] as const;

const MIN_ITEMS = 3;
const MAX_TITLE = 80;
const MIN_QUOTE_LEN = 6;

/** 照合用の正規化: NFKC、空白・改行・全角空白をすべて除去 */
export function normalizeForMatch(s: string): string {
  return s.normalize("NFKC").replace(/[\s　]/g, "");
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 「」で囲まれた部分を取り出す */
function extractQuotes(text: string): string[] {
  return [...text.matchAll(/「([^「」]*)」/g)].map((m) => m[1]!);
}

/** 「」の中を除いた本文 */
function outsideQuotes(text: string): string {
  return text.replace(/「[^「」]*」/g, "");
}

// ---- スキーマ検証(形の確認と正規化) ----

function parseSentence(v: unknown, path: string, issues: VerifyIssue[]): Sentence | null {
  if (!isObj(v)) {
    issues.push({ code: "schema", path, message: "文は { text, citations } の形のオブジェクトにしてください。" });
    return null;
  }
  const text = typeof v.text === "string" ? v.text.trim() : "";
  if (!text) issues.push({ code: "schema", path: `${path}.text`, message: "文の text が空です。本文を入れてください。" });
  if (!Array.isArray(v.citations)) {
    issues.push({ code: "schema", path: `${path}.citations`, message: "citations は配列にしてください(例: [{\"source_id\": \"src_...\"}])。" });
    return text ? { text, citations: [] } : null;
  }
  const citations: Citation[] = [];
  v.citations.forEach((c, i) => {
    const cp = `${path}.citations[${i}]`;
    if (!isObj(c) || typeof c.source_id !== "string" || !c.source_id.trim()) {
      issues.push({ code: "schema", path: cp, message: "出典は { source_id: \"src_...\", quote?: \"...\" } の形にしてください。" });
      return;
    }
    const cit: Citation = { source_id: c.source_id.trim() };
    if (c.quote !== undefined) {
      if (typeof c.quote !== "string" || !c.quote.trim()) {
        issues.push({ code: "schema", path: `${cp}.quote`, message: "quote を指定する場合は空でない文字列にしてください。不要なら省略してください。" });
      } else {
        cit.quote = c.quote.trim();
      }
    }
    citations.push(cit);
  });
  return text ? { text, citations } : null;
}

function parseSentences(v: unknown, path: string, issues: VerifyIssue[], min: number): Sentence[] {
  if (!Array.isArray(v)) {
    issues.push({ code: "schema", path, message: "文の配列にしてください。" });
    return [];
  }
  if (v.length < min) {
    issues.push({ code: "schema", path, message: `文を${min}つ以上入れてください。` });
  }
  return v.map((s, i) => parseSentence(s, `${path}[${i}]`, issues)).filter((s): s is Sentence => s !== null);
}

function parseSubmission(input: unknown, topicId: string, issues: VerifyIssue[]): StorySubmission | null {
  if (!isObj(input)) {
    issues.push({ code: "schema", path: "", message: "投稿は JSON オブジェクトにしてください。" });
    return null;
  }
  if (input.topic_id !== topicId) {
    issues.push({
      code: "schema",
      path: "topic_id",
      message: `topic_id が一致しません。この話題の ID は "${topicId}" です。`,
    });
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > MAX_TITLE) {
    issues.push({ code: "schema", path: "title", message: `title は1〜${MAX_TITLE}文字にしてください(現在 ${title.length} 文字)。` });
  }
  const writer = typeof input.writer === "string" && input.writer.trim() ? input.writer.trim() : "unknown";
  const lead = parseSentences(input.lead, "lead", issues, 1);

  const items: StoryItem[] = [];
  if (!Array.isArray(input.items)) {
    issues.push({ code: "schema", path: "items", message: "items は配列にしてください。" });
  } else {
    if (input.items.length < MIN_ITEMS) {
      issues.push({ code: "schema", path: "items", message: `items(年表の項目)を${MIN_ITEMS}件以上入れてください(現在 ${input.items.length} 件)。` });
    }
    input.items.forEach((it, i) => {
      const p = `items[${i}]`;
      if (!isObj(it)) {
        issues.push({ code: "schema", path: p, message: "項目は { date, heading, sentences } の形のオブジェクトにしてください。" });
        return;
      }
      const date = typeof it.date === "string" ? it.date.trim() : "";
      if (!isRealDate(date)) {
        issues.push({ code: "schema", path: `${p}.date`, message: "date は実在する日付を YYYY-MM-DD 形式で入れてください。" });
      }
      const heading = typeof it.heading === "string" ? it.heading.trim() : "";
      if (!heading) issues.push({ code: "schema", path: `${p}.heading`, message: "heading(項目の見出し)が空です。" });
      const sentences = parseSentences(it.sentences, `${p}.sentences`, issues, 1);
      items.push({ date, heading, sentences });
    });
  }

  const perspectives: Perspective[] = [];
  if (!Array.isArray(input.perspectives)) {
    issues.push({ code: "schema", path: "perspectives", message: "perspectives は配列にしてください。" });
  } else {
    input.perspectives.forEach((pv, i) => {
      const p = `perspectives[${i}]`;
      if (!isObj(pv)) {
        issues.push({ code: "schema", path: p, message: "論点は { stance, sentences } の形のオブジェクトにしてください。" });
        return;
      }
      const stance = typeof pv.stance === "string" ? pv.stance.trim() : "";
      if (!stance) issues.push({ code: "schema", path: `${p}.stance`, message: "stance(立場。例: 賛成、反対・慎重)が空です。" });
      perspectives.push({ stance, sentences: parseSentences(pv.sentences, `${p}.sentences`, issues, 1) });
    });
  }

  return { topic_id: topicId, writer, title, lead, items, perspectives };
}

// ---- 内容の検証 ----

interface SentenceRef {
  path: string;
  sentence: Sentence;
}

function allSentences(story: StorySubmission): SentenceRef[] {
  const out: SentenceRef[] = [];
  story.lead.forEach((s, i) => out.push({ path: `lead[${i}]`, sentence: s }));
  story.items.forEach((it, i) =>
    it.sentences.forEach((s, j) => out.push({ path: `items[${i}].sentences[${j}]`, sentence: s })),
  );
  story.perspectives.forEach((pv, i) =>
    pv.sentences.forEach((s, j) => out.push({ path: `perspectives[${i}].sentences[${j}]`, sentence: s })),
  );
  return out;
}

export function verifyStory(input: unknown, sources: Map<string, SourceForVerify>, topicId: string): VerifyResult {
  const issues: VerifyIssue[] = [];
  const story = parseSubmission(input, topicId, issues);
  if (!story) return { passed: false, issues };

  const normBody = new Map<string, string>();
  for (const [id, s] of sources) normBody.set(id, normalizeForMatch(s.body));

  // 発言者名(空白除去)。2文字未満は誤検出が多いので除く
  const speakerNames = new Set<string>();
  for (const s of sources.values()) {
    const name = s.speaker ? normalizeForMatch(s.speaker) : "";
    if (name.length >= 2) speakerNames.add(name);
  }

  for (const { path, sentence } of allSentences(story)) {
    const known = sentence.citations.filter((c) => sources.has(c.source_id));

    if (sentence.citations.length === 0) {
      issues.push({
        code: "missing_citation",
        path,
        message: "この文に出典がありません。根拠となる一次資料の source_id を citations に1つ以上入れるか、文を削除してください。",
      });
    }

    sentence.citations.forEach((c, i) => {
      if (!sources.has(c.source_id)) {
        issues.push({
          code: "unknown_source",
          path: `${path}.citations[${i}]`,
          message: `source_id "${c.source_id}" はこの話題の資料にありません。GET /ingest/v1/topics/${topicId}/sources で取得した ID だけを使ってください。`,
        });
        return;
      }
      if (c.quote !== undefined) {
        const q = normalizeForMatch(c.quote);
        if (!normBody.get(c.source_id)!.includes(q)) {
          issues.push({
            code: "quote_mismatch",
            path: `${path}.citations[${i}].quote`,
            message: `quote が出典 "${c.source_id}" の本文と一致しません。本文から一字一句そのまま抜き出すか、quote を省略してください。`,
          });
        }
      }
    });

    // 本文中の「」引用は、この文の出典のどれかに含まれていること
    for (const raw of extractQuotes(sentence.text)) {
      const q = normalizeForMatch(raw);
      if (q.length < MIN_QUOTE_LEN) continue;
      if (!known.some((c) => normBody.get(c.source_id)!.includes(q))) {
        issues.push({
          code: "quote_mismatch",
          path,
          message: `「${raw}」がこの文の出典の本文に見つかりません。引用は出典から一字一句そのまま写すか、「」を外して要約してください。`,
        });
      }
    }

    // 発言者の取り違え
    const normText = normalizeForMatch(sentence.text);
    for (const name of speakerNames) {
      if (!normText.includes(name)) continue;
      const ok = known.some((c) => {
        const src = sources.get(c.source_id)!;
        return (src.speaker && normalizeForMatch(src.speaker) === name) || normBody.get(c.source_id)!.includes(name);
      });
      if (!ok) {
        issues.push({
          code: "speaker_mismatch",
          path,
          message: `文中の「${name}」は、この文の出典の発言者でも本文中の人物でもありません。${name}の発言を出典に加えるか、人物名を正してください。`,
        });
      }
    }

    // 禁止表現(引用の外のみ)
    const outside = outsideQuotes(sentence.text);
    const banned = BANNED_EXPRESSIONS.filter((w) => outside.includes(w));
    if (banned.length) {
      issues.push({
        code: "banned_expression",
        path,
        message: `断定的な非難・煽りの表現(${banned.join("、")})は使えません。事実と発言の引用だけで中立に書き直してください。`,
      });
    }
  }

  // 各項目の日付は、項目内のいずれかの出典の日付と一致すること
  story.items.forEach((it, i) => {
    if (!isRealDate(it.date)) return;
    const dates = new Set<string>();
    for (const s of it.sentences) {
      for (const c of s.citations) {
        const d = sources.get(c.source_id)?.date;
        if (d) dates.add(d);
      }
    }
    if (dates.size > 0 && !dates.has(it.date)) {
      issues.push({
        code: "date_mismatch",
        path: `items[${i}].date`,
        message: `項目の日付 ${it.date} が、項目内の出典の日付(${[...dates].sort().join("、")})のどれとも一致しません。出典の日付に合わせてください。`,
      });
    }
  });

  // 両論併記
  const stances = new Set(story.perspectives.map((p) => p.stance).filter(Boolean));
  if (story.perspectives.length < 2 || stances.size < 2) {
    issues.push({
      code: "perspectives",
      path: "perspectives",
      message: "perspectives には異なる立場(例: 賛成 と 反対・慎重)を2つ以上入れ、それぞれ審議での発言を出典にしてください。",
    });
  }

  return issues.length === 0 ? { passed: true, issues, story } : { passed: false, issues };
}
