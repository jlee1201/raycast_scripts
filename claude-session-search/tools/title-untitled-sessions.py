#!/usr/bin/env python3
"""
Titler plan generator for Claude Desktop sessions.

Claude Desktop imports CLI sessions without a title, so freshly-opened old sessions show up
"untitled". Desktop exposes no external title setter — the only correct path is the in-app
`updateSession(...)`, reachable via the `ccd_session_mgmt` MCP tool `set_session_title`, which
is ONLY available inside a Claude-Desktop-hosted Claude Code session (it is not a user-configured
MCP server, so it is absent from headless/cron/cloud runs).

So this script does NOT call the MCP tool itself. It scans Desktop's session store on disk,
finds untitled (non-archived) sessions, computes a good title for each
(transcript custom-title -> aiTitle -> summary -> first user prompt), and prints a plan.
A Claude Code agent running in a Desktop session then calls `set_session_title` for each entry.

IMPORTANT id mapping: the app's sessionId is `local_<uuid-from-the-filename>`, NOT
`local_<cliSessionId>`. Older sessions use a random desktop id in the filename that differs from
the CLI id, so always derive session_id from the filename.

Usage:  python3 title-untitled-sessions.py            # print plan
        python3 title-untitled-sessions.py --json      # emit plan as JSON only
"""
import json, os, glob, sys

HOME = os.path.expanduser("~")
DESK = os.path.join(HOME, "Library", "Application Support", "Claude", "claude-code-sessions")
PROJ = os.path.join(HOME, ".claude", "projects")
MAX_TITLE = 118


def transcript_path(cli_id):
    hits = glob.glob(os.path.join(PROJ, "*", f"{cli_id}.jsonl"))
    return hits[0] if hits else None


def _clip(s):
    s = " ".join(s.split()).strip()
    return (s[: MAX_TITLE - 1] + "…") if len(s) > MAX_TITLE else s


def derive_title(cli_id):
    """transcript custom-title -> aiTitle -> summary -> first real user prompt."""
    path = transcript_path(cli_id)
    if not path:
        return None
    custom = ai = summary = first_prompt = None
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            head = f.read(65536)
    except OSError:
        return None
    for line in head.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            break
        if isinstance(o.get("customTitle"), str) and o["customTitle"].strip():
            custom = custom or o["customTitle"].strip()
        if isinstance(o.get("aiTitle"), str) and o["aiTitle"].strip():
            ai = ai or o["aiTitle"].strip()
        if o.get("type") == "summary" and isinstance(o.get("summary"), str) and o["summary"].strip():
            summary = summary or o["summary"].strip()
        if first_prompt is None and o.get("type") == "user" and not o.get("isMeta"):
            c = o.get("message", {}).get("content")
            txt = None
            if isinstance(c, str):
                txt = c
            elif isinstance(c, list):
                for p in c:
                    if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str):
                        txt = p["text"]
                        break
            if txt:
                s = " ".join(txt.split()).strip()
                if s and not s.startswith("<") and not s.startswith("Caveat:") and not s.startswith("[Request interrupted"):
                    first_prompt = s
    best = custom or ai or summary or first_prompt
    return _clip(best) if best else None


def build_plan():
    plan = []
    for fp in glob.glob(os.path.join(DESK, "**", "local_*.json"), recursive=True):
        try:
            d = json.load(open(fp))
        except (OSError, json.JSONDecodeError):
            continue
        if (d.get("title") or "").strip() or d.get("isArchived"):
            continue
        cli = d.get("cliSessionId")
        if not cli:
            continue
        # app sessionId is derived from the FILENAME, not the cliSessionId
        session_id = os.path.basename(fp)[: -len(".json")]
        title = derive_title(cli)
        if not title:
            continue
        plan.append({"session_id": session_id, "cli": cli, "title": title, "cwd": d.get("cwd", "")})
    return plan


def main():
    plan = build_plan()
    if "--json" in sys.argv:
        print(json.dumps(plan, indent=2))
        return
    print(f"Untitled, non-archived Desktop sessions with a derivable title: {len(plan)}\n")
    for p in plan:
        proj = os.path.basename(p["cwd"]) or "?"
        print(f"  {p['session_id']}")
        print(f"    [{proj}] {p['title']}")
    if not plan:
        print("  (none — all imported sessions are titled)")
    print("\nNext: for each entry, call MCP set_session_title(session_id, title) from a Desktop-hosted session.")


if __name__ == "__main__":
    main()
