import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@raycast/api": fileURLToPath(new URL("./src/__mocks__/raycast-api.tsx", import.meta.url)) },
  },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
