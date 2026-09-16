import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Toast,
  closeMainWindow,
  showToast,
} from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Session, listSessions, prettyPath } from "./sessions";
import { Snippet, searchContent } from "./search";

const execFileAsync = promisify(execFile);

const ALL_PROJECTS = "__all__";
const MIN_CONTENT_QUERY = 2;
const DEBOUNCE_MS = 200;

async function openInClaudeDesktop(session: Session) {
  // Claude Desktop registers the `claude://` scheme; `resume` looks a session up by DESKTOP's
  // own internal id. Pass session.openId (not the CLI sessionId) — for ~20% of sessions those
  // differ, and passing the CLI id there would miss the lookup and create an untitled duplicate.
  // See the `openId` doc comment in sessions.ts. The id is a UUID, so no escaping needed.
  await execFileAsync("/usr/bin/open", [`claude://resume?session=${session.openId}`]);
}

// --- markdown helpers -------------------------------------------------------

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}[\]()#+\-.!>~|])/g, "\\$1");
}

/** Escape markdown, bolding every case-insensitive occurrence of `q`. */
function highlight(text: string, q: string): string {
  const query = q.trim();
  if (!query) return escapeMd(text);
  const lc = text.toLowerCase();
  const ql = query.toLowerCase();
  let out = "";
  let i = 0;
  for (;;) {
    const j = lc.indexOf(ql, i);
    if (j < 0) {
      out += escapeMd(text.slice(i));
      break;
    }
    out += escapeMd(text.slice(i, j)) + "**" + escapeMd(text.slice(j, j + query.length)) + "**";
    i = j + query.length;
  }
  return out;
}

function roleLabel(role: Snippet["role"]): string {
  if (role === "user") return "_You_ · ";
  if (role === "assistant") return "_Claude_ · ";
  return "";
}

function metaMatch(s: Session, q: string): boolean {
  return (
    s.title.toLowerCase().includes(q) ||
    s.preview.toLowerCase().includes(q) ||
    s.projectPath.toLowerCase().includes(q) ||
    (s.gitBranch?.toLowerCase().includes(q) ?? false) ||
    s.sessionId.toLowerCase().includes(q)
  );
}

// --- component --------------------------------------------------------------

