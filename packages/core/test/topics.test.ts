import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeAuto, extractLawTerms, parseFeed, searchStem, stripSourceSuffix, topicIdFor } from "../src";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

describe("extractLawTerms", () => {
  const items = parseFeed(decodeAuto(fixture("news-google.xml")));
  const terms = new Set(items.flatMap((it) => extractLawTerms(it.title)));

  it("話題の法律名を抽出する", () => {
    for (const t of ["AI法", "定数削減法", "消費税減税法"]) expect(terms).toContain(t);
  });

  it("一般的な言い方や外国の法律は除外する", () => {
    for (const t of ["重要法", "提出法", "豪LNG輸出規制法", "米ビットコイン準備金法", "2026年度法"]) {
      expect(terms).not.toContain(t);
    }
  });

  it("接頭辞を除き、法案・罪を正規化する", () => {
    expect(extractLawTerms("改正入管法が成立、不同意性交等罪の新設も 法務委員会で可決 - 共同")).toEqual([
      "入管法",
      "不同意性交等罪",
    ]);
  });

  it("法務・方法などは法律名にしない", () => {
    expect(extractLawTerms("法務省が新しい方法を検討")).toEqual([]);
  });
});

describe("stripSourceSuffix", () => {
  it("末尾の媒体名を除く", () => {
    expect(stripSourceSuffix("AI法改正案の概要判明 - Yahoo!ニュース")).toBe("AI法改正案の概要判明");
    expect(stripSourceSuffix("媒体名なし")).toBe("媒体名なし");
  });
});

describe("searchStem", () => {
  it("末尾の法・罪・条約を除く", () => {
    expect(searchStem("消費税減税法")).toBe("消費税減税");
    expect(searchStem("不同意性交等罪")).toBe("不同意性交等");
    expect(searchStem("刑法")).toBe("刑法");
  });
});

describe("topicIdFor", () => {
  it("同じ入力から同じ ID を作る", async () => {
    const a = await topicIdFor("定数削減法");
    expect(a).toMatch(/^tp_[0-9a-f]{12}$/);
    expect(await topicIdFor("定数削減法")).toBe(a);
    expect(await topicIdFor("AI法")).not.toBe(a);
  });
});
