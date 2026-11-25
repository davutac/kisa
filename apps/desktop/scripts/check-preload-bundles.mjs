import { readFileSync } from "node:fs";
import path from "node:path";

// Entries run in Electron's sandboxed preload environment, whose restricted
// CommonJS loader cannot resolve bundler-created sibling chunks.
const entries = ["account-setup.cjs", "attachment-preview.cjs", "index.cjs"];
const relativeRequirePattern = /require\(["']\./u;

for (const entry of entries) {
  const source = readFileSync(path.resolve("out/preload", entry), "utf-8");

  if (relativeRequirePattern.test(source)) {
    throw new Error(
      `${entry} is not self-contained; sandboxed preloads cannot load relative CommonJS chunks`
    );
  }
}
