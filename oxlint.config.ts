import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, react, tanstack, vitest],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "**/components/ui/**",
    "packages/database/drizzle/**/snapshot.json",
    "repos/**",
  ],
  overrides: [
    {
      excludeFiles: [
        "apps/desktop/src/renderer/src/routes/**/-components/**/*.tsx",
      ],
      files: ["apps/desktop/src/renderer/src/routes/**/*.tsx"],
      rules: {
        "func-style": ["error", "declaration"],
        "no-use-before-define": ["error", { functions: false }],
        "react/function-component-definition": [
          "error",
          {
            namedComponents: "function-declaration",
            unnamedComponents: "arrow-function",
          },
        ],
      },
    },
  ],
});
