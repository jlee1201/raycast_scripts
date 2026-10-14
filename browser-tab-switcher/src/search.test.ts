import { describe, expect, it } from "vitest";
import { highlightMarkdown, rankItems, searchItem } from "./search";

describe("searchItem", () => {
  it("matches everything with no highlights when the query is blank", () => {
    expect(searchItem("  ", "Anything", "https://a.example")).toEqual({ score: 0, titleRanges: [], urlRanges: [] });
  });

  it("returns null when the characters are not present in order", () => {
    expect(searchItem("zzz", "Notion", "https://notion.so")).toBeNull();
  });

  it("highlights a literal substring case-insensitively", () => {
    const r = searchItem("notion", "My Notion page", "https://example.com")!;
    expect(r.titleRanges).toEqual([[3, 9]]);
    expect(r.urlRanges).toEqual([]);
  });

  it("ranks a literal title match above a literal URL match above a fuzzy match", () => {
    const title = searchItem("notion", "Notion home", "https://example.com")!;
    const url = searchItem("notion", "Home", "https://www.notion.so/page")!;
    const fuzzy = searchItem("notion", "extract TurnOnEstimateNotificationsSubscriber", "https://github.com/pull/1")!;
    expect(title.score).toBeGreaterThan(url.score);
    expect(url.score).toBeGreaterThan(fuzzy.score);
  });

  it("scores a literal match above any fuzzy match, however compact the fuzzy one is", () => {
    const literalInUrl = searchItem("notion", "x", "https://a.example/some/very/long/path/notion")!;
    const fuzzyInTitle = searchItem("notion", "notificatio n", "https://a.example")!;
    expect(literalInUrl.score).toBeGreaterThan(fuzzyInTitle.score);
  });

  it("prefers a match at the start of a word", () => {
    const wordStart = searchItem("note", "My notes", "")!;
    const midWord = searchItem("note", "Denote", "")!;
    expect(wordStart.score).toBeGreaterThan(midWord.score);
  });

  it("treats non-ASCII letters as part of a word when judging word starts", () => {
    const afterSpace = searchItem("note", "Café note", "")!;
    const afterLetter = searchItem("note", "Cafénote", "")!;
    expect(afterSpace.score).toBeGreaterThan(afterLetter.score);
  });

  it("falls back to fuzzy matching and highlights the tightest in-order characters", () => {
    const r = searchItem("notion", "Notifications", "")!;
    expect(r.titleRanges).toEqual([
      [0, 4],
      [10, 12],
    ]);
  });

  it("does not highlight fuzzy noise in a field when the other field has a literal match", () => {
    const r = searchItem("notion", "Notifications of things", "https://notion.so/x")!;
    expect(r.titleRanges).toEqual([]);
    expect(r.urlRanges).toEqual([[8, 14]]);
  });

  it("requires every whitespace-separated term to match", () => {
    expect(searchItem("notion roadmap", "Notion", "https://notion.so")).toBeNull();
    const r = searchItem("notion roadmap", "Roadmap", "https://notion.so/q3")!;
    expect(r.titleRanges).toEqual([[0, 7]]);
    expect(r.urlRanges).toEqual([[8, 14]]);
  });
});

describe("rankItems", () => {
  const rows = [
    { title: "Alpha", url: "https://github.com/x/NotificationsSubscriber" },
    { title: "Notion - Roadmap", url: "https://www.notion.so/roadmap" },
    { title: "Unrelated", url: "https://example.com" },
    { title: "Docs", url: "https://www.notion.so/docs" },
  ];

  it("drops non-matches and orders literal matches before fuzzy ones", () => {
    const out = rankItems("notion", rows, (r) => r.title, (r) => r.url);
    expect(out.map((o) => o.item.title)).toEqual(["Notion - Roadmap", "Docs", "Alpha"]);
  });

  it("keeps the original order when the query is blank", () => {
    const out = rankItems("", rows, (r) => r.title, (r) => r.url);
    expect(out.map((o) => o.item.title)).toEqual(rows.map((r) => r.title));
  });

  it("keeps original order among equal scores", () => {
    const same = [
      { title: "b notion", url: "" },
      { title: "a notion", url: "" },
    ];
    const out = rankItems("notion", same, (r) => r.title, (r) => r.url);
    expect(out.map((o) => o.item.title)).toEqual(["b notion", "a notion"]);
  });
});

describe("highlightMarkdown", () => {
  it("wraps matched ranges in code spans", () => {
    expect(highlightMarkdown("My Notion page", [[3, 9]])).toBe("My `Notion` page");
  });

  it("escapes markdown syntax in unmatched text", () => {
    expect(highlightMarkdown("a_b *c* [d]", [])).toBe("a\\_b \\*c\\* \\[d\\]");
  });

  it("never lets a backtick in matched text break out of the code span", () => {
    expect(highlightMarkdown("a`b", [[0, 3]])).toBe("`a'b`");
  });

  it("handles a match that touches the start and end", () => {
    expect(highlightMarkdown("abc", [[0, 3]])).toBe("`abc`");
  });
});
