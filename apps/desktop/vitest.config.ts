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
});
