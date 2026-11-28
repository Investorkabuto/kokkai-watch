import { describe, expect, it } from "vitest";
import { BANNED_EXPRESSIONS, normalizeForMatch, verifyStory, type SourceForVerify, type StorySubmission } from "../src";

const TOPIC = "tp_0123456789ab";

const SOURCES = new Map<string, SourceForVerify>(
  (
    [
      {
        id: "src_be_222-kaku-1_received_衆議院",
        kind: "bill_event",
        date: "2026-10-09",
        title: "審議経過",
        body: "2026-10-09 衆議院 議案受理",
        speaker: null,
      },
      {
        id: "src_be_222-kaku-1_plenary_decided_衆議院",
        kind: "bill_event",
        date: "2026-10-30",
        title: "審議経過",
        body: "2026-10-30 衆議院 本会議で採決 可決",
        speaker: null,
      },
      {
        id: "src_sp_A",
        kind: "speech",
        date: "2026-10-22",
        title: "衆議院 法務委員会 山田太郎",
        body: "○山田太郎君　この改正は被害者の保護の観点から\r\n必要不可欠であると考えます。",
        speaker: "山田 太郎",
      },
      {
        id: "src_sp_B",
        kind: "speech",
        date: "2026-10-22",
        title: "衆議院 法務委員会 佐藤花子",
        body: "○佐藤花子君　構成要件が曖昧になるおそれがあり、慎重な検討が必要です。",
        speaker: "佐藤花子",
      },
    ] satisfies SourceForVerify[]
  ).map((s) => [s.id, s]),
);

function validStory(): StorySubmission {
  return {
    topic_id: TOPIC,
    writer: "muse",
    title: "  改正法はどのような議論を経て成立したのか ",
    lead: [{ text: "改正法案は2026年10月に衆議院で可決された。", citations: [{ source_id: "src_be_222-kaku-1_plenary_decided_衆議院" }] }],
    items: [
      {
        date: "2026-10-09",
        heading: "衆議院が法案を受理",
        sentences: [{ text: "内閣が提出した法案を衆議院が受理した。", citations: [{ source_id: "src_be_222-kaku-1_received_衆議院" }] }],
      },
      {
        date: "2026-10-22",
        heading: "法務委員会で質疑",
        sentences: [
          {
            text: "山田太郎議員は「被害者の保護の観点から必要不可欠である」と述べた。",
            citations: [{ source_id: "src_sp_A", quote: "被害者の保護の観点から 必要不可欠である" }],
          },
        ],
      },
      {
        date: "2026-10-30",
        heading: "衆議院本会議で可決",
        sentences: [{ text: "衆議院本会議で可決された。", citations: [{ source_id: "src_be_222-kaku-1_plenary_decided_衆議院" }] }],
      },
    ],
    perspectives: [
      { stance: "賛成", sentences: [{ text: "被害者保護に必要だとする意見。", citations: [{ source_id: "src_sp_A" }] }] },
      { stance: "反対・慎重", sentences: [{ text: "構成要件が曖昧になるとの懸念。", citations: [{ source_id: "src_sp_B" }] }] },
    ],
  };
}

const codes = (r: ReturnType<typeof verifyStory>) => r.issues.map((i) => i.code);

