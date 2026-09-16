# Claude Code Session Search

A Raycast extension to fuzzy-search **every Claude Code session on disk** and reopen
one in **Claude Desktop** — like the browser tab switcher, but for Claude sessions
(and the session doesn't have to be running).

## What it does

- Lists every Claude Code transcript under `~/.claude/projects/*/*.jsonl` (the complete,
  resumable set — 1000s of sessions load in well under a second).
- Shows a human-readable **title** for each, preferring Claude Desktop's own session
  title (`~/Library/Application Support/Claude/claude-code-sessions/`) and falling back
  to the first real user prompt from the transcript.
- Search matches on title, the first prompt, project path, and git branch.
- Filter by project with the dropdown in the search bar.
- Sorted by most-recently-active first.

## How opening works

Selecting a session runs the Claude Desktop deep link:

```
claude://resume?session=<SESSION_ID>
```

Claude Desktop imports that CLI transcript by id and opens it. `<SESSION_ID>` is exactly
the `.jsonl` filename (a UUID), which also matches the Desktop index's `cliSessionId`.

## Actions

| Action | Shortcut |
| --- | --- |
| Open in Claude Desktop | `↵` |
| Toggle Details | `⌘D` |
| Copy Resume Command (`claude --resume <id>`) | `⌘C` |
| Copy Session ID | `⌘⇧C` |
| Show Transcript in Finder | `⌘F` |
| Refresh | `⌘R` |

## Develop

```
npm install
npx @raycast/api dev
```

Then run **Search Claude Code Sessions** from Raycast.

> Note: `@raycast/api` (≥ ~1.102) requires `@types/react@19.0.10`. This package pins it via
> an `overrides` block so a fresh `npm install` builds cleanly; without it, a stray
> `@types/react@18.x` in the tree makes every Raycast JSX component fail to typecheck.

The `assets/icon.png` is a placeholder copied from the tab-switcher extension — swap in a
dedicated icon when convenient.
