import { readFile } from "node:fs/promises";
import path from "node:path";

const preloadDirectory = path.resolve("out/preload");
const entries = ["attachment-preview.cjs", "index.cjs"];
const relativeRequirePattern = /require\(["']\./u;

for (const entry of entries) {
  // Entries run in Electron's sandboxed preload environment, whose restricted
  // CommonJS loader cannot resolve bundler-created sibling chunks.
  // eslint-disable-next-line no-await-in-loop
  const source = await readFile(path.join(preloadDirectory, entry), "utf-8");

  if (relativeRequirePattern.test(source)) {
    throw new Error(
      `${entry} is not self-contained; sandboxed preloads cannot load relative CommonJS chunks`
    );
  }
}
