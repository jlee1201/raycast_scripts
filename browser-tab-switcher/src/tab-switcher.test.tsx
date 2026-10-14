import { EventEmitter } from "node:events";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  execCalls: [] as { cmd: string; args: string[] }[],
  ps: "",
  jxa: "[]",
  cdp: {} as Record<number, unknown[]>,
  httpGets: [] as string[],
}));

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], cb: (err: Error | null, res: { stdout: string; stderr: string }) => void) => {
    state.execCalls.push({ cmd, args });
    if (cmd === "ps") cb(null, { stdout: state.ps, stderr: "" });
    else if (cmd === "/usr/bin/osascript" && args[0] === "-l") cb(null, { stdout: state.jxa, stderr: "" });
    else cb(null, { stdout: "", stderr: "" });
  },
}));

vi.mock("node:http", () => ({
  default: {
    get: (url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
      state.httpGets.push(url);
      const req = new EventEmitter() as EventEmitter & { destroy: () => void };
      req.destroy = () => {};
      const port = Number(new URL(url).port);
      setImmediate(() => {
        const targets = state.cdp[port];
        if (!targets) return req.emit("error", new Error("ECONNREFUSED"));
        const res = new EventEmitter();
        cb(res);
        res.emit("data", JSON.stringify(targets));
        res.emit("end");
      });
      return req;
    },
  },
}));

import TabSwitcher, {
  canonicalUrl,
  computeHostname,
  dedupeKey,
  discoverChromiumInstances,
  listAllTabs,
  normalizeTitle,
  type BrowserTab,
} from "./tab-switcher";

const EDGE_PS = `  101 /Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge --remote-debugging-port=9223 --user-data-dir=/x`;
const CHROME_PS = `  202 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9224 --user-data-dir=/y`;
const HELPER_PS = `  303 /Applications/Microsoft Edge.app/Contents/Frameworks/Helper --type=renderer --remote-debugging-port=9223`;

beforeEach(() => {
  state.execCalls = [];
  state.httpGets = [];
  state.ps = [EDGE_PS, CHROME_PS, HELPER_PS].join("\n");
  state.jxa = "[]";
  state.cdp = {
    9223: [{ id: "e1", title: "Edge Tab", url: "https://edge.example/a", type: "page" }],
    9224: [
      { id: "c1", title: "Chrome Tab", url: "https://chrome.example/a", type: "page" },
      { id: "c2", title: "Worker", url: "https://chrome.example/w", type: "service_worker" },
    ],
  };
});

describe("pure helpers", () => {
  it("computeHostname handles valid, empty and invalid URLs", () => {
    expect(computeHostname("https://a.example.com/x?y=1")).toBe("a.example.com");
    expect(computeHostname("")).toBe("");
    expect(computeHostname(undefined)).toBe("");
    expect(computeHostname("not a url")).toBe("");
  });

  it("canonicalUrl strips the hash only", () => {
    expect(canonicalUrl("https://a.example/p?q=1#section")).toBe("https://a.example/p?q=1");
    expect(canonicalUrl("garbage")).toBe("garbage");
  });

  it("normalizeTitle drops unread counts and lowercases", () => {
    expect(normalizeTitle("Inbox (1,234)  - Mail")).toBe("inbox - mail");
  });

  it("dedupeKey distinguishes browsers but ignores hash and unread counts", () => {
    const base = { title: "Inbox (3)", url: "https://m.example/#a", switchMethod: { kind: "applescript", windowId: 1, tabIndex: 1 } } as const;
    const a: BrowserTab = { ...base, browser: "Google Chrome" };
    const b: BrowserTab = { ...base, browser: "Google Chrome", title: "Inbox (9)", url: "https://m.example/#b" };
    const c: BrowserTab = { ...base, browser: "Microsoft Edge" };
    expect(dedupeKey(a)).toBe(dedupeKey(b));
    expect(dedupeKey(a)).not.toBe(dedupeKey(c));
  });
});

describe("discoverChromiumInstances", () => {
  it("finds debug-port instances, classifies them and skips helper processes", async () => {
    const found = await discoverChromiumInstances();
    expect(found).toEqual([
      { browser: "Microsoft Edge", pid: 101, port: 9223 },
      { browser: "Google Chrome", pid: 202, port: 9224 },
    ]);
  });
});

