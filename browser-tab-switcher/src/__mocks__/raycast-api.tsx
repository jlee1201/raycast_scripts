import type { ReactNode } from "react";

const passthrough = (name: string) => {
  const C = (props: { children?: ReactNode }) => <>{props.children}</>;
  C.displayName = name;
  return C;
};

export const List = Object.assign(passthrough("List"), {
  Item: passthrough("List.Item"),
  EmptyView: passthrough("List.EmptyView"),
});
export const ActionPanel = passthrough("ActionPanel");
export const Action = passthrough("Action");
export const Icon = new Proxy({}, { get: (_t, k) => String(k) });
export const Color = new Proxy({}, { get: (_t, k) => String(k) });
export const Toast = { Style: { Failure: "failure" } };
export const showToast = async () => undefined;
export const closeMainWindow = async () => undefined;