export default function Command() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [project, setProject] = useState<string>(ALL_PROJECTS);
  const [showingDetail, setShowingDetail] = useState(false);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [contentHits, setContentHits] = useState<Map<string, Snippet[]>>(new Map());
  const [searching, setSearching] = useState(false);
  const rgMissingWarned = useRef(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const all = await Promise.resolve().then(listSessions);
      setSessions(all);
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to load sessions", message: String(e) });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Debounce the search text before hitting ripgrep.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Run the content search whenever the debounced query changes; abort stale runs.
  useEffect(() => {
    const q = debounced.trim();
    if (q.length < MIN_CONTENT_QUERY) {
      setContentHits(new Map());
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    searchContent(q, controller.signal)
      .then((hits) => {
        if (!controller.signal.aborted) setContentHits(hits);
      })
      .catch(async (e) => {
        if (controller.signal.aborted) return;
        setContentHits(new Map());
        if (String(e).includes("ripgrep") && !rgMissingWarned.current) {
          rgMissingWarned.current = true;
          await showToast({
            style: Toast.Style.Failure,
            title: "Content search unavailable",
            message: "ripgrep (rg) not found — searching titles/prompts only. Install with: brew install ripgrep",
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [debounced]);

  const projects = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const s of sessions ?? []) {
      const entry = counts.get(s.projectPath) ?? { name: s.projectName, count: 0 };
      entry.count += 1;
      counts.set(s.projectPath, entry);
    }
    return [...counts.entries()]
      .map(([path, v]) => ({ path, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [sessions]);

  const q = query.trim().toLowerCase();

  const visible = useMemo(() => {
    let list = sessions ?? [];
    if (project !== ALL_PROJECTS) list = list.filter((s) => s.projectPath === project);
    if (q.length > 0) list = list.filter((s) => metaMatch(s, q) || contentHits.has(s.sessionId));
    return list;
  }, [sessions, project, q, contentHits]);

  const hasQuery = q.length > 0;
  const detailOn = showingDetail || (hasQuery && contentHits.size > 0);

  return (
    <List
      isLoading={isLoading || searching}
      filtering={false}
      throttle
      onSearchTextChange={setQuery}
      isShowingDetail={detailOn}
      searchBarPlaceholder="Search titles, prompts & transcript contents…"
      searchBarAccessory={
        <List.Dropdown tooltip="Filter by project" value={project} onChange={setProject} storeValue>
          <List.Dropdown.Item title="All Projects" value={ALL_PROJECTS} icon={Icon.Folder} />
          <List.Dropdown.Section title="Projects">
            {projects.map((p) => (
              <List.Dropdown.Item key={p.path} title={`${p.name} (${p.count})`} value={p.path} icon={Icon.Folder} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title={isLoading ? "Loading sessions…" : hasQuery ? "No matching sessions" : "No sessions found"}
        description={
          isLoading
            ? undefined
            : hasQuery
              ? "No title, prompt, or transcript content matched."
              : "No Claude Code transcripts were found under ~/.claude/projects."
        }
      />
      {visible.map((s) => {
        const pretty = prettyPath(s.projectPath);
        const hits = contentHits.get(s.sessionId);

        const accessories: List.Item.Accessory[] = [];
        if (!detailOn) {
          if (hits && hits.length) {
            accessories.push({
              tag: { value: `${hits.length}${hits.length >= 3 ? "+" : ""} in transcript`, color: Color.Green },
              icon: Icon.Text,
            });
          }
          if (s.archived) accessories.push({ icon: { source: Icon.Tray, tintColor: Color.SecondaryText } });
          if (s.gitBranch) accessories.push({ tag: { value: s.gitBranch, color: Color.SecondaryText } });
          accessories.push({ date: new Date(s.lastActivity) });
        }

        return (
          <List.Item
            key={s.sessionId}
            icon={{ source: Icon.Message, tintColor: hits && hits.length ? Color.Green : Color.Purple }}
            title={s.title}
            subtitle={detailOn ? undefined : pretty}
            accessories={accessories}
            detail={<List.Item.Detail markdown={detailMarkdown(s, hits, debounced)} metadata={detailMetadata(s, hits)} />}
            actions={
              <ActionPanel>
                <ActionPanel.Section>
                  <Action
                    title="Open in Claude Desktop"
                    icon={Icon.AppWindow}
                    onAction={async () => {
                      try {
                        // Open first, close the Raycast window last: Raycast can tear this
                        // process down shortly after closeMainWindow() resolves, so anything
                        // placed after it risks never running.
                        await openInClaudeDesktop(s);
                        await closeMainWindow();
                      } catch (e) {
                        debugLog(runId, `onAction: error ${String(e)}`);
                        await showToast({
                          style: Toast.Style.Failure,
                          title: "Couldn't open session",
                          message: String(e),
                        });
                      }
                    }}
                  />
                  <Action
                    title="Toggle Details"
                    icon={Icon.Sidebar}
                    shortcut={{ modifiers: ["cmd"], key: "d" }}
                    onAction={() => setShowingDetail((v) => !v)}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action.CopyToClipboard
                    title="Copy Resume Command"
                    content={`claude --resume ${s.sessionId}`}
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                  />
                  <Action.CopyToClipboard
                    title="Copy Session ID"
                    content={s.sessionId}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                  />
                  <Action.ShowInFinder
                    title="Show Transcript in Finder"
                    path={s.transcriptPath}
                    shortcut={{ modifiers: ["cmd"], key: "f" }}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action
                    title="Refresh"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={load}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

function detailMarkdown(s: Session, hits: Snippet[] | undefined, query: string): string {
  const lines = [`## ${escapeMd(s.title)}`, ""];
  if (hits && hits.length) {
    lines.push(`**${hits.length}${hits.length >= 3 ? "+" : ""} match${hits.length === 1 ? "" : "es"} in transcript**`, "");
    for (const h of hits) {
      lines.push(`> ${roleLabel(h.role)}${highlight(h.text, query)}`, "");
    }
  } else if (s.preview) {
    lines.push(`> ${highlight(s.preview, query)}`, "");
  }
  return lines.join("\n");
}

function detailMetadata(s: Session, hits: Snippet[] | undefined) {
  return (
    <List.Item.Detail.Metadata>
      <List.Item.Detail.Metadata.Label title="Project" text={prettyPath(s.projectPath)} icon={Icon.Folder} />
      {s.gitBranch ? <List.Item.Detail.Metadata.Label title="Branch" text={s.gitBranch} icon={Icon.Code} /> : null}
      <List.Item.Detail.Metadata.Label title="Last message" text={new Date(s.lastActivity).toLocaleString()} />
      <List.Item.Detail.Metadata.Label title="Session ID" text={s.sessionId} />
      <List.Item.Detail.Metadata.TagList title="Title">
        <List.Item.Detail.Metadata.TagList.Item
          text={
            s.titleSource === "user"
              ? "curated"
              : s.titleSource === "auto"
                ? "auto"
                : s.titleSource === "message"
                  ? "from prompt"
                  : "untitled"
          }
          color={s.titleSource === "user" ? Color.Blue : Color.SecondaryText}
        />
        {hits && hits.length ? (
          <List.Item.Detail.Metadata.TagList.Item text="content match" color={Color.Green} />
        ) : null}
        {s.archived ? <List.Item.Detail.Metadata.TagList.Item text="archived" color={Color.Orange} /> : null}
      </List.Item.Detail.Metadata.TagList>
    </List.Item.Detail.Metadata>
  );
}
