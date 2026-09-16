import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_DIR, extractLineText, LineRole } from "./sessions";

export type Snippet = { role: LineRole; text: string };

const MIN_QUERY = 2;
const MAX_FILES = 50; // cap distinct sessions we return
const PER_FILE = 3; // snippets kept per session
const RG_MAX_COUNT = 10; // matched lines rg emits per file (we keep the first PER_FILE that are real message text)
const CONTEXT = 80; // chars of context on each side of a match
const MAX_LINE = 100_000; // skip absurdly long lines (context dumps, base64, tool output) — always noise

// Raycast's Node env often lacks Homebrew on PATH, so resolve rg's absolute path ourselves.
const RG_CANDIDATES = [
  "/opt/homebrew/bin/rg",
  "/usr/local/bin/rg",
  "/usr/bin/rg",
  "/opt/local/bin/rg",
  "/home/linuxbrew/.linuxbrew/bin/rg",
];

let rgPathCache: string | null | undefined;

export function findRg(): string | null {
  if (rgPathCache !== undefined) return rgPathCache;
  for (const c of RG_CANDIDATES) {
    try {
      if (fs.existsSync(c)) return (rgPathCache = c);
    } catch {
      /* ignore */
    }
  }
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    const p = path.join(dir, "rg");
    try {
      if (fs.existsSync(p)) return (rgPathCache = p);
    } catch {
      /* ignore */
    }
  }
  return (rgPathCache = null);
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Build a readable, centered snippet around the first occurrence of `q` in `text`. */
function centerSnippet(text: string, q: string): string {
  const clean = collapse(text);
  const j = clean.toLowerCase().indexOf(q.toLowerCase());
  if (j < 0) return clean.slice(0, CONTEXT * 2) + (clean.length > CONTEXT * 2 ? "…" : "");
  const start = Math.max(0, j - CONTEXT);
  const end = Math.min(clean.length, j + q.length + CONTEXT);
  return (start > 0 ? "…" : "") + clean.slice(start, end) + (end < clean.length ? "…" : "");
}

/**
 * Turn one matched JSONL line into a clean snippet — but ONLY if the match lands in real
 * conversation text (a user prompt or assistant reply). Attachments, tool calls/results,
 * meta lines, and oversized context dumps return null so they never pollute results.
 */
function lineToSnippet(lineText: string, q: string): Snippet | null {
  if (!lineText || lineText.length > MAX_LINE) return null;
  let parsed: { role: LineRole; text: string } | null;
  try {
    parsed = extractLineText(JSON.parse(lineText));
  } catch {
    return null;
  }
  if (!parsed) return null;
  if (!parsed.text.toLowerCase().includes(q.toLowerCase())) return null; // match was in JSON noise, not the text
  return { role: parsed.role, text: centerSnippet(parsed.text, q) };
}

/**
 * Full-text search across every transcript via ripgrep. Returns a map of sessionId → snippets
 * (up to PER_FILE each) for up to MAX_FILES sessions. Rejects if rg can't be found.
 */
export function searchContent(query: string, signal?: AbortSignal): Promise<Map<string, Snippet[]>> {
  const q = query.trim();
  const res = new Map<string, Snippet[]>();
  if (q.length < MIN_QUERY) return Promise.resolve(res);

  const rg = findRg();
  if (!rg) return Promise.reject(new Error("ripgrep (rg) not found"));

  return new Promise((resolve, reject) => {
    const child = spawn(
      rg,
      ["--json", "-F", "-i", "--max-count", String(RG_MAX_COUNT), "-e", q, "-g", "*.jsonl", "--", PROJECTS_DIR],
      { stdio: ["ignore", "pipe", "ignore"] },
    );

    const seen = new Set<string>();
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      fn();
    };

    if (signal) {
      if (signal.aborted) finish(() => resolve(res));
      signal.addEventListener("abort", () => finish(() => resolve(res)), { once: true });
    }

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (done) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let o: any;
      try {
        o = JSON.parse(line);
      } catch {
        return;
      }
      if (o.type !== "match") return;
      const p: string | undefined = o.data?.path?.text;
      if (!p) return;
      const id = path.basename(p).replace(/\.jsonl$/, "");

      if (!seen.has(id)) {
        if (seen.size >= MAX_FILES) {
          finish(() => resolve(res));
          return;
        }
        seen.add(id);
      }
      const existing = res.get(id);
      if (existing && existing.length >= PER_FILE) return;

      const snip = lineToSnippet(o.data.lines?.text ?? "", q);
      if (!snip) return;
      if (existing) existing.push(snip);
      else res.set(id, [snip]);
    });

    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", () => finish(() => resolve(res)));
  });
}