describe("listAllTabs", () => {
  it("returns CDP page targets from every instance, excluding non-page targets", async () => {
    const tabs = await listAllTabs();
    expect(tabs.map((t) => t.title).sort()).toEqual(["Chrome Tab", "Edge Tab"]);
  });

  it("scopes to the requested browsers: no CDP probe or JXA for the others", async () => {
    const tabs = await listAllTabs(["Microsoft Edge"]);
    expect(tabs.map((t) => t.browser)).toEqual(["Microsoft Edge"]);
    expect(state.httpGets.some((u) => u.includes(":9224"))).toBe(false);
    const jxa = state.execCalls.find((c) => c.args[0] === "-l")!;
    expect(jxa.args[3]).toContain('var browsers = ["Microsoft Edge"];');
  });

  it("includes every browser when unscoped", async () => {
    await listAllTabs();
    const jxa = state.execCalls.find((c) => c.args[0] === "-l")!;
    expect(jxa.args[3]).toContain(
      'var browsers = ["Safari","Google Chrome","Brave Browser","Microsoft Edge","Thorium"];',
    );
  });

  it("merges AppleScript-only tabs but dedupes ones already seen over CDP", async () => {
    state.jxa = JSON.stringify([
      { browser: "Microsoft Edge", windowId: 5, tabIndex: 1, title: "Edge Tab", url: "https://edge.example/a#x" },
      { browser: "Microsoft Edge", windowId: 6, tabIndex: 1, title: "Other Profile", url: "https://p.example" },
    ]);
    const tabs = await listAllTabs(["Microsoft Edge"]);
    expect(tabs.map((t) => t.title).sort()).toEqual(["Edge Tab", "Other Profile"]);
  });
});

describe("<TabSwitcher /> rendering", () => {
  const mounted: TestRenderer.ReactTestRenderer[] = [];
  afterEach(() => {
    mounted.splice(0).forEach((r) => act(() => r.unmount()));
  });

  async function render(props: React.ComponentProps<typeof TabSwitcher> = {}) {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<TabSwitcher {...props} />);
      await new Promise((res) => setTimeout(res, 20));
    });
    mounted.push(r);
    return r.root;
  }
  const listOf = (root: TestRenderer.ReactTestInstance) =>
    root.findAll((n) => (n.type as { displayName?: string }).displayName === "List")[0];
  const items = (root: TestRenderer.ReactTestInstance) =>
    root.findAll((n) => (n.type as { displayName?: string }).displayName === "List.Item");

  async function type(root: TestRenderer.ReactTestInstance, text: string) {
    await act(async () => {
      listOf(root).props.onSearchTextChange(text);
    });
  }

  // Regression: an earlier change passed onSearchTextChange without handling filtering, so typing
  // stopped narrowing the list. We now filter ourselves, so assert on the observable behaviour.
  it("narrows the list as the user types", async () => {
    const root = await render();
    expect(listOf(root).props.filtering).toBe(false);
    await type(root, "chrome");
    expect(items(root).map((i) => i.props.title)).toEqual([expect.stringContaining("Chrome Tab")]);
    await type(root, "");
    expect(items(root)).toHaveLength(2);
  });

  it("ranks a literal match above tabs that only match as scattered letters", async () => {
    state.cdp = {
      9223: [
        { id: "a", title: "Notifications digest", url: "https://mail.example/inbox", type: "page" },
        { id: "b", title: "Home", url: "https://www.notion.so/home", type: "page" },
        { id: "c", title: "Unrelated", url: "https://example.com", type: "page" },
      ],
    };
    const root = await render({ browsers: ["Microsoft Edge"] });
    await type(root, "notion");
    expect(items(root).map((i) => i.props.title)).toEqual([
      expect.stringContaining("Home"),
      expect.stringContaining("Notifications digest"),
    ]);
  });

  it("shows a detail pane with the matched characters highlighted only while searching", async () => {
    state.cdp = { 9223: [{ id: "b", title: "Home", url: "https://www.notion.so/home", type: "page" }] };
    const root = await render({ browsers: ["Microsoft Edge"] });
    expect(listOf(root).props.isShowingDetail).toBe(false);

    await type(root, "notion");
    expect(listOf(root).props.isShowingDetail).toBe(true);
    expect(items(root)[0].props.detail.props.markdown).toContain("https://www\\.`notion`\\.so/home");
  });

  it("filters the launcher item by its title like any other item", async () => {
    const launcher = { title: "Launch Edge", run: vi.fn(async () => {}) };
    const root = await render({ browsers: ["Microsoft Edge"], launcher });
    await type(root, "launch");
    expect(items(root).map((i) => i.props.title)).toEqual(["Launch Edge"]);
    await type(root, "edge tab");
    expect(items(root).map((i) => i.props.title)).toEqual([expect.stringContaining("Edge Tab")]);
  });

  it("renders one item per tab with the browser tag", async () => {
    const root = await render();
    const rendered = items(root);
    expect(rendered).toHaveLength(2);
    const edge = rendered.find((i) => i.props.title.startsWith("Edge Tab"))!;
    expect(edge.props.accessories[0].tag.value).toBe("Microsoft Edge");
  });

  it("only lists the scoped browser's tabs", async () => {
    const root = await render({ browsers: ["Google Chrome"] });
    expect(items(root).map((i) => i.props.title)).toEqual([expect.stringContaining("Chrome Tab")]);
  });

  it("shows a launcher item first only when a launcher is provided", async () => {
    const run = vi.fn(async () => {});
    const withLauncher = await render({ browsers: ["Microsoft Edge"], launcher: { title: "Launch Edge", run } });
    expect(items(withLauncher)[0].props.title).toBe("Launch Edge");
    const without = await render({ browsers: ["Microsoft Edge"] });
    expect(items(without).some((i) => i.props.title === "Launch Edge")).toBe(false);
  });
});
