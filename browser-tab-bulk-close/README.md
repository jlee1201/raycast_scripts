## Bulk Close Browser Tabs (Raycast Extension)

Filter all open tabs across Safari and Chromium-based browsers, then close matches in bulk.

### Commands

- **Bulk Close Tabs** — filter by title/URL and close all matches (requires typing "close" to confirm).
- **Close Duplicate Tabs** — find tabs with the same URL + title and close extras, keeping one per group.

### Supported Browsers

- Safari
- Google Chrome
- Brave Browser
- Microsoft Edge
- Thorium

Any Chromium fork that exposes `--remote-debugging-port` can be added (see `.cursor/rules/browser-automation.mdc` for the checklist).

### How it works

**Chromium browsers** use the Chrome DevTools Protocol (CDP):

- Discovers running instances by scanning process arguments for `--remote-debugging-port`.
- Lists tabs via HTTP (`/json` endpoint) on each instance's debug port.
- Closes tabs via the `/json/close/` endpoint — correctly handles multiple instances of the same browser.

**Safari** uses JXA/AppleScript:

- Enumerates tabs via JXA (`osascript -l JavaScript`).
- Closes tabs via AppleScript, targeting windows by stable window ID. Tabs are closed in descending index order to avoid reindexing.

### Permissions

On first run, macOS will ask to allow Raycast to control each browser. Approve to enable closing tabs.

### Notes

- Only currently running browsers are scanned.
- Private/incognito windows may be hidden from scripting depending on browser settings.
