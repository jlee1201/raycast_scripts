## Browser Tab Switcher (Raycast Extension)

List all open tabs across Safari and Chromium-based browsers. Pick one to bring that browser to the foreground and switch to the selected tab.

### Features

- **Cross-browser tab listing**: Safari, Google Chrome, Brave Browser, Microsoft Edge, Thorium
- **Instant switching**: Focuses the browser and selects the tab
- **Searchable**: Filter by tab title and URL (hostname is appended to title for better search matching)
- **Multi-instance support**: Correctly handles multiple instances of the same Chromium browser (e.g. separate Edge profiles)

### How it works

**Chromium browsers** (Chrome, Edge, Brave) use the Chrome DevTools Protocol (CDP):

- Discovers running instances by scanning process arguments for `--remote-debugging-port`.
- Lists tabs via HTTP (`/json` endpoint) on each instance's debug port.
- Switches tabs via the `/json/activate/` endpoint, then brings the correct process to the macOS foreground using System Events.

**Safari** uses JXA/AppleScript:

- Enumerates tabs via JXA (`osascript -l JavaScript`).
- Switches tabs via AppleScript, targeting windows by stable window ID.

If a Chromium browser has no debug port available, it falls back to the JXA/AppleScript approach.

### Setup

1. Open Raycast → Extensions → Import Extension → select this folder.
2. On first run, macOS will prompt for Automation permissions so Raycast can control your browsers. Approve for each browser you plan to use.

### Usage

1. Invoke the command: "Switch to Browser Tab".
2. Search for a tab by title or URL (e.g., "perplex" will match perplexity.ai tabs).
3. Press Enter on a result to focus its browser and switch to that tab.

### Supported Browsers

- Safari
- Google Chrome
- Brave Browser
- Microsoft Edge
- Thorium

Any Chromium fork that exposes `--remote-debugging-port` can be added (see `.cursor/rules/browser-automation.mdc` for the checklist).

### Limitations

- Private/incognito windows may be hidden from scripting depending on browser settings.
- Some tabs (new tab pages) may not have URLs; they will display as "Untitled".
- Discarded/unloaded Chromium tabs may not appear in CDP listings (only affects tabs that haven't been accessed in a while).

### Tech Stack

- **Raycast API**: UI framework
- **TypeScript + React**: command implementation
- **Chrome DevTools Protocol**: tab listing and switching for Chromium browsers
- **JXA + AppleScript**: macOS automation for Safari
- **Node.js `http` module**: CDP HTTP communication
