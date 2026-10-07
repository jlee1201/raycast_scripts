import { CHROME_LAUNCHER } from "./launchers";
import TabSwitcher from "./tab-switcher";

export default function Command() {
  return <TabSwitcher browsers={["Google Chrome"]} launcher={CHROME_LAUNCHER} />;
}
