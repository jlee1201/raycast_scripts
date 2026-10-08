import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: string[] }[],
  scriptExists: true,
}));

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], cb: (err: Error | null, res: { stdout: string; stderr: string }) => void) => {
    state.calls.push({ cmd, args });
    cb(null, { stdout: "", stderr: "" });
  },
}));
vi.mock("node:fs", () => ({ existsSync: () => state.scriptExists }));

import { CHROME_LAUNCHER, EDGE_LAUNCHER } from "./launchers";

beforeEach(() => {
  state.calls = [];
  state.scriptExists = true;
  vi.unstubAllGlobals();
});

describe("EDGE_LAUNCHER", () => {
  it("runs the edge-work-open.sh script when present", async () => {
    await EDGE_LAUNCHER.run();
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].cmd).toMatch(/\/bin\/edge-work-open\.sh$/);
  });

  it("falls back to opening Microsoft Edge when the script is missing", async () => {
    state.scriptExists = false;
    await EDGE_LAUNCHER.run();
    expect(state.calls).toEqual([{ cmd: "/usr/bin/open", args: ["-a", "Microsoft Edge"] }]);
  });
});

describe("CHROME_LAUNCHER", () => {
  it("just fronts Chrome when the debug port (9224) is already up", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    await CHROME_LAUNCHER.run();
    expect(state.calls).toEqual([{ cmd: "/usr/bin/open", args: ["/Applications/Google Chrome.app"] }]);
  });

  it("starts a new debug-port instance when nothing is listening", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await CHROME_LAUNCHER.run();
    const { cmd, args } = state.calls[0];
    expect(cmd).toBe("/usr/bin/open");
    expect(args.slice(0, 3)).toEqual(["-na", "/Applications/Google Chrome.app", "--args"]);
    expect(args).toContain("--remote-debugging-port=9224");
    expect(args.some((a) => a.startsWith("--user-data-dir=") && a.endsWith("/ChromeProfiles/default"))).toBe(true);
  });
});
