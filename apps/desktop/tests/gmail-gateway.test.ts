import type { gmail_v1 } from "@googleapis/gmail";
import { GmailGateway } from "@repo/gmail/gateway";
import {
  AccountId,
  GMAIL_FULL_ACCESS_SCOPE,
  GmailAccount,
  GmailCapabilities,
  LabelId,
  ThreadId,
} from "@repo/gmail/models";
import { Effect, Option, Redacted } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GmailGatewayLive } from "../src/main/mail/gmail-gateway";

const googleApi = vi.hoisted(() => ({
  clientOptions: [] as { readonly http2?: boolean }[],
  labelCreates: [] as gmail_v1.Params$Resource$Users$Labels$Create[],
  labelDeletes: [] as gmail_v1.Params$Resource$Users$Labels$Delete[],
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
      Object.defineProperty(client.users.labels, "create", {
        value: (request: gmail_v1.Params$Resource$Users$Labels$Create) => {
          googleApi.labelCreates.push(request);
          return Promise.resolve({
            data: {
              id: "Label_created",
              name: request.requestBody?.name,
              type: "user",
            },
          });
        },
      });
      Object.defineProperty(client.users.labels, "delete", {
        value: (request: gmail_v1.Params$Resource$Users$Labels$Delete) => {
          googleApi.labelDeletes.push(request);
          return Promise.resolve();
        },
      });
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
  beforeEach(() => {
    googleApi.clientOptions.length = 0;
    googleApi.labelCreates.length = 0;
    googleApi.labelDeletes.length = 0;
  });

  it("creates and deletes labels through Gmail", async () => {
    const label = await Effect.runPromise(
      GmailGateway.pipe(
        Effect.flatMap((gateway) =>
          Effect.gen(function* mutatesLabels() {
            const created = yield* gateway.createLabel(
              authorization,
              "Projects/Kisa"
            );
            yield* gateway.deleteLabel(
              authorization,
              LabelId.make("Label_created")
            );
            return created.value;
          })
        ),
        Effect.provide(GmailGatewayLive)
      )
    );

    expect(label).toMatchObject({
      id: "Label_created",
      name: "Projects/Kisa",
      type: "user",
    });
    expect(googleApi.labelCreates).toStrictEqual([
      { requestBody: { name: "Projects/Kisa" }, userId: "me" },
    ]);
    expect(googleApi.labelDeletes).toStrictEqual([
      { id: "Label_created", userId: "me" },
    ]);
  });

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
