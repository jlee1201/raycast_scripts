import { Color, Icon } from "@raycast/api";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BrowserName = "Safari" | "Google Chrome" | "Brave Browser" | "Microsoft Edge";

export type BrowserTab = {
  browser: BrowserName;
  windowIndex: number;
  tabIndex: number;
  title: string;
  url: string;
};

export const SUPPORTED_BROWSERS: BrowserName[] = ["Safari", "Google Chrome", "Brave Browser", "Microsoft Edge"];

export function computeHostname(url: string | undefined): string {
  if (!url) {
    return "";
  }
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

export async function listAllTabs(): Promise<BrowserTab[]> {
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

export async function closeTabs(tabs: BrowserTab[]) {
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

/** Strip the hash/fragment from a URL so anchored variants are treated as duplicates. */
export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Strip dynamic counts like "(4,474)" from titles so the same page with a changing unread count still matches. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/\([\d,]+\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toLowerCase();
}

export function tabKey(t: BrowserTab): string {
  return `${t.browser}-${t.windowIndex}-${t.tabIndex}`;
}

/**
 * Given a list of tabs, return a Set of tabKey values for tabs that are
 * duplicates (i.e. not the first occurrence of each canonical URL + title group).
 */
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
  }
}
