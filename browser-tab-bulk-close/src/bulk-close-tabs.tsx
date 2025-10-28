import { Action, ActionPanel, Color, Icon, List, Toast, confirmAlert, showToast, Form, useNavigation } from "@raycast/api";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { useEffect, useMemo, useState } from "react";

const execFileAsync = promisify(execFile);

type BrowserName = "Safari" | "Google Chrome" | "Brave Browser" | "Microsoft Edge";

type BrowserTab = {
  browser: BrowserName;
  windowIndex: number;
  tabIndex: number;
  title: string;
  url: string;
};

const SUPPORTED_BROWSERS: BrowserName[] = ["Safari", "Google Chrome", "Brave Browser", "Microsoft Edge"];

function computeHostname(url: string | undefined): string {
  if (!url) {
    return "";
  }
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

async function listAllTabs(): Promise<BrowserTab[]> {
  const jxa = `
function getTabs(appName) {
  try {
    var app = Application(appName);
    if (!app.running()) { return []; }
    var isSafari = appName === 'Safari';
    var out = [];
    var wins = app.windows();
    for (var wi=0; wi<wins.length; wi++) {
      var w = wins[wi];
      var tabs = w.tabs();
      for (var ti=0; ti<tabs.length; ti++) {
        var t = tabs[ti];
        var title = isSafari ? t.name() : t.title();
        var url = t.url();
        if (typeof title !== 'string') title = '';
        if (typeof url !== 'string') url = '';
        out.push({ browser: appName, windowIndex: wi + 1, tabIndex: ti + 1, title: title, url: url });
      }
    }
    return out;
  } catch (e) { return []; }
}
var all = [];
var browsers = ${JSON.stringify(SUPPORTED_BROWSERS)};
for (var i=0;i<browsers.length;i++) { var b = browsers[i]; var ts = getTabs(b); for (var j=0;j<ts.length;j++) all.push(ts[j]); }
JSON.stringify(all);
`;
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", jxa]);
  return JSON.parse(stdout.trim() || "[]") as BrowserTab[];
}

async function closeTabs(tabs: BrowserTab[]) {
  // Group by browser and window for efficient AppleScript
  const byBrowser = new Map<BrowserName, Map<number, number[]>>();
  for (const t of tabs) {
    const winMap = byBrowser.get(t.browser) ?? new Map<number, number[]>();
    const list = winMap.get(t.windowIndex) ?? [];
    list.push(t.tabIndex);
    winMap.set(t.windowIndex, list);
    byBrowser.set(t.browser, winMap);
  }

  for (const [browser, winMap] of byBrowser) {
    const isSafari = browser === "Safari";
    // For each window, close tabs in descending index to avoid reindexing issues
    let script = `tell application "${browser}"\nactivate\ntry\n`;
    for (const [winIdx, tabIdxs] of winMap) {
      const sorted = [...tabIdxs].sort((a, b) => b - a);
      script += `if (count of windows) > 0 then\n`;
      script += `set index of window ${winIdx} to 1\n`;
      for (const ti of sorted) {
        script += isSafari
          ? `try\nclose tab ${ti} of window 1\nend try\n`
          : `try\nclose (tab ${ti} of window 1)\nend try\n`;
      }
      script += `end if\n`;
    }
    script += `end try\nend tell`;
    await execFileAsync("/usr/bin/osascript", ["-e", script]);
  }
}

export default function Command() {
  const [allTabs, setAllTabs] = useState<BrowserTab[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const { push, pop } = useNavigation();

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const tabs = await listAllTabs();
        setAllTabs(tabs);
      } catch (e) {
        await showToast({ style: Toast.Style.Failure, title: "Failed to list tabs", message: String(e) });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTabs;
    return allTabs.filter((t) => (t.title + " " + t.url).toLowerCase().includes(q));
  }, [allTabs, query]);

  const closeCount = filtered.length;

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Type to filter tabs to close (e.g., zoom, calendar, localhost)"
    >
      <List.Section title={`Matches (${closeCount})`} subtitle={query ? `Filter: ${query}` : undefined}>
        {filtered.map((t) => {
          const hostname = computeHostname(t.url);
          const displayTitle = t.title || t.url || "Untitled";
          // Append hostname to title for better searchability
          const searchableTitle = hostname && !displayTitle.includes(hostname) 
            ? `${displayTitle} - ${hostname}`
            : displayTitle;
          
          return (
            <List.Item
              key={`${t.browser}-${t.windowIndex}-${t.tabIndex}-${t.url}`}
              title={searchableTitle}
              subtitle={t.url}
              accessories={[{ tag: { value: t.browser, color: browserColor(t.browser) } }]}
              icon={iconForBrowser(t.browser)}
              actions={
                <ActionPanel>
                <Action
                  title={`Close All (${closeCount})`}
                  icon={Icon.Trash}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
                  onAction={() => {
                    push(
                      <ConfirmPhraseForm
                        count={closeCount}
                        onConfirm={async () => {
                          await closeTabs(filtered);
                          await showToast({ style: Toast.Style.Success, title: `Closed ${closeCount} tabs` });
                          await refresh();
                          pop();
                        }}
                      />
                    );
                  }}
                />
                <Action
                  title="Close This Tab"
                  icon={Icon.XmarkCircle}
                  onAction={async () => {
                    await confirmAndClose([t]);
                    await refresh();
                  }}
                />
                <Action title="Refresh" icon={Icon.Repeat} onAction={refresh} />
              </ActionPanel>
            }
          />
          );
        })}
      </List.Section>
    </List>
  );

  async function refresh() {
    setIsLoading(true);
    try {
      const tabs = await listAllTabs();
      setAllTabs(tabs);
    } finally {
      setIsLoading(false);
    }
  }

  async function confirmAndClose(tabs: BrowserTab[]) {
    if (tabs.length === 0) return;
    const ok = await confirmAlert({
      title: `Close ${tabs.length} tab${tabs.length === 1 ? "" : "s"}?`,
      message: "This will close matching tabs across all supported browsers.",
      primaryAction: { title: "Close Tabs", style: "destructive" },
    });
    if (!ok) return;
    try {
      await closeTabs(tabs);
      await showToast({ style: Toast.Style.Success, title: `Closed ${tabs.length} tab${tabs.length === 1 ? "" : "s"}` });
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to close tabs", message: String(e) });
    }
  }
}

function browserColor(browser: BrowserName): Color.ColorLike {
  switch (browser) {
    case "Safari":
      return Color.Blue;
    case "Google Chrome":
      return Color.Red;
    case "Brave Browser":
      return Color.Orange;
    case "Microsoft Edge":
      return Color.Green;
  }
}

function iconForBrowser(browser: BrowserName) {
  switch (browser) {
    case "Safari":
      return Icon.Compass;
    case "Google Chrome":
      return Icon.Dot;
    case "Brave Browser":
      return Icon.Shield;
    case "Microsoft Edge":
      return Icon.Globe;
  }
}

function ConfirmPhraseForm(props: { count: number; onConfirm: () => void }) {
  const [text, setText] = useState("");
  const disabled = text.trim().toLowerCase() !== "close";
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={`Type "close" to confirm (${props.count})`}
            icon={Icon.Trash}
            onSubmit={props.onConfirm}
            shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
            disabled={disabled}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="To confirm bulk closing, type the word 'close' below." />
      <Form.TextField id="confirm" title="Confirm Phrase" placeholder="close" value={text} onChange={setText} />
    </Form>
  );
}


