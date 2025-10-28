## Browser Tab Switcher (Raycast Extension)

List all open tabs across Safari, Google Chrome, Brave, and Microsoft Edge. Pick one to bring that browser to the foreground and switch to the selected tab.

### Features

- **Cross-browser tab listing**: Safari, Google Chrome, Brave Browser, Microsoft Edge
- **Instant switching**: Focuses the browser and selects the tab
- **Searchable**: Filter by tab title and URL (hostname is appended to title for better search matching)

### How it works

- Uses **JXA (JavaScript for Automation)** via `osascript -l JavaScript` to enumerate windows/tabs and return JSON.
- Uses **AppleScript** via `osascript` to bring the app to the foreground and switch the active tab.
- UI built with **Raycast API** (`@raycast/api`) in **TypeScript/React**.

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

You can add more Chromium-based browsers by extending the `SUPPORTED_BROWSERS` array in `src/switch-tab.tsx`.

### Limitations

- Private/incognito windows may be hidden from scripting depending on browser settings.
- Some tabs (new tab pages) may not have URLs; they will display as "Untitled".
- Window and tab indices can change between the list and switch actions if tabs move; in practice this is rare and the command is fast enough to minimize drift.

### Tech Stack

- **Raycast API**: UI framework
- **TypeScript + React**: command implementation
- **JXA + AppleScript**: macOS automation for browsers





