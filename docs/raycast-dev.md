## Raycast Extensions - Local Development Playbook

This repo contains local Raycast extensions. Follow this playbook for creating, importing, and troubleshooting extensions.

### Core concepts

- Raycast Extensions are Node/React-based commands defined by a manifest in `package.json` (fields live at the ROOT of the file).
- Script Commands are different and live under Settings → Script Commands; they are not used here.

### Minimal manifest (package.json) schema

Required at the root of `package.json`:

```json
{
  "name": "my-extension",
  "version": "0.0.1",
  "private": true,
  "description": "Short description",
  "license": "MIT",
  "type": "module",
  "schemaVersion": 1,
  "title": "My Extension",
  "icon": "icon.png", // 512x512 PNG RGBA in assets/
  "categories": ["Productivity"],
  "author": "<raycast-username>",
  "commands": [
    { "name": "index", "title": "Do Thing", "description": "...", "mode": "view" }
  ],
  "scripts": { "dev": "ray dev", "build": "ray build" },
  "dependencies": { "@raycast/api": "^1.82.0" },
  "devDependencies": { "typescript": "^5.x", "react": "^18" }
}
```

Notes:
- `author` must be your Raycast username (visible in Raycast → Store). Example: `jlee1201`.
- `icon` must be a valid PNG, 512×512, truecolor RGBA. Place it under `assets/icon.png`.

### TS config

`tsconfig.json` should include:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Node",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ES2020", "DOM"]
  },
  "include": ["src"]
}
```

### Importing a local extension

1) Open Raycast and run "Create Extension" → choose "Use Local Folder" and pick the extension folder.
2) Or open "Extensions" and drag the folder into the window.
3) Ensure Developer Mode is on (Raycast Settings → Advanced) and you are logged in to Raycast.

### Building locally

- Install deps once: `npm install`
- Start dev watcher: `npx @raycast/api dev` (or `npm run dev`)
- This generates the executable JS and watches for changes.

### Common errors and fixes

- "Could not find command's executable JS file": run `ray dev` in the extension folder.
- "Could not decode extension's manifest file": ensure manifest fields are at the ROOT of `package.json` and valid; run `npx @raycast/api lint`.
- Lint says author invalid: set `author` to your Raycast USERNAME (not display name).
- Icon errors: provide `assets/icon.png` as a 512×512 PNG RGBA. Use `scripts/gen-icon.sh` to generate a valid placeholder.
- Reserved shortcuts: some shortcuts (e.g., Cmd+Enter) are reserved. Use different combinations or rely on default Enter behavior (first action).

### macOS permissions

When controlling browsers, approve prompts: System Settings → Privacy & Security → Automation → Allow Raycast to control Safari/Chrome/Brave/Edge.

### JXA/AppleScript patterns

- Enumerate tabs using JXA via `osascript -l JavaScript` and return JSON.
- Switch/focus or close tabs using AppleScript strings executed via `osascript`.
- For bulk closing, close tabs in descending index per window to avoid reindexing.

### Repo conventions

- Use absolute paths in scripts and when referencing this workspace.
- Place icons in `assets/` and use `icon.png` in the manifest.
- Keep each extension self-contained under its folder with `src/`, `assets/`, `README.md`.
- Prefer TypeScript + React and `@raycast/api` components.

### Useful commands

- `npx @raycast/api dev` — build and watch
- `npx @raycast/api build` — build once
- `npx @raycast/api lint` — validate manifest, icon

### Troubleshooting checklist

- Manifest fields at root? Title/author/icon/categories/commands present?
- Icon is valid PNG 512×512 RGBA?
- Logged into Raycast and Developer Mode enabled?
- Built with `ray dev` after changes?






