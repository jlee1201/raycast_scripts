import type { ReactNode } from "react";
import { vi } from "vitest";

const passthrough = (name: string) => {
  const C = (props: { children?: ReactNode }) => <>{props.children}</>;
  C.displayName = name;
  return C;
};

export const List = Object.assign(passthrough("List"), {
  Item: Object.assign(passthrough("List.Item"), { Detail: passthrough("List.Item.Detail") }),
  EmptyView: passthrough("List.EmptyView"),
});
export const ActionPanel = passthrough("ActionPanel");
export const Action = passthrough("Action");
export const Icon = new Proxy({}, { get: (_t, k) => String(k) });
export const Color = new Proxy({}, { get: (_t, k) => String(k) });
export const Toast = { Style: { Failure: "failure" } };
export const showToast = async () => undefined;
export const closeMainWindow = vi.fn(async (_options?: unknown) => undefined);
export const PopToRootType = { Immediate: "immediate", Default: "default", Suspended: "suspended" };
