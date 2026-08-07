import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "apps/desktop/src/renderer/src/routeTree.gen.ts",
    "repos/**",
    "**/components/ui/**",
  ],
  sortTailwindcss: {
    functions: ["cn", "clsx"],
    preserveDuplicates: false,
    preserveWhitespace: false,
  },
});
