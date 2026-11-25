import { defineConfig } from "oxlint";
import antislop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, react, tanstack, vitest, antislop],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "apps/marketing/src/components/ui/**",
    "packages/database/drizzle/**/snapshot.json",
    "repos/**",
  ],
  overrides: [
    {
      // The desktop tests replace `electron` and main's own modules with
      // `vi.mock`. Taking those mocks out means adding injection seams to
      // production code, which is a change of its own, so the rule is off for
      // this folder alone.
      files: ["apps/desktop/tests/**"],
      rules: { "anti-slop/no-module-mocking": "off" },
    },
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
    // Schema values share names with their `typeof X.Type` aliases; TypeScript rejects genuine redeclarations.
    "no-redeclare": "off",
  },
});