describe("verifyStory", () => {
  it("正しい投稿は合格し、正規化済みデータを返す", () => {
    const r = verifyStory(validStory(), SOURCES, TOPIC);
    expect(r.issues).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.story?.title).toBe("改正法はどのような議論を経て成立したのか");
    expect(r.story?.writer).toBe("muse");
  });

  it("writer 省略時は unknown", () => {
    const s = validStory();
    delete s.writer;
    expect(verifyStory(s, SOURCES, TOPIC).story?.writer).toBe("unknown");
  });

  describe("schema", () => {
    it("オブジェクトでない", () => {
      expect(codes(verifyStory("x", SOURCES, TOPIC))).toEqual(["schema"]);
    });
    it("topic_id が違う", () => {
      const s = { ...validStory(), topic_id: "tp_other" };
      const r = verifyStory(s, SOURCES, TOPIC);
      expect(r.passed).toBe(false);
      expect(r.issues.find((i) => i.code === "schema")?.path).toBe("topic_id");
    });
    it("title が長すぎる / items が3件未満 / 実在しない日付", () => {
      const s = validStory();
      s.title = "あ".repeat(81);
      s.items = s.items.slice(0, 2);
      s.items[0]!.date = "2026-02-30";
      const r = verifyStory(s, SOURCES, TOPIC);
      const paths = r.issues.filter((i) => i.code === "schema").map((i) => i.path);
      expect(paths).toEqual(expect.arrayContaining(["title", "items", "items[0].date"]));
    });
    it("lead が空 / 文の text が空", () => {
      const s = validStory() as unknown as Record<string, unknown>;
      s.lead = [];
      (s.items as StorySubmission["items"])[0]!.sentences[0]!.text = "  ";
      const r = verifyStory(s, SOURCES, TOPIC);
      expect(r.issues.filter((i) => i.code === "schema").map((i) => i.path)).toEqual(
        expect.arrayContaining(["lead", "items[0].sentences[0].text"]),
      );
    });
  });

  it("missing_citation", () => {
    const s = validStory();
    s.items[0]!.sentences.push({ text: "出典のない文。", citations: [] });
    const r = verifyStory(s, SOURCES, TOPIC);
    expect(r.issues).toContainEqual(expect.objectContaining({ code: "missing_citation", path: "items[0].sentences[1]" }));
  });

  it("unknown_source", () => {
    const s = validStory();
    s.lead[0]!.citations = [{ source_id: "src_nope" }];
    const r = verifyStory(s, SOURCES, TOPIC);
    expect(r.issues).toContainEqual(expect.objectContaining({ code: "unknown_source", path: "lead[0].citations[0]" }));
  });

  it("quote_mismatch: quote が本文にない", () => {
    const s = validStory();
    s.items[1]!.sentences[0]!.citations[0]!.quote = "絶対に必要である";
    expect(codes(verifyStory(s, SOURCES, TOPIC))).toContain("quote_mismatch");
  });

  it("quote_mismatch: 本文中の「」が出典にない(捏造防止)", () => {
    const s = validStory();
    s.items[1]!.sentences[0] = {
      text: "山田太郎議員は「この法案は完全に間違っている」と述べた。",
      citations: [{ source_id: "src_sp_A" }],
    };
    const r = verifyStory(s, SOURCES, TOPIC);
    expect(r.issues).toContainEqual(expect.objectContaining({ code: "quote_mismatch", path: "items[1].sentences[0]" }));
  });

  it("短い「」(6文字未満)は照合しない", () => {
    const s = validStory();
    s.items[0]!.sentences[0]!.text = "法案は「改正法」と呼ばれる。";
    expect(verifyStory(s, SOURCES, TOPIC).passed).toBe(true);
  });

  it("date_mismatch", () => {
    const s = validStory();
    s.items[2]!.date = "2026-10-31";
    const r = verifyStory(s, SOURCES, TOPIC);
    expect(r.issues).toContainEqual(expect.objectContaining({ code: "date_mismatch", path: "items[2].date" }));
  });

  it("speaker_mismatch: 別人の発言を出典にしている", () => {
    const s = validStory();
    s.items[1]!.sentences[0] = {
      text: "佐藤花子議員は被害者保護が必要だと述べた。",
      citations: [{ source_id: "src_sp_A" }],
    };
    const r = verifyStory(s, SOURCES, TOPIC);
    expect(r.issues).toContainEqual(expect.objectContaining({ code: "speaker_mismatch", path: "items[1].sentences[0]" }));
  });

  it("perspectives: 1件しかない / 立場が同じ", () => {
    const s = validStory();
    s.perspectives = [s.perspectives[0]!];
    expect(codes(verifyStory(s, SOURCES, TOPIC))).toContain("perspectives");
    const t = validStory();
    t.perspectives[1]!.stance = "賛成";
    expect(codes(verifyStory(t, SOURCES, TOPIC))).toContain("perspectives");
  });

  it("banned_expression: 引用の外の禁止表現は不合格、引用内は可", () => {
    const s = validStory();
    s.items[0]!.sentences[0]!.text = "政府は情報を隠蔽した。";
    const r = verifyStory(s, SOURCES, TOPIC);
    expect(r.issues).toContainEqual(expect.objectContaining({ code: "banned_expression", path: "items[0].sentences[0]" }));

    const t = validStory();
    t.items[0]!.sentences[0]!.text = "受理された(「隠蔽」)。";
    expect(verifyStory(t, SOURCES, TOPIC).passed).toBe(true);
    expect(BANNED_EXPRESSIONS).toContain("隠蔽");
  });
});

describe("normalizeForMatch", () => {
  it("NFKC にして空白・改行・全角空白を除く", () => {
    expect(normalizeForMatch("ＡＢ　c\r\n d")).toBe("ABcd");
  });
});
