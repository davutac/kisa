import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@/shared", replacement: path.resolve("src/shared") },
      { find: "@/constants", replacement: path.resolve("src/constants.ts") },
      { find: "@/renderer", replacement: path.resolve("src/renderer/src") },
      { find: "@", replacement: path.resolve("src/renderer/src") },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          exclude: ["tests/**/*.dom.test.tsx"],
          include: ["tests/**/*.test.{ts,tsx}"],
          name: "node",
        },
      },
      {
        extends: true,
        test: {
          environment: "jsdom",
          include: ["tests/**/*.dom.test.tsx"],
          name: "dom",
          setupFiles: ["tests/setup/dom.ts"],
        },
      },
    ],
  },
});
