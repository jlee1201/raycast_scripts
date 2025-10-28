import { Action, ActionPanel, Color, Icon, List, Toast, showToast } from "@raycast/api";
import { useEffect, useState } from "react";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
        // Some tabs (e.g., new tab) may not have URLs
        if (typeof url !== 'string') { url = ''; }
        if (typeof title !== 'string') { title = ''; }
        result.push({ browser: appName, windowIndex: wi + 1, tabIndex: ti + 1, title: title, url: url });
      }
    }
    return result;
  } catch (e) {
    return [];
  }
}

var browsers = ${JSON.stringify(SUPPORTED_BROWSERS)};
var all = [];
for (var i = 0; i < browsers.length; i++) {
  var b = browsers[i];
  var tabs = getTabs(b);
  for (var j = 0; j < tabs.length; j++) { all.push(tabs[j]); }
}
JSON.stringify(all);
`;

  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", jxa]);
  const parsed = JSON.parse(stdout.trim() || "[]") as BrowserTab[];
  return parsed;
}

async function focusAndSwitchToTab(browser: BrowserName, windowIndex: number, tabIndex: number) {
  const isSafari = browser === "Safari";
  
  // Robust script with proper syntax and timing
  const script = `
tell application "${browser}"
  -- Store initial state
  set wasAlreadyFrontmost to frontmost
  set targetWindowVisible to false
  
  try
    -- Check if the target window is already visible (same space)
    if (count of windows) >= ${windowIndex} then
      set targetWindowVisible to visible of window ${windowIndex}
    end if
  end try
  
  -- Activate the browser
  activate
  
  -- Wait for browser to become frontmost
  repeat 20 times
    if frontmost then exit repeat
    delay 0.05
  end repeat
  
  try
    if (count of windows) is 0 then
      return
    end if
    
    -- Bring window to front
    set index of window ${windowIndex} to 1
    
    -- Smart delay based on whether we're likely switching spaces
    if targetWindowVisible and wasAlreadyFrontmost then
      -- Same space, minimal delay
      delay 0.1
    else
      -- Cross-space switch detected
      -- Ensure the window is visible
      set visible of window 1 to true
      
      -- Wait for space animation to complete
      delay 0.6
      
      -- Additional wait to ensure window is ready
      repeat 10 times
        try
          -- Try to access window properties to confirm it's ready
          set windowName to name of window 1
          exit repeat
        on error
          delay 0.1
        end try
      end repeat
    end if
    
    -- Now switch to the tab with retries
    set tabSwitched to false
    repeat 3 times
      try
        ${isSafari ? `set current tab of window 1 to tab ${tabIndex} of window 1` : `set active tab index of window 1 to ${tabIndex}`}
        set tabSwitched to true
        exit repeat
      on error
        -- If it fails, try bringing window to front again
        activate
        set index of window 1 to 1
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

export default function Command() {
  const [tabs, setTabs] = useState<BrowserTab[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const all = await listAllTabs();
        // Sort by browser then title for stability
        all.sort((a, b) => (a.browser === b.browser ? a.title.localeCompare(b.title) : a.browser.localeCompare(b.browser)));
        setTabs(all);
      } catch (e) {
        await showToast({ style: Toast.Style.Failure, title: "Failed to list tabs", message: String(e) });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search tabs across browsers…">
      {tabs?.map((t) => {
        const subtitle = t.url || "";
        const hostname = computeHostname(subtitle);
        
        // Build keywords array - include URL, hostname, and parts of the URL
        const keywords: string[] = [];
        if (subtitle) {
          keywords.push(subtitle); // Full URL
          if (hostname) {
            keywords.push(hostname); // Just hostname
          }
          // Add path segments as keywords
          try {
            const url = new URL(subtitle);
            const pathSegments = url.pathname.split('/').filter(s => s.length > 0);
            keywords.push(...pathSegments);
          } catch {
            // Invalid URL, skip path parsing
          }
        }
        
        // WORKAROUND: Raycast's keywords don't support partial matching well
        // So we'll append hostname to the title for searchability
        const displayTitle = t.title || subtitle || "Untitled";
        const searchableTitle = hostname && !displayTitle.includes(hostname) 
          ? `${displayTitle} - ${hostname}`
          : displayTitle;
        
        return (
          <List.Item
            key={`${t.browser}-${t.windowIndex}-${t.tabIndex}-${t.url}`}
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
                      await focusAndSwitchToTab(t.browser, t.windowIndex, t.tabIndex);
                      await showToast({ style: Toast.Style.Success, title: `Switched: ${t.browser}` });
                    } catch (e) {
                      await showToast({ style: Toast.Style.Failure, title: "Failed to switch", message: String(e) });
                    }
                  }}
                />
                <Action
                  title="Refresh Tabs"
                  icon={Icon.Repeat}
                  onAction={async () => {
                    setIsLoading(true);
                    try {
                      const all = await listAllTabs();
                      all.sort((a, b) => (a.browser === b.browser ? a.title.localeCompare(b.title) : a.browser.localeCompare(b.browser)));
                      setTabs(all);
                    } finally {
                      setIsLoading(false);
                    }
                  }}
                />
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


