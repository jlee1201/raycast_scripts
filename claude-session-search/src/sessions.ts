import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();

// CLI transcripts: the complete, resumable set. One .jsonl per session, named by session UUID.
export const PROJECTS_DIR = path.join(HOME, ".claude", "projects");

// Claude Desktop's own session index. Tiny one-line JSON files, nested a couple levels deep,
// keyed internally by `cliSessionId` (the same UUID as the CLI transcript filename). We use it
// ONLY for user-curated titles + the archived flag — never for ordering (see the sort note below).
const DESKTOP_SESSIONS_DIR = path.join(HOME, "Library", "Application Support", "Claude", "claude-code-sessions");

// The exact session-id shape Claude Desktop's `claude://resume?session=` handler accepts.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HEAD_BYTES = 32768;
const TAIL_BYTES = 32768;

export type TitleSource = "user" | "auto" | "message" | "none";

export type Session = {
  sessionId: string;
  /**
   * The id to pass to `claude://resume?session=`. For most sessions this equals `sessionId`
   * (the CLI transcript UUID). But ~20% of sessions predate a Desktop id scheme change and have
   * a Desktop-internal id that differs from the CLI UUID ("old-scheme"). Desktop's resume handler
   * looks a session up by ITS OWN internal id, not the CLI UUID — passing the CLI UUID for an
   * old-scheme session misses that lookup, so Desktop treats it as never-seen and re-imports it,
   * creating a second untitled duplicate record instead of reopening the original. Passing the
   * Desktop-internal id instead (when one exists) always hits the lookup and reopens the
   * existing, correctly-titled record. See [[claude-desktop-session-storage-and-deeplink]].
   */
  openId: string;
  projectPath: string;
  projectName: string;
  title: string;
  /** First real user message, used both for search and the detail panel. */
  preview: string;
  /**
   * Epoch ms of the last real message in the transcript. This is deliberately NOT the Desktop
   * index's lastActivityAt nor the file mtime: opening a session in Desktop imports it (bumping
   * lastActivityAt to "now") and rewrites the .jsonl to strip thinking blocks (bumping mtime),
   * either of which would shuffle a freshly-opened session to the top. The transcript's own
   * message timestamps don't change when Desktop opens a session, so ordering stays put.
   */
  lastActivity: number;
  gitBranch?: string;
  archived: boolean;
  titleSource: TitleSource;
  transcriptPath: string;
};

type DesktopEntry = {
  /** The `local_<X>.json` filename UUID — Desktop's own internal session id, used for openId. */
  desktopId: string;
  title?: string;
  titleSource?: string;
  cwd?: string;
  isArchived?: boolean;
};

// ---------------------------------------------------------------------------
// Shared transcript-line text extraction (used here for the first prompt and
// by the content search for building snippets).
// ---------------------------------------------------------------------------

export type LineRole = "user" | "assistant" | "other";

/**
 * Pull the human-readable text out of one parsed transcript line, joining text
 * parts and ignoring thinking blocks, tool calls, tool results, and images.
 * Returns null for meta lines (system reminders, command wrappers, etc.).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractLineText(o: any): { role: LineRole; text: string } | null {
  if (!o || o.isMeta) return null;
  const type = o.type;
  if (type !== "user" && type !== "assistant") return null;

  const content = o.message?.content;
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join(" ");
  }
  text = text.trim();
  if (!text) return null;
  return { role: type, text };
}

/** True for user text that is a real prompt (not a tool/command/system wrapper). */
function isRealPrompt(s: string): boolean {
  return !(s.startsWith("<") || s.startsWith("Caveat:") || s.startsWith("[Request interrupted"));
}

// ---------------------------------------------------------------------------
// Desktop index (titles + archived flag only)
// ---------------------------------------------------------------------------

function collectDesktopFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 4) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      collectDesktopFiles(full, out, depth + 1);
    } else if (e.isFile() && e.name.startsWith("local_") && e.name.endsWith(".json")) {
      out.push(full);
    }
  }
}

const LOCAL_PREFIX = "local_";

function loadDesktopIndex(): Map<string, DesktopEntry> {
  const map = new Map<string, DesktopEntry>();
  const files: string[] = [];
  collectDesktopFiles(DESKTOP_SESSIONS_DIR, files);
  for (const file of files) {
    const base = path.basename(file, ".json");
    if (!base.startsWith(LOCAL_PREFIX)) continue;
    const desktopId = base.slice(LOCAL_PREFIX.length);
    if (!UUID_RE.test(desktopId)) continue;

    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let parsed: (Omit<DesktopEntry, "desktopId"> & { cliSessionId?: string }) | undefined;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed) continue;
    // The `local_<X>.json` filename UUID is Desktop's own internal session id and can differ
    // from the CLI id (older sessions predate a scheme change) — the authoritative link to the
    // CLI transcript is the inner `cliSessionId` field, so key the map off that.
    const cliId = parsed.cliSessionId;
    if (!cliId || !UUID_RE.test(cliId)) continue;

    const o: DesktopEntry = { ...parsed, desktopId };
    // A CLI session can have more than one Desktop record (e.g. a stray duplicate from the old
    // resume bug). Prefer whichever has a user-curated title; among equals, keep the latest seen.
    const existing = map.get(cliId);
    if (existing && existing.titleSource === "user" && o.titleSource !== "user") continue;
    map.set(cliId, o);
  }
  return map;
}

