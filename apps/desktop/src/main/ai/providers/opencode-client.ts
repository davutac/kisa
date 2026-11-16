import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import * as Effect from "effect/Effect";

import { parseCliVersion, providerFailure, runProbeCommand } from "./shared";

// Stateless generation moved to /api/experimental/generate/text in OpenCode 2.2.
const MINIMUM_MINOR_VERSION = 2;

export const isSupportedOpenCodeVersion = (version: string | undefined) => {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\./u.exec(version ?? "");
  return (
    match?.groups?.["major"] === "2" &&
    Number(match.groups["minor"]) >= MINIMUM_MINOR_VERSION
  );
};

const discoverOpenCode = Effect.tryPromise({
  catch: () =>
    providerFailure(
      "opencode",
      "Could not connect to the OpenCode 2.2+ service"
    ),
  try: () => Service.discover({ version: isSupportedOpenCodeVersion }),
});

export const connectOpenCode = Effect.fn("connectOpenCode")(
  function* connectOpenCode() {
    let endpoint = yield* discoverOpenCode;
    if (endpoint === undefined) {
      const version = yield* runProbeCommand("opencode", ["--version"]);
      const cliVersion =
        version?.exitCode === 0
          ? parseCliVersion(`${version.stdout}\n${version.stderr}`)
          : undefined;
      if (!isSupportedOpenCodeVersion(cliVersion)) {
        return yield* providerFailure(
          "opencode",
          "OpenCode 2.2 or later is required. Install or update OpenCode, then refresh providers."
        );
      }
      // The CLI owns the shared service lifetime; Kisa only owns its HTTP requests.
      const started = yield* runProbeCommand("opencode", ["service", "start"]);
      if (started?.exitCode !== 0) {
        return yield* providerFailure(
          "opencode",
          "Could not start the OpenCode 2.2+ service"
        );
      }
      endpoint = yield* discoverOpenCode;
    }
    if (endpoint === undefined) {
      return yield* providerFailure(
        "opencode",
        "Could not connect to the OpenCode 2.2+ service"
      );
    }
    return OpenCode.make({
      baseUrl: endpoint.url,
      headers: Service.headers(endpoint),
    });
  }
);
