import type { gmail_v1 } from "@googleapis/gmail";
import { GmailGateway } from "@repo/gmail/gateway";
import {
  AccountId,
  AttachmentId,
  GMAIL_FULL_ACCESS_SCOPE,
  GmailAccount,
  GmailCapabilities,
  HistoryId,
  LabelColor,
  LabelId,
  MessageId,
  ThreadId,
} from "@repo/gmail/models";
import { Effect, Option, Redacted } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GmailGatewayLive } from "../src/main/mail/gmail-gateway";

const googleApi = vi.hoisted(() => ({
  attachmentError: undefined as unknown,
  batchError: undefined as unknown,
  clientOptions: [] as { readonly http2?: boolean }[],
  historyRecords: [] as gmail_v1.Schema$History[],
  historyRequests: [] as gmail_v1.Params$Resource$Users$History$List[],
  labelCreates: [] as gmail_v1.Params$Resource$Users$Labels$Create[],
  labelDeletes: [] as gmail_v1.Params$Resource$Users$Labels$Delete[],
  labelError: undefined as unknown,
  labelPatches: [] as gmail_v1.Params$Resource$Users$Labels$Patch[],
  pendingRequest: Promise.withResolvers<undefined>().promise,
  trashError: undefined as unknown,
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
          if (googleApi.labelError !== undefined) {
            return Promise.reject(googleApi.labelError);
          }

          googleApi.labelCreates.push(request);
          return Promise.resolve({
            data: {
              color: request.requestBody?.color,
              id: "Label_created",
              name: request.requestBody?.name,
              type: "user",
            },
          });
        },
      });
      Object.defineProperty(client.users.labels, "delete", {
        value: (request: gmail_v1.Params$Resource$Users$Labels$Delete) => {
          if (googleApi.labelError !== undefined) {
            return Promise.reject(googleApi.labelError);
          }

          googleApi.labelDeletes.push(request);
          return Promise.resolve();
        },
      });
      Object.defineProperty(client.users.labels, "patch", {
        value: (request: gmail_v1.Params$Resource$Users$Labels$Patch) => {
          if (googleApi.labelError !== undefined) {
            return Promise.reject(googleApi.labelError);
          }

          googleApi.labelPatches.push(request);
          return Promise.resolve({
            data: {
              color: request.requestBody?.color,
              id: request.id,
              name: request.requestBody?.name,
              type: "user",
            },
          });
        },
      });
      Object.defineProperty(client.users.messages, "batchModify", {
        value: () =>
          googleApi.batchError === undefined
            ? Promise.resolve()
            : Promise.reject(googleApi.batchError),
      });
      Object.defineProperty(client.users.messages.attachments, "get", {
        value: () =>
          googleApi.attachmentError === undefined
            ? Promise.resolve({ data: { data: "" } })
            : Promise.reject(googleApi.attachmentError),
      });
      Object.defineProperty(client.users.history, "list", {
        value: (request: gmail_v1.Params$Resource$Users$History$List) => {
          googleApi.historyRequests.push(request);
          return Promise.resolve({
            data: {
              history: googleApi.historyRecords,
              historyId: "history-next",
            },
          });
        },
      });
      Object.defineProperty(client.users.threads, "trash", {
        value: () => {
          if (googleApi.trashError !== undefined) {
            return Promise.reject(googleApi.trashError);
          }

          if (versionOrOptions.http2 === true) {
            return googleApi.pendingRequest;
          }

          return Promise.resolve();
        },
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
    googleApi.attachmentError = undefined;
    googleApi.batchError = undefined;
    googleApi.clientOptions.length = 0;
    googleApi.historyRecords.length = 0;
    googleApi.historyRequests.length = 0;
    googleApi.labelError = undefined;
    googleApi.labelCreates.length = 0;
    googleApi.labelDeletes.length = 0;
    googleApi.labelPatches.length = 0;
    googleApi.trashError = undefined;
  });

  it("creates, patches, and deletes labels through Gmail", async () => {
    const color = new LabelColor({
      background: "#4a86e8",
      text: "#ffffff",
    });
    const updatedLabel = await Effect.runPromise(
      GmailGateway.pipe(
        Effect.flatMap((gateway) =>
          Effect.gen(function* mutatesLabels() {
            yield* gateway.createLabel(authorization, "Projects/Kisa", color);
            const updated = yield* gateway.patchLabel(
              authorization,
              LabelId.make("Label_created"),
              "Projects/Kisa 2",
              color
            );
            yield* gateway.deleteLabel(
              authorization,
              LabelId.make("Label_created")
            );
            return updated.value;
          })
        ),
        Effect.provide(GmailGatewayLive)
      )
    );

    expect(updatedLabel).toMatchObject({
      color,
      id: "Label_created",
      name: "Projects/Kisa 2",
      type: "user",
    });
    expect(googleApi.labelCreates).toStrictEqual([
      {
        requestBody: {
          color: { backgroundColor: "#4a86e8", textColor: "#ffffff" },
          name: "Projects/Kisa",
        },
        userId: "me",
      },
    ]);
    expect(googleApi.labelDeletes).toStrictEqual([
      { id: "Label_created", userId: "me" },
    ]);
    expect(googleApi.labelPatches).toStrictEqual([
      {
        id: "Label_created",
        requestBody: {
          color: { backgroundColor: "#4a86e8", textColor: "#ffffff" },
          name: "Projects/Kisa 2",
        },
        userId: "me",
      },
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

  it("requests deleted-message history so remote deletions are synchronized", async () => {
    googleApi.historyRecords.push({
      messagesDeleted: [
        {
          message: { id: "deleted-message", threadId: "deleted-thread" },
        },
      ],
    });

    const result = await Effect.runPromise(
      GmailGateway.pipe(
        Effect.flatMap((gateway) =>
          gateway.listHistory(authorization, HistoryId.make("history-before"))
        ),
        Effect.provide(GmailGatewayLive)
      )
    );

    expect(result.value.removedThreadIds).toStrictEqual(["deleted-thread"]);
    expect(googleApi.historyRequests).toStrictEqual([
      expect.objectContaining({
        historyTypes: [
          "labelAdded",
          "labelRemoved",
          "messageAdded",
          "messageDeleted",
        ],
        startHistoryId: "history-before",
        userId: "me",
      }),
    ]);
  });

  it("classifies a missing Gmail thread distinctly", async () => {
    googleApi.trashError = {
      message: "Requested entity was not found.",
      status: 404,
    };

    const error = await Effect.runPromise(
      GmailGateway.pipe(
        Effect.flatMap((gateway) =>
          gateway.trashThread(authorization, ThreadId.make("stale-thread"))
        ),
        Effect.provide(GmailGatewayLive),
        Effect.flip
      )
    );

    expect(error).toMatchObject({
      _tag: "GmailEntityNotFoundError",
      accountId: authorization.account.id,
      message: "Requested entity was not found.",
      resource: "thread",
    });
  });

  it("classifies a missing Gmail label distinctly", async () => {
    googleApi.labelError = {
      message: "Requested entity was not found.",
      status: 404,
    };

    const error = await Effect.runPromise(
      GmailGateway.pipe(
        Effect.flatMap((gateway) =>
          gateway.deleteLabel(authorization, LabelId.make("Label_stale"))
        ),
        Effect.provide(GmailGatewayLive),
        Effect.flip
      )
    );

    expect(error).toMatchObject({
      _tag: "GmailEntityNotFoundError",
      accountId: authorization.account.id,
      resource: "label",
    });
  });

  it("keeps a create 404 as an operational API failure", async () => {
    googleApi.labelError = {
      message: "Requested entity was not found.",
      status: 404,
    };

    const error = await Effect.runPromise(
      GmailGateway.pipe(
        Effect.flatMap((gateway) =>
          gateway.createLabel(authorization, "New label")
        ),
        Effect.provide(GmailGatewayLive),
        Effect.flip
      )
    );

    expect(error).toMatchObject({
      _tag: "GmailApiError",
      retryable: false,
      status: 404,
    });
  });

  it("classifies missing attachments and batch messages distinctly", async () => {
    const notFound = {
      message: "Requested entity was not found.",
      status: 404,
    };
    googleApi.attachmentError = notFound;

    const attachmentError = await Effect.runPromise(
      GmailGateway.pipe(
        Effect.flatMap((gateway) =>
          gateway.getAttachment(authorization, {
            attachmentId: AttachmentId.make("attachment-1"),
            filename: "document.pdf",
            mediaType: "application/pdf",
            messageId: MessageId.make("message-1"),
          })
        ),
        Effect.provide(GmailGatewayLive),
        Effect.flip
      )
    );

    googleApi.attachmentError = undefined;
    googleApi.batchError = notFound;

    const batchError = await Effect.runPromise(
      GmailGateway.pipe(
        Effect.flatMap((gateway) =>
          gateway.batchModifyMessageLabels(authorization, {
            addLabelIds: [],
            messageIds: [MessageId.make("message-1")],
            removeLabelIds: ["UNREAD"],
          })
        ),
        Effect.provide(GmailGatewayLive),
        Effect.flip
      )
    );

    expect([attachmentError, batchError]).toMatchObject([
      { _tag: "GmailEntityNotFoundError", resource: "attachment" },
      { _tag: "GmailEntityNotFoundError", resource: "message" },
    ]);
  });
});
