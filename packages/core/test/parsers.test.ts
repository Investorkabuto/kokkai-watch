import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildProgress,
  decodeAuto,
  normalizeBillStatus,
  parseBillKeika,
  parseBillList,
  parseFeed,
  parseMeetingList,
  parseWarekiDate,
} from "../src";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const sjis = (name: string) => decodeAuto(fixture(name));

describe("parseWarekiDate", () => {
  it("令和の日付を西暦にする", () => {
    expect(parseWarekiDate("令和 8年10月 9日")).toBe("2026-10-09");
    expect(parseWarekiDate("令和元年5月1日")).toBe("2019-05-01");
    expect(parseWarekiDate("平成31年4月30日")).toBe("2019-04-30");
    expect(parseWarekiDate("")).toBeNull();
  });
});

describe("衆議院 議案の一覧", () => {
  const bills = parseBillList(sjis("shugiin-gian-menu.sjis.htm"));

  it("衆法・参法・閣法・条約を抽出する", () => {
    const kinds = new Set(bills.map((b) => b.kind));
    expect(kinds).toEqual(new Set(["衆法", "参法", "閣法", "条約"]));
    expect(bills.length).toBeGreaterThan(40);
  });

  it("行の内容を正しく読む", () => {
    const b = bills.find((x) => x.id === "222-kaku-2");
    expect(b).toMatchObject({
      kind: "閣法",
      session: 222,
      number: 2,
      title: "一般職の職員の給与に関する法律等の一部を改正する法律案",
      statusText: "成立",
    });
    expect(b?.keikaUrl).toBe("https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/keika/1DE3442.htm");
    expect(b?.honbunUrl).toBe("https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/honbun/g22209002.htm");
  });

  it("ID が重複しない", () => {
    expect(new Set(bills.map((b) => b.id)).size).toBe(bills.length);
  });
});

describe("衆議院 審議経過", () => {
  it("成立した閣法の経過を読む", () => {
    const k = parseBillKeika(sjis("shugiin-keika-passed.sjis.htm"));
    expect(k.submitter).toBe("内閣");
    expect(k.lawNumber).toBe("79");
    expect(k.events.map((e) => [e.date, e.house, e.stage, e.result])).toEqual([
      ["2026-10-09", "衆議院", "received", null],
      ["2026-10-09", "参議院", "preliminary_received", null],
      ["2026-10-22", "衆議院", "referred", null],
      ["2026-10-28", "衆議院", "committee_decided", "可決"],
      ["2026-10-30", "衆議院", "plenary_decided", "可決"],
      ["2026-10-30", "参議院", "received", null],
      ["2026-11-04", "参議院", "referred", null],
      ["2026-11-10", "参議院", "committee_decided", "可決"],
      ["2026-11-11", "参議院", "plenary_decided", "可決"],
      ["2026-11-18", null, "promulgated", "79"],
    ]);
    expect(k.events.find((e) => e.stage === "referred")?.committee).toBe("内閣");
    expect(k.shugiinVote.attitude).toBe("全会一致");
    expect(k.shugiinVote.for).toContain("日本共産党");

    const progress = buildProgress(k.events);
    expect(progress.map((p) => p.state)).toEqual(["done", "done", "done", "done", "done", "done"]);
    expect(progress[1]?.label).toBe("衆 委員会");
  });

  it("審議中の衆法の経過を読む", () => {
    const k = parseBillKeika(sjis("shugiin-keika-pending.sjis.htm"));
    expect(k.submitter).toBe("落合 貴之君外四名");
    expect(k.submitterGroups.length).toBeGreaterThan(0);
    expect(k.lawNumber).toBeNull();
    const progress = buildProgress(k.events);
    expect(progress.at(-1)?.state).toBe("todo");
  });
});

describe("normalizeBillStatus", () => {
  it.each([
    ["衆議院で審議中", "pending"],
    ["参議院で閉会中審査", "pending"],
    ["成立", "passed"],
    ["承認", "passed"],
    ["衆議院で否決", "rejected"],
    ["撤回", "withdrawn"],
    ["未了", "lapsed"],
  ])("%s → %s", (text, status) => {
    expect(normalizeBillStatus(text)).toBe(status);
  });
});

describe("国会会議録 API", () => {
  it("meeting_list を解析する", () => {
    const page = parseMeetingList(JSON.parse(fixture("kokkai-meeting-list.json").toString("utf-8")));
    expect(page.total).toBeGreaterThan(0);
    const m = page.meetings[0]!;
    expect(m.id).toMatch(/^\d{3}\w+$/);
    expect(m.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.url).toContain("kokkai.ndl.go.jp");
    expect(m.speeches.every((s) => s.order > 0)).toBe(true);
  });

  it("エラーメッセージを例外にする", () => {
    expect(() => parseMeetingList({ message: "パラメータが不正です" })).toThrow(/kokkai API error/);
  });
});

describe("RSS", () => {
  it("RSS 2.0(財務省)", () => {
    const items = parseFeed(decodeAuto(fixture("rss-mof.xml")));
    expect(items.length).toBeGreaterThan(5);
    expect(items[0]!.url).toMatch(/^https:\/\/www\.mof\.go\.jp\//);
    expect(items[0]!.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("RSS 1.0 / Shift_JIS(総務省)", () => {
    const items = parseFeed(decodeAuto(fixture("rss-soumu.sjis.rdf")));
    expect(items.length).toBeGreaterThan(5);
    expect(items[0]!.title).not.toMatch(/[�]/);
    expect(items[0]!.url).toMatch(/^https:\/\/www\.soumu\.go\.jp\//);
  });

  it("RSS 1.0 / UTF-8(内閣府)", () => {
    const items = parseFeed(decodeAuto(fixture("rss-cao.rdf")));
    expect(items.length).toBeGreaterThan(0);
  });

  it("Atom と CDATA", () => {
    const items = parseFeed(`<feed><entry><title><![CDATA[テスト &amp; 発表]]></title>
      <link rel="alternate" href="https://example.go.jp/a?x=1&amp;y=2"/><updated>2026-11-26T09:00:00+09:00</updated></entry></feed>`);
    expect(items).toEqual([
      { title: "テスト & 発表", url: "https://example.go.jp/a?x=1&y=2", publishedAt: "2026-11-26T00:00:00.000Z" },
    ]);
  });
});
