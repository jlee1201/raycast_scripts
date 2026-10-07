import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Launcher = { title: string; run: () => Promise<void> };

const EDGE_WORK_SCRIPT = `${homedir()}/bin/edge-work-open.sh`;

// Starts the CDP/SOP Edge instance if it isn't running, otherwise just brings it to the front.
async function launchEdgeWork() {
  if (existsSync(EDGE_WORK_SCRIPT)) {
    await execFileAsync(EDGE_WORK_SCRIPT, []);
    return;
  }
  await execFileAsync("/usr/bin/open", ["-a", "Microsoft Edge"]);
}

async function chromeCdpRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Mirrors edge-work-open.sh for the debug-port Chrome instance (port 9224, ~/ChromeProfiles/default).
async function launchChromeCdp() {
  const app = "/Applications/Google Chrome.app";
  if (await chromeCdpRunning(9224)) {
    await execFileAsync("/usr/bin/open", [app]);
    return;
  }
  await execFileAsync("/usr/bin/open", [
    "-na",
    app,
    "--args",
    "--remote-debugging-port=9224",
    "--remote-allow-origins=*",
    `--user-data-dir=${homedir()}/ChromeProfiles/default`,
    "--profile-directory=Default",
    "--no-first-run",
    "--no-default-browser-check",
    "--restore-last-session",
  ]);
}

export const EDGE_LAUNCHER: Launcher = { title: "Launch / Switch to Edge Work", run: launchEdgeWork };
export const CHROME_LAUNCHER: Launcher = { title: "Launch / Switch to Chrome", run: launchChromeCdp };
