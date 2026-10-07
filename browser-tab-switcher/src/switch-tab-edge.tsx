import { EDGE_LAUNCHER } from "./launchers";
import TabSwitcher from "./tab-switcher";

export default function Command() {
  return <TabSwitcher browsers={["Microsoft Edge"]} launcher={EDGE_LAUNCHER} />;
}
