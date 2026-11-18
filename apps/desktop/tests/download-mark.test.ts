import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { markAsDownloaded } from "../src/main/mail/download-mark";

const directories: string[] = [];

const createSavedFile = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "kisa-download-mark-"));
  directories.push(directory);
  const filePath = path.join(directory, "invoice.pdf");
  writeFileSync(filePath, "%PDF-1.7");
  return filePath;
};

// Each check reads back the mark the operating system itself consults, so it
// runs only on that operating system.
describe(markAsDownloaded, () => {
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.runIf(process.platform === "darwin")(
    "quarantines a saved file on macOS",
    async () => {
      const filePath = createSavedFile();

      await Effect.runPromise(markAsDownloaded(filePath));

      expect(
        execFileSync(
          "/usr/bin/xattr",
          ["-p", "com.apple.quarantine", filePath],
          { encoding: "utf-8" }
        )
      ).toMatch(/^0081;[\da-f]+;Kisa;$/mu);
    }
  );

  it.runIf(process.platform === "win32")(
    "marks a saved file as from the Internet zone on Windows",
    async () => {
      const filePath = createSavedFile();

      await Effect.runPromise(markAsDownloaded(filePath));

      expect(readFileSync(`${filePath}:Zone.Identifier`, "utf-8")).toContain(
        "ZoneId=3"
      );
    }
  );
});
