import { Color, Icon } from "@raycast/api";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";

const execFileAsync = promisify(execFile);

export type BrowserName = "Safari" | "Google Chrome" | "Brave Browser" | "Microsoft Edge" | "Thorium";

export type CDPClose = { kind: "cdp"; port: number; tabId: string };
type AppleScriptClose = { kind: "applescript"; windowId: number; tabIndex: number };
export type CloseMethod = CDPClose | AppleScriptClose;

export type BrowserTab = {
  browser: BrowserName;
  title: string;
  url: string;
  closeMethod: CloseMethod;
};

const CHROMIUM_BROWSERS: BrowserName[] = ["Google Chrome", "Brave Browser", "Microsoft Edge", "Thorium"];

export function computeHostname(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// CDP (Chrome DevTools Protocol) – Chromium browsers
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
        closeMethod: { kind: "cdp" as const, port: instance.port, tabId: t.id },
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// JXA / AppleScript – Safari (and fallback)
// ---------------------------------------------------------------------------

async function listTabsJXA(browsers: BrowserName[]): Promise<BrowserTab[]> {
  if (browsers.length === 0) return [];

  const jxa = `
function getTabs(appName) {
  try {
    var app = Application(appName);
    if (!app.running()) { return []; }
    var isSafari = appName === 'Safari';
    var out = [];
    var wins = app.windows();
    for (var wi = 0; wi < wins.length; wi++) {
      var w = wins[wi];
      var tabs = w.tabs();
      for (var ti = 0; ti < tabs.length; ti++) {
        var t = tabs[ti];
        var title = isSafari ? t.name() : t.title();
        var url = t.url();
        if (typeof title !== 'string') title = '';
        if (typeof url !== 'string') url = '';
        out.push({ browser: appName, windowId: w.id(), tabIndex: ti + 1, title: title, url: url });
      }
    }
    return out;
  } catch (e) { return []; }
}
var all = [];
var browsers = ${JSON.stringify(browsers)};
for (var i = 0; i < browsers.length; i++) { var b = browsers[i]; var ts = getTabs(b); for (var j = 0; j < ts.length; j++) all.push(ts[j]); }
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
    closeMethod: { kind: "applescript" as const, windowId: t.windowId, tabIndex: t.tabIndex },
  }));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function listAllTabs(): Promise<BrowserTab[]> {
  const all: BrowserTab[] = [];

  const chromiumInstances = await discoverChromiumInstances();
  const browsersWithCDP = new Set(chromiumInstances.map((i) => i.browser));

  const cdpResults = await Promise.all(chromiumInstances.map(listTabsCDP));
  for (const tabs of cdpResults) all.push(...tabs);

  const jxaBrowsers: BrowserName[] = ["Safari"];
  for (const b of CHROMIUM_BROWSERS) {
    if (!browsersWithCDP.has(b)) jxaBrowsers.push(b);
  }
  const jxaTabs = await listTabsJXA(jxaBrowsers);
  all.push(...jxaTabs);

  return all;
}

export async function closeTabs(tabs: BrowserTab[]) {
  const cdpTabs = tabs.filter((t): t is BrowserTab & { closeMethod: CDPClose } => t.closeMethod.kind === "cdp");
  const asTabs = tabs.filter(
    (t): t is BrowserTab & { closeMethod: AppleScriptClose } => t.closeMethod.kind === "applescript",
  );

  // CDP: close each tab via HTTP
  await Promise.all(
    cdpTabs.map(async (t) => {
      try {
        await httpGet(`http://localhost:${t.closeMethod.port}/json/close/${t.closeMethod.tabId}`);
      } catch {
        // tab may already be closed
      }
    }),
  );

  // AppleScript: group by browser → windowId, close in descending tab index
  const byBrowser = new Map<BrowserName, Map<number, number[]>>();
  for (const t of asTabs) {
    const winMap = byBrowser.get(t.browser) ?? new Map<number, number[]>();
    const list = winMap.get(t.closeMethod.windowId) ?? [];
    list.push(t.closeMethod.tabIndex);
    winMap.set(t.closeMethod.windowId, list);
    byBrowser.set(t.browser, winMap);
  }

  for (const [browser, winMap] of byBrowser) {
    const isSafari = browser === "Safari";
    let script = `tell application "${browser}"\ntry\n`;
    for (const [windowId, tabIdxs] of winMap) {
      const sorted = [...tabIdxs].sort((a, b) => b - a);
      script += `set targetWindow to (first window whose id is ${windowId})\n`;
      script += `set index of targetWindow to 1\n`;
      for (const ti of sorted) {
        script += isSafari
          ? `try\nclose tab ${ti} of window 1\nend try\n`
          : `try\nclose (tab ${ti} of window 1)\nend try\n`;
      }
    }
    script += `end try\nend tell`;
    await execFileAsync("/usr/bin/osascript", ["-e", script]);
  }
}

export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function normalizeTitle(title: string): string {
  return title
    .replace(/\([\d,]+\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toLowerCase();
}

export function tabKey(t: BrowserTab): string {
  const m = t.closeMethod;
  if (m.kind === "cdp") return `cdp-${m.port}-${m.tabId}`;
  return `as-${t.browser}-${m.windowId}-${m.tabIndex}`;
}

export function findDuplicateTabKeys(tabs: BrowserTab[]): Set<string> {
  const grouped = new Map<string, BrowserTab[]>();
  for (const tab of tabs) {
    const key = canonicalUrl(tab.url) + "\0" + normalizeTitle(tab.title);
    const list = grouped.get(key) ?? [];
    list.push(tab);
    grouped.set(key, list);
  }
  const dupKeys = new Set<string>();
  for (const members of grouped.values()) {
    if (members.length < 2) continue;
    for (let i = 1; i < members.length; i++) {
      dupKeys.add(tabKey(members[i]));
    }
  }
  return dupKeys;
}

export function browserColor(browser: BrowserName): Color.ColorLike {
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

export function iconForBrowser(browser: BrowserName) {
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
