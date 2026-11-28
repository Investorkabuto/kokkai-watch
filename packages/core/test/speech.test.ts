import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSpeechList, speechListUrl } from "../src";

describe("国会会議録 発言検索 API", () => {
  it("speech を解析する", () => {
    const json = JSON.parse(readFileSync(new URL("./fixtures/kokkai-speech.json", import.meta.url), "utf-8"));
    const page = parseSpeechList(json);
    expect(page.total).toBe(218);
    expect(page.nextRecordPosition).toBe(4);
    expect(page.speeches).toHaveLength(3);
    const s = page.speeches[0]!;
    expect(s).toMatchObject({
      speechID: "122215206X00320261105_123",
      issueID: "122215206X00320261105",
      session: 222,
      house: "参議院",
      meetingName: "法務委員会",
      issue: "第3号",
      date: "2026-11-05",
      order: 123,
      speaker: "仁比聡平",
      speakerGroup: "日本共産党",
      speakerPosition: null,
      url: "https://kokkai.ndl.go.jp/txt/122215206X00320261105/123",
      meetingUrl: "https://kokkai.ndl.go.jp/txt/122215206X00320261105",
    });
    expect(s.text.startsWith("○仁比聡平君")).toBe(true);
  });

  it("URL を作る(max は100まで)", () => {
    const u = new URL(speechListUrl({ any: "不同意性交", max: 500, start: 101 }));
    expect(u.pathname).toBe("/api/speech");
    expect(u.searchParams.get("any")).toBe("不同意性交");
    expect(u.searchParams.get("maximumRecords")).toBe("100");
    expect(u.searchParams.get("startRecord")).toBe("101");
    expect(u.searchParams.get("recordPacking")).toBe("json");
  });

  it("エラーメッセージを例外にする", () => {
    expect(() => parseSpeechList({ message: "検索条件が不正です" })).toThrow(/kokkai API error/);
  });
});
