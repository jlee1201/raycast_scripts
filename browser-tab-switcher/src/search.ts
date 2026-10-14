export type Range = [start: number, end: number];

export type SearchResult = { score: number; titleRanges: Range[]; urlRanges: Range[] };

// Literal matches always outscore fuzzy ones: the lowest literal (URL, mid-word) is 600,
// the highest fuzzy (title, zero gaps) is 200.
const TITLE_LITERAL = 1000;
const URL_LITERAL = 600;
const WORD_START_BONUS = 100;
const TITLE_FUZZY = 200;
const URL_FUZZY = 100;
const MAX_GAP_PENALTY = 99;

type FieldMatch = { kind: "literal" | "fuzzy"; score: number; ranges: Range[] };

// Same length as the input so indices into the folded text are valid in the original.
function fold(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) out += s[i].toLowerCase()[0] ?? s[i];
  return out;
}

function isWordStart(text: string, i: number): boolean {
  return i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]);
}

function mergeAdjacent(indices: number[]): Range[] {
  const ranges: Range[] = [];
  for (const i of indices) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
  }
  return ranges;
}

function matchLiteral(term: string, text: string, folded: string): { ranges: Range[]; wordStart: boolean } | null {
  const ranges: Range[] = [];
  let wordStart = false;
  for (let i = folded.indexOf(term); i !== -1; i = folded.indexOf(term, i + term.length)) {
    ranges.push([i, i + term.length]);
    if (isWordStart(text, i)) wordStart = true;
  }
  return ranges.length ? { ranges, wordStart } : null;
}

// Tightest in-order subsequence: try every start of the first character, keep the shortest span.
function matchFuzzy(term: string, folded: string): { indices: number[]; span: number } | null {
  let best: { indices: number[]; span: number } | null = null;
  for (let start = folded.indexOf(term[0]); start !== -1; start = folded.indexOf(term[0], start + 1)) {
    const indices = [start];
    let from = start + 1;
    for (let t = 1; t < term.length; t++) {
      const at = folded.indexOf(term[t], from);
      if (at === -1) break;
      indices.push(at);
      from = at + 1;
    }
    if (indices.length < term.length) break; // later starts have even less text left
    const span = indices[indices.length - 1] - start + 1;
    if (!best || span < best.span) best = { indices, span };
  }
  return best;
}

function matchField(term: string, text: string, literalBase: number, fuzzyBase: number): FieldMatch | null {
  const folded = fold(text);
  const literal = matchLiteral(term, text, folded);
  if (literal) {
    return {
      kind: "literal",
      score: literalBase + (literal.wordStart ? WORD_START_BONUS : 0),
      ranges: literal.ranges,
    };
  }
  const fuzzy = matchFuzzy(term, folded);
  if (!fuzzy) return null;
  const gaps = Math.min(fuzzy.span - term.length, MAX_GAP_PENALTY);
  return { kind: "fuzzy", score: fuzzyBase - gaps, ranges: mergeAdjacent(fuzzy.indices) };
}

export function searchItem(query: string, title: string, url: string): SearchResult | null {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const result: SearchResult = { score: 0, titleRanges: [], urlRanges: [] };

  for (const term of terms) {
    const inTitle = matchField(term, title, TITLE_LITERAL, TITLE_FUZZY);
    const inUrl = matchField(term, url, URL_LITERAL, URL_FUZZY);
    if (!inTitle && !inUrl) return null;

    // Only highlight the strongest kind of match, so scattered fuzzy letters in one field
    // don't clutter a field that has the real hit.
    const anyLiteral = inTitle?.kind === "literal" || inUrl?.kind === "literal";
    const kind = anyLiteral ? "literal" : "fuzzy";
    const t = inTitle?.kind === kind ? inTitle : null;
    const u = inUrl?.kind === kind ? inUrl : null;

    result.score += Math.max(t?.score ?? 0, u?.score ?? 0);
    if (t) result.titleRanges.push(...t.ranges);
    if (u) result.urlRanges.push(...u.ranges);
  }

  result.titleRanges = normalizeRanges(result.titleRanges);
  result.urlRanges = normalizeRanges(result.urlRanges);
  return result;
}

function normalizeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

export function rankItems<T>(
  query: string,
  items: T[],
  getTitle: (item: T) => string,
  getUrl: (item: T) => string,
): { item: T; result: SearchResult }[] {
  const ranked: { item: T; result: SearchResult }[] = [];
  for (const item of items) {
    const result = searchItem(query, getTitle(item), getUrl(item));
    if (result) ranked.push({ item, result });
  }
  // Array.prototype.sort is stable, so equal scores keep their incoming order.
  return ranked.sort((a, b) => b.result.score - a.result.score);
}

const MARKDOWN_SPECIALS = /[\\`*_{}[\]()#+\-.!<>|~&]/g;

export function highlightMarkdown(text: string, ranges: Range[]): string {
  const escape = (s: string) => s.replace(MARKDOWN_SPECIALS, "\\$&");
  let out = "";
  let pos = 0;
  for (const [s, e] of ranges) {
    out += escape(text.slice(pos, s));
    out += "`" + text.slice(s, e).replace(/`/g, "'") + "`";
    pos = e;
  }
  return out + escape(text.slice(pos));
}
