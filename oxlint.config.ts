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
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
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
  rules: {
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
  },
});
