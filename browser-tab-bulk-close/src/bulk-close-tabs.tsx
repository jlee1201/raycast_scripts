import { Action, ActionPanel, Color, Form, Icon, List, Toast, confirmAlert, showToast, useNavigation } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { BrowserTab, browserColor, closeTabs, computeHostname, findDuplicateTabKeys, iconForBrowser, listAllTabs, tabKey } from "./shared";

export default function Command() {
  const [allTabs, setAllTabs] = useState<BrowserTab[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const { push, pop } = useNavigation();

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const tabs = await listAllTabs();
        setAllTabs(tabs);
      } catch (e) {
        await showToast({ style: Toast.Style.Failure, title: "Failed to list tabs", message: String(e) });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTabs;
    return allTabs.filter((t) => (t.title + " " + t.url).toLowerCase().includes(q));
  }, [allTabs, query]);

  const dupKeys = useMemo(() => findDuplicateTabKeys(filtered), [filtered]);
  const duplicateTabs = useMemo(() => filtered.filter((t) => dupKeys.has(tabKey(t))), [filtered, dupKeys]);

  const closeCount = filtered.length;
  const dupCount = duplicateTabs.length;

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Type to filter tabs to close (e.g., zoom, calendar, localhost)"
    >
      <List.Section title={`Matches (${closeCount})`} subtitle={query ? `Filter: ${query}` : undefined}>
        {filtered.map((t) => {
          const hostname = computeHostname(t.url);
          const displayTitle = t.title || t.url || "Untitled";
          const searchableTitle =
            hostname && !displayTitle.includes(hostname) ? `${displayTitle} - ${hostname}` : displayTitle;
          const isDup = dupKeys.has(tabKey(t));

          const accessories: List.Item.Accessory[] = [];
          if (isDup) {
            accessories.push({ tag: { value: "Duplicate", color: Color.Red } });
          }
          accessories.push({ tag: { value: t.browser, color: browserColor(t.browser) } });

          return (
            <List.Item
              key={tabKey(t)}
              title={searchableTitle}
              subtitle={t.url}
              accessories={accessories}
              icon={iconForBrowser(t.browser)}
              actions={
                <ActionPanel>
                  <Action
                    title={`Close All (${closeCount})`}
                    icon={Icon.Trash}
                    onAction={() => {
                      push(
                        <ConfirmPhraseForm
                          count={closeCount}
                          onConfirm={async () => {
                            await closeTabs(filtered);
                            await showToast({ style: Toast.Style.Success, title: `Closed ${closeCount} tabs` });
                            await refresh();
                            pop();
                          }}
                        />,
                      );
                    }}
                  />
                  {dupCount > 0 && (
                    <Action
                      title={`Close Duplicates Only (${dupCount})`}
                      icon={Icon.Layers}
                      shortcut={{ modifiers: ["cmd"], key: "return" }}
                      onAction={async () => {
                        await confirmAndClose(duplicateTabs, "duplicate ");
                        await refresh();
                      }}
                    />
                  )}
                  <Action
                    title="Close This Tab"
                    icon={Icon.XmarkCircle}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
                    onAction={async () => {
                      await confirmAndClose([t]);
                      await refresh();
                    }}
                  />
                  <Action title="Refresh" icon={Icon.Repeat} onAction={refresh} />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );

  async function refresh() {
    setIsLoading(true);
    try {
      const tabs = await listAllTabs();
      setAllTabs(tabs);
    } finally {
      setIsLoading(false);
    }
  }

  async function confirmAndClose(tabs: BrowserTab[], label = "") {
    if (tabs.length === 0) return;
    const ok = await confirmAlert({
      title: `Close ${tabs.length} ${label}tab${tabs.length === 1 ? "" : "s"}?`,
      message: "This will close matching tabs across all supported browsers.",
      primaryAction: { title: "Close Tabs", style: "destructive" },
    });
    if (!ok) return;
    try {
      await closeTabs(tabs);
      await showToast({ style: Toast.Style.Success, title: `Closed ${tabs.length} ${label}tab${tabs.length === 1 ? "" : "s"}` });
    } catch (e) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to close tabs", message: String(e) });
    }
  }
}

function ConfirmPhraseForm(props: { count: number; onConfirm: () => void }) {
  const [text, setText] = useState("");
  const disabled = text.trim().toLowerCase() !== "close";
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={`Type "close" to confirm (${props.count})`}
            icon={Icon.Trash}
            onSubmit={props.onConfirm}
            shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
            disabled={disabled}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="To confirm bulk closing, type the word 'close' below." />
      <Form.TextField id="confirm" title="Confirm Phrase" placeholder="close" value={text} onChange={setText} />
    </Form>
  );
}
