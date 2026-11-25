import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { Effect, Schema } from "effect";

import { APP_NAME } from "@/constants";

// A saved attachment came from whoever sent the message. Marking it the way a
// browser marks a download makes macOS Gatekeeper, and Windows SmartScreen
// and Office Protected View, check it when it is opened instead of treating it
// as a file the reader made. Linux has no equivalent that desktops honour.

const execFileAsync = promisify(execFile);

// Zone 3 is the Internet zone.
const WINDOWS_ZONE_IDENTIFIER = "[ZoneTransfer]\r\nZoneId=3\r\n";

// oxlint-disable-next-line unicorn/throw-new-error
export class DownloadMarkError extends Schema.TaggedError<
  DownloadMarkError,
  { readonly brand: unique symbol }
>()("DownloadMarkError", { message: Schema.String }) {}

const createQuarantineValue = (now: number): string =>
  `0081;${Math.floor(now / 1000).toString(16)};${APP_NAME};`;

export const markAsDownloaded = Effect.fn("markAsDownloaded")(
  function* markAsDownloaded(
    filePath: string,
    platform: NodeJS.Platform = process.platform
  ) {
    if (platform === "darwin") {
      yield* Effect.tryPromise({
        catch: () =>
          new DownloadMarkError({ message: "Could not quarantine the file" }),
        try: () =>
          execFileAsync("/usr/bin/xattr", [
            "-w",
            "com.apple.quarantine",
            createQuarantineValue(Date.now()),
            filePath,
          ]),
      });

      return;
    }

    if (platform === "win32") {
      yield* Effect.tryPromise({
        catch: () =>
          new DownloadMarkError({
            message: "Could not mark the file as downloaded",
          }),
        try: () =>
          writeFile(`${filePath}:Zone.Identifier`, WINDOWS_ZONE_IDENTIFIER),
      });
    }
  }
);
