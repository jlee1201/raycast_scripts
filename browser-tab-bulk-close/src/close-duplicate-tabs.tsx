import { Action, ActionPanel, Color, Icon, List, Toast, confirmAlert, showToast } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { BrowserTab, browserColor, canonicalUrl, closeTabs, computeHostname, iconForBrowser, listAllTabs, normalizeTitle, tabKey } from "./shared";

type DuplicateGroup = {
  canonical: string;
  normalizedTitle: string;
  keep: BrowserTab;
  duplicates: BrowserTab[];
};

function findDuplicateGroups(tabs: BrowserTab[]): DuplicateGroup[] {
  const grouped = new Map<string, BrowserTab[]>();
  for (const tab of tabs) {
    const key = canonicalUrl(tab.url) + "\0" + normalizeTitle(tab.title);
    const list = grouped.get(key) ?? [];
    list.push(tab);
    grouped.set(key, list);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, members] of grouped) {
    if (members.length < 2) continue;
    const [keep, ...duplicates] = members;
    const canonical = canonicalUrl(keep.url);
    const nt = normalizeTitle(keep.title);
    groups.push({ canonical, normalizedTitle: nt, keep, duplicates });
  }

  groups.sort((a, b) => b.duplicates.length - a.duplicates.length);
  return groups;
}

export default function Command() {
  const [allTabs, setAllTabs] = useState<BrowserTab[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function refresh() {
    setIsLoading(true);
    try {
      const tabs = await listAllTabs();
      setAllTabs(tabs);
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to list tabs", message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const groups = useMemo(() => findDuplicateGroups(allTabs), [allTabs]);
  const totalDuplicates = groups.reduce((sum, g) => sum + g.duplicates.length, 0);

  async function closeAllDuplicates() {
    const allDups = groups.flatMap((g) => g.duplicates);
    if (allDups.length === 0) return;
    const ok = await confirmAlert({
      title: `Close ${allDups.length} duplicate tab${allDups.length === 1 ? "" : "s"}?`,
      message: `Keeping one tab per unique URL across ${groups.length} group${groups.length === 1 ? "" : "s"}.`,
      primaryAction: { title: "Close Duplicates", style: "destructive" },
    });
    if (!ok) return;
    try {
      await closeTabs(allDups);
      await showToast({ style: Toast.Style.Success, title: `Closed ${allDups.length} duplicate tab${allDups.length === 1 ? "" : "s"}` });
      await refresh();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to close tabs", message: String(e) });
    }
  }

  async function closeGroupDuplicates(group: DuplicateGroup) {
    const count = group.duplicates.length;
    const ok = await confirmAlert({
      title: `Close ${count} duplicate${count === 1 ? "" : "s"} of this page?`,
      message: `Keeping one tab for: ${group.canonical}`,
      primaryAction: { title: "Close Duplicates", style: "destructive" },
    });
    if (!ok) return;
    try {
      await closeTabs(group.duplicates);
      await showToast({ style: Toast.Style.Success, title: `Closed ${count} duplicate${count === 1 ? "" : "s"}` });
      await refresh();
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to close tabs", message: String(e) });
    }
  }

  if (!isLoading && groups.length === 0) {
    return (
      <List>
        <List.EmptyView
          title="No Duplicate Tabs Found"
          description="All your open tabs have unique URL + title combinations."
          icon={Icon.CheckCircle}
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter duplicate tab groups…">
      {groups.map((group, gi) => {
        const hostname = computeHostname(group.canonical);
        const sectionTitle = group.keep.title || hostname || group.canonical;
        const dupCount = group.duplicates.length;

        return (
          <List.Section
            key={`${gi}-${group.canonical}-${group.normalizedTitle}`}
            title={sectionTitle}
            subtitle={`${dupCount + 1} tabs · ${dupCount} duplicate${dupCount === 1 ? "" : "s"} to close`}
          >
            {/* The tab we'll keep */}
            <List.Item
              key={`keep-${tabKey(group.keep)}`}
              title={group.keep.title || group.keep.url || "Untitled"}
              subtitle={group.keep.url}
              accessories={[
                { tag: { value: "Keep", color: Color.Green } },
                { tag: { value: group.keep.browser, color: browserColor(group.keep.browser) } },
              ]}
              icon={Icon.CheckCircle}
              actions={
                <ActionPanel>
                  <Action
                    title={`Close All Duplicates (${totalDuplicates})`}
                    icon={Icon.Trash}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
                    onAction={closeAllDuplicates}
                  />
                  <Action
                    title={`Close Duplicates of This Page (${dupCount})`}
                    icon={Icon.XmarkCircle}
                    onAction={() => closeGroupDuplicates(group)}
                  />
                  <Action title="Refresh" icon={Icon.Repeat} onAction={refresh} />
                </ActionPanel>
              }
            />
            {/* Duplicate tabs that will be closed */}
            {group.duplicates.map((t) => (
              <List.Item
                key={`dup-${tabKey(t)}`}
                title={t.title || t.url || "Untitled"}
                subtitle={t.url}
                accessories={[
                  { tag: { value: "Duplicate", color: Color.Red } },
                  { tag: { value: t.browser, color: browserColor(t.browser) } },
                ]}
                icon={iconForBrowser(t.browser)}
                actions={
                  <ActionPanel>
                    <Action
                      title={`Close All Duplicates (${totalDuplicates})`}
                      icon={Icon.Trash}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
                      onAction={closeAllDuplicates}
                    />
                    <Action
                      title={`Close Duplicates of This Page (${dupCount})`}
                      icon={Icon.XmarkCircle}
                      onAction={() => closeGroupDuplicates(group)}
                    />
                    <Action title="Refresh" icon={Icon.Repeat} onAction={refresh} />
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>
        );
      })}
    </List>
  );
}
