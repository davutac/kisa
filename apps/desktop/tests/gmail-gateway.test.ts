import type { gmail_v1 } from "@googleapis/gmail";
import { GmailGateway } from "@repo/gmail/gateway";
import {
  AccountId,
  GMAIL_FULL_ACCESS_SCOPE,
  GmailAccount,
  GmailCapabilities,
  ThreadId,
} from "@repo/gmail/models";
import { Effect, Option, Redacted } from "effect";
import { describe, expect, it, vi } from "vitest";

import { GmailGatewayLive } from "../src/main/mail/gmail-gateway";

const googleApi = vi.hoisted(() => ({
  clientOptions: [] as { readonly http2?: boolean }[],
  pendingRequest: Promise.withResolvers<undefined>().promise,
}));

vi.mock(import("@googleapis/gmail"), async (importOriginal) => {
  const original = await importOriginal();

  function gmail(version: "v1"): gmail_v1.Gmail;
  function gmail(options: gmail_v1.Options): gmail_v1.Gmail;
  function gmail(versionOrOptions: "v1" | gmail_v1.Options): gmail_v1.Gmail {
    const client =
      versionOrOptions === "v1"
        ? original.gmail("v1")
        : original.gmail(versionOrOptions);

    if (versionOrOptions !== "v1") {
      googleApi.clientOptions.push(versionOrOptions);
      Object.defineProperty(client.users.threads, "trash", {
        value: () =>
          versionOrOptions.http2 === true
            ? googleApi.pendingRequest
            : Promise.resolve(),
      });
    }

    return client;
  }

  return {
    ...original,
    gmail,
  };
});

const authorization = {
  account: new GmailAccount({
    capabilities: new GmailCapabilities({
      modify: true,
      read: true,
      send: true,
    }),
    email: "person@example.com",
    id: AccountId.make("person@example.com"),
    scopes: [GMAIL_FULL_ACCESS_SCOPE],
  }),
  credentials: { accessToken: Redacted.make("test-access-token") },
};

describe("Gmail gateway", () => {
  it("settles a bodyless thread-trash request", async () => {
    const result = await Effect.runPromise(
      GmailGateway.pipe(
        Effect.flatMap((gateway) =>
          gateway.trashThread(authorization, ThreadId.make("thread-1"))
        ),
        Effect.provide(GmailGatewayLive),
        Effect.timeoutOption(50)
      )
    );

    expect(Option.isSome(result)).toBeTruthy();
    expect(googleApi.clientOptions).toStrictEqual([
      expect.not.objectContaining({ http2: true }),
    ]);
  });
});