// ---------------------------------------------------------------------------
// CLI transcripts
// ---------------------------------------------------------------------------

function readSlice(file: string, bytes: number, fromEnd: boolean): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const start = fromEnd ? Math.max(0, size - bytes) : 0;
    const len = Math.min(bytes, size - start);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

type Head = { cwd?: string; gitBranch?: string; firstUserText?: string };

function parseTranscriptHead(text: string): Head {
  const head: Head = {};
  if (!text) return head;
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let o: any;
    try {
      o = JSON.parse(s);
    } catch {
      // Final line in our fixed-size window is usually truncated — stop here.
      break;
    }
    if (!head.cwd && typeof o.cwd === "string" && o.cwd) head.cwd = o.cwd;
    if (!head.gitBranch && typeof o.gitBranch === "string" && o.gitBranch) head.gitBranch = o.gitBranch;
    if (!head.firstUserText) {
      const parsed = extractLineText(o);
      if (parsed && parsed.role === "user" && isRealPrompt(parsed.text)) head.firstUserText = parsed.text;
    }
    if (head.cwd && head.gitBranch && head.firstUserText) break;
  }
  return head;
}

/** Max message timestamp (epoch ms) found in a chunk of transcript text. */
function maxTimestampMs(text: string): number | undefined {
  let max: number | undefined;
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let o: any;
    try {
      o = JSON.parse(s);
    } catch {
      continue; // partial first/last line in the window — skip it
    }
    if (typeof o.timestamp === "string") {
      const t = Date.parse(o.timestamp);
      if (!Number.isNaN(t) && (max === undefined || t > max)) max = t;
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function oneLine(s: string, max = 120): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function decodeProjectDir(name: string): string {
  return "/" + name.replace(/^-+/, "").replace(/-/g, "/");
}

export function prettyPath(p: string): string {
  return p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listSessions(): Session[] {
  const desktop = loadDesktopIndex();
  const sessions: Session[] = [];

  let projectDirs: fs.Dirent[];
  try {
    projectDirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return sessions;
  }

  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_DIR, projectDir.name);

    let files: string[];
    try {
      files = fs.readdirSync(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const sessionId = file.slice(0, -".jsonl".length);
      if (!UUID_RE.test(sessionId)) continue;

      const transcriptPath = path.join(dirPath, file);
      let size = 0;
      let mtimeMs = 0;
      try {
        const st = fs.statSync(transcriptPath);
        size = st.size;
        mtimeMs = st.mtimeMs;
      } catch {
        continue;
      }

      const headText = readSlice(transcriptPath, HEAD_BYTES, false);
      const head = parseTranscriptHead(headText);

      // Last message time: from the tail (or the head, if the file is small enough that the
      // head already contains the whole thing). Falls back to mtime only when no timestamp parses.
      const tailText = size > HEAD_BYTES ? readSlice(transcriptPath, TAIL_BYTES, true) : headText;
      const lastMsgMs = maxTimestampMs(tailText) ?? maxTimestampMs(headText) ?? mtimeMs;

      const d = desktop.get(sessionId);
      const projectPath = d?.cwd || head.cwd || decodeProjectDir(projectDir.name);
      const projectName = path.basename(projectPath) || projectPath;

      // Title priority: user-curated Desktop title → Desktop auto title → first prompt → untitled.
      // (Ordering is decoupled from this and stays put, so an auto title appearing after a first
      // open only changes the label, never the position.)
      let title: string;
      let titleSource: TitleSource;
      if (d?.title && d.titleSource === "user") {
        title = d.title;
        titleSource = "user";
      } else if (d?.title) {
        title = d.title;
        titleSource = "auto";
      } else if (head.firstUserText) {
        title = oneLine(head.firstUserText);
        titleSource = "message";
      } else {
        title = `Untitled — ${projectName}`;
        titleSource = "none";
      }

      // Prefer Desktop's own internal id for reopening (see the `openId` doc comment above) —
      // only fall back to the CLI UUID when the session has never been imported into Desktop
      // (no desktop record at all), where a fresh import is correct and there's no title to lose.
      const openId = d?.desktopId ?? sessionId;

      sessions.push({
        sessionId,
        openId,
        projectPath,
        projectName,
        title,
        preview: head.firstUserText ? oneLine(head.firstUserText, 280) : "",
        lastActivity: lastMsgMs,
        gitBranch: head.gitBranch,
        archived: Boolean(d?.isArchived),
        titleSource,
        transcriptPath,
      });
    }
  }

  sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  return sessions;
}
