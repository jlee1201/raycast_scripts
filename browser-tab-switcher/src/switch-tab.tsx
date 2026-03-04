import { Action, ActionPanel, Color, Icon, List, Toast, showToast } from "@raycast/api";
import { useEffect, useState } from "react";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";

const execFileAsync = promisify(execFile);

type BrowserName = "Safari" | "Google Chrome" | "Brave Browser" | "Microsoft Edge" | "Thorium";

type CDPSwitch = { kind: "cdp"; port: number; pid: number; tabId: string };
type AppleScriptSwitch = { kind: "applescript"; windowId: number; tabIndex: number };
type SwitchMethod = CDPSwitch | AppleScriptSwitch;

type BrowserTab = {
  browser: BrowserName;
  title: string;
  url: string;
  switchMethod: SwitchMethod;
};

const SAFARI: BrowserName = "Safari";
const CHROMIUM_BROWSERS: BrowserName[] = ["Google Chrome", "Brave Browser", "Microsoft Edge", "Thorium"];

function computeHostname(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// CDP (Chrome DevTools Protocol) – used for Chromium browsers
// ---------------------------------------------------------------------------

type ChromiumInstance = { browser: BrowserName; pid: number; port: number };

function httpGet(url: string, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function discoverChromiumInstances(): Promise<ChromiumInstance[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid,args"]);
    const instances: ChromiumInstance[] = [];
    const seenPorts = new Set<number>();

    for (const line of stdout.split("\n")) {
      if (line.includes("--type=")) continue;
      const portMatch = line.match(/--remote-debugging-port=(\d+)/);
      if (!portMatch) continue;

      const port = parseInt(portMatch[1], 10);
      if (seenPorts.has(port)) continue;
      seenPorts.add(port);

      const pid = parseInt(line.trim().split(/\s+/)[0], 10);

      let browser: BrowserName | null = null;
      if (line.includes("Microsoft Edge")) browser = "Microsoft Edge";
      else if (line.includes("Google Chrome")) browser = "Google Chrome";
      else if (line.includes("Brave Browser")) browser = "Brave Browser";
      else if (line.includes("Thorium")) browser = "Thorium";

      if (browser) instances.push({ browser, pid, port });
    }
    return instances;
  } catch {
    return [];
  }
}

interface CDPTarget {
  id: string;
  title: string;
  url: string;
  type: string;
}

async function listTabsCDP(instance: ChromiumInstance): Promise<BrowserTab[]> {
  try {
    const data = await httpGet(`http://localhost:${instance.port}/json`);
    const targets: CDPTarget[] = JSON.parse(data);

    return targets
      .filter((t) => t.type === "page")
      .map((t) => ({
        browser: instance.browser,
        title: t.title || "",
        url: t.url || "",
        switchMethod: {
          kind: "cdp" as const,
          port: instance.port,
          pid: instance.pid,
          tabId: t.id,
        },
      }));
  } catch {
    return [];
  }
}

async function switchTabCDP(method: CDPSwitch) {
  await httpGet(`http://localhost:${method.port}/json/activate/${method.tabId}`);

  const script = `
tell application "System Events"
  set frontmost of (first process whose unix id is ${method.pid}) to true
end tell`;
  await execFileAsync("/usr/bin/osascript", ["-e", script]);
}

// ---------------------------------------------------------------------------
// JXA / AppleScript – used for Safari (and as fallback)
// ---------------------------------------------------------------------------

async function listTabsJXA(browsers: BrowserName[]): Promise<BrowserTab[]> {
  if (browsers.length === 0) return [];

  const jxa = `
ObjC.import('stdlib');
function getTabs(appName) {
  try {
    var app = Application(appName);
    if (!app.running()) { return []; }
    var isSafari = appName === 'Safari';
    var result = [];
    var windows = app.windows();
    for (var wi = 0; wi < windows.length; wi++) {
      var w = windows[wi];
      var tabs = w.tabs();
      for (var ti = 0; ti < tabs.length; ti++) {
        var t = tabs[ti];
        var title = isSafari ? t.name() : t.title();
        var url = t.url();
        if (typeof url !== 'string') { url = ''; }
        if (typeof title !== 'string') { title = ''; }
        result.push({ browser: appName, windowId: w.id(), tabIndex: ti + 1, title: title, url: url });
      }
    }
    return result;
  } catch (e) {
    return [];
  }
}
var browsers = ${JSON.stringify(browsers)};
var all = [];
for (var i = 0; i < browsers.length; i++) {
  var tabs = getTabs(browsers[i]);
  for (var j = 0; j < tabs.length; j++) { all.push(tabs[j]); }
}
JSON.stringify(all);
`;

  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", jxa]);
  const parsed = JSON.parse(stdout.trim() || "[]") as Array<{
    browser: BrowserName;
    windowId: number;
    tabIndex: number;
    title: string;
    url: string;
  }>;

  return parsed.map((t) => ({
    browser: t.browser,
    title: t.title,
    url: t.url,
    switchMethod: { kind: "applescript" as const, windowId: t.windowId, tabIndex: t.tabIndex },
  }));
}

async function switchTabAppleScript(browser: BrowserName, method: AppleScriptSwitch) {
  const isSafari = browser === "Safari";

  const script = `
tell application "${browser}"
  set wasAlreadyFrontmost to frontmost
  set targetWindowVisible to false

  try
    set targetWindow to (first window whose id is ${method.windowId})
    set targetWindowVisible to visible of targetWindow
  end try

  activate

  repeat 20 times
    if frontmost then exit repeat
    delay 0.05
  end repeat

  try
    set targetWindow to (first window whose id is ${method.windowId})
    set index of targetWindow to 1

    if targetWindowVisible and wasAlreadyFrontmost then
      delay 0.1
    else
      set visible of window 1 to true
      delay 0.6
      repeat 10 times
        try
          set windowName to name of window 1
          exit repeat
        on error
          delay 0.1
        end try
      end repeat
    end if

    set tabSwitched to false
    repeat 3 times
      try
        ${isSafari ? `set current tab of window 1 to tab ${method.tabIndex} of window 1` : `set active tab index of window 1 to ${method.tabIndex}`}
        set tabSwitched to true
        exit repeat
      on error
        activate
        set targetWindow to (first window whose id is ${method.windowId})
        set index of targetWindow to 1
        delay 0.2
      end try
    end repeat

    if not tabSwitched then
      error "Failed to switch to tab after multiple attempts"
    end if

  on error errMsg
    error errMsg
  end try
end tell`;

  await execFileAsync("/usr/bin/osascript", ["-e", script]);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function listAllTabs(): Promise<BrowserTab[]> {
  const all: BrowserTab[] = [];

  const chromiumInstances = await discoverChromiumInstances();
  const browsersWithCDP = new Set(chromiumInstances.map((i) => i.browser));

  const cdpResults = await Promise.all(chromiumInstances.map(listTabsCDP));
  for (const tabs of cdpResults) all.push(...tabs);

  const jxaBrowsers: BrowserName[] = [SAFARI];
  for (const b of CHROMIUM_BROWSERS) {
    if (!browsersWithCDP.has(b)) jxaBrowsers.push(b);
  }
  const jxaTabs = await listTabsJXA(jxaBrowsers);
  all.push(...jxaTabs);

  return all;
}

async function focusAndSwitchToTab(tab: BrowserTab) {
  const m = tab.switchMethod;
  if (m.kind === "cdp") {
    await switchTabCDP(m);
  } else {
    await switchTabAppleScript(tab.browser, m);
  }
}

function tabKey(tab: BrowserTab): string {
  const m = tab.switchMethod;
  if (m.kind === "cdp") return `cdp-${m.port}-${m.tabId}`;
  return `as-${tab.browser}-${m.windowId}-${m.tabIndex}`;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export default function Command() {
  const [tabs, setTabs] = useState<BrowserTab[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadTabs = async () => {
    setIsLoading(true);
    try {
      const all = await listAllTabs();
      all.sort((a, b) =>
        a.browser === b.browser ? a.title.localeCompare(b.title) : a.browser.localeCompare(b.browser),
      );
      setTabs(all);
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to list tabs", message: String(e) });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTabs();
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search tabs across browsers…">
      {tabs?.map((t) => {
        const subtitle = t.url || "";
        const hostname = computeHostname(subtitle);

        const keywords: string[] = [];
        if (subtitle) {
          keywords.push(subtitle);
          if (hostname) keywords.push(hostname);
          try {
            const url = new URL(subtitle);
            const pathSegments = url.pathname.split("/").filter((s) => s.length > 0);
            keywords.push(...pathSegments);
          } catch {
            // skip
          }
        }

        const displayTitle = t.title || subtitle || "Untitled";
        const searchableTitle =
          hostname && !displayTitle.includes(hostname) ? `${displayTitle} - ${hostname}` : displayTitle;

        return (
          <List.Item
            key={tabKey(t)}
            title={searchableTitle}
            subtitle={subtitle}
            keywords={keywords}
            accessories={[{ tag: { value: t.browser, color: browserColor(t.browser) } }]}
            icon={iconForBrowser(t.browser)}
            actions={
              <ActionPanel>
                <Action
                  title="Switch to This Tab"
                  icon={Icon.Switch}
                  onAction={async () => {
                    try {
                      await focusAndSwitchToTab(t);
                      await showToast({ style: Toast.Style.Success, title: `Switched: ${t.browser}` });
                    } catch (e) {
                      await showToast({ style: Toast.Style.Failure, title: "Failed to switch", message: String(e) });
                    }
                  }}
                />
                <Action title="Refresh Tabs" icon={Icon.Repeat} onAction={loadTabs} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
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
    case "Thorium":
      return Color.Purple;
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
    case "Thorium":
      return Icon.Bolt;
  }
}
